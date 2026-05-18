import test from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../public/js/state.js';
import { updateHUD } from '../public/js/hud.js';

function installFakeDocument(ids) {
  const elements = new Map(ids.map((id) => [id, {
    id,
    textContent: '',
    classList: {
      classes: new Set(),
      add(name) { this.classes.add(name); },
      remove(name) { this.classes.delete(name); },
    },
    get offsetWidth() { return 0; },
  }]));
  globalThis.document = {
    getElementById(id) {
      return elements.get(id) ?? null;
    },
  };
  return elements;
}

test('updateHUD keeps shop gold label synced with current character gold', () => {
  const elements = installFakeDocument(['hud-name', 'stat-hd', 'stat-ag', 'stat-ch', 'stat-gold', 'shop-gold']);
  state.character = {
    name: 'Borin',
    hd: 17,
    agility: 12,
    charisma: 18,
    gold: 200,
  };

  updateHUD(false);

  assert.equal(elements.get('stat-gold').textContent, 200);
  assert.equal(elements.get('shop-gold').textContent, 'Your gold: 200');
});

test('updateHUD clears shop gold label when there is no active character', () => {
  const elements = installFakeDocument(['hud-name', 'stat-hd', 'stat-ag', 'stat-ch', 'stat-gold', 'shop-gold']);
  state.character = {};

  updateHUD(false);

  assert.equal(elements.get('stat-gold').textContent, '—');
  assert.equal(elements.get('shop-gold').textContent, 'Your gold: —');
});
