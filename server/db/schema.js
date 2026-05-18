const MIGRATION_ID = 'task-8-account-character-adventure-runs';

const REQUIRED_PLAYER_CHARACTER_COLUMNS = [
  'id',
  'player_id',
  'name',
  'class',
  'hardiness',
  'agility',
  'charisma',
  'hd',
  'max_hd',
  'gold',
  'bank_gold',
  'inventory',
  'equipment',
  'adventures_completed',
  'is_alive',
  'created_at',
  'updated_at',
  'last_played_at',
];

async function assertCompatiblePlayerCharactersTable(db) {
  const tableCheck = await db.query("SELECT to_regclass('public.player_characters') IS NOT NULL AS exists");
  if (!tableCheck.rows?.[0]?.exists) return;

  const columns = await db.query(`
    SELECT column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'player_characters'
  `);
  const rows = columns.rows ?? [];
  const present = new Set(rows.map((row) => row.column_name));
  const missing = REQUIRED_PLAYER_CHARACTER_COLUMNS.filter((column) => !present.has(column));

  if (missing.length > 0) {
    throw new Error(
      `Incompatible legacy player_characters table detected; missing columns: ${missing.join(', ')}. `
      + 'Please perform a manual backup/rename before applying Task 8 schema.',
    );
  }

  const expectedTypes = {
    id: 'text',
    player_id: 'text',
    name: 'text',
    class: 'text',
    hardiness: 'integer',
    agility: 'integer',
    charisma: 'integer',
    hd: 'integer',
    max_hd: 'integer',
    gold: 'integer',
    bank_gold: 'integer',
    inventory: 'jsonb',
    equipment: 'jsonb',
    adventures_completed: 'jsonb',
    is_alive: 'boolean',
    created_at: 'timestamp with time zone',
    updated_at: 'timestamp with time zone',
    last_played_at: 'timestamp with time zone',
  };
  const incompatible = rows
    .filter((row) => expectedTypes[row.column_name] && row.data_type && row.data_type !== expectedTypes[row.column_name])
    .map((row) => `${row.column_name} expected ${expectedTypes[row.column_name]} got ${row.data_type}`);

  if (incompatible.length > 0) {
    throw new Error(
      `Incompatible legacy player_characters table detected; ${incompatible.join('; ')}. `
      + 'Please perform a manual backup/rename before applying Task 8 schema.',
    );
  }
}

export async function ensureGameSchema(db) {
  if (!db || typeof db.query !== 'function') {
    throw new TypeError('ensureGameSchema requires a pg pool/client with query(sql, params)');
  }

  await assertCompatiblePlayerCharactersTable(db);

  const client = typeof db.connect === 'function' ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    await client.query(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  auth_provider TEXT,
  auth_subject TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS players_auth_identity_idx
  ON players(auth_provider, auth_subject)
  WHERE auth_provider IS NOT NULL AND auth_subject IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS players_email_idx
  ON players(lower(email))
  WHERE email IS NOT NULL;
CREATE TABLE IF NOT EXISTS player_characters (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('adventurer', 'warrior', 'rogue', 'mystic')),
  hardiness INTEGER NOT NULL CHECK (hardiness > 0),
  agility INTEGER NOT NULL CHECK (agility > 0),
  charisma INTEGER NOT NULL CHECK (charisma > 0),
  hd INTEGER NOT NULL CHECK (hd >= 0),
  max_hd INTEGER NOT NULL CHECK (max_hd > 0),
  gold INTEGER NOT NULL DEFAULT 0 CHECK (gold >= 0),
  bank_gold INTEGER NOT NULL DEFAULT 0 CHECK (bank_gold >= 0),
  inventory JSONB NOT NULL DEFAULT '[]'::jsonb,
  equipment JSONB NOT NULL DEFAULT '{}'::jsonb,
  adventures_completed JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_alive BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_played_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS player_characters_player_id_idx ON player_characters(player_id);
CREATE TABLE IF NOT EXISTS adventure_runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES player_characters(id) ON DELETE CASCADE,
  adventure_id TEXT NOT NULL,
  current_room INTEGER NOT NULL,
  room_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  enemy_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  collected_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  discovered_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'dead', 'abandoned')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS adventure_runs_player_id_idx ON adventure_runs(player_id);
CREATE INDEX IF NOT EXISTS adventure_runs_character_id_idx ON adventure_runs(character_id);
CREATE UNIQUE INDEX IF NOT EXISTS adventure_runs_one_active_per_character_idx
  ON adventure_runs(character_id)
  WHERE status = 'active';
  `);

    await client.query(`
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'player_characters_class_check'
      AND conrelid = 'player_characters'::regclass
  ) THEN
    ALTER TABLE player_characters DROP CONSTRAINT player_characters_class_check;
  END IF;
  ALTER TABLE player_characters
    ADD CONSTRAINT player_characters_class_check CHECK (class IN ('adventurer', 'warrior', 'rogue', 'mystic'));
END $$;
    `);

    await client.query(
      'INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
      [MIGRATION_ID],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    if (client !== db && typeof client.release === 'function') client.release();
  }
}

export { MIGRATION_ID };
