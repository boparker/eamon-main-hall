import express from 'express';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ── AI Client ─────────────────────────────────────────────────────────────────
let AI_PROVIDER, MODEL;
if (process.env.ANTHROPIC_API_KEY) {
  AI_PROVIDER = 'anthropic';
  MODEL = 'claude-3-5-haiku-20241022';
} else if (process.env.XAI_API_KEY) {
  AI_PROVIDER = 'xai';
  MODEL = 'grok-3-mini';
} else {
  AI_PROVIDER = 'openai';
  MODEL = 'gpt-4o';
}

const anthropic = AI_PROVIDER === 'anthropic' ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
const openai = AI_PROVIDER !== 'anthropic' ? new OpenAI({
  apiKey: process.env.XAI_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.XAI_API_KEY ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1',
}) : null;

// ── ElevenLabs config (FULL voice IDs) ────────────────────────────────────────
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const VOICES = {
  irishman: 'JBFqnCBsd6RMkjVDRZzb',  // George — warm, captivating storyteller (British)
  narrator: 'nPczCjzI2devNBz1zQrb',  // Brian — deep, resonant and comforting
  shopkeep: 'iP95p4xoKVk53GoZ742B',  // Chris — charming, down-to-earth
};

// ── System prompt ─────────────────────────────────────────────────────────────
const DM_SYSTEM = `You are the Dungeon Master for Eamon: The Second Age, a dark text RPG.
During character creation, you speak as the Burly Irishman — the gruff barkeep who runs the Guild of Free Adventurers. During adventures, you become an omniscient cinematic narrator.

VOICE: Gruff, warm, weathered Irish barkeep. Short sentences. Working-class eloquence. Calls people "lad," "lass," or "adventurer." Occasionally darkly funny.

CRITICAL: NEVER start a response with "Ah" or "Ah," — vary your openings. Use direct statements, observations, actions, or descriptions. Each response must begin differently from the last three.

CRITICAL FORMATTING RULES:
- NEVER use markdown (no **, no ##, no bullets, no numbered lists).
- Plain text only. No emojis.
- Keep responses under 100 words. Punchy. No walls of text.
- ALWAYS drive forward. Never leave the player without a clear next action.
- When you ask the player to DO something (a question they must answer, an action they must take), wrap that specific phrase in curly braces like {What's your name, lad?} or {Which path calls to you?}. Only the actionable question/prompt, not the whole paragraph.

LOCATION TAGS:
At the START of every response, include a location tag on its own line:
[LOCATION: The Great Hall]
or [LOCATION: Marcos Cavielli's Weapon Shop]
or [LOCATION: The Beginner's Cave - Entrance]
etc. This updates the scene title for the player. Always include it.

VOICE TAGS:
After the location tag, tag the speaker:
[VOICE: irishman] for the Burly Irishman
[VOICE: narrator] for adventure narration
[VOICE: shopkeep] for shop NPCs
These tags tell the system which voice to use. Always include one.

CHOICE FORMATTING:
When presenting choices, format them as:
[CHOICE: Visit the weapon shop]
[CHOICE: Browse the magic emporium]
[CHOICE: Enter the Adventure Gate]
Put these at the END of your response, after the narration. 2-5 choices. The player can still type freely.

CHARACTER CREATION FLOW (follow exactly):
1. GREETING: Welcome them. Describe the Guild Hall in 2 sentences. Then: {What's your name, adventurer?}
   Include: [CHOICE: (type your name below)]
2. AFTER NAME: Acknowledge warmly. Offer three paths:
   [CHOICE: The way of the Warrior — strong and tough]
   [CHOICE: The path of the Rogue — quick and cunning]
   [CHOICE: The calling of the Mystic — charming and magical]
3. AFTER CLASS: Confirm with flavor. Announce stats plainly. Then offer:
   [CHOICE: Visit Marcos Cavielli's weapon shop]
   [CHOICE: Browse Hokas Tokas' magic emporium]
   [CHOICE: Step through the Adventure Gate]

ADVENTURE MODE:
When the player enters an adventure, shift to cinematic narrator voice.
- Use [VOICE: narrator] and update [LOCATION: ...] for each room.
- Describe rooms vividly in 2-3 sentences.
- Present choices for movement/action.
- Track combat logically. Enemies have HP. The player can die.

SHOP DATA TAGS:
When the player enters a shop, include a shop inventory tag:
[SHOP: marcos]
or [SHOP: hokas] or [SHOP: bank] or [SHOP: pawn]
This triggers a side panel showing all items and prices. The player can browse visually and tap to buy.
After the shop tag, give a brief 1-2 sentence greeting from the shopkeeper. Don't list individual items in the narration — the panel handles that.
When leaving a shop, include [SHOP: close].

INPUT CONTEXT TAGS:
After choices, include one of these to hint how the input should look:
[INPUT: name] — for name entry
[INPUT: choice] — for selecting from options
[INPUT: action] — for freeform adventure commands
[INPUT: shop] — for shop interactions

STATS (reference):
- Warrior: Hardiness 22, Agility 14, Charisma 10, Gold 200
- Rogue: Hardiness 14, Agility 22, Charisma 12, Gold 200
- Mystic: Hardiness 12, Agility 14, Charisma 22, Gold 250
`;

// ── Session store ─────────────────────────────────────────────────────────────
const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      id, phase: 'intro', character: null,
      history: [{ role: 'system', content: DM_SYSTEM }],
    });
  }
  return sessions.get(id);
}

// ── Stream AI with tag parsing ────────────────────────────────────────────────
async function streamAI(messages, res, session) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // Create stream based on provider
    let streamIterator;
    if (AI_PROVIDER === 'anthropic') {
      // Convert messages: extract system, keep user/assistant
      const systemMsg = messages.find(m => m.role === 'system')?.content || '';
      const chatMsgs = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
      const anthropicStream = anthropic.messages.stream({
        model: MODEL, system: systemMsg, messages: chatMsgs,
        max_tokens: 300, temperature: 0.85,
      });
      streamIterator = (async function*() {
        for await (const event of anthropicStream) {
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            yield event.delta.text;
          }
        }
      })();
    } else {
      const oaiStream = await openai.chat.completions.create({
        model: MODEL, messages, stream: true, max_tokens: 300, temperature: 0.85,
      });
      streamIterator = (async function*() {
        for await (const chunk of oaiStream) {
          const delta = chunk.choices[0]?.delta?.content || '';
          if (delta) yield delta;
        }
      })();
    }

    let full = '';
    let tagBuffer = '';
    let inTag = false;
    let braceBuffer = '';
    let inBrace = false;

    for await (const delta of streamIterator) {
      full += delta;

      for (const ch of delta) {
        // Brace detection for action highlights
        if (ch === '{' && !inTag) { inBrace = true; braceBuffer = ''; continue; }
        if (ch === '}' && inBrace) {
          inBrace = false;
          res.write(`data: ${JSON.stringify({ type: 'action_text', text: braceBuffer })}\n\n`);
          braceBuffer = '';
          continue;
        }
        if (inBrace) { braceBuffer += ch; continue; }

        // Tag detection
        if (ch === '[') { inTag = true; tagBuffer = '['; continue; }
        if (inTag) {
          tagBuffer += ch;
          if (ch === ']') {
            inTag = false;
            const locMatch = tagBuffer.match(/\[LOCATION:\s*(.+?)\]/);
            const voiceMatch = tagBuffer.match(/\[VOICE:\s*(.+?)\]/);
            const choiceMatch = tagBuffer.match(/\[CHOICE:\s*(.+?)\]/);
            const inputMatch = tagBuffer.match(/\[INPUT:\s*(.+?)\]/);
            const shopMatch = tagBuffer.match(/\[SHOP:\s*(.+?)\]/);
            if (locMatch) res.write(`data: ${JSON.stringify({ type: 'location', text: locMatch[1] })}\n\n`);
            else if (voiceMatch) res.write(`data: ${JSON.stringify({ type: 'voice', voice: voiceMatch[1] })}\n\n`);
            else if (choiceMatch) res.write(`data: ${JSON.stringify({ type: 'choice', text: choiceMatch[1] })}\n\n`);
            else if (inputMatch) res.write(`data: ${JSON.stringify({ type: 'input_hint', hint: inputMatch[1] })}\n\n`);
            else if (shopMatch) res.write(`data: ${JSON.stringify({ type: 'shop', shop: shopMatch[1] })}\n\n`);
            tagBuffer = '';
          }
          continue;
        }
        res.write(`data: ${JSON.stringify({ type: 'token', text: ch })}\n\n`);
      }
    }

    session.history.push({ role: 'assistant', content: full });

    let phaseUpdate = null;
    if (session.phase === 'classed' && session.character) {
      phaseUpdate = { phase: 'playing', character: session.character };
    }

    // Clean text for TTS
    const clean = full
      .replace(/\[LOCATION:.*?\]\n?/g, '').replace(/\[VOICE:.*?\]\n?/g, '')
      .replace(/\[INPUT:.*?\]\n?/g, '').replace(/\[CHOICE:.*?\]\n?/g, '')
      .replace(/[{}]/g, '').trim();

    // Determine voice from response
    const voiceKey = full.match(/\[VOICE:\s*(.+?)\]/)?.[1] || 'narrator';
    const voiceId = VOICES[voiceKey] || VOICES.narrator;

    res.write(`data: ${JSON.stringify({ type: 'done', full: clean, phaseUpdate, voiceId, ttsText: clean })}\n\n`);
    res.end();
  } catch (err) {
    console.error(err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
}

// ── ElevenLabs TTS endpoint ───────────────────────────────────────────────────
app.post('/api/tts', async (req, res) => {
  const { text, voiceId } = req.body;
  if (!text || !ELEVEN_KEY) return res.status(400).json({ error: 'missing text or API key' });

  try {
    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId || VOICES.narrator}/stream`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text.slice(0, 500),
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.35 },
      }),
    });

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error('ElevenLabs error:', ttsRes.status, errText);
      return res.status(ttsRes.status).json({ error: errText });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');
    const reader = ttsRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      res.write(Buffer.from(value));
    }
  } catch (err) {
    console.error('TTS error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Start session ─────────────────────────────────────────────────────────────
app.post('/api/start', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'missing sessionId' });

  const session = getSession(sessionId);
  session.history = [{ role: 'system', content: DM_SYSTEM }];
  session.phase = 'intro';

  session.history.push({
    role: 'user',
    content: '[SYSTEM: Player entered the Guild Hall. Greet them as the Burly Irishman. 2 vivid sentences about the hall, then ask their name using {braces} around the question. Under 60 words. Include [LOCATION: The Great Hall], [VOICE: irishman], [INPUT: name] tags, and [CHOICE: (type your name below)].]'
  });

  await streamAI(session.history, res, session);
});

// ── Chat ──────────────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: 'missing fields' });

  const session = getSession(sessionId);

  if (session.phase === 'intro') {
    session.character = { name: message.trim() };
    session.phase = 'named';
    session.history.push({ role: 'user', content: `My name is ${message}` });
    session.history.push({
      role: 'system',
      content: '[Acknowledge name warmly. Offer three paths: Warrior, Rogue, Mystic. Use [CHOICE:] tags. Use {braces} around the question asking which path. Include [VOICE: irishman], [LOCATION: The Great Hall], [INPUT: choice]. Under 80 words.]'
    });
  } else if (session.phase === 'named') {
    const lower = message.toLowerCase();
    let cls = 'warrior';
    if (lower.includes('rogue') || lower.includes('thief') || lower.includes('quick') || lower.includes('cunning')) cls = 'rogue';
    if (lower.includes('mystic') || lower.includes('magic') || lower.includes('mage') || lower.includes('wizard')) cls = 'mystic';

    const stats = {
      warrior: { hd: 22, ag: 14, ch: 10, gold: 200 },
      rogue:   { hd: 14, ag: 22, ch: 12, gold: 200 },
      mystic:  { hd: 12, ag: 14, ch: 22, gold: 250 },
    };

    session.character = { ...session.character, class: cls, ...stats[cls] };
    session.phase = 'classed';

    session.history.push({ role: 'user', content: `I choose the path of the ${cls}.` });
    session.history.push({
      role: 'system',
      content: `[They chose ${cls}. Stats: HD ${stats[cls].hd}, AG ${stats[cls].ag}, CH ${stats[cls].ch}, Gold ${stats[cls].gold}. Confirm with flavor, state stats, offer shops or Adventure Gate. Use [CHOICE:] tags, {braces} around the question, [VOICE: irishman], [LOCATION: The Great Hall], [INPUT: choice]. Under 100 words.]`
    });
  } else {
    session.history.push({ role: 'user', content: message });
  }

  await streamAI(session.history, res, session);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Eamon: The Second Age — port ${PORT} — model: ${MODEL}`));
