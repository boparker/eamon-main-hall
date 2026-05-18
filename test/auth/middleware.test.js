import test from 'node:test';
import assert from 'node:assert/strict';

import { optionalAuth, requireAuth } from '../../server/auth/middleware.js';
import { hashSessionToken } from '../../server/auth/sessions.js';

function makeReq(authHeader) {
  return { headers: authHeader ? { authorization: authHeader } : {} };
}

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function makeDb({ user = null } = {}) {
  return {
    queries: [],
    async query(sql, params = []) {
      this.queries.push({ sql, params });
      return { rows: user ? [user] : [] };
    },
  };
}

async function runMiddleware(middleware, req, res) {
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  return nextCalled;
}

test('optionalAuth leaves req.auth null when no bearer token is present', async () => {
  const db = makeDb();
  const req = makeReq();
  const res = makeRes();

  const nextCalled = await runMiddleware(optionalAuth({ db }), req, res);

  assert.equal(nextCalled, true);
  assert.equal(req.auth, null);
  assert.equal(db.queries.length, 0);
});

test('optionalAuth resolves a valid bearer token into req.auth user', async () => {
  const user = { id: 'user-1', username: 'bo' };
  const db = makeDb({ user });
  const req = makeReq('Bearer raw-token');
  const res = makeRes();

  const nextCalled = await runMiddleware(optionalAuth({ db }), req, res);

  assert.equal(nextCalled, true);
  assert.deepEqual(req.auth, { user });
  assert.equal(db.queries[0].params[0], hashSessionToken('raw-token'));
});

test('optionalAuth rejects present but invalid bearer token', async () => {
  const db = makeDb({ user: null });
  const req = makeReq('Bearer bad-token');
  const res = makeRes();

  const nextCalled = await runMiddleware(optionalAuth({ db }), req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Invalid or expired session' });
});

test('requireAuth rejects missing bearer token', async () => {
  const db = makeDb();
  const req = makeReq();
  const res = makeRes();

  const nextCalled = await runMiddleware(requireAuth({ db }), req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Authentication required' });
});
