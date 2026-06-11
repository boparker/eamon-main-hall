// chronicle.js — The character's persistent memory: a deed log written by the
// deterministic engine (every entry is something that verifiably happened) and
// an optional AI-compressed summary when the log grows long. The chronicle
// rides on the character row, feeds the narrator and parley prompts, and makes
// consequence persist across adventures: the Hall remembers.

import { complete, isEnabled } from './llm.js';

export const MAX_DEEDS = 40;
const COMPRESS_AT = 30;
const KEEP_RECENT = 10;

export function chronicleOf(character) {
  const chronicle = character?.chronicle;
  return {
    summary: typeof chronicle?.summary === 'string' ? chronicle.summary : '',
    deeds: Array.isArray(chronicle?.deeds) ? chronicle.deeds : [],
  };
}

// Append a deed (immutable). The engine calls this only for events it
// resolved itself, so the chronicle is always true.
export function recordDeed(character, text, { at = new Date().toISOString() } = {}) {
  if (!text) return character;
  const { summary, deeds } = chronicleOf(character);
  const next = [...deeds, { at, text }].slice(-MAX_DEEDS);
  return { ...character, chronicle: { summary, deeds: next } };
}

export function recordDeeds(character, texts = [], opts = {}) {
  return texts.filter(Boolean).reduce((c, text) => recordDeed(c, text, opts), character);
}

// When the log grows long, ask the model to fold older deeds into the prose
// summary, keeping the recent ones verbatim. On any failure the chronicle is
// left as-is (it just stays a longer list — never lossy without a summary).
export async function maybeCompress(character) {
  const { summary, deeds } = chronicleOf(character);
  if (!isEnabled() || deeds.length < COMPRESS_AT) return character;

  const toFold = deeds.slice(0, deeds.length - KEEP_RECENT);
  const text = await complete({
    system: 'You compress an adventurer\'s deed log into a chronicle. Third person, past tense, storybook register, 3-5 sentences. Use ONLY the deeds given — never invent. Keep names. Classroom-safe.',
    prompt: `Existing chronicle (may be empty): ${summary || '(none)'}\n\nDeeds to fold in:\n${toFold.map((d) => `- ${d.text}`).join('\n')}\n\nWrite the updated chronicle.`,
    maxTokens: 250,
    temperature: 0.6,
    key: null,
  });
  if (!text) return character;
  return { ...character, chronicle: { summary: text, deeds: deeds.slice(-KEEP_RECENT) } };
}
