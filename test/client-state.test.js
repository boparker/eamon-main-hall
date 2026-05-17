import test from 'node:test';
import assert from 'node:assert/strict';

import { getOrCreateLocalPlayerId } from '../public/js/state.js';

test('getOrCreateLocalPlayerId persists anonymous player id in localStorage', () => {
  const values = new Map();
  const localStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };

  const first = getOrCreateLocalPlayerId({ localStorage, randomUUID: () => 'uuid-1' });
  const second = getOrCreateLocalPlayerId({ localStorage, randomUUID: () => 'uuid-2' });

  assert.equal(first, 'local-player-uuid-1');
  assert.equal(second, 'local-player-uuid-1');
  assert.equal(values.get('eamon.localPlayerId'), 'local-player-uuid-1');
});

test('getOrCreateLocalPlayerId falls back safely when localStorage is unavailable', () => {
  const id = getOrCreateLocalPlayerId({ localStorage: null, randomUUID: () => 'uuid-1' });

  assert.equal(id, 'local-player-uuid-1');
});
