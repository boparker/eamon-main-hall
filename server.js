import express from 'express';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import crypto from 'crypto';

const { Pool } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ── Database Setup ────────────────────────────────────────────────────────────
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

async function initDatabase() {
  if (!pool) {
    console.log('[DB] No DATABASE_URL, skipping database init');
    return;
  }
  
  try {
    console.log('[DB] Checking connection...');
    await pool.query('SELECT NOW()');
    console.log('[DB] Connected successfully');
    
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'adventures'
      );
    `);
    
    if (tableCheck.rows[0].exists) {
      console.log('[DB] Schema already initialized');
      return;
    }
    
    console.log('[DB] Creating schema...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS adventures (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        difficulty INTEGER DEFAULT 1,
        author TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS locations (
        id SERIAL PRIMARY KEY,
        adventure_id INTEGER REFERENCES adventures(id),
        room_number INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        style_prompt_prefix TEXT,
        image_url TEXT,
        UNIQUE(adventure_id, room_number)
      );
      
      CREATE TABLE IF NOT EXISTS characters (
        id SERIAL PRIMARY KEY,
        adventure_id INTEGER REFERENCES adventures(id),
        name TEXT NOT NULL,
        description TEXT,
        type TEXT CHECK (type IN ('monster', 'npc', 'friendly')),
        hardiness INTEGER DEFAULT 10,
        agility INTEGER DEFAULT 10,
        charisma INTEGER DEFAULT 10,
        portrait_url TEXT
      );
      
      CREATE TABLE IF NOT EXISTS exits (
        id SERIAL PRIMARY KEY,
        location_id INTEGER REFERENCES locations(id),
        direction TEXT NOT NULL,
        destination_room INTEGER NOT NULL,
        description TEXT
      );
    `);
    
    console.log('[DB] Schema created successfully');
    console.log('[DB] Ready for seed data');
    
  } catch (err) {
    console.error('[DB] Initialization error:', err.message);
  }
}

// ── AI Client ─────────────────────────────────────────────────────────────────
let AI_PROVIDER, MODEL;
if (process.env.XAI_API_KEY) {
  AI_PROVIDER = 'xai';
  MODEL = 'grok-3-mini';
} else if (process.env.OPENAI_API_KEY) {
  AI_PROVIDER = 'openai';
  MODEL = 'gpt-4o';
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
  irishman: 'JBFqnCBsd6RMkjVDRZzb',
  narrator: 'nPczCjzI2devNBz1zQrb',
  shopkeep: 'iP95p4xoKVk53GoZ742B',
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
   Include: [CHOICE: Type your name]
2. AFTER NAME: Acknowledge warmly. Offer three paths:
   [CHOICE: The way of the Warrior — strong and tough]
   [CHOICE: The path of the Rogue — quick and cunning]
   [CHOICE: The calling of the Mystic — charming and magical]
3. AFTER CLASS: Confirm with flavor. Announce stats plainly. Then offer:
   [CHOICE: Visit Marcos Cavielli's weapon shop]
   [CHOICE: Browse Hokas Tokas' magic emporium]
   [CHOICE: Step through the Adventure Gate]

MAIN HALL NAVIGATION:
After the player leaves ANY shop, ALWAYS return them to the Main Hall.
- Use [LOCATION: The Great Hall] and [VOICE: irishman]
- Acknowledge what they bought (if anything), then offer the remaining options:
   [CHOICE: Visit Marcos Cavielli's weapon shop]
   [CHOICE: Browse Hokas Tokas' magic emporium]
   [CHOICE: Visit Shylock McFenney's bank]
   [CHOICE: See Sam Slicker's pawn shop]
   [CHOICE: Step through the Adventure Gate]
- NEVER re-ask their name or class. Character creation happens ONCE. Once a name and class are set, that phase is DONE FOREVER for this session.
- If the player says "leave," "back," "exit," or "done" while in a shop, return to Main Hall.

ADVENTURE MODE:
When the player enters an adventure, shift to cinematic narrator voice.
- Use [VOICE: narrator] and update [LOCATION: ...] for each room.
- Describe rooms vividly in 2-3 sentences.
- Present choices for movement/action.
- Track combat logically. Enemies have HP. The player can die.

MONSTER/NPC PORTRAIT TAGS:
When the player encounters a monster or notable NPC for the first time, include:
[MONSTER: Goblin | snarling green-skinned creature with jagged teeth and rusty dagger]
or [NPC: Cynthia | young woman with auburn hair and leather armor, kind eyes]
The description after | should be a vivid visual description (10-20 words) for portrait generation.
Use [MONSTER: ...] for hostile creatures and [NPC: ...] for friendly/neutral characters.
Only emit this tag ONCE per unique character/monster per session.

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
    let streamIterator;
    if (AI_PROVIDER === 'anthropic') {
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
        if (ch === '{' && !inTag) { inBrace = true; braceBuffer = ''; continue; }
        if (ch === '}' && inBrace) {
          inBrace = false;
          res.write(`data: ${JSON.stringify({ type: 'action_text', text: braceBuffer })}\n\n`);
          braceBuffer = '';
          continue;
        }
        if (inBrace) { braceBuffer += ch; continue; }

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
            const monsterMatch = tagBuffer.match(/\[MONSTER:\s*(.+?)(?:\s*\|\s*(.+?))?\]/);
            const npcMatch = tagBuffer.match(/\[NPC:\s*(.+?)(?:\s*\|\s*(.+?))?\]/);
            if (locMatch) res.write(`data: ${JSON.stringify({ type: 'location', text: locMatch[1] })}\n\n`);
            else if (voiceMatch) res.write(`data: ${JSON.stringify({ type: 'voice', voice: voiceMatch[1] })}\n\n`);
            else if (choiceMatch) res.write(`data: ${JSON.stringify({ type: 'choice', text: choiceMatch[1] })}\n\n`);
            else if (inputMatch) res.write(`data: ${JSON.stringify({ type: 'input_hint', hint: inputMatch[1] })}\n\n`);
            else if (shopMatch) res.write(`data: ${JSON.stringify({ type: 'shop', shop: shopMatch[1] })}\n\n`);
            else if (monsterMatch) res.write(`data: ${JSON.stringify({ type: 'portrait', name: monsterMatch[1], desc: monsterMatch[2] || '', kind: 'monster' })}\n\n`);
            else if (npcMatch) res.write(`data: ${JSON.stringify({ type: 'portrait', name: npcMatch[1], desc: npcMatch[2] || '', kind: 'npc' })}\n\n`);
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

    const clean = full
      .replace(/\[LOCATION:.*?\]\n?/g, '').replace(/\[VOICE:.*?\]\n?/g, '')
      .replace(/\[INPUT:.*?\]\n?/g, '').replace(/\[CHOICE:.*?\]\n?/g, '')
      .replace(/[{}]/g, '').trim();

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

// ── Image Generation (Fal.ai Flux) ───────────────────────────────────────────
const FAL_KEY = process.env.FAL_KEY;
const IMAGE_CACHE_DIR = join(__dirname, 'public', 'gen-images');

(async () => {
  if (!existsSync(IMAGE_CACHE_DIR)) await mkdir(IMAGE_CACHE_DIR, { recursive: true });
})();

const SCENE_STYLE_PREFIX = `Eyvind Earle painting style, geometric painterly landscape, angular Gothic forms, ` +
  `dramatic depth and layered parallax planes, jewel-tone palette with deep purples midnight blues and burnished gold, ` +
  `architectural detail, Sleeping Beauty 1959 background aesthetic, cinematic wide composition, no text no words no letters`;

const PORTRAIT_STYLE_PREFIX = `Eyvind Earle and Sleeping Beauty 1959 character design, flat cel-shaded with 1-2 subtle shadow planes, ` +
  `angular elegant features, tall adult proportions 8 heads tall, Celtic ornamental detail on clothing and armor, ` +
  `jewel-tone palette, dark moody background, portrait bust shot centered, no text no words no letters`;

function cacheKey(prefix, text) {
  return prefix + '-' + crypto.createHash('md5').update(text.toLowerCase().trim()).digest('hex').slice(0, 12);
}

async function pollFalResult(requestId, falKey) {
  const maxAttempts = 30;
  const delayMs = 1000;
  
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`https://queue.fal.run/fal-ai/flux/dev/requests/${requestId}/status`, {
      headers: { 'Authorization': `Key ${falKey}` }
    });
    
    if (!res.ok) {
      console.error('[IMG] Fal poll error:', res.status);
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }
    
    const status = await res.json();
    console.log(`[IMG] Fal status: ${status.status}`);
    
    if (status.status === 'COMPLETED') {
      const resultRes = await fetch(`https://queue.fal.run/fal-ai/flux/dev/requests/${requestId}`, {
        headers: { 'Authorization': `Key ${falKey}` }
      });
      if (resultRes.ok) {
        return await resultRes.json();
      }
    } else if (status.status === 'FAILED') {
      throw new Error('Fal generation failed');
    }
    
    await new Promise(r => setTimeout(r, delayMs));
  }
  
  throw new Error('Fal polling timeout');
}

async function generateImage(prompt, cachePrefix) {
  const key = cacheKey(cachePrefix, prompt);
  const cachedPath = join(IMAGE_CACHE_DIR, `${key}.jpg`);
  const publicUrl = `/gen-images/${key}.jpg`;

  if (existsSync(cachedPath)) {
    console.log(`[IMG] Cache hit: ${key}`);
    return publicUrl;
  }

  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    console.error('[IMG] No FAL_KEY set');
    return { error: 'No API key configured' };
  }

  console.log(`[IMG] Generating: ${cachePrefix} — ${prompt.slice(0, 60)}...`);

  try {
    const submitRes = await fetch('https://queue.fal.run/fal-ai/flux/dev', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${falKey}`
      },
      body: JSON.stringify({
        prompt: prompt,
        image_size: cachePrefix === 'scene' ? 'landscape_16_9' : 'portrait_4_3',
        num_inference_steps: 28,
        guidance_scale: 3.5
      })
    });

    if (!submitRes.ok) {
      const err = await submitRes.text();
      console.error('[IMG] Fal submit error:', submitRes.status, err.slice(0, 200));
      return { error: `API ${submitRes.status}: ${err.slice(0, 100)}` };
    }

    const submitData = await submitRes.json();
    const requestId = submitData.request_id;
    
    if (!requestId) {
      console.error('[IMG] No request_id from Fal');
      return { error: 'No request ID' };
    }

    console.log(`[IMG] Fal request: ${requestId}`);
    
    const result = await pollFalResult(requestId, falKey);
    
    if (!result.images?.[0]?.url) {
      console.error('[IMG] No image URL in Fal response');
      return { error: 'No image data' };
    }

    const imageRes = await fetch(result.images[0].url);
    if (!imageRes.ok) {
      return { error: 'Failed to download image' };
    }
    
    const buffer = Buffer.from(await imageRes.arrayBuffer());
    await writeFile(cachedPath, buffer);
    console.log(`[IMG] Saved: ${cachedPath} (${(buffer.length / 1024).toFixed(0)}KB)`);
    return publicUrl;
  } catch (err) {
    console.error('[IMG] Generation error:', err.message);
    return { error: err.message };
  }
}

app.post('/api/scene-image', async (req, res) => {
  const { location, description } = req.body;
  if (!location) return res.status(400).json({ error: 'missing location' });

  const prompt = `${SCENE_STYLE_PREFIX}. Scene: ${location}${description ? '. ' + description : ''}`;
  const result = await generateImage(prompt, 'scene');
  if (result?.error) return res.status(500).json(result);
  res.json({ url: result });
});

app.post('/api/portrait', async (req, res) => {
  const { name, description, type } = req.body;
  if (!name) return res.status(400).json({ error: 'missing name' });

  const typeHint = type === 'monster' ? 'fearsome creature portrait' : type === 'npc' ? 'RPG character portrait' : 'character portrait';
  const prompt = `${PORTRAIT_STYLE_PREFIX}. ${typeHint}: ${name}${description ? '. ' + description : ''}`;
  const result = await generateImage(prompt, type || 'char');
  if (result?.error) return res.status(500).json(result);
  res.json({ url: result });
});

// ── Database Query Endpoints ──────────────────────────────────────────────────
app.get('/api/adventures', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not available' });
  try {
    const result = await pool.query('SELECT * FROM adventures ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/adventures/:slug/locations', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database not available' });
  try {
    const advResult = await pool.query('SELECT id FROM adventures WHERE slug = $1', [req.params.slug]);
    if (advResult.rows.length === 0) return res.status(404).json({ error: 'Adventure not found' });
    
    const result = await pool.query(
      'SELECT * FROM locations WHERE adventure_id = $1 ORDER BY room_number',
      [advResult.rows[0].id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Seed Database (protected) ────────────────────────────────────────────────
// ── Seed Database (inline) ───────────────────────────────────────────────────
// ── Seed Database (protected) ────────────────────────────────────────────────
app.post('/api/admin/seed', async (req, res) => {
  if (req.headers.authorization !== 'Bearer eamon-seed-2024') {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!pool) return res.status(503).json({ error: 'Database not available' });
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Check if already seeded
    const check = await client.query('SELECT id FROM adventures WHERE slug = $1', ['beginners-cave']);
    if (check.rows.length > 0) {
      await client.query('COMMIT');
      return res.json({ success: true, message: 'Already seeded', adventure_id: check.rows[0].id });
    }
    
    // Insert adventure
    const advResult = await client.query(
      'INSERT INTO adventures (slug, name, description, difficulty, author) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      ['beginners-cave', 'The Beginner''s Cave', 'A simple cave for new adventurers to learn the ropes.', 1, 'Donald Brown']
    );
    const advId = advResult.rows[0].id;
    
    // Insert all 26 rooms
    const rooms = [
      [1, 'Cave Entrance', 'A cool breeze drifts past you from the cave mouth to the north. The forest path leads south.', 'dark cave entrance, stone archway, dappled sunlight filtering through trees, moss-covered rocks, mysterious shadows'],
      [2, 'Dark Passageway', 'A narrow passageway winds deeper into the mountain. The air grows colder.', 'narrow stone corridor, flickering torchlight, rough-hewn walls, dripping water, claustrophobic atmosphere'],
      [3, 'Large Cavern', 'The passage opens into a large cavern. The ceiling disappears into darkness above.', 'vast underground cavern, towering stalactites, bioluminescent fungi, echoing drips, mysterious vastness'],
      [4, 'Side Chamber', 'A small side chamber branches off from the main cavern. It appears empty.', 'small cave chamber, scattered bones, ancient campfire ashes, cracked stone floor, abandoned campsite'],
      [5, 'Healing Spring', 'A natural spring bubbles up from the rocks. The water glows with faint magical light.', 'magical underground spring, glowing blue water, crystalline formations, peaceful ethereal light, healing waters'],
      [6, 'Narrow Crevice', 'You squeeze through a narrow crevice in the rock. It''s barely wide enough to pass.', 'tight rock crevice, rough stone scraping, dim light ahead, geological striations, passage through stone'],
      [7, 'Crystal Grotto', 'Crystals line the walls of this small grotto, reflecting what little light there is.', 'crystal-lined grotto, refracted rainbow light, faceted gemstone walls, magical luminescence, natural wonder'],
      [8, 'Collapsed Tunnel', 'A tunnel has collapsed here, blocking further passage. Rubble fills the way forward.', 'collapsed mine tunnel, fallen boulders, dust motes in light, broken support beams, impassable rubble'],
      [9, 'Underground River', 'An underground river rushes past, its waters dark and swift.', 'underground river, rushing dark waters, natural stone bridge, echoing cavern, treacherous crossing'],
      [10, 'Sandy Beach', 'A small sandy beach along the riverbank. The sand is strangely warm.', 'underground beach, black volcanic sand, phosphorescent pebbles, lapping water sounds, eerie warmth'],
      [11, 'Monster Den', 'A foul smell emanates from this chamber. Scratches mark the walls.', 'monster lair, scattered bones, claw marks on stone, dried blood stains, predator territory'],
      [12, 'Treasure Vault', 'An ancient vault door hangs open. Treasures may lie within.', 'ancient treasure vault, ornate metal door, scattered gold coins, velvet-lined shelves, tempting riches'],
      [13, 'Hidden Alcove', 'A hidden alcove concealed behind a false wall. It smells of secrets.', 'hidden alcove, false stone wall, ancient scrolls, dust-covered artifacts, secret chamber'],
      [14, 'Mimic Chamber', 'This room appears to contain a treasure chest. But something feels wrong.', 'deceptive chamber, ornate treasure chest, too-perfect arrangement, subtle wrongness, mimic lair'],
      [15, 'Cursed Altar', 'An altar to forgotten gods stands here, covered in incomprehensible runes.', 'cursed altar, eldritch runes, dried blood stains, flickering shadow-flames, forbidden worship site'],
      [16, 'Rat Warren', 'The walls here are chewed and scratched. The smell is overpowering.', 'rat warren, chewed stone walls, scattered droppings, scratching sounds in walls, vermin infestation'],
      [17, 'Hermit''s Cave', 'Someone has lived here recently. A bed of straw and cold ashes suggest a former occupant.', 'hermit dwelling, straw bed, cold campfire, primitive furnishings, abandoned shelter'],
      [18, 'Gorilla Lair', 'Large ape-like prints mark the dusty floor. The smell is musky and wild.', 'gorilla territory, large primate prints, scattered fruit peels, musky animal scent, jungle-like humidity'],
      [19, 'Priest''s Sanctum', 'Religious symbols cover the walls. Someone practiced forbidden rites here.', 'priest sanctum, religious icons, forbidden symbols, incense smoke, corrupted chapel'],
      [20, 'Flooded Passage', 'Water covers the floor here, ankle-deep and freezing cold.', 'flooded passage, ankle-deep icy water, dripping ceiling, treacherous footing, cold mist'],
      [21, 'Bat Colony', 'The ceiling crawls with bats. They stir at your presence.', 'bat colony, ceiling covered in leathery wings, squeaking echoes, guano-covered floor, overwhelming smell'],
      [22, 'Ore Vein', 'A rich vein of ore sparkles in the torchlight. Someone mined here long ago.', 'mining tunnel, exposed ore vein, abandoned pickaxes, glittering minerals, dwarven remnants'],
      [23, 'Bottomless Pit', 'A dark pit yawns before you. No bottom is visible.', 'bottomless pit, yawning darkness, crumbling edge, vertigo-inducing depth, ancient chasm'],
      [24, 'Ancient Shrine', 'An ancient shrine to unknown powers. Offerings of gold still rest upon it.', 'ancient shrine, piled gold offerings, mysterious deity statue, eternal flames, sacred site'],
      [25, 'Guardian Chamber', 'A chamber that feels watched. Something protects the way forward.', 'guardian chamber, magical pressure, warning symbols, defensive enchantments, ominous presence'],
      [26, 'Pirate''s Cove', 'A hidden cove where pirates once stored their ill-gotten gains. The water laps at the shore.', 'pirate cove, hidden beach, scattered treasure chests, weathered ship beams, underground lake shore']
    ];
    
    const roomIds = {};
    for (const [num, name, desc, style] of rooms) {
      const result = await client.query(
        'INSERT INTO locations (adventure_id, room_number, name, description, style_prompt_prefix) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [advId, num, name, desc, style]
      );
      roomIds[num] = result.rows[0].id;
    }
    
    // Insert characters
    const characters = [
      ['Cynthia', 'A friendly guide who helps new adventurers learn the basics', 'friendly', 15, 14, 18],
      ['Giant Rat', 'A large aggressive rat with yellowed teeth and patchy fur', 'monster', 8, 12, 2],
      ['Goblin', 'A small green-skinned creature with jagged teeth and rusty dagger', 'monster', 10, 14, 5],
      ['Mimic', 'A shape-shifting monster disguised as a treasure chest', 'monster', 20, 8, 3],
      ['Hermit', 'An old man living in the caves, sometimes friendly', 'npc', 12, 10, 14],
      ['Gorilla', 'A massive silverback ape protecting its territory', 'monster', 25, 12, 5],
      ['Mad Priest', 'A crazed cultist performing dark rituals', 'monster', 14, 10, 16],
      ['Pirate Captain', 'The ghost of a long-dead pirate guarding his treasure', 'monster', 30, 16, 12]
    ];
    
    for (const [name, desc, type, hd, ag, ch] of characters) {
      await client.query(
        'INSERT INTO characters (adventure_id, name, description, type, hardiness, agility, charisma) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [advId, name, desc, type, hd, ag, ch]
      );
    }
    
    // Insert exits
    const exits = [
      [1, 'NORTH', 2, 'A dark passageway leads deeper'],
      [1, 'SOUTH', -999, 'Exit to the Main Hall'],
      [2, 'SOUTH', 1, 'Back to the entrance'],
      [2, 'EAST', 3, 'To the large cavern'],
      [3, 'WEST', 2, 'Back to the passageway'],
      [3, 'NORTH', 5, 'To the healing spring'],
      [3, 'EAST', 4, 'To a side chamber'],
      [3, 'DOWN', 6, 'A narrow crevice descends'],
      [4, 'WEST', 3, 'Back to main cavern'],
      [5, 'SOUTH', 3, 'Back to main cavern'],
      [6, 'UP', 3, 'Climb back up'],
      [6, 'EAST', 7, 'To crystal grotto'],
      [7, 'WEST', 6, 'Back through crevice'],
      [7, 'NORTH', 9, 'To underground river'],
      [9, 'SOUTH', 7, 'Back to grotto'],
      [9, 'EAST', 10, 'Cross to sandy beach'],
      [9, 'NORTH', 11, 'To monster den'],
      [10, 'WEST', 9, 'Back to river'],
      [11, 'SOUTH', 9, 'Back to river'],
      [11, 'NORTH', 12, 'To treasure vault'],
      [12, 'SOUTH', 11, 'Back to monster den'],
      [12, 'SECRET', 13, 'Hidden passage to alcove'],
      [13, 'SECRET', 12, 'Back to vault'],
      [13, 'EAST', 14, 'To mimic chamber'],
      [14, 'WEST', 13, 'Back to alcove'],
      [14, 'NORTH', 15, 'To cursed altar'],
      [15, 'SOUTH', 14, 'Back to mimic chamber'],
      [15, 'EAST', 16, 'To rat warren'],
      [16, 'WEST', 15, 'Back to altar'],
      [16, 'NORTH', 17, 'To hermit''s cave'],
      [17, 'SOUTH', 16, 'Back to rat warren'],
      [17, 'EAST', 18, 'To gorilla lair'],
      [18, 'WEST', 17, 'Back to hermit'],
      [18, 'NORTH', 19, 'To priest''s sanctum'],
      [19, 'SOUTH', 18, 'Back to gorilla lair'],
      [19, 'DOWN', 20, 'To flooded passage'],
      [20, 'UP', 19, 'Back to sanctum'],
      [20, 'EAST', 21, 'To bat colony'],
      [21, 'WEST', 20, 'Back to flooded passage'],
      [21, 'NORTH', 22, 'To ore vein'],
      [22, 'SOUTH', 21, 'Back to bat colony'],
      [22, 'EAST', 23, 'To bottomless pit'],
      [23, 'WEST', 22, 'Back to ore vein'],
      [23, 'NORTH', 24, 'To ancient shrine'],
      [24, 'SOUTH', 23, 'Back to pit'],
      [24, 'EAST', 25, 'To guardian chamber'],
      [25, 'WEST', 24, 'Back to shrine'],
      [25, 'EAST', 26, 'To pirate''s cove'],
      [26, 'WEST', 25, 'Back to guardian chamber'],
      [26, 'OUT', -1, 'Exit the cave']
    ];
    
    for (const [roomNum, dir, dest, desc] of exits) {
      if (roomIds[roomNum]) {
        await client.query(
          'INSERT INTO exits (location_id, direction, destination_room, description) VALUES ($1, $2, $3, $4)',
          [roomIds[roomNum], dir, dest, desc]
        );
      }
    }
    
    await client.query('COMMIT');
    
    res.json({ 
      success: true, 
      message: 'Database seeded successfully',
      adventure_id: advId,
      rooms: Object.keys(roomIds).length,
      characters: characters.length,
      exits: exits.length
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[SEED] Error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
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

// ── Health / Debug ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    fal_key_set: !!process.env.FAL_KEY,
    fal_key_length: process.env.FAL_KEY?.length || 0,
    db_connected: !!pool,
    model: MODEL,
    provider: AI_PROVIDER,
  });
});

// ── Initialize and Start ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
  await initDatabase();
  app.listen(PORT, () => console.log(`Eamon: The Second Age — port ${PORT} — model: ${MODEL}`));
}

start();
