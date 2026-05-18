import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionToken, hashSessionToken, sessionExpiry } from '../../server/auth/sessions.js';

test('createSessionToken returns long unique opaque tokens', () => {
  const first = createSessionToken();
  const second = createSessionToken();

  assert.equal(typeof first, 'string');
  assert.ok(first.length >= 43);
  assert.notEqual(first, second);
});

test('hashSessionToken is deterministic and does not expose raw token', () => {
  const token = 'session-token-for-test';
  const first = hashSessionToken(token);
  const second = hashSessionToken(token);

  assert.equal(first, second);
  assert.match(first, /^sha256\$/);
  assert.equal(first.includes(token), false);
});

test('sessionExpiry returns a future Date using requested day window', () => {
  const before = Date.now();
  const expiry = sessionExpiry(2);
  const after = Date.now();

  assert.ok(expiry instanceof Date);
  assert.ok(expiry.getTime() >= before + 2 * 24 * 60 * 60 * 1000);
  assert.ok(expiry.getTime() <= after + 2 * 24 * 60 * 60 * 1000 + 1000);
});
