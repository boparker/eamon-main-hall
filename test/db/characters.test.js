import test from 'node:test';
import assert from 'node:assert/strict';

import { claimGuestCharacter, createCharacter, getCharacter, listCharacters, updateCharacter } from '../../server/db/characters.js';

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

test('createCharacter inserts player-owned character with JSON defaults', async () => {
  const pool = makePool([{ id: 'char-1' }]);

  await createCharacter(pool, {
    id: 'char-1', playerId: 'player-1', name: 'Aria', className: 'rogue',
    hardiness: 14, agility: 22, charisma: 12, hd: 14, maxHd: 14, gold: 200,
  });

  const query = pool.queries[0];
  assert.match(query.sql, /INSERT INTO player_characters/);
  assert.deepEqual(query.params, [
    'char-1', 'player-1', null, null, 'Aria', 'rogue', 14, 22, 12, 14, 14, 200, 0,
    '[]', '{}', '[]', true,
  ]);
});

test('createCharacter can attach registered user and profile ownership while preserving guest player id', async () => {
  const pool = makePool([{ id: 'char-1' }]);

  await createCharacter(pool, {
    id: 'char-1', playerId: 'player-1', userId: 'user-1', profileId: 'profile-1', name: 'Aria', className: 'adventurer',
    hardiness: 15, agility: 12, charisma: 15, hd: 15, maxHd: 15, gold: 200,
  });

  const query = pool.queries[0];
  assert.match(query.sql, /user_id, profile_id/);
  assert.deepEqual(query.params, [
    'char-1', 'player-1', 'user-1', 'profile-1', 'Aria', 'adventurer', 15, 12, 15, 15, 15, 200, 0,
    '[]', '{}', '[]', true,
  ]);
});

test('listCharacters only lists a player owned characters ordered by updated time', async () => {
  const pool = makePool([{ id: 'char-1' }]);

  await listCharacters(pool, 'player-1');

  assert.match(pool.queries[0].sql, /WHERE player_id = \$1/);
  assert.match(pool.queries[0].sql, /ORDER BY updated_at DESC/);
  assert.deepEqual(pool.queries[0].params, ['player-1']);
});

test('listCharacters can scope registered characters by user and profile', async () => {
  const pool = makePool([{ id: 'char-1' }]);

  await listCharacters(pool, { userId: 'user-1', profileId: 'profile-1' });

  assert.match(pool.queries[0].sql, /WHERE user_id = \$1 AND profile_id = \$2/);
  assert.match(pool.queries[0].sql, /ORDER BY updated_at DESC/);
  assert.deepEqual(pool.queries[0].params, ['user-1', 'profile-1']);
});

test('getCharacter scopes lookup by character id and player id', async () => {
  const pool = makePool([{ id: 'char-1' }]);

  await getCharacter(pool, 'player-1', 'char-1');

  assert.match(pool.queries[0].sql, /WHERE id = \$1 AND player_id = \$2/);
  assert.deepEqual(pool.queries[0].params, ['char-1', 'player-1']);
});

test('getCharacter can scope lookup by registered user/profile ownership', async () => {
  const pool = makePool([{ id: 'char-1' }]);

  await getCharacter(pool, { userId: 'user-1', profileId: 'profile-1' }, 'char-1');

  assert.match(pool.queries[0].sql, /WHERE id = \$1 AND user_id = \$2 AND profile_id = \$3/);
  assert.deepEqual(pool.queries[0].params, ['char-1', 'user-1', 'profile-1']);
});

test('updateCharacter updates only allowed fields and serializes JSON values', async () => {
  const pool = makePool([{ id: 'char-1' }]);

  await updateCharacter(pool, 'player-1', 'char-1', {
    hd: 11,
    gold: 25,
    inventory: [{ slug: 'sword' }],
    equipment: { weapon: 'sword' },
    ignored: 'nope',
  });

  const query = pool.queries[0];
  assert.match(query.sql, /UPDATE player_characters SET/);
  assert.match(query.sql, /updated_at = NOW\(\)/);
  assert.doesNotMatch(query.sql, /ignored/);
  assert.deepEqual(query.params, [11, 25, '[{"slug":"sword"}]', '{"weapon":"sword"}', 'char-1', 'player-1']);
});

test('updateCharacter can scope updates by registered user/profile ownership', async () => {
  const pool = makePool([{ id: 'char-1' }]);

  await updateCharacter(pool, { userId: 'user-1', profileId: 'profile-1' }, 'char-1', { gold: 123 });

  const query = pool.queries[0];
  assert.match(query.sql, /WHERE id = \$2 AND user_id = \$3 AND profile_id = \$4/);
  assert.deepEqual(query.params, [123, 'char-1', 'user-1', 'profile-1']);
});

test('claimGuestCharacter attaches a guest character to a user profile without mutating sheet fields', async () => {
  const pool = makePool([{ id: 'char-1', name: 'Mara', hardiness: 10, equipment: { weapon: 'sword' } }]);

  const claimed = await claimGuestCharacter(pool, {
    guestPlayerId: 'guest-1',
    characterId: 'char-1',
    userId: 'user-1',
    profileId: 'profile-1',
  });

  const query = pool.queries[0];
  assert.equal(claimed.id, 'char-1');
  assert.match(query.sql, /UPDATE player_characters SET\s+user_id = \$1,\s+profile_id = \$2,\s+updated_at = NOW\(\)/);
  assert.match(query.sql, /WHERE id = \$3 AND player_id = \$4 AND user_id IS NULL AND profile_id IS NULL/);
  assert.doesNotMatch(query.sql, /hardiness|agility|charisma|hd|max_hd|gold|inventory|equipment|adventures_completed/i);
  assert.deepEqual(query.params, ['user-1', 'profile-1', 'char-1', 'guest-1']);
});
