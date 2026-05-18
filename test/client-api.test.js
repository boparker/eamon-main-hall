import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bootstrapGame,
  listGameCharacters,
  sendGameCommand,
} from '../public/js/api.js';

function installFetch(responsePayload = { ok: true }) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() { return responsePayload; },
    };
  };
  return {
    calls,
    restore() { globalThis.fetch = originalFetch; },
  };
}

test('bootstrapGame can call registered profile bootstrap with bearer auth and no guest player id', async () => {
  const fetchStub = installFetch();
  try {
    await bootstrapGame({ sessionToken: 'raw-session-token', profileId: 'profile-1' });

    assert.equal(fetchStub.calls[0].url, '/api/game/bootstrap');
    assert.equal(fetchStub.calls[0].options.method, 'POST');
    assert.equal(fetchStub.calls[0].options.headers.authorization, 'Bearer raw-session-token');
    assert.equal(fetchStub.calls[0].options.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(fetchStub.calls[0].options.body), { profileId: 'profile-1' });
  } finally {
    fetchStub.restore();
  }
});

test('sendGameCommand can send registered profile command without guest player id', async () => {
  const fetchStub = installFetch();
  try {
    await sendGameCommand({
      sessionToken: 'raw-session-token',
      profileId: 'profile-1',
      characterId: 'char-1',
      adventureRunId: 'run-1',
      input: 'south',
    });

    assert.equal(fetchStub.calls[0].url, '/api/game/command');
    assert.equal(fetchStub.calls[0].options.headers.authorization, 'Bearer raw-session-token');
    assert.deepEqual(JSON.parse(fetchStub.calls[0].options.body), {
      profileId: 'profile-1',
      characterId: 'char-1',
      adventureRunId: 'run-1',
      input: 'south',
    });
  } finally {
    fetchStub.restore();
  }
});

test('listGameCharacters preserves guest playerId query path', async () => {
  const fetchStub = installFetch();
  try {
    await listGameCharacters('local-player-1');

    assert.equal(fetchStub.calls[0].url, '/api/game/characters?playerId=local-player-1');
    assert.equal(fetchStub.calls[0].options.headers, undefined);
  } finally {
    fetchStub.restore();
  }
});
