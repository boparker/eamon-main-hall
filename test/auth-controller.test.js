import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAuthController,
} from '../public/js/auth-controller.js';

function storageHarness() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function makeController({ registerPayload, loginPayload, mePayload } = {}) {
  const calls = [];
  const api = {
    async registerAccount(input) {
      calls.push({ type: 'registerAccount', input });
      return registerPayload ?? { ok: true, token: 'register-token', user: { id: 'user-1' }, profiles: [{ id: 'profile-1' }] };
    },
    async loginAccount(input) {
      calls.push({ type: 'loginAccount', input });
      return loginPayload ?? { ok: true, token: 'login-token', user: { id: 'user-1' }, profiles: [{ id: 'profile-1' }] };
    },
    async getCurrentAccount(token) {
      calls.push({ type: 'getCurrentAccount', token });
      return mePayload ?? { ok: true, user: { id: 'user-1' }, profiles: [{ id: 'profile-1' }] };
    },
    async logoutAccount(token) {
      calls.push({ type: 'logoutAccount', token });
      return { ok: true };
    },
  };
  const storage = storageHarness();
  const controller = createAuthController({ api, storage });
  return { controller, calls, storage };
}

test('register saves returned account session and exposes game identity', async () => {
  const { controller, calls } = makeController();

  const session = await controller.register({ username: 'bo', email: 'bo@example.com', password: 'secret-pass' });

  assert.equal(calls[0].type, 'registerAccount');
  assert.equal(session.sessionToken, 'register-token');
  assert.deepEqual(controller.gameIdentity(), { sessionToken: 'register-token', profileId: 'profile-1' });
});

test('login saves returned account session and exposes game identity', async () => {
  const { controller } = makeController();

  await controller.login({ username: 'bo', password: 'secret-pass' });

  assert.deepEqual(controller.gameIdentity(), { sessionToken: 'login-token', profileId: 'profile-1' });
});

test('refreshCurrentAccount preserves token while updating user/profile metadata', async () => {
  const { controller, calls } = makeController({ mePayload: { ok: true, user: { id: 'user-2' }, profiles: [{ id: 'profile-2' }] } });
  await controller.login({ username: 'bo', password: 'secret-pass' });

  const refreshed = await controller.refreshCurrentAccount();

  assert.equal(calls.at(-1).type, 'getCurrentAccount');
  assert.equal(calls.at(-1).token, 'login-token');
  assert.equal(refreshed.profileId, 'profile-2');
  assert.deepEqual(controller.gameIdentity(), { sessionToken: 'login-token', profileId: 'profile-2' });
});

test('selectProfile persists active profile and updates game identity', async () => {
  const { controller } = makeController({
    loginPayload: {
      ok: true,
      token: 'login-token',
      user: { id: 'user-1' },
      profiles: [{ id: 'profile-1' }, { id: 'profile-2' }],
    },
  });
  await controller.login({ username: 'bo', password: 'secret-pass' });

  const selected = controller.selectProfile('profile-2');

  assert.equal(selected.profileId, 'profile-2');
  assert.deepEqual(controller.gameIdentity(), { sessionToken: 'login-token', profileId: 'profile-2' });
});

test('selectCharacter persists selected character metadata on the active profile', async () => {
  const { controller } = makeController({
    loginPayload: {
      ok: true,
      token: 'login-token',
      user: { id: 'user-1', username: 'bo' },
      profiles: [
        { id: 'profile-1', name: 'Main', selected_character_id: null },
        { id: 'profile-2', name: 'Alt', selected_character_id: null },
      ],
      profileId: 'profile-1',
    },
  });
  await controller.login({ username: 'bo', password: 'secret12' });

  const session = controller.selectCharacter('char-2');

  assert.equal(session.profiles[0].selected_character_id, 'char-2');
  assert.equal(session.profiles[0].selectedCharacterId, 'char-2');
  assert.equal(session.profiles[1].selected_character_id, null);
});

test('selectProfile rejects profiles outside the current account session', async () => {
  const { controller } = makeController();
  await controller.login({ username: 'bo', password: 'secret-pass' });

  assert.throws(() => controller.selectProfile('profile-other'), /Profile is not available/);
  assert.deepEqual(controller.gameIdentity(), { sessionToken: 'login-token', profileId: 'profile-1' });
});

test('logout calls server when token exists and clears local session', async () => {
  const { controller, calls } = makeController();
  await controller.login({ username: 'bo', password: 'secret-pass' });

  await controller.logout();

  assert.equal(calls.at(-1).type, 'logoutAccount');
  assert.equal(calls.at(-1).token, 'login-token');
  assert.equal(controller.getSession(), null);
  assert.equal(controller.gameIdentity(), null);
});
