import test from 'node:test';
import assert from 'node:assert/strict';

import { gameFetch } from '../public/js/api.js';

test('gameFetch reports stable errors for non-JSON responses', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 502,
    json: async () => { throw new SyntaxError('not json'); },
    text: async () => 'Bad gateway',
  });

  try {
    await assert.rejects(() => gameFetch('/bootstrap', { method: 'POST', body: { playerId: 'p1' } }), (err) => {
      assert.equal(err.status, 502);
      assert.match(err.message, /Bad gateway/);
      return true;
    });
  } finally {
    globalThis.fetch = oldFetch;
  }
});
