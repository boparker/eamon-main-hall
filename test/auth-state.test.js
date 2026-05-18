import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getStoredAuthSession,
  saveAuthSession,
  clearAuthSession,
  activeProfileId,
} from '../public/js/auth-state.js';

function storageHarness(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    dump() { return Object.fromEntries(values); },
  };
}

test('saveAuthSession stores token, user, profiles, and selected active profile id', () => {
  const storage = storageHarness();
  const session = saveAuthSession({
    token: 'raw-session-token',
    user: { id: 'user-1', username: 'bo' },
    profiles: [{ id: 'profile-1', displayName: 'Bo' }],
  }, storage);

  assert.equal(session.sessionToken, 'raw-session-token');
  assert.equal(session.profileId, 'profile-1');
  assert.deepEqual(getStoredAuthSession(storage), session);
});

test('getStoredAuthSession returns null and clears malformed or incomplete session data', () => {
  const storage = storageHarness({ eamonAuthSession: '{bad json' });

  assert.equal(getStoredAuthSession(storage), null);
  assert.deepEqual(storage.dump(), {});
});

test('activeProfileId preserves explicit selected profile over first profile fallback', () => {
  assert.equal(activeProfileId({ selectedProfileId: 'profile-2', profiles: [{ id: 'profile-1' }, { id: 'profile-2' }] }), 'profile-2');
  assert.equal(activeProfileId({ profiles: [{ id: 'profile-1' }] }), 'profile-1');
  assert.equal(activeProfileId({ profiles: [] }), null);
});

test('clearAuthSession removes stored auth session', () => {
  const storage = storageHarness();
  saveAuthSession({ token: 'raw-session-token', profiles: [{ id: 'profile-1' }] }, storage);

  clearAuthSession(storage);

  assert.equal(getStoredAuthSession(storage), null);
});
