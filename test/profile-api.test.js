import test from 'node:test';
import assert from 'node:assert/strict';

import { selectProfileCharacter } from '../public/js/profile-api.js';

function createFetchRecorder({ response = { ok: true, profile: { id: 'profile-1', selected_character_id: 'char-1' } } } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() { return response; },
    };
  };
  return { calls, fetchImpl };
}

test('selectProfileCharacter posts selected character to profile endpoint with bearer token', async () => {
  const { calls, fetchImpl } = createFetchRecorder();

  const payload = await selectProfileCharacter({ sessionToken: 'raw-session-token', profileId: 'profile-1', characterId: 'char-1', fetchImpl });

  assert.equal(payload.profile.selected_character_id, 'char-1');
  assert.equal(calls[0].url, '/api/profiles/profile-1/select-character');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.authorization, 'Bearer raw-session-token');
  assert.equal(calls[0].options.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), { characterId: 'char-1' });
});
