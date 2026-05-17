import test from 'node:test';
import assert from 'node:assert/strict';

import { isDead, resolveAttack, resolveCombatRound } from '../../server/engine/combat.js';

function sequenceRng(values) {
  const rolls = [...values];
  return () => {
    if (rolls.length === 0) {
      throw new Error('rng exhausted');
    }
    return rolls.shift();
  };
}

test('isDead recognizes hp, currentHp, and current_hp at zero or below', () => {
  assert.equal(isDead({ hp: 1 }), false);
  assert.equal(isDead({ hp: 0 }), true);
  assert.equal(isDead({ hp: -3 }), true);
  assert.equal(isDead({ hp: 10, currentHp: 0 }), true);
  assert.equal(isDead({ hp: 10, current_hp: 0 }), true);
  assert.equal(isDead(null), true);
});

test('resolveAttack hits using agility, rolls attacker damage dice, applies defense, and clamps hp', () => {
  const attacker = { agility: 2, damage_dice: '1d6' };
  const defender = { currentHp: 5, agility: 1, defense: 2 };

  const result = resolveAttack(attacker, defender, sequenceRng([0.4, 0.999999]));

  assert.deepEqual(result, {
    hit: true,
    roll: 9,
    attackTotal: 11,
    targetNumber: 11,
    rawDamage: 6,
    damage: 4,
    defenderHp: 1,
  });
  assert.equal(defender.currentHp, 1);
});

test('resolveAttack misses below target number and does not roll damage', () => {
  const attacker = { agility: 0, damage_dice: '1d100' };
  const defender = { hp: 8, agility: 5, defense: 0 };

  const result = resolveAttack(attacker, defender, sequenceRng([0]));

  assert.deepEqual(result, {
    hit: false,
    roll: 1,
    attackTotal: 1,
    targetNumber: 15,
    rawDamage: 0,
    damage: 0,
    defenderHp: 8,
  });
  assert.equal(defender.hp, 8);
});

test('resolveAttack supports equipped weapon dice and armor/current_hp aliases', () => {
  const attacker = { agility: 4, equippedWeapon: { damage_dice: '2d4+1' } };
  const defender = { current_hp: 3, agility: 0, armor: 2 };

  const result = resolveAttack(attacker, defender, sequenceRng([0.25, 0.999999, 0.999999]));

  assert.equal(result.hit, true);
  assert.equal(result.rawDamage, 9);
  assert.equal(result.damage, 7);
  assert.equal(result.defenderHp, 0);
  assert.equal(defender.current_hp, 0);
});

test('resolveCombatRound resolves player first and skips counterattack when enemy dies', () => {
  const character = { currentHp: 10, agility: 5, equippedWeapon: { damage_dice: '1d6' }, defense: 0 };
  const enemy = { hp: 3, agility: 0, damage_dice: '1d12' };

  const result = resolveCombatRound(character, enemy, sequenceRng([0.2, 0.999999]));

  assert.equal(enemy.hp, 0);
  assert.equal(character.currentHp, 10);
  assert.equal(result.enemyDefeated, true);
  assert.equal(result.characterDefeated, false);
  assert.equal(result.enemyAttack, null);
  assert.equal(result.playerAttack.hit, true);
});

test('resolveCombatRound counterattacks when enemy survives and clamps player hp', () => {
  const character = { hp: 4, agility: 0, weapon: { damage_dice: '1d4' }, armor: 1 };
  const enemy = { hp: 10, agility: 0, damage_dice: '1d8' };

  const result = resolveCombatRound(character, enemy, sequenceRng([0.5, 0.5, 0.5, 0.999999]));

  assert.equal(enemy.hp, 7);
  assert.equal(character.hp, 0);
  assert.equal(result.enemyDefeated, false);
  assert.equal(result.characterDefeated, true);
  assert.equal(result.playerAttack.damage, 3);
  assert.equal(result.enemyAttack.damage, 7);
});

test('resolveAttack handles missing defender by reporting damage without throwing', () => {
  const attacker = { agility: 20, damage_dice: '1d4' };

  const result = resolveAttack(attacker, null, sequenceRng([0, 0.999999]));

  assert.equal(result.hit, true);
  assert.equal(result.rawDamage, 4);
  assert.equal(result.damage, 4);
  assert.equal(result.defenderHp, 0);
});

test('resolveAttack handles invalid damage dice as zero damage', () => {
  const attacker = { agility: 20, damage_dice: 'not-dice' };
  const defender = { hp: 5, agility: 0 };

  const result = resolveAttack(attacker, defender, sequenceRng([0.5]));

  assert.equal(result.hit, true);
  assert.equal(result.rawDamage, 0);
  assert.equal(result.damage, 0);
  assert.equal(result.defenderHp, 5);
  assert.equal(defender.hp, 5);
});

test('resolveAttack handles invalid rng by falling back to deterministic minimum rolls', () => {
  const attacker = { agility: 20, damage_dice: '1d4' };
  const defender = { hp: 5, agility: 0 };

  const result = resolveAttack(attacker, defender, null);

  assert.equal(result.hit, true);
  assert.equal(result.roll, 1);
  assert.equal(result.rawDamage, 1);
  assert.equal(result.damage, 1);
  assert.equal(result.defenderHp, 4);
});
