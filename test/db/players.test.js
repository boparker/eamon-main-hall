import test from 'node:test';
import assert from 'node:assert/strict';

import { upsertPlayer, getPlayer } from '../../server/db/players.js';

function makePool(rows = []) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      return { rows: rows.length ? [rows.shift()] : [] };
    },
  };
}

test('upsertPlayer creates anonymous player with injected id and returns row', async () => {
  const expected = { id: 'player-1', display_name: 'Bo' };
  const pool = makePool([expected]);

  const row = await upsertPlayer(pool, { id: 'player-1', displayName: 'Bo' });

  assert.equal(row, expected);
  assert.match(pool.queries[0].sql, /INSERT INTO players/);
  assert.match(pool.queries[0].sql, /ON CONFLICT \(id\) DO UPDATE/);
  assert.deepEqual(pool.queries[0].params, ['player-1', 'Bo', null, null, null]);
});

test('upsertPlayer supports auth identity/email ownership upgrades', async () => {
  const pool = makePool([{ id: 'player-2' }]);

  await upsertPlayer(pool, {
    id: 'player-2',
    displayName: 'Bee',
    authProvider: 'email',
    authSubject: 'subject-1',
    email: 'Bee@Example.com',
  });

  assert.deepEqual(pool.queries[0].params, ['email', 'subject-1', 'Bee@Example.com']);
  assert.deepEqual(pool.queries[1].params, ['player-2', 'Bee', 'email', 'subject-1', 'Bee@Example.com']);
});

test('upsertPlayer reuses existing player found by auth identity before inserting', async () => {
  const pool = makePool([{ id: 'existing-player' }, { id: 'existing-player' }]);

  await upsertPlayer(pool, {
    id: 'new-random-id',
    displayName: 'Bee',
    authProvider: 'email',
    authSubject: 'subject-1',
    email: 'Bee@Example.com',
  });

  assert.match(pool.queries[0].sql, /auth_provider = \$1 AND auth_subject = \$2/);
  assert.deepEqual(pool.queries[1].params, ['existing-player', 'Bee', 'email', 'subject-1', 'Bee@Example.com']);
});

test('getPlayer fetches by id', async () => {
  const pool = makePool([{ id: 'player-1' }]);

  const row = await getPlayer(pool, 'player-1');

  assert.deepEqual(row, { id: 'player-1' });
  assert.match(pool.queries[0].sql, /SELECT \* FROM players WHERE id = \$1/);
  assert.deepEqual(pool.queries[0].params, ['player-1']);
});
