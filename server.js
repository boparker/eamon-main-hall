import express from 'express';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ── AI Client (Grok via xAI, OpenAI-compatible) ──────────────────────────────
const openai = new OpenAI({
  apiKey: process.env.XAI_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.XAI_API_KEY ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1',
});
const MODEL = process.env.XAI_API_KEY ? 'grok-3-mini' : 'gpt-4o';

// ── ElevenLabs config ─────────────────────────────────────────────────────────
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const VOICES = {
  irishman: 'JBFqnCBsd6RM',  // George — warm, captivating storyteller
  narrator: 'nPczCjzI2dev',  // Brian — deep, resonant and comforting
  shopkeep: 'iP95p4xoKVk5',  // Chris — charming, down-to-earth
};

// ── System prompt ─────────────────────────────────────────────────────────────
const DM_SYSTEM = `You are the Dungeon Master for Eamon: The Second Age, a dark text RPG.
During character creation, you speak as the Burly Irishman — the gruff barkeep who runs the Guild of Free Adventurers. During adventures, you become an omniscient cinematic narrator.

VOICE: Gruff, warm, weathered Irish barkeep. Short sentences. Working-class eloquence. Calls people "lad," "lass," or "adventurer." Occasionally darkly funny.

CRITICAL FORMATTING RULES:
- NEVER use markdown (no **, no ##, no bullets, no numbered lists).
- Plain text only. No emojis.
- Keep responses under 100 words. Punchy. No walls of text.
- ALWAYS drive forward. Never leave the player without a clear next action.

LOCATION TAGS:
At the START of every response, include a location tag on its own line:
[LOCATION: The Great Hall]
or [LOCATION: Marcos Cavielli's Weapon Shop]
or [LOCATION: The Beginner's Cave - Entrance]
etc. This updates the scene title for the player. Always include it.

VOICE TAGS:
At the START of dialogue sections, tag the speaker:
[VOICE: irishman] for the Burly Irishman
[VOICE: narrator] for adventure narration
[VOICE: shopkeep] for shop NPCs
These tags tell the system which voice to use. Always include one after the location tag.

CHOICE FORMATTING:
When presenting choices, format them as:
[CHOICE: Visit the weapon shop]
[CHOICE: Browse the magic emporium]
[CHOICE: Enter the Adventure Gate]
Put these at the END of your response, after the narration. The system renders them as clickable cards. You can include 2-5 choices. The player can still type freely — choices are suggestions, not restrictions.

CHARACTER CREATION FLOW (follow exactly):
1. GREETING: Welcome them. Describe the Guild Hall in 2 sentences. Ask their name.
   Include: [CHOICE: (just type your name below)]
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

INPUT CONTEXT TAGS:
After choices, include one of these to hint how the input should look:
[INPUT: name] — for name entry (quill/parchment style)
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
      id,
      phase: 'intro',
      character: null,
      history: [{ role: 'system', content: DM_SYSTEM }],
    });
  }
  return sessions.get(id);
}

// ── Parse DM response for structured data ─────────────────────────────────────
function parseDMResponse(text) {
  const location = text.match(/\[LOCATION:\s*(.+?)\]/)?.[1] || null;
  const voice = text.match(/\[VOICE:\s*(.+?)\]/)?.[1] || 'narrator';
  const inputHint = text.match(/\[INPUT:\s*(.+?)\]/)?.[1] || 'action';
  const choices = [...text.matchAll(/\[CHOICE:\s*(.+?)\]/g)].map(m => m[1]);

  // Strip tags from display text
  const clean = text
    .replace(/\[LOCATION:.*?\]\n?/g, '')
    .replace(/\[VOICE:.*?\]\n?/g, '')
    .replace(/\[INPUT:.*?\]\n?/g, '')
    .replace(/\[CHOICE:.*?\]\n?/g, '')
    .trim();

  return { location, voice, inputHint, choices, clean };
}

// ── Stream AI with structured parsing ─────────────────────────────────────────
async function streamAI(messages, res, session) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = await openai.chat.completions.create({
      model: MODEL,
      messages,
      stream: true,
      max_tokens: 300,
      temperature: 0.85,
    });

    let full = '';
    let tagBuffer = '';
    let inTag = false;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (!delta) continue;

      full += delta;

      // Process character by character for tag detection
      for (const ch of delta) {
        if (ch === '[') {
          inTag = true;
          tagBuffer = '[';
          continue;
        }
        if (inTag) {
          tagBuffer += ch;
          if (ch === ']') {
            inTag = false;
            // Parse the complete tag
            const locMatch = tagBuffer.match(/\[LOCATION:\s*(.+?)\]/);
            const voiceMatch = tagBuffer.match(/\[VOICE:\s*(.+?)\]/);
            const choiceMatch = tagBuffer.match(/\[CHOICE:\s*(.+?)\]/);
            const inputMatch = tagBuffer.match(/\[INPUT:\s*(.+?)\]/);

            if (locMatch) {
              res.write(`data: ${JSON.stringify({ type: 'location', text: locMatch[1] })}\n\n`);
            } else if (voiceMatch) {
              res.write(`data: ${JSON.stringify({ type: 'voice', voice: voiceMatch[1] })}\n\n`);
            } else if (choiceMatch) {
              res.write(`data: ${JSON.stringify({ type: 'choice', text: choiceMatch[1] })}\n\n`);
            } else if (inputMatch) {
              res.write(`data: ${JSON.stringify({ type: 'input_hint', hint: inputMatch[1] })}\n\n`);
            }
            tagBuffer = '';
          }
          continue;
        }
        // Regular text token
        res.write(`data: ${JSON.stringify({ type: 'token', text: ch })}\n\n`);
      }
    }

    session.history.push({ role: 'assistant', content: full });

    // Send phase update if character was just set
    let phaseUpdate = null;
    if (session.phase === 'classed' && session.character) {
      phaseUpdate = { phase: 'playing', character: session.character };
    }

    // Parse full response for TTS text
    const parsed = parseDMResponse(full);

    res.write(`data: ${JSON.stringify({
      type: 'done',
      full: parsed.clean,
      phaseUpdate,
      voiceId: VOICES[parsed.voice] || VOICES.narrator,
      ttsText: parsed.clean,
    })}\n\n`);
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

  const vid = voiceId || VOICES.narrator;

  try {
    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVEN_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text.slice(0, 500), // Cap length for cost
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.35 },
      }),
    });

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error('ElevenLabs error:', errText);
      return res.status(ttsRes.status).json({ error: errText });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');

    const reader = ttsRes.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); return; }
        res.write(Buffer.from(value));
      }
    };
    await pump();
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
    content: '[SYSTEM: The player just entered the Guild Hall. Greet them as the Burly Irishman. 2 vivid sentences about the hall, then ask their name. Under 60 words. Remember to include [LOCATION: The Great Hall], [VOICE: irishman], and [INPUT: name] tags.]'
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
      content: '[Acknowledge their name warmly. Offer three paths: Warrior, Rogue, Mystic. Use [CHOICE:] tags for each. Include [VOICE: irishman], [LOCATION: The Great Hall], [INPUT: choice]. Under 80 words.]'
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
      content: `[They chose ${cls}. Stats: HD ${stats[cls].hd}, AG ${stats[cls].ag}, CH ${stats[cls].ch}, Gold ${stats[cls].gold}. Confirm with flavor, state stats, offer shops or Adventure Gate. Use [CHOICE:] tags, [VOICE: irishman], [LOCATION: The Great Hall], [INPUT: choice]. Under 100 words.]`
    });
  } else {
    session.history.push({ role: 'user', content: message });
  }

  await streamAI(session.history, res, session);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Eamon: The Second Age — port ${PORT} — model: ${MODEL}`));
