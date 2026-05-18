import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createProfilesRouter } from '../../server/routes/profiles.js';

async function request(app, method, path, body, headers = {}) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeDeps(overrides = {}) {
  const calls = [];
  const deps = {
    db: { ok: true },
    hashSessionToken: (token) => `sha256$${token}`,
    async getUserBySessionTokenHash(_db, tokenHash) {
      calls.push({ type: 'getUserBySessionTokenHash', tokenHash });
      if (tokenHash === 'sha256$raw-session-token') return { id: 'user-1', username: 'bo' };
      return null;
    },
    async listProfiles(_db, userId) {
      calls.push({ type: 'listProfiles', userId });
      return [{ id: 'profile-1', user_id: userId, name: 'Bo', selected_character_id: null }];
    },
    async createProfile(_db, userId, name) {
      calls.push({ type: 'createProfile', userId, name });
      return { id: 'profile-2', user_id: userId, name, selected_character_id: null };
    },
    async setSelectedCharacter(_db, userId, profileId, characterId) {
      calls.push({ type: 'setSelectedCharacter', userId, profileId, characterId });
      return { id: profileId, user_id: userId, name: 'Bo', selected_character_id: characterId };
    },
    ...overrides,
  };
  deps.calls = calls;
  return deps;
}

function makeApp(deps = makeDeps()) {
  const app = express();
  app.use(express.json());
  app.use('/api/profiles', createProfilesRouter(deps));
  return { app, deps };
}

test('GET /api/profiles rejects unauthenticated requests', async () => {
  const { app } = makeApp();

  const response = await request(app, 'GET', '/api/profiles');

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'Authentication required' });
});

test('GET /api/profiles lists authenticated user profiles', async () => {
  const { app, deps } = makeApp();

  const response = await request(app, 'GET', '/api/profiles', null, { authorization: 'Bearer raw-session-token' });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.profiles[0].id, 'profile-1');
  assert.equal(deps.calls.find((call) => call.type === 'listProfiles').userId, 'user-1');
});

test('POST /api/profiles creates an authenticated user profile', async () => {
  const { app, deps } = makeApp();

  const response = await request(app, 'POST', '/api/profiles', { name: 'Second Player' }, { authorization: 'Bearer raw-session-token' });

  assert.equal(response.status, 201);
  assert.equal(response.body.profile.name, 'Second Player');
  assert.deepEqual(deps.calls.find((call) => call.type === 'createProfile'), { type: 'createProfile', userId: 'user-1', name: 'Second Player' });
});

test('POST /api/profiles validates profile name', async () => {
  const { app } = makeApp();

  const response = await request(app, 'POST', '/api/profiles', { name: ' ' }, { authorization: 'Bearer raw-session-token' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /profile name/i);
});

test('POST /api/profiles/:profileId/select-character persists selected character', async () => {
  const { app, deps } = makeApp();

  const response = await request(
    app,
    'POST',
    '/api/profiles/profile-1/select-character',
    { characterId: 'char-1' },
    { authorization: 'Bearer raw-session-token' },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.profile.selected_character_id, 'char-1');
  assert.deepEqual(deps.calls.find((call) => call.type === 'setSelectedCharacter'), {
    type: 'setSelectedCharacter', userId: 'user-1', profileId: 'profile-1', characterId: 'char-1',
  });
});
