import test from 'node:test';
import assert from 'node:assert/strict';

import {
  baseFriendliness, friendlyChance, resolveEncounter, isEscort, buildFighter,
} from '../../server/engine/companions.js';

test('baseFriendliness derives from disposition word or explicit override', () => {
  assert.equal(baseFriendliness({ friendliness: 'friendly' }), 80);
  assert.equal(baseFriendliness({ friendliness: 'hostile' }), 10);
  assert.equal(baseFriendliness({ friendliness: 'neutral' }), 50);
  assert.equal(baseFriendliness({}), 50);
  assert.equal(baseFriendliness({ base_friendliness: 33 }), 33);
});

test('friendlyChance shifts 5% per charisma point and clamps to 5..95', () => {
  assert.equal(friendlyChance(10, 50), 50);
  assert.equal(friendlyChance(15, 50), 75);
  assert.equal(friendlyChance(5, 50), 25);
  assert.equal(friendlyChance(40, 50), 95); // clamp high
  assert.equal(friendlyChance(0, 10), 5); // clamp low
});

test('resolveEncounter: roll under the chance is a friend, at/over is a foe', () => {
  const npc = { friendliness: 'neutral' }; // base 50
  // charisma 15 -> 75% friendly. rng 0.74 -> roll 74 < 75 -> friend
  assert.equal(resolveEncounter(npc, 15, () => 0.74), 'friend');
  // rng 0.80 -> roll 80 >= 75 -> foe
  assert.equal(resolveEncounter(npc, 15, () => 0.80), 'foe');
});

test('isEscort flags explicit escorts and no-attack NPCs', () => {
  assert.equal(isEscort({ escort: true }), true);
  assert.equal(isEscort({ damage_dice: '0d0' }), true);
  assert.equal(isEscort({ damage_dice: null }), true);
  assert.equal(isEscort({ damage_dice: '2d8' }), false);
});

test('buildFighter makes a transient combat entity carrying current hp', () => {
  const f = buildFighter({ slug: 'hermit', name: 'Hermit', agility: 12, damage_dice: '2d8' }, 7);
  assert.deepEqual(f, { slug: 'hermit', name: 'Hermit', hp: 7, agility: 12, damage_dice: '2d8', defense: 0 });
});
