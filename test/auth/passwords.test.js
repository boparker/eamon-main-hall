import test from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, verifyPassword } from '../../server/auth/passwords.js';

test('hashPassword stores a scrypt hash rather than the raw password', async () => {
  const hash = await hashPassword('correct horse battery staple');

  assert.match(hash, /^scrypt\$/);
  assert.notEqual(hash, 'correct horse battery staple');
  assert.equal(hash.includes('correct horse battery staple'), false);
});

test('verifyPassword accepts the original password and rejects the wrong password', async () => {
  const hash = await hashPassword('correct horse battery staple');

  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
});

test('verifyPassword returns false for malformed stored hashes', async () => {
  assert.equal(await verifyPassword('anything', ''), false);
  assert.equal(await verifyPassword('anything', 'not-a-scrypt-hash'), false);
  assert.equal(await verifyPassword('anything', 'scrypt$missing-key'), false);
});
