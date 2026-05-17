import test from 'node:test';
import assert from 'node:assert/strict';

import { rollDie, rollDice } from '../../server/engine/dice.js';

test('rollDie maps rng 0 to 1 and near-1 to sides', () => {
  assert.equal(rollDie(6, () => 0), 1);
  assert.equal(rollDie(6, () => 0.999999), 6);
});

test('rollDice supports 1d6', () => {
  assert.equal(rollDice('1d6', () => 0), 1);
  assert.equal(rollDice('1d6', () => 0.999999), 6);
});

test('rollDice supports 2d4+1', () => {
  const rolls = [0, 0.999999];
  const rng = () => rolls.shift();

  assert.equal(rollDice('2d4+1', rng), 6);
});

test('rollDice supports negative modifiers like 2d4-1', () => {
  const rolls = [0, 0.999999];
  const rng = () => rolls.shift();

  assert.equal(rollDice('2d4-1', rng), 4);
});

test('rollDice returns 0 for invalid notation for Phase 1 simplicity', () => {
  assert.equal(rollDice('bad'), 0);
  assert.equal(rollDice(''), 0);
  assert.equal(rollDice(null), 0);
});
