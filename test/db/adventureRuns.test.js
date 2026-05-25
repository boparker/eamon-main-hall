import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAdventureRun,
  getAdventureRun,
  getActiveAdventureRunForCharacter,
  updateAdventureRun,
  completeAdventureRun,
  abandonAdventureRun,
} from '../../server/db/adventureRuns.js';

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

test('createAdventureRun inserts active run without FK validation against adventures table', async () => {
  const pool = makePool([{ id: 'run-1' }]);

  await createAdventureRun(pool, {
    id: 'run-1', playerId: 'player-1', characterId: 'char-1', adventureId: 'beginners-cave', currentRoom: 1,
  });

  const query = pool.queries[0];
  assert.match(query.sql, /INSERT INTO adventure_runs/);
  assert.match(query.sql, /SELECT \$1, \$2, pc.id, \$4, \$5/);
  assert.match(query.sql, /FROM player_characters pc/);
  assert.match(query.sql, /pc.id = \$3 AND pc.player_id = \$2/);
  assert.doesNotMatch(query.sql, /REFERENCES adventures|JOIN adventures/);
  assert.deepEqual(query.params, ['run-1', 'player-1', 'char-1', 'beginners-cave', 1, '{}', '{}', '[]', '[]', '{}']);
});

test('createAdventureRun can attach registered user and profile ownership', async () => {
  const pool = makePool([{ id: 'run-1' }]);

  await createAdventureRun(pool, {
    id: 'run-1', playerId: 'account:user-1', userId: 'user-1', profileId: 'profile-1', characterId: 'char-1', adventureId: 'beginners-cave', currentRoom: 1,
  });

  const query = pool.queries[0];
  assert.match(query.sql, /id, player_id, user_id, profile_id, character_id/);
  assert.match(query.sql, /pc.id = \$5 AND pc.user_id = \$3 AND pc.profile_id = \$4/);
  assert.deepEqual(query.params, ['run-1', 'account:user-1', 'user-1', 'profile-1', 'char-1', 'beginners-cave', 1, '{}', '{}', '[]', '[]', '{}']);
});

test('createAdventureRun rejects adventure ids that are not known JSON slugs', async () => {
  const pool = makePool([{ id: 'run-1' }]);

  await assert.rejects(
    () => createAdventureRun(pool, {
      id: 'run-1', playerId: 'player-1', characterId: 'char-1', adventureId: 'unknown-cave', currentRoom: 1,
      knownAdventureIds: new Set(['beginners-cave']),
    }),
    /Unknown adventure_id unknown-cave/i,
  );

  assert.equal(pool.queries.length, 0);
});

test('getAdventureRun scopes by player and run id', async () => {
  const pool = makePool([{ id: 'run-1' }]);

  await getAdventureRun(pool, 'player-1', 'run-1');

  assert.match(pool.queries[0].sql, /WHERE id = \$1 AND player_id = \$2/);
  assert.deepEqual(pool.queries[0].params, ['run-1', 'player-1']);
});

test('getAdventureRun can scope by registered user and profile', async () => {
  const pool = makePool([{ id: 'run-1' }]);

  await getAdventureRun(pool, { playerId: 'account:user-1', userId: 'user-1', profileId: 'profile-1' }, 'run-1');

  assert.match(pool.queries[0].sql, /WHERE id = \$1 AND player_id = \$2 AND user_id = \$3 AND profile_id = \$4/);
  assert.deepEqual(pool.queries[0].params, ['run-1', 'account:user-1', 'user-1', 'profile-1']);
});

test('getActiveAdventureRunForCharacter scopes active runs by character and registered profile', async () => {
  const pool = makePool([{ id: 'run-1' }]);

  await getActiveAdventureRunForCharacter(pool, { playerId: 'account:user-1', userId: 'user-1', profileId: 'profile-1' }, 'char-1');

  assert.match(pool.queries[0].sql, /WHERE character_id = \$1 AND status = 'active' AND player_id = \$2 AND user_id = \$3 AND profile_id = \$4/);
  assert.match(pool.queries[0].sql, /ORDER BY updated_at DESC/);
  assert.deepEqual(pool.queries[0].params, ['char-1', 'account:user-1', 'user-1', 'profile-1']);
});

test('updateAdventureRun updates allowed state fields as JSON', async () => {
  const pool = makePool([{ id: 'run-1' }]);

  await updateAdventureRun(pool, 'player-1', 'run-1', {
    currentRoom: 2,
    roomState: { visited: [1] },
    flags: { doorOpen: true },
    status: 'active',
    ignored: 'nope',
  });

  const query = pool.queries[0];
  assert.match(query.sql, /UPDATE adventure_runs SET/);
  assert.doesNotMatch(query.sql, /ignored/);
  assert.deepEqual(query.params, [2, '{"visited":[1]}', '{"doorOpen":true}', 'active', 'run-1', 'player-1']);
});

test('updateAdventureRun can scope by registered user/profile ownership', async () => {
  const pool = makePool([{ id: 'run-1' }]);

  await updateAdventureRun(pool, { playerId: 'account:user-1', userId: 'user-1', profileId: 'profile-1' }, 'run-1', { currentRoom: 2 });

  assert.match(pool.queries[0].sql, /WHERE id = \$2 AND player_id = \$3 AND user_id = \$4 AND profile_id = \$5/);
  assert.deepEqual(pool.queries[0].params, [2, 'run-1', 'account:user-1', 'user-1', 'profile-1']);
});

test('completeAdventureRun and abandonAdventureRun set terminal status and completed_at', async () => {
  const pool = makePool([{ id: 'run-1' }, { id: 'run-2' }]);

  await completeAdventureRun(pool, 'player-1', 'run-1');
  await abandonAdventureRun(pool, 'player-1', 'run-2');

  assert.match(pool.queries[0].sql, /status = 'completed'/);
  assert.match(pool.queries[0].sql, /completed_at = NOW\(\)/);
  assert.deepEqual(pool.queries[0].params, ['run-1', 'player-1']);
  assert.match(pool.queries[1].sql, /status = 'abandoned'/);
  assert.match(pool.queries[1].sql, /completed_at = NOW\(\)/);
  assert.deepEqual(pool.queries[1].params, ['run-2', 'player-1']);
});


test('completeAdventureRun and abandonAdventureRun can scope by registered user/profile ownership', async () => {
  const pool = makePool([{ id: 'run-1' }, { id: 'run-2' }]);
  const owner = { playerId: 'account:user-1', userId: 'user-1', profileId: 'profile-1' };

  await completeAdventureRun(pool, owner, 'run-1');
  await abandonAdventureRun(pool, owner, 'run-2');

  assert.match(pool.queries[0].sql, /WHERE id = \$1 AND player_id = \$2 AND user_id = \$3 AND profile_id = \$4/);
  assert.deepEqual(pool.queries[0].params, ['run-1', 'account:user-1', 'user-1', 'profile-1']);
  assert.match(pool.queries[1].sql, /WHERE id = \$1 AND player_id = \$2 AND user_id = \$3 AND profile_id = \$4/);
  assert.deepEqual(pool.queries[1].params, ['run-2', 'account:user-1', 'user-1', 'profile-1']);
});
