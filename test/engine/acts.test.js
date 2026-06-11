import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getRegard, setRegard, shiftRegard, charismaScaled,
  actsFor, findAct, applyAct, timesActed,
  canYield, checkYield, hasYielded, markYielded, markMerciless, isMerciless,
  markSpared, wasSpared,
  behaviorState,
  telegraphFor, telegraphPending, setTelegraph, shouldTelegraph, isStance,
} from '../../server/engine/acts.js';
import { resolveTelegraphRound } from '../../server/engine/combat.js';

const gorilla = {
  slug: 'gorilla', name: 'Gorilla', friendliness: 'hostile', hp: 12,
  acts: [
    { verb: 'calm', label: 'Calm', shift: 30, success_text: 'It calms.', repeat_text: 'Calmer still.' },
    { verb: 'posture', shift: -15, success_text: 'It rages.' },
  ],
  yields_at_regard: 60,
  yields_at_hp: 3,
  telegraph: { every: 2, name: 'charge', multiplier: 2, warn_text: 'It charges!' },
};

const run = () => ({ flags: {} });

test('regard starts from base friendliness and clamps 0..100', () => {
  assert.equal(getRegard(run(), gorilla), 10); // hostile base
  const r = setRegard(run(), 'gorilla', 250);
  assert.equal(getRegard(r, gorilla), 100);
  assert.equal(getRegard(setRegard(run(), 'gorilla', -5), gorilla), 0);
});

test('charisma scales positive shifts only', () => {
  assert.equal(charismaScaled(20, 15), 25); // +25% at cha 15
  assert.equal(charismaScaled(20, 10), 20);
  assert.equal(charismaScaled(-20, 18), -20); // insults are not charming
});

test('applyAct shifts regard, repeat lands at half strength', () => {
  const act = findAct(gorilla, 'calm');
  const first = applyAct({ run: run(), npc: gorilla, act, charisma: 10 });
  assert.equal(first.regard, 40); // 10 + 30
  assert.equal(first.text, 'It calms.');
  assert.equal(timesActed(first.run, 'gorilla', 'calm'), 1);
  const second = applyAct({ run: first.run, npc: gorilla, act, charisma: 10 });
  assert.equal(second.regard, 55); // +15 (halved)
  assert.equal(second.text, 'Calmer still.');
  assert.equal(second.repeated, true);
});

test('negative acts lower regard', () => {
  const act = findAct(gorilla, 'posture');
  const result = applyAct({ run: setRegard(run(), 'gorilla', 40), npc: gorilla, act, charisma: 18 });
  assert.equal(result.regard, 25);
});

test('yields when regard crosses threshold or hp falls to threshold', () => {
  assert.equal(checkYield(gorilla, run(), 12), false);
  assert.equal(checkYield(gorilla, setRegard(run(), 'gorilla', 60), 12), true);
  assert.equal(checkYield(gorilla, run(), 3), true); // hp threshold
  assert.equal(checkYield(gorilla, run(), 0), false); // dead is not yielding
  assert.equal(canYield({ slug: 'rat' }), false);
});

test('striking a yielded enemy is merciless: never yields again', () => {
  let r = markYielded(run(), 'gorilla');
  assert.equal(hasYielded(r, 'gorilla'), true);
  r = markMerciless(r, 'gorilla');
  assert.equal(isMerciless(r, 'gorilla'), true);
  assert.equal(hasYielded(r, 'gorilla'), false);
  assert.equal(checkYield(gorilla, setRegard(r, 'gorilla', 100), 1), false);
});

test('spared is recorded', () => {
  const r = markSpared(run(), 'gorilla');
  assert.equal(wasSpared(r, 'gorilla'), true);
  assert.equal(wasSpared(run(), 'gorilla'), false);
});

test('behavior states track hp and regard', () => {
  assert.equal(behaviorState(gorilla, { hp: 12, maxHp: 12, regard: 10 }), 'aggressive');
  assert.equal(behaviorState(gorilla, { hp: 7, maxHp: 12, regard: 10 }), 'wary');
  assert.equal(behaviorState(gorilla, { hp: 12, maxHp: 12, regard: 45 }), 'wary');
  assert.equal(behaviorState(gorilla, { hp: 2, maxHp: 12, regard: 10 }), 'desperate');
  assert.equal(behaviorState(gorilla, { hp: 12, maxHp: 12, regard: 10, yielded: true }), 'yielding');
});

test('telegraph raises on schedule and toggles', () => {
  assert.ok(telegraphFor(gorilla));
  assert.equal(shouldTelegraph(gorilla, 1), false);
  assert.equal(shouldTelegraph(gorilla, 2), true);
  assert.equal(shouldTelegraph(gorilla, 4), true);
  assert.equal(shouldTelegraph({ slug: 'rat' }, 2), false);
  let r = setTelegraph(run(), 'gorilla', true);
  assert.equal(telegraphPending(r, 'gorilla'), true);
  r = setTelegraph(r, 'gorilla', false);
  assert.equal(telegraphPending(r, 'gorilla'), false);
  assert.ok(isStance('brace') && isStance('dodge') && isStance('interrupt'));
  assert.equal(isStance('attack'), false);
});

test('telegraph round: dodge evades entirely', () => {
  const character = { hp: 10, agility: 5, damage_dice: '1d4' };
  const enemy = { hp: 12, agility: 0, damage_dice: '2d6' };
  const result = resolveTelegraphRound({ character, enemy, stance: 'dodge', rng: () => 0.99 });
  assert.equal(result.enemyAttack.damage, 0);
  assert.equal(result.enemyAttack.evaded, true);
  assert.equal(character.hp, 10);
});

test('telegraph round: brace halves the multiplier', () => {
  const character = { hp: 20, agility: 0, damage_dice: '1d4', defense: 0 };
  const enemy = { hp: 12, agility: 20, damage_dice: '2d6' };
  // rng high → enemy hits, dice roll max: 2d6 max = 12, multiplier 2/2 = 1 → 12 damage
  const result = resolveTelegraphRound({ character, enemy, stance: 'brace', multiplier: 2, rng: () => 0.999 });
  assert.equal(result.enemyAttack.braced, true);
  assert.ok(result.enemyAttack.damage <= 12);
  assert.equal(result.playerAttack, null);
});

test('telegraph round: interrupt hit cancels the blow', () => {
  const character = { hp: 10, agility: 30, damage_dice: '1d4' };
  const enemy = { hp: 12, agility: 0, damage_dice: '2d6' };
  const result = resolveTelegraphRound({ character, enemy, stance: 'interrupt', rng: () => 0.5 });
  assert.equal(result.interrupted, true);
  assert.equal(result.enemyAttack, null);
  assert.ok(enemy.hp < 12);
});

test('telegraph round: missed interrupt eats the doubled blow automatically', () => {
  const character = { hp: 30, agility: 0, damage_dice: '1d4', defense: 0 };
  const enemy = { hp: 12, agility: 30, damage_dice: '1d4' };
  const result = resolveTelegraphRound({ character, enemy, stance: 'interrupt', multiplier: 2, rng: () => 0.0 });
  assert.equal(result.playerAttack.hit, false);
  assert.equal(result.enemyAttack.hit, true);
  assert.equal(result.enemyAttack.exposed, true);
  assert.ok(character.hp < 30);
});
