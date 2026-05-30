import test from 'node:test';
import assert from 'node:assert/strict';

import { castSpell, isSpell, COMBAT_SPELLS } from '../../server/engine/spells.js';

const low = () => 0;     // d100 -> 1 (always succeeds vs any learned ability)
const high = () => 0.99; // d100 -> 100 (fails unless ability is 100)

test('isSpell recognises the four combat spells', () => {
  assert.deepEqual(COMBAT_SPELLS, ['blast', 'heal', 'speed', 'power']);
  assert.equal(isSpell('Blast'), true);
  assert.equal(isSpell('fireball'), false);
});

test('castSpell refuses unknown or unlearned spells', () => {
  assert.equal(castSpell({ spells: {} }, 'fireball', {}).reason, 'unknown-spell');
  assert.equal(castSpell({ spells: {} }, 'blast', { enemy: { hp: 5 } }).reason, 'not-learned');
});

test('blast needs a target and damages the enemy on success', () => {
  assert.equal(castSpell({ spells: { blast: 50 } }, 'blast', { rng: low }).reason, 'no-target');
  const enemy = { hp: 20 };
  const result = castSpell({ spells: { blast: 50 } }, 'blast', { enemy, rng: low });
  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.ok(result.damage > 0);
  assert.equal(enemy.hp, 20 - result.damage);
});

test('a failed cast fizzles with no effect', () => {
  const enemy = { hp: 20 };
  const result = castSpell({ spells: { blast: 50 } }, 'blast', { enemy, rng: high });
  assert.equal(result.success, false);
  assert.equal(result.damage, 0);
  assert.equal(enemy.hp, 20); // untouched
});

test('heal restores hardiness, capped at max', () => {
  const character = { hd: 5, maxHd: 8, spells: { heal: 90 } };
  const result = castSpell(character, 'heal', { rng: low });
  assert.equal(result.success, true);
  assert.ok(result.heal > 0);
  assert.ok(character.hd <= 8); // never exceeds max
});

test('speed grants haste on success', () => {
  const result = castSpell({ spells: { speed: 90 } }, 'speed', { rng: low });
  assert.equal(result.success, true);
  assert.equal(result.haste, true);
});

test('power always resolves to one of its outcomes on success', () => {
  const enemy = { hp: 30 };
  const result = castSpell({ hd: 10, maxHd: 20, spells: { power: 90 } }, 'power', { enemy, rng: low });
  assert.equal(result.success, true);
  assert.ok(typeof result.message === 'string' && result.message.length > 0);
});
