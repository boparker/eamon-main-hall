import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyDeed, computeReputation, reputationRead, reputationForPrompt,
  encounterBonus, firstSightRegard, yieldMods, escortMultiplier,
} from '../../server/engine/reputation.js';
import { friendlyChance } from '../../server/engine/companions.js';

const deed = (kind, n = 1) => Array.from({ length: n }, () => ({ text: 'x', kind }));

test('classifyDeed prefers structured kind, falls back to legacy text patterns', () => {
  assert.equal(classifyDeed({ text: 'whatever', kind: 'spare' }), 'spare');
  assert.equal(classifyDeed({ text: 'Showed mercy to the Gorilla in East Cell.' }), 'spare');
  assert.equal(classifyDeed({ text: 'Slew the Rat in the tunnel.' }), 'slay');
  assert.equal(classifyDeed({ text: 'Broke a truce with the Troll, who had yielded.' }), 'truce_broken');
  assert.equal(classifyDeed({ text: 'Brought Cynthia safely home through the dark.' }), 'rescue');
  assert.equal(classifyDeed({ text: 'Made peace with Heinrich in the cell, who joined the party.' }), 'befriend');
  assert.equal(classifyDeed({ text: 'Conquered The Beginner\'s Cave for the first time.' }), 'complete');
  assert.equal(classifyDeed({ text: 'Carried home plunder worth 80 gold.' }), 'other');
});

test('an unknown adventurer has tier 0 and no world effects', () => {
  const rep = computeReputation({ deeds: deed('spare', 1) }); // renown 3 < 10
  assert.equal(rep.tier, 0);
  assert.equal(rep.leaning, 'unknown');
  assert.equal(rep.epithet, null);
  assert.equal(encounterBonus(rep), 0);
  assert.equal(firstSightRegard(rep), 0);
  assert.deepEqual(yieldMods(rep), { regardEase: 0, hpEase: 0 });
  assert.equal(escortMultiplier(rep), 1);
});

test('a merciful record earns the Kind then the Merciful, and warms the world', () => {
  const t1 = computeReputation({ deeds: [...deed('spare', 3), ...deed('rescue', 1)] }); // 9+3=12
  assert.equal(t1.tier, 1);
  assert.equal(t1.leaning, 'merciful');
  assert.equal(t1.epithet, 'the Kind');
  assert.equal(encounterBonus(t1), 7);
  assert.equal(firstSightRegard(t1), 4);
  assert.deepEqual(yieldMods(t1), { regardEase: 0, hpEase: 0 }); // mercy doesn't scare anyone
  assert.equal(escortMultiplier(t1), 1.25);

  const t2 = computeReputation({ deeds: [...deed('spare', 8), ...deed('rescue', 2)] }); // 30
  assert.equal(t2.tier, 2);
  assert.equal(t2.epithet, 'the Merciful');
  assert.equal(encounterBonus(t2), 14);
  assert.equal(escortMultiplier(t2), 1.5);
});

test('a dreaded record earns the Ruthless then the Butcher — feared, not befriended', () => {
  const t1 = computeReputation({ deeds: [...deed('truce_broken', 2), ...deed('slay', 3)] }); // 13
  assert.equal(t1.tier, 1);
  assert.equal(t1.leaning, 'dreaded');
  assert.equal(t1.epithet, 'the Ruthless');
  assert.equal(encounterBonus(t1), -7); // nobody volunteers to walk with you
  assert.equal(firstSightRegard(t1), -4);
  assert.deepEqual(yieldMods(t1), { regardEase: 5, hpEase: 1 }); // enemies break sooner

  const t2 = computeReputation({ deeds: [...deed('truce_broken', 4), ...deed('slay', 12)] }); // 32
  assert.equal(t2.epithet, 'the Butcher');
  assert.deepEqual(yieldMods(t2), { regardEase: 10, hpEase: 2 });
  assert.equal(escortMultiplier(t2), 1);
});

test('leanings have inertia: mixed records read balanced until a 1.5x margin', () => {
  const mixed = computeReputation({ deeds: [...deed('spare', 4), ...deed('slay', 10)] }); // mercy 12, dread 10
  assert.equal(mixed.leaning, 'balanced');
  assert.equal(mixed.epithet, 'the Bold');
  // Redemption is climbable: enough mercy flips it
  const redeemed = computeReputation({ deeds: [...deed('spare', 5), ...deed('slay', 10)] }); // 15 vs 10
  assert.equal(redeemed.leaning, 'merciful');
});

test('completions spread renown without tilting the leaning', () => {
  const rep = computeReputation({ deeds: [...deed('spare', 2), ...deed('complete', 2)] }); // 6 + 10 = 16
  assert.equal(rep.tier, 1);
  assert.equal(rep.leaning, 'merciful');
});

test('reads and prompt lines are legible and tier-gated', () => {
  assert.match(reputationRead(computeReputation({ deeds: [] }), 'Theron'), /not yet widely known/);
  const merciful = computeReputation({ deeds: [...deed('spare', 3), ...deed('rescue', 1)] });
  assert.match(reputationRead(merciful, 'Theron'), /Known for mercy.*Theron the Kind/s);
  assert.equal(reputationForPrompt(computeReputation({ deeds: [] }), 'Theron'), null);
  assert.match(reputationForPrompt(merciful, 'Theron'), /Theron the Kind.*sparing foes/s);
  const dreaded = computeReputation({ deeds: [...deed('truce_broken', 2), ...deed('slay', 3)] });
  assert.match(reputationForPrompt(dreaded, 'Theron'), /feared.*truces broken/s);
});

test('encounter bonus flows into the friend-or-foe odds', () => {
  assert.equal(friendlyChance(10, 50, 0), 50);
  assert.equal(friendlyChance(10, 50, 14), 64); // the Merciful attract company
  assert.equal(friendlyChance(10, 50, -14), 36); // nobody walks with the Butcher
  assert.equal(friendlyChance(21, 95, 14), 95); // still clamped
});
