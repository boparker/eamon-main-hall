import express from 'express';
import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── System prompt: the AI Dungeon Master ──────────────────────────────────────
const DM_SYSTEM = `You are the Dungeon Master for a dark, immersive text RPG called Modern Eamon.
You run adventures in the tradition of old D&D — but with full narrative freedom.

TONE: Cinematic, atmospheric, literary. Think Cormac McCarthy meets Tolkien. 
Sparse but vivid. No purple prose. No exclamation points. Dark, dangerous, beautiful.

RULES:
- The player's character has stats: Hardiness (health/strength), Agility (speed/dexterity), Charisma (persuasion/luck)
- Rolls are implied — sometimes you succeed, sometimes you fail. Describe outcomes with consequence.
- Combat is real. Characters can die. Create tension.
- NPCs have personalities and remember what the player did.
- The world reacts to player choices.
- NEVER break character. NEVER explain mechanics out loud. Just narrate.
- Keep responses under 120 words. Tight, punchy, cinematic.
- End each response with what the player perceives — a sight, sound, or choice that hangs in the air.
- DO NOT list numbered options. The player types freely.

WORLD: The Guild of Free Adventurers occupies a great hall at the edge of the known world.
Beyond its doors: caves, ruins, dungeons, forgotten places. Some adventures are deadly. All are real.

When the session starts, you describe the Main Hall briefly and ask the player's name.
`;

// ── In-memory session store (replace with Redis for production) ───────────────
const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      id,
      character: null,
      history: [{ role: 'system', content: DM_SYSTEM }],
      roomImageCache: new Map(),
    });
  }
  return sessions.get(id);
}

// ── Stream endpoint ───────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: 'missing fields' });

  const session = getSession(sessionId);
  session.history.push({ role: 'user', content: message });

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: session.history,
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

    // Signal done
    res.write(`data: ${JSON.stringify({ type: 'done', full })}\n\n`);
    res.end();
  } catch (err) {
    console.error(err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

// ── Start session ─────────────────────────────────────────────────────────────
app.post('/api/start', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'missing sessionId' });

  const session = getSession(sessionId);
  // Reset for fresh start
  session.history = [{ role: 'system', content: DM_SYSTEM }];

  // SSE stream the opening narration
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        ...session.history,
        { role: 'user', content: 'Begin the game. Set the scene in the Main Hall. Make it dark, atmospheric, cinematic. Ask for my name.' }
      ],
      stream: true,
      max_tokens: 180,
      temperature: 0.9,
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
    res.write(`data: ${JSON.stringify({ type: 'done', full })}\n\n`);
    res.end();
  } catch (err) {
    console.error(err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Eamon AI running on port ${PORT}`));
