// llm.js — The one place the game talks to a language model. Everything above
// this layer (narrator, parley, hints, lore) calls complete()/completeJSON()
// and ALWAYS has a deterministic fallback: any failure, timeout, missing key,
// or EAMON_AI=off returns null and the game plays on rules-only, exactly as it
// did before AI existed. The model never touches game state — it only writes
// prose and structured suggestions the engine validates.

import { createHash } from 'node:crypto';

const DEFAULT_MODEL = process.env.EAMON_AI_MODEL || 'claude-haiku-4-5-20251001';
const DEFAULT_TIMEOUT_MS = Number(process.env.EAMON_AI_TIMEOUT_MS) || 8000;
const CACHE_MAX = 500;

// Simple in-memory LRU (Map preserves insertion order).
const cache = new Map();

function cacheGet(key) {
  if (!key || !cache.has(key)) return undefined;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function cacheSet(key, value) {
  if (!key) return;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

export function cacheKey(...parts) {
  return createHash('md5').update(parts.map((p) => JSON.stringify(p ?? null)).join('|')).digest('hex');
}

let clientPromise = null;

export function isEnabled() {
  if (String(process.env.EAMON_AI ?? '').toLowerCase() === 'off') return false;
  return !!process.env.ANTHROPIC_API_KEY;
}

async function getClient() {
  if (!isEnabled()) return null;
  if (!clientPromise) {
    clientPromise = import('@anthropic-ai/sdk')
      .then(({ default: Anthropic }) => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }))
      .catch(() => null);
  }
  return clientPromise;
}

// For tests: reset module state.
export function _reset() {
  clientPromise = null;
  cache.clear();
}

// One completion. Returns the text or null (never throws).
export async function complete({ system, prompt, maxTokens = 300, temperature = 0.8, key = null, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const client = await getClient();
  if (!client) return null;

  try {
    const response = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: maxTokens,
      temperature,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }],
    }, { timeout: timeoutMs, maxRetries: 1 });
    const text = response?.content?.find((block) => block.type === 'text')?.text?.trim() ?? null;
    if (text) cacheSet(key, text);
    return text || null;
  } catch {
    return null;
  }
}

// A completion that must come back as JSON matching `validate(parsed)`.
// Retries once with the parse error appended; returns the object or null.
export async function completeJSON({ system, prompt, validate = () => true, maxTokens = 400, temperature = 0.7, key = null, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = await complete({
      system,
      prompt: attempt === 0 ? prompt : `${prompt}\n\nYour previous reply was not valid JSON matching the schema. Reply with ONLY the JSON object.`,
      maxTokens,
      temperature,
      key: null, // raw text isn't cached; the validated object is
      timeoutMs,
    });
    if (!text) return null;
    try {
      // Tolerate code fences and leading prose around the JSON object.
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) continue;
      const parsed = JSON.parse(match[0]);
      if (validate(parsed)) {
        cacheSet(key, parsed);
        return parsed;
      }
    } catch {
      // fall through to retry
    }
  }
  return null;
}
