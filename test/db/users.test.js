import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createUser,
  getUserByUsername,
  createUserSession,
  getUserBySessionTokenHash,
  deleteUserSession,
} from '../../server/db/users.js';

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

test('createUser normalizes username and stores password hash only', async () => {
  const row = { id: 'user-1', username: 'bo', email: 'bo@example.com', display_name: 'Bo' };
  const db = makeDb({ rows: [row] });

  const user = await createUser(db, {
    id: 'user-1',
    username: ' Bo ',
    email: 'BO@example.com',
    passwordHash: 'scrypt$hash',
    displayName: 'Bo',
  });

  assert.deepEqual(user, row);
  assert.match(db.queries[0].sql, /INSERT INTO users/);
  assert.equal(db.queries[0].params[1], 'bo');
  assert.equal(db.queries[0].params[2], 'bo@example.com');
  assert.equal(db.queries[0].params[3], 'scrypt$hash');
  assert.equal(db.queries[0].params.includes('raw-password'), false);
});

test('getUserByUsername looks up normalized username', async () => {
  const row = { id: 'user-1', username: 'bo' };
  const db = makeDb({ rows: [row] });

  const user = await getUserByUsername(db, ' Bo ');

  assert.equal(user, row);
  assert.match(db.queries[0].sql, /WHERE lower\(username\) = \$1/);
  assert.equal(db.queries[0].params[0], 'bo');
});

test('createUserSession stores token hash and expiry', async () => {
  const row = { id: 'session-1', user_id: 'user-1', token_hash: 'sha256$hash' };
  const db = makeDb({ rows: [row] });
  const expiresAt = new Date('2030-01-01T00:00:00Z');

  const session = await createUserSession(db, 'user-1', 'sha256$hash', expiresAt, 'session-1');

  assert.equal(session, row);
  assert.match(db.queries[0].sql, /INSERT INTO user_sessions/);
  assert.deepEqual(db.queries[0].params, ['session-1', 'user-1', 'sha256$hash', expiresAt]);
});

test('getUserBySessionTokenHash returns only unexpired sessions and bumps last_seen_at', async () => {
  const row = { session_id: 'session-1', id: 'user-1', username: 'bo' };
  const db = makeDb({ rows: [row] });

  const user = await getUserBySessionTokenHash(db, 'sha256$hash');

  assert.equal(user, row);
  assert.match(db.queries[0].sql, /JOIN users u ON u.id = .*user_id/);
  assert.match(db.queries[0].sql, /expires_at > NOW\(\)/);
  assert.match(db.queries[0].sql, /UPDATE user_sessions/);
  assert.equal(db.queries[0].params[0], 'sha256$hash');
});

test('deleteUserSession deletes by token hash', async () => {
  const db = makeDb();

  await deleteUserSession(db, 'sha256$hash');

  assert.match(db.queries[0].sql, /DELETE FROM user_sessions/);
  assert.equal(db.queries[0].params[0], 'sha256$hash');
});
