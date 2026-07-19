import express from 'express';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ensureGameSchema } from './server/db/schema.js';
import { createGameRouter } from './server/routes/game.js';
import { createAuthRouter } from './server/routes/auth.js';
import { createProfilesRouter } from './server/routes/profiles.js';
import { createMediaRouter } from './server/routes/media.js';

const { Pool } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
// Without Cache-Control, browsers heuristically cache (10% of file age) and
// keep serving STALE JS for hours after a deploy — live-play bug reports kept
// matching already-fixed code. But plain no-cache made every reload
// re-validate each ES module serially down the import chain (~1s+ of 304
// round trips). stale-while-revalidate is the sweet spot: serve instantly
// from cache, refresh in the background — a deploy reaches the player one
// reload later. Heavy media (scenes, audio, portraits) caches a week; a
// re-authored media file must ship under a bumped ?v= query (see audio.js).
app.use(express.static(join(__dirname, 'public'), {
  setHeaders(res, path) {
    if (/\.(png|jpe?g|webp|mp3|m4a|wav|woff2?)$/i.test(path)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=0, stale-while-revalidate=86400');
    }
  },
}));
// A 404 for a not-yet-shipped asset must NEVER be cached: browsers held
// "that image is broken" in tab memory long after the real file deployed.
app.use((req, res, next) => {
  if (/^\/(scenes|audio)\//.test(req.path)) {
    res.set('Cache-Control', 'no-store');
    return res.status(404).end();
  }
  next();
});

// ── Database Setup ────────────────────────────────────────────────────────────
// Local Postgres (localhost) speaks plaintext; hosted (Railway) requires SSL.
const isLocalDb = /@localhost|@127\.0\.0\.1|^postgres(ql)?:\/\/localhost|^postgres(ql)?:\/\/127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '');
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(isLocalDb ? {} : { ssl: { rejectUnauthorized: false } }),
}) : null;
let dbReady = false;

async function initDatabase() {
  if (!pool) {
    console.log('[DB] No DATABASE_URL, skipping database init');
    return;
  }
  
  try {
    console.log('[DB] Checking connection...');
    await pool.query('SELECT NOW()');
    console.log('[DB] Connected successfully');

    await ensureGameSchema(pool);
    console.log('[DB] Game persistence schema ready');
    
    // Check if legacy content schema is already initialized
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'adventures'
      );
    `);
    
    if (tableCheck.rows[0].exists) {
      console.log('[DB] Schema already initialized');
      dbReady = true;
      return;
    }
    
    console.log('[DB] Creating schema...');
    
    // Create tables
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
    dbReady = true;
    
  } catch (err) {
    console.error('[DB] Initialization error:', err.message);
    console.warn('[DB] Continuing without database-backed persistence until DATABASE_URL/Postgres is healthy.');
  }
}

// ── AI Client ─────────────────────────────────────────────────────────────────
let AI_PROVIDER = null;
let MODEL = null;

if (process.env.XAI_API_KEY) {
  AI_PROVIDER = 'xai';
  MODEL = 'grok-3-mini-latest';
} else if (process.env.OPENAI_API_KEY) {
  AI_PROVIDER = 'openai';
  MODEL = 'gpt-4o';
} else if (process.env.ANTHROPIC_API_KEY) {
  AI_PROVIDER = 'anthropic';
  MODEL = 'claude-3-5-haiku-latest';
}

if (!AI_PROVIDER) {
  console.warn('[AI] No XAI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY set. AI provider detection is reported by /api/health; the deterministic game loop does not require it.');
}

// ── Deterministic Game API ────────────────────────────────────────────────────
app.use('/api/auth', createAuthRouter({ db: pool }));
app.use('/api/profiles', createProfilesRouter({ db: pool }));
app.use('/api/game', createGameRouter({ db: pool }));

// ── Media (TTS + image generation) ────────────────────────────────────────────
app.use('/api', createMediaRouter());

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

// ── Health / Debug ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    fal_key_set: !!process.env.FAL_KEY,
    fal_key_length: process.env.FAL_KEY?.length || 0,
    db_configured: !!pool,
    db_ready: dbReady,
    model: MODEL,
    provider: AI_PROVIDER,
    ai_configured: !!AI_PROVIDER,
  });
});

// ── Initialize and Start ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
  await initDatabase();
  // Report the model the AI layer ACTUALLY uses (server/ai/llm.js), not the
  // legacy provider-detection above — the old banner misdirected a debugging
  // session into thinking prod ran 3.5-haiku.
  const aiModel = process.env.EAMON_AI_MODEL || 'claude-haiku-4-5-20251001';
  app.listen(PORT, () => console.log(`Eamon: The Second Age — port ${PORT} — model: ${aiModel}`));
}

start();

// ── Seed Database (inline) ────────────────────────────────────────────────────
app.post('/api/admin/seed', async (req, res) => {
  if (req.headers.authorization !== 'Bearer eamon-seed-2024') {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!pool) return res.status(503).json({ error: 'Database not available' });
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const check = await client.query('SELECT id FROM adventures WHERE slug = $1', ['beginners-cave']);
    if (check.rows.length > 0) {
      await client.query('COMMIT');
      return res.json({ success: true, message: 'Already seeded', adventure_id: check.rows[0].id });
    }
    
    const advResult = await client.query(
      'INSERT INTO adventures (slug, name, description, difficulty, author) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      ['beginners-cave', "The Beginner's Cave", 'A simple cave for new adventurers to learn the ropes.', 1, 'Donald Brown']
    );
    const advId = advResult.rows[0].id;
    
    // Seed all 26 rooms
    const rooms = [
      [1, 'Cave Entrance', 'A cool breeze drifts past you from the cave mouth to the north. The forest path leads south.', 'dark cave entrance, stone archway, dappled sunlight filtering through trees, moss-covered rocks, mysterious shadows'],
      [2, 'Dark Passageway', 'A narrow passageway winds deeper into the mountain. The air grows colder.', 'narrow stone corridor, flickering torchlight, rough-hewn walls, dripping water, claustrophobic atmosphere'],
      [3, 'Large Cavern', 'The passage opens into a large cavern. The ceiling disappears into darkness above.', 'vast underground cavern, towering stalactites, bioluminescent fungi, echoing drips, mysterious vastness'],
      [4, 'Side Chamber', 'A small side chamber branches off from the main cavern. It appears empty.', 'small cave chamber, scattered bones, ancient campfire ashes, cracked stone floor, abandoned campsite'],
      [5, 'Healing Spring', 'A natural spring bubbles up from the rocks. The water glows with faint magical light.', 'magical underground spring, glowing blue water, crystalline formations, peaceful ethereal light, healing waters'],
      [6, 'Narrow Crevice', 'You squeeze through a narrow crevice in the rock. It is barely wide enough to pass.', 'tight rock crevice, rough stone scraping, dim light ahead, geological striations, passage through stone'],
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
      [17, "Hermit's Cave", 'Someone has lived here recently. A bed of straw and cold ashes suggest a former occupant.', 'hermit dwelling, straw bed, cold campfire, primitive furnishings, abandoned shelter'],
      [18, 'Gorilla Lair', 'Large ape-like prints mark the dusty floor. The smell is musky and wild.', 'gorilla territory, large primate prints, scattered fruit peels, musky animal scent, jungle-like humidity'],
      [19, "Priest's Sanctum", 'Religious symbols cover the walls. Someone practiced forbidden rites here.', 'priest sanctum, religious icons, forbidden symbols, incense smoke, corrupted chapel'],
      [20, 'Flooded Passage', 'Water covers the floor here, ankle-deep and freezing cold.', 'flooded passage, ankle-deep icy water, dripping ceiling, treacherous footing, cold mist'],
      [21, 'Bat Colony', 'The ceiling crawls with bats. They stir at your presence.', 'bat colony, ceiling covered in leathery wings, squeaking echoes, guano-covered floor, overwhelming smell'],
      [22, 'Ore Vein', 'A rich vein of ore sparkles in the torchlight. Someone mined here long ago.', 'mining tunnel, exposed ore vein, abandoned pickaxes, glittering minerals, dwarven remnants'],
      [23, 'Bottomless Pit', 'A dark pit yawns before you. No bottom is visible.', 'bottomless pit, yawning darkness, crumbling edge, vertigo-inducing depth, ancient chasm'],
      [24, 'Ancient Shrine', 'An ancient shrine to unknown powers. Offerings of gold still rest upon it.', 'ancient shrine, piled gold offerings, mysterious deity statue, eternal flames, sacred site'],
      [25, 'Guardian Chamber', 'A chamber that feels watched. Something protects the way forward.', 'guardian chamber, magical pressure, warning symbols, defensive enchantments, ominous presence'],
      [26, "Pirate's Cove", 'A hidden cove where pirates once stored their ill-gotten gains. The water laps at the shore.', 'pirate cove, hidden beach, scattered treasure chests, weathered ship beams, underground lake shore']
    ];
    
    for (const [num, name, desc, style] of rooms) {
      await client.query(
        'INSERT INTO locations (adventure_id, room_number, name, description, style_prompt_prefix) VALUES ($1, $2, $3, $4, $5)',
        [advId, num, name, desc, style]
      );
    }
    
    // Seed characters
    const chars = [
      ['Cynthia', 'A friendly guide who helps new adventurers learn the basics', 'friendly', 15, 14, 18],
      ['Giant Rat', 'A large aggressive rat with yellowed teeth and patchy fur', 'monster', 8, 12, 2],
      ['Goblin', 'A small green-skinned creature with jagged teeth and rusty dagger', 'monster', 10, 14, 5],
      ['Mimic', 'A shape-shifting monster disguised as a treasure chest', 'monster', 20, 10, 2],
      ['Pirate', 'A grizzled pirate guarding his treasure', 'monster', 18, 16, 8],
      ['Hermit', 'An old hermit living in the cave', 'friendly', 12, 10, 14],
      ['Gorilla', 'A large aggressive gorilla', 'monster', 25, 18, 5],
      ['Mad Priest', 'A priest driven mad by dark rituals', 'monster', 14, 12, 16]
    ];
    
    for (const [name, desc, type, hd, ag, ch] of chars) {
      await client.query(
        'INSERT INTO characters (adventure_id, name, description, type, hardiness, agility, charisma) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [advId, name, desc, type, hd, ag, ch]
      );
    }
    
    await client.query('COMMIT');
    res.json({ success: true, adventure_id: advId, rooms: rooms.length, characters: chars.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[SEED] Error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
