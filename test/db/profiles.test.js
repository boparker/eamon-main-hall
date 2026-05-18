import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createProfile,
  listProfiles,
  getProfile,
  setSelectedCharacter,
} from '../../server/db/profiles.js';

function makeDb({ rows = [] } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      return { rows };
    },
  };
}

test('createProfile inserts a user-owned profile', async () => {
  const row = { id: 'profile-1', user_id: 'user-1', name: 'Bo' };
  const db = makeDb({ rows: [row] });

  const profile = await createProfile(db, 'user-1', ' Bo ', 'profile-1');

  assert.equal(profile, row);
  assert.match(db.queries[0].sql, /INSERT INTO player_profiles/);
  assert.deepEqual(db.queries[0].params, ['profile-1', 'user-1', 'Bo']);
});

test('listProfiles scopes profiles by user', async () => {
  const rows = [{ id: 'profile-1', user_id: 'user-1', name: 'Bo' }];
  const db = makeDb({ rows });

  const profiles = await listProfiles(db, 'user-1');

  assert.equal(profiles, rows);
  assert.match(db.queries[0].sql, /WHERE user_id = \$1/);
  assert.equal(db.queries[0].params[0], 'user-1');
});

test('getProfile scopes lookup by user and profile', async () => {
  const row = { id: 'profile-1', user_id: 'user-1', name: 'Bo' };
  const db = makeDb({ rows: [row] });

  const profile = await getProfile(db, 'user-1', 'profile-1');

  assert.equal(profile, row);
  assert.match(db.queries[0].sql, /WHERE user_id = \$1 AND id = \$2/);
  assert.deepEqual(db.queries[0].params, ['user-1', 'profile-1']);
});

test('setSelectedCharacter scopes selected character by user profile and owned character', async () => {
  const row = { id: 'profile-1', selected_character_id: 'char-1' };
  const db = makeDb({ rows: [row] });

  const profile = await setSelectedCharacter(db, 'user-1', 'profile-1', 'char-1');

  assert.equal(profile, row);
  assert.match(db.queries[0].sql, /UPDATE player_profiles/);
  assert.match(db.queries[0].sql, /EXISTS \(/);
  assert.match(db.queries[0].sql, /player_characters/);
  assert.deepEqual(db.queries[0].params, ['user-1', 'profile-1', 'char-1']);
});
