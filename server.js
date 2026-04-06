import express from 'express';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Use xAI/Grok (OpenAI-compatible) — falls back to OpenAI if no XAI key
const openai = new OpenAI({
  apiKey: process.env.XAI_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.XAI_API_KEY ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1',
});

// ── System prompt: the AI Dungeon Master ──────────────────────────────────────
const DM_SYSTEM = `You are the Dungeon Master and narrator for Eamon: The Second Age, a dark text RPG.
You speak as a character — the Burly Irishman who runs the Guild of Free Adventurers.

VOICE: Gruff, warm, weathered. A barkeep who's seen a thousand adventurers come and go. Think a medieval Irish publican — direct, colorful, occasionally darkly funny. You call people "lad," "lass," or just "adventurer." Short sentences. Working-class eloquence.

CRITICAL RULES:
- ALWAYS drive the conversation forward. Never leave the player without a clear next action.
- After EVERY response, tell the player exactly what to type or do next.
- Keep responses under 100 words. Punchy. No walls of text.
- Stay in character always. You ARE the Burly Irishman during character creation. During adventures, you become an omniscient narrator.
- Never use markdown formatting (no **, no ##, no bullets). Plain text only.
- Do not use emojis.

CHARACTER CREATION FLOW (follow this exactly):
1. GREETING: Welcome them to the Guild Hall. Describe it in 2 sentences max. Then ask: "What's your name, adventurer?" — nothing else.
2. AFTER NAME: Acknowledge their name with personality. Then ask them to choose a path:
   "Three paths lie before you: the way of the Warrior (strong, tough), the Rogue (quick, cunning), or the Mystic (charming, magical). Which calls to you?"
3. AFTER CLASS: Confirm their choice with flavor. Announce their stats. Then say:
   "The Guild Hall has much to offer before you venture out. You could visit Marcos Cavielli at the weapon shop, browse Hokas Tokas' magic emporium, or... if you're feeling bold, step through the Adventure Gate and face what's waiting in the dark. What'll it be?"
4. From here, respond to whatever they choose. If they go to a shop, roleplay the shopkeeper. If they choose the gate, begin the Beginner's Cave adventure.

ADVENTURE MODE:
When the player enters an adventure, shift from the Irishman's voice to a cinematic narrator voice.
- Describe rooms vividly but briefly (2-3 sentences max).
- When combat starts, describe the enemy and the tension. Let the player choose their action freely.
- Track combat logically. Enemies have HP. Hits deal damage. The player can die.
- After clearing a room or defeating an enemy, describe what they see and hear next.
- Always end with a clear prompt for action.

STATS (for reference):
- Warrior: Hardiness 22, Agility 14, Charisma 10, Gold 200
- Rogue: Hardiness 14, Agility 22, Charisma 12, Gold 200
- Mystic: Hardiness 12, Agility 14, Charisma 22, Gold 250
`;

// ── In-memory session store ───────────────────────────────────────────────────
const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      id,
      phase: 'intro', // intro → named → classed → playing
      character: null,
      history: [{ role: 'system', content: DM_SYSTEM }],
    });
  }
  return sessions.get(id);
}

// ── Shared streaming helper ───────────────────────────────────────────────────
async function streamAI(messages, res, session) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = await openai.chat.completions.create({
      model: process.env.XAI_API_KEY ? 'grok-3-mini' : 'gpt-4o',
      messages,
      stream: true,
      max_tokens: 200,
      temperature: 0.85,
    });

    let full = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        full += delta;
        res.write(`data: ${JSON.stringify({ type: 'token', text: delta })}\n\n`);
      }
    }

    session.history.push({ role: 'assistant', content: full });

    // Detect phase transitions from DM response
    let phaseUpdate = null;
    if (session.phase === 'intro') {
      // DM just asked for name — next input will be name
    } else if (session.phase === 'named') {
      // DM just asked for class — next input will be class choice
    } else if (session.phase === 'classed') {
      // DM announced stats — send them to client
      phaseUpdate = { phase: 'playing', character: session.character };
    }

    res.write(`data: ${JSON.stringify({ type: 'done', full, phaseUpdate })}\n\n`);
    res.end();
  } catch (err) {
    console.error(err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
}

// ── Start session ─────────────────────────────────────────────────────────────
app.post('/api/start', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'missing sessionId' });

  const session = getSession(sessionId);
  session.history = [{ role: 'system', content: DM_SYSTEM }];
  session.phase = 'intro';

  const startMsg = { role: 'user', content: '[SYSTEM: The player just entered the Guild Hall for the first time. Greet them in character as the Burly Irishman. Describe the hall in 1-2 vivid sentences, then ask their name. Keep it under 60 words. End with a direct question asking their name.]' };
  session.history.push(startMsg);

  await streamAI(session.history, res, session);
});

// ── Chat endpoint ─────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: 'missing fields' });

  const session = getSession(sessionId);

  // Phase-aware message wrapping
  let wrappedMessage = message;

  if (session.phase === 'intro') {
    // Player is giving their name
    wrappedMessage = `My name is ${message}`;
    session.character = { name: message.trim() };
    session.phase = 'named';

    // Add instruction for DM to offer class choice
    session.history.push({ role: 'user', content: wrappedMessage });
    session.history.push({ role: 'system', content: '[Acknowledge their name warmly. Now offer the three paths: Warrior (strong/tough), Rogue (quick/cunning), Mystic (charming/magical). Keep it under 80 words. Make each path sound appealing but distinct.]' });
  } else if (session.phase === 'named') {
    // Player is choosing a class
    const lower = message.toLowerCase();
    let cls = 'warrior';
    if (lower.includes('rogue') || lower.includes('thief') || lower.includes('quick') || lower.includes('cunning') || lower.includes('agil')) cls = 'rogue';
    if (lower.includes('mystic') || lower.includes('magic') || lower.includes('mage') || lower.includes('wizard') || lower.includes('charm')) cls = 'mystic';

    const stats = {
      warrior: { hd: 22, ag: 14, ch: 10, gold: 200 },
      rogue:   { hd: 14, ag: 22, ch: 12, gold: 200 },
      mystic:  { hd: 12, ag: 14, ch: 22, gold: 250 },
    };

    session.character = {
      ...session.character,
      class: cls,
      ...stats[cls],
    };
    session.phase = 'classed';

    session.history.push({ role: 'user', content: `I choose the path of the ${cls}.` });
    session.history.push({ role: 'system', content: `[They chose ${cls}. Their stats: Hardiness ${stats[cls].hd}, Agility ${stats[cls].ag}, Charisma ${stats[cls].ch}, Gold ${stats[cls].gold}. Confirm their choice with 1-2 lines of flavor. State their stats plainly. Then offer: visit Marcos Cavielli's weapon shop, Hokas Tokas' magic emporium, or step through the Adventure Gate. Under 100 words.]` });
  } else {
    session.history.push({ role: 'user', content: message });
  }

  await streamAI(session.history, res, session);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Eamon: The Second Age running on port ${PORT}`));
