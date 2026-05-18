import test from 'node:test';
import assert from 'node:assert/strict';

import { claimGuestCharacter, createProfile, selectProfileCharacter } from '../public/js/profile-api.js';

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

test('createProfile posts profile name to profile collection endpoint with bearer token', async () => {
  const { calls, fetchImpl } = createFetchRecorder({ response: { ok: true, profile: { id: 'profile-2', name: 'New Party' } } });

  const payload = await createProfile({ sessionToken: 'raw-session-token', name: 'New Party', fetchImpl });

  assert.equal(payload.profile.id, 'profile-2');
  assert.equal(calls[0].url, '/api/profiles');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.authorization, 'Bearer raw-session-token');
  assert.equal(calls[0].options.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), { name: 'New Party' });
});

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

test('claimGuestCharacter posts guest player and character ids to profile claim endpoint', async () => {
  const { calls, fetchImpl } = createFetchRecorder({ response: { ok: true, character: { id: 'char-1' }, profile: { id: 'profile-1', selected_character_id: 'char-1' } } });

  const payload = await claimGuestCharacter({
    sessionToken: 'raw-session-token',
    profileId: 'profile-1',
    guestPlayerId: 'guest-1',
    characterId: 'char-1',
    fetchImpl,
  });

  assert.equal(payload.character.id, 'char-1');
  assert.equal(calls[0].url, '/api/profiles/profile-1/claim-guest-character');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.authorization, 'Bearer raw-session-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), { guestPlayerId: 'guest-1', characterId: 'char-1' });
});
