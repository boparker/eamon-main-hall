import test from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, getCharacter, listCharacters, updateCharacter } from '../../server/db/characters.js';

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
    'char-1', 'player-1', 'Aria', 'rogue', 14, 22, 12, 14, 14, 200, 0,
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

test('getCharacter scopes lookup by character id and player id', async () => {
  const pool = makePool([{ id: 'char-1' }]);

  await getCharacter(pool, 'player-1', 'char-1');

  assert.match(pool.queries[0].sql, /WHERE id = \$1 AND player_id = \$2/);
  assert.deepEqual(pool.queries[0].params, ['char-1', 'player-1']);
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
