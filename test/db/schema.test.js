import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureGameSchema } from '../../server/db/schema.js';

function makePool({ rowsBySql = [], failOnSql = null } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (failOnSql && sql.includes(failOnSql)) throw new Error(`forced failure for ${failOnSql}`);
      const match = rowsBySql.find((entry) => sql.includes(entry.includes));
      return { rows: match?.rows ?? [] };
    },
  };
}

const combinedSql = (pool) => pool.queries.map((q) => q.sql).join('\n');

test('ensureGameSchema creates account persistence tables and indexes without adventure FK', async () => {
  const pool = makePool({
    rowsBySql: [
      { includes: "to_regclass('public.player_characters')", rows: [{ exists: false }] },
      { includes: 'information_schema.columns', rows: [] },
    ],
  });

  await ensureGameSchema(pool);

  const sql = combinedSql(pool);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS schema_migrations/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS players/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS users/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_sessions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS player_profiles/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS player_characters/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS adventure_runs/);
  assert.match(sql, /ALTER TABLE player_characters ADD COLUMN IF NOT EXISTS user_id/);
  assert.match(sql, /ALTER TABLE player_characters ADD COLUMN IF NOT EXISTS profile_id/);
  assert.match(sql, /ALTER TABLE adventure_runs ADD COLUMN IF NOT EXISTS user_id/);
  assert.match(sql, /ALTER TABLE adventure_runs ADD COLUMN IF NOT EXISTS profile_id/);
  assert.match(sql, /players_auth_identity_idx/);
  assert.match(sql, /players_email_idx/);
  assert.match(sql, /adventure_runs_one_active_per_character_idx/);
  assert.match(sql, /adventure_id TEXT NOT NULL/);
  assert.doesNotMatch(sql, /adventure_id\s+TEXT\s+NOT NULL\s+REFERENCES/i);
  assert.doesNotMatch(sql, /REFERENCES adventures/i);
});

test('ensureGameSchema records a schema migration id and is independent of adventures table checks', async () => {
  const pool = makePool({
    rowsBySql: [
      { includes: "to_regclass('public.player_characters')", rows: [{ exists: false }] },
      { includes: 'information_schema.columns', rows: [] },
    ],
  });

  await ensureGameSchema(pool);

  assert.equal(pool.queries.some((q) => q.sql.includes("table_name = 'adventures'")), false);
  assert.equal(pool.queries.some((q) => q.sql.includes('INSERT INTO schema_migrations')), true);
  assert.equal(pool.queries.at(-2).params[0], 'task-8-account-character-adventure-runs');
});

test('ensureGameSchema wraps schema creation and migration record in a transaction', async () => {
  const pool = makePool({
    rowsBySql: [
      { includes: "to_regclass('public.player_characters')", rows: [{ exists: false }] },
      { includes: 'information_schema.columns', rows: [] },
    ],
  });

  await ensureGameSchema(pool);

  const sqls = pool.queries.map((q) => q.sql.trim());
  assert.equal(sqls.includes('BEGIN'), true);
  assert.equal(sqls.includes('COMMIT'), true);
  assert.equal(sqls.includes('ROLLBACK'), false);
});

test('ensureGameSchema rolls back schema transaction on migration failure', async () => {
  const pool = makePool({
    rowsBySql: [
      { includes: "to_regclass('public.player_characters')", rows: [{ exists: false }] },
      { includes: 'information_schema.columns', rows: [] },
    ],
    failOnSql: 'INSERT INTO schema_migrations',
  });

  await assert.rejects(() => ensureGameSchema(pool), /forced failure/);

  assert.equal(pool.queries.some((q) => q.sql.trim() === 'BEGIN'), true);
  assert.equal(pool.queries.some((q) => q.sql.trim() === 'ROLLBACK'), true);
  assert.equal(pool.queries.some((q) => q.sql.trim() === 'COMMIT'), false);
});

test('ensureGameSchema fails loudly for incompatible legacy player_characters table', async () => {
  const pool = makePool({
    rowsBySql: [
      { includes: "to_regclass('public.player_characters')", rows: [{ exists: true }] },
      { includes: 'information_schema.columns', rows: [{ column_name: 'id' }, { column_name: 'name' }] },
    ],
  });

  await assert.rejects(
    () => ensureGameSchema(pool),
    /Incompatible legacy player_characters table.*manual backup\/rename/i,
  );
});

test('ensureGameSchema fails loudly for legacy player_characters with incompatible column types', async () => {
  const requiredRows = [
    ['id', 'integer'],
    ['player_id', 'text'],
    ['name', 'text'],
    ['class', 'text'],
    ['hardiness', 'integer'],
    ['agility', 'integer'],
    ['charisma', 'integer'],
    ['hd', 'integer'],
    ['max_hd', 'integer'],
    ['gold', 'integer'],
    ['bank_gold', 'integer'],
    ['inventory', 'jsonb'],
    ['equipment', 'jsonb'],
    ['adventures_completed', 'jsonb'],
    ['is_alive', 'boolean'],
    ['created_at', 'timestamp with time zone'],
    ['updated_at', 'timestamp with time zone'],
    ['last_played_at', 'timestamp with time zone'],
  ].map(([column_name, data_type]) => ({ column_name, data_type }));
  const pool = makePool({
    rowsBySql: [
      { includes: "to_regclass('public.player_characters')", rows: [{ exists: true }] },
      { includes: 'information_schema.columns', rows: requiredRows },
    ],
  });

  await assert.rejects(
    () => ensureGameSchema(pool),
    /id expected text got integer.*manual backup\/rename/i,
  );
});
