import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createAuthRouter } from '../../server/routes/auth.js';

async function request(app, method, path, body, headers = {}) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json();
    return { status: response.status, body: json };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeDeps(overrides = {}) {
  const calls = [];
  const deps = {
    db: { ok: true },
    hashPassword: async (password) => `scrypt$${password}`,
    verifyPassword: async (password, stored) => stored === `scrypt$${password}`,
    createSessionToken: () => 'raw-session-token',
    hashSessionToken: (token) => `sha256$${token}`,
    sessionExpiry: () => new Date('2030-01-01T00:00:00Z'),
    async createUser(_db, input) {
      calls.push({ type: 'createUser', input });
      return { id: input.id ?? 'user-1', username: input.username.trim().toLowerCase(), email: input.email?.toLowerCase() ?? null, display_name: input.displayName ?? null };
    },
    async getUserByUsername(_db, username) {
      calls.push({ type: 'getUserByUsername', username });
      if (username.trim().toLowerCase() === 'bo') return { id: 'user-1', username: 'bo', password_hash: 'scrypt$secretpass1', display_name: 'Bo' };
      return null;
    },
    async createProfile(_db, userId, name) {
      calls.push({ type: 'createProfile', userId, name });
      return { id: 'profile-1', user_id: userId, name };
    },
    async listProfiles(_db, userId) {
      calls.push({ type: 'listProfiles', userId });
      return [{ id: 'profile-1', user_id: userId, name: 'Bo', selected_character_id: null }];
    },
    async createUserSession(_db, userId, tokenHash, expiresAt) {
      calls.push({ type: 'createUserSession', userId, tokenHash, expiresAt });
      return { id: 'session-1', user_id: userId, token_hash: tokenHash };
    },
    async getUserBySessionTokenHash(_db, tokenHash) {
      calls.push({ type: 'getUserBySessionTokenHash', tokenHash });
      if (tokenHash === 'sha256$raw-session-token') return { id: 'user-1', username: 'bo', display_name: 'Bo' };
      return null;
    },
    async deleteUserSession(_db, tokenHash) {
      calls.push({ type: 'deleteUserSession', tokenHash });
    },
    ...overrides,
  };
  deps.calls = calls;
  return deps;
}

function makeApp(deps = makeDeps()) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(deps));
  return { app, deps };
}

test('POST /api/auth/register creates user, default profile, and session token', async () => {
  const { app, deps } = makeApp();

  const response = await request(app, 'POST', '/api/auth/register', {
    username: ' Boparker ',
    email: 'BO@example.com',
    password: 'secretpass1',
    displayName: 'Bo',
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.sessionToken, 'raw-session-token');
  assert.equal(response.body.user.username, 'boparker');
  assert.equal(response.body.profile.id, 'profile-1');
  assert.equal(deps.calls.find((call) => call.type === 'createUser').input.passwordHash, 'scrypt$secretpass1');
  assert.equal(deps.calls.some((call) => call.type === 'createProfile'), true);
  assert.equal(deps.calls.some((call) => call.type === 'createUserSession'), true);
});

test('POST /api/auth/register validates username and password', async () => {
  const { app } = makeApp();

  const response = await request(app, 'POST', '/api/auth/register', { username: 'x', password: 'short' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /username/i);
});

test('POST /api/auth/login returns session for valid credentials and rejects wrong password', async () => {
  const { app } = makeApp();

  const ok = await request(app, 'POST', '/api/auth/login', { username: 'bo', password: 'secretpass1' });
  const bad = await request(app, 'POST', '/api/auth/login', { username: 'bo', password: 'wrongpass1' });

  assert.equal(ok.status, 200);
  assert.equal(ok.body.sessionToken, 'raw-session-token');
  assert.equal(ok.body.profiles[0].id, 'profile-1');
  assert.equal(bad.status, 401);
});

test('GET /api/auth/me returns current user and profiles for bearer token', async () => {
  const { app } = makeApp();

  const response = await request(app, 'GET', '/api/auth/me', null, { authorization: 'Bearer raw-session-token' });

  assert.equal(response.status, 200);
  assert.equal(response.body.user.username, 'bo');
  assert.equal(response.body.profiles.length, 1);
});

test('POST /api/auth/logout invalidates current session token', async () => {
  const { app, deps } = makeApp();

  const response = await request(app, 'POST', '/api/auth/logout', null, { authorization: 'Bearer raw-session-token' });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(deps.calls.find((call) => call.type === 'deleteUserSession').tokenHash, 'sha256$raw-session-token');
});
