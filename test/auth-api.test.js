import test from 'node:test';
import assert from 'node:assert/strict';

import {
  authFetch,
  registerAccount,
  loginAccount,
  getCurrentAccount,
  logoutAccount,
} from '../public/js/auth-api.js';

function installFetch({ payload = { ok: true }, ok = true, status = 200 } = {}) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok,
      status,
      async json() { return payload; },
    };
  };
  return { calls, restore() { globalThis.fetch = originalFetch; } };
}

test('registerAccount posts credentials to auth register endpoint', async () => {
  const fetchStub = installFetch({ payload: { ok: true, token: 'raw-session-token', profiles: [{ id: 'profile-1' }] } });
  try {
    await registerAccount({ username: 'bo', email: 'bo@example.com', password: 'secret-pass' });

    assert.equal(fetchStub.calls[0].url, '/api/auth/register');
    assert.equal(fetchStub.calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(fetchStub.calls[0].options.body), { username: 'bo', email: 'bo@example.com', password: 'secret-pass' });
    assert.equal(fetchStub.calls[0].options.headers['content-type'], 'application/json');
  } finally {
    fetchStub.restore();
  }
});

test('getCurrentAccount sends bearer token to /api/auth/me', async () => {
  const fetchStub = installFetch({ payload: { ok: true, user: { id: 'user-1' }, profiles: [] } });
  try {
    await getCurrentAccount('raw-session-token');

    assert.equal(fetchStub.calls[0].url, '/api/auth/me');
    assert.equal(fetchStub.calls[0].options.headers.authorization, 'Bearer raw-session-token');
  } finally {
    fetchStub.restore();
  }
});

test('logoutAccount sends bearer token to auth logout endpoint', async () => {
  const fetchStub = installFetch();
  try {
    await logoutAccount('raw-session-token');

    assert.equal(fetchStub.calls[0].url, '/api/auth/logout');
    assert.equal(fetchStub.calls[0].options.method, 'POST');
    assert.equal(fetchStub.calls[0].options.headers.authorization, 'Bearer raw-session-token');
  } finally {
    fetchStub.restore();
  }
});

test('authFetch throws stable errors for failed auth responses', async () => {
  const fetchStub = installFetch({ ok: false, status: 401, payload: { error: 'Invalid credentials.' } });
  try {
    await assert.rejects(() => authFetch('/login', { method: 'POST', body: { username: 'bo' } }), /Invalid credentials/);
  } finally {
    fetchStub.restore();
  }
});
