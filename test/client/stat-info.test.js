import test from 'node:test';
import assert from 'node:assert/strict';

import {
  statBand, describeStat, rollRead, avgDamage, compareGear, STAT_META,
} from '../../public/js/stat-info.js';

test('statBand maps 3d7 numbers to the right qualitative label', () => {
  assert.equal(statBand(3).label, 'Poor');
  assert.equal(statBand(8).label, 'Poor');
  assert.equal(statBand(10).label, 'Below Average');
  assert.equal(statBand(13).label, 'Average');
  assert.equal(statBand(16).label, 'Good');
  assert.equal(statBand(18).label, 'Excellent');
  assert.equal(statBand(21).label, 'Exceptional');
});

test('describeStat returns the band + the real effect blurb', () => {
  const d = describeStat('agility', 16);
  assert.equal(d.label, 'Agility');
  assert.equal(d.band, 'Good');
  assert.equal(d.value, 16);
  assert.match(d.effect, /hit AND how often enemies miss/i);
  assert.equal(describeStat('nope', 5), null);
});

test('rollRead turns a roll into a character identity, naming strengths and weaknesses', () => {
  // Tough + charming, low agility.
  const read = rollRead({ hardiness: 20, agility: 8, charisma: 19 });
  assert.match(read, /tough/);
  assert.match(read, /charming/);
  assert.match(read, /not especially quick/); // the low agility caveat
});

test('rollRead always names at least one strength even with a flat roll', () => {
  const read = rollRead({ hardiness: 12, agility: 12, charisma: 12 });
  assert.ok(read.length > 0);
  assert.match(read, /This adventurer is/);
});

test('avgDamage parses dice notation including modifiers', () => {
  assert.equal(avgDamage('1d8'), 4.5);
  assert.equal(avgDamage('2d6'), 7);
  assert.equal(avgDamage('2d6+1'), 8);
  assert.equal(avgDamage('nonsense'), 0);
});

test('compareGear flags weapon upgrades/downgrades vs the equipped weapon', () => {
  const sword = { equipmentSlot: 'weapon', stats: { damage: '1d8' } };
  const dagger = { weapon: { name: 'Dagger', stats: { damage: '1d4' } } };
  const up = compareGear(sword, dagger);
  assert.equal(up.verdict.key, 'upgrade');
  assert.match(up.detail, /1d8 vs 1d4/);

  const down = compareGear({ equipmentSlot: 'weapon', stats: { damage: '1d4' } }, { weapon: { name: 'Sword', stats: { damage: '1d8' } } });
  assert.equal(down.verdict.key, 'downgrade');
});

test('compareGear treats an empty slot as new gear', () => {
  const res = compareGear({ equipmentSlot: 'armor', stats: { armorClass: 3 } }, {});
  assert.equal(res.verdict.key, 'new');
  assert.match(res.detail, /Reduces every hit by 3/);
});

test('compareGear compares armor by armor class', () => {
  const res = compareGear(
    { equipmentSlot: 'armor', stats: { armorClass: 3 } },
    { armor: { name: 'Leather Armor', stats: { armorClass: 1 } } },
  );
  assert.equal(res.verdict.key, 'upgrade');
  assert.match(res.detail, /AC 3 vs 1/);
});

test('compareGear returns null for non-gear items', () => {
  assert.equal(compareGear({ type: 'potion', stats: {} }), null);
});

test('STAT_META charisma copy makes clear it is social-only (no combat/prices)', () => {
  assert.match(STAT_META.charisma.effect, /no effect on combat or prices/i);
});
