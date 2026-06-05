import test from 'node:test';
import assert from 'node:assert/strict';

import { isDead, resolveAttack, resolveCombatRound, resolvePartyRound } from '../../server/engine/combat.js';

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

test('resolveAttack uses deterministic unarmed damage when an adventurer has no weapon dice', () => {
  const attacker = { agility: 20 };
  const defender = { hp: 5, agility: 0 };

  const result = resolveAttack(attacker, defender, sequenceRng([0.5, 0.999999]));

  assert.equal(result.hit, true);
  assert.equal(result.rawDamage, 2);
  assert.equal(result.damage, 2);
  assert.equal(result.defenderHp, 3);
  assert.equal(defender.hp, 3);
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

test('resolvePartyRound: player + companion both strike the enemy, then the enemy hits one party member', () => {
  // Constant high rng -> every attack hits; d20 -> 20, 1d4 -> 4 damage.
  const rng = () => 0.99;
  const character = { agility: 5, damage_dice: '1d4', hp: 20 };
  const enemy = { hp: 50, agility: 0, defense: 0, damage_dice: '1d4' };
  const hermit = { slug: 'hermit', name: 'Hermit', agility: 0, damage_dice: '1d4', hp: 10, defense: 0 };

  const round = resolvePartyRound({ character, fighters: [hermit], enemy, rng });

  assert.equal(round.playerAttack.hit, true);
  assert.equal(round.playerAttack.damage, 4);
  assert.equal(round.companionAttacks.length, 1);
  assert.equal(round.companionAttacks[0].slug, 'hermit');
  assert.equal(round.companionAttacks[0].attack.damage, 4);
  assert.equal(enemy.hp, 42); // 50 - 4 (player) - 4 (hermit)
  assert.equal(round.enemyDefeated, false);
  // party = [player, hermit]; floor(0.99*2) = 1 -> enemy strikes the hermit.
  assert.equal(round.enemyTarget, 'hermit');
  assert.equal(round.enemyAttack.hit, true);
  assert.equal(hermit.hp, 6);
  assert.equal(round.characterDefeated, false);
  assert.deepEqual(round.fallen, []);
});

test('resolvePartyRound: a companion struck below zero is reported as fallen', () => {
  const rng = () => 0.99;
  const character = { agility: 5, damage_dice: '1d4', hp: 20 };
  const enemy = { hp: 50, agility: 0, defense: 0, damage_dice: '1d4' };
  const hermit = { slug: 'hermit', name: 'Hermit', agility: 0, damage_dice: '1d4', hp: 3, defense: 0 };

  const round = resolvePartyRound({ character, fighters: [hermit], enemy, rng });

  assert.equal(round.enemyTarget, 'hermit');
  assert.equal(hermit.hp, 0); // 3 - 4, clamped
  assert.deepEqual(round.fallen, ['hermit']);
});

test('resolvePartyRound with no fighters matches the classic player↔enemy exchange', () => {
  const rng = () => 0.99;
  const character = { agility: 5, damage_dice: '1d4', hp: 20 };
  const enemy = { hp: 50, agility: 0, defense: 0, damage_dice: '1d4' };

  const round = resolvePartyRound({ character, fighters: [], enemy, rng });
  assert.equal(round.companionAttacks.length, 0);
  assert.equal(round.enemyTarget, 'player'); // only the player to hit
  assert.equal(enemy.hp, 46);
});
