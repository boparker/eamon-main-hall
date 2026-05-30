import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHOP_CATALOG, findCatalogItem, buyFromShop, sellToShop, generateMagicWeapons,
  SPELLS, learnSpell, spellAbility,
  attributePrice, raiseAttribute,
  bankDeposit, bankWithdraw,
} from '../../server/engine/vendors.js';

const baseCharacter = () => ({
  name: 'Mara', gold: 1000, bankGold: 0, hardiness: 15, agility: 12, charisma: 9,
  hd: 15, maxHd: 15, inventory: [], equipment: {}, spells: {},
});

// ── Marcos: one combined shop, buy at value, sell at half ──
test('catalog has weapons and armor in one combined shop', () => {
  assert.ok(SHOP_CATALOG.some((i) => i.category === 'weapon'));
  assert.ok(SHOP_CATALOG.some((i) => i.category === 'armor'));
  assert.equal(findCatalogItem('buy short sword').slug, 'short-sword');
  assert.equal(findCatalogItem('Plate Armor').slug, 'plate-armor');
});

test('buyFromShop deducts gold, adds to inventory, and equips', () => {
  const item = findCatalogItem('sword');
  const result = buyFromShop(baseCharacter(), item);
  assert.equal(result.ok, true);
  assert.equal(result.character.gold, 1000 - 75);
  assert.equal(result.character.inventory.length, 1);
  assert.equal(result.character.equipment.weapon.slug, 'sword');
});

test('buyFromShop rejects when gold is insufficient and does not mutate input', () => {
  const character = { ...baseCharacter(), gold: 10 };
  const result = buyFromShop(character, findCatalogItem('sword'));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insufficient-gold');
  assert.equal(character.gold, 10);
  assert.equal(character.inventory.length, 0);
});

test('sellToShop pays half value, removes from inventory, and unequips', () => {
  const bought = buyFromShop(baseCharacter(), findCatalogItem('sword')).character;
  const result = sellToShop(bought, 'sword');
  assert.equal(result.ok, true);
  assert.equal(result.goldGained, Math.floor(75 / 2)); // 37
  assert.equal(result.character.gold, 1000 - 75 + 37);
  assert.equal(result.character.inventory.length, 0);
  assert.equal(result.character.equipment.weapon, undefined);
});

test('generateMagicWeapons produces named magic weapons with to-hit and damage', () => {
  const weapons = generateMagicWeapons(3, () => 0); // deterministic
  assert.equal(weapons.length, 3);
  for (const w of weapons) {
    assert.equal(w.magic, true);
    assert.equal(w.category, 'weapon');
    assert.equal(w.equipmentSlot, 'weapon');
    assert.match(w.stats.damage, /^\dd\d+$/);
    assert.equal(typeof w.stats.weaponOdds, 'number');
    assert.ok(w.price > 0);
    assert.ok(String(w.name).length > 0 && w.slug.length > 0);
  }
  // sorted cheapest-first
  assert.ok(weapons[0].price <= weapons[2].price);
});

test('the live catalog includes generated magic weapons', () => {
  assert.ok(SHOP_CATALOG.some((item) => item.magic === true));
});

// ── Hokas Tokas: percentage buy-up with diminishing returns, capped >90 ──
test('learnSpell raises ability by the reference formula and deducts the flat price', () => {
  const result = learnSpell(baseCharacter(), 'blast', () => 0); // rollDie => 1
  assert.equal(result.ok, true);
  assert.equal(result.learned, true);
  // gap=100 → floor(100/4 + 1) = 26
  assert.equal(result.ability, 26);
  assert.equal(result.character.gold, 1000 - 1000);
  assert.equal(spellAbility(result.character, 'blast'), 26);
});

test('learnSpell is an upgrade (not "learned") when already known', () => {
  const character = { ...baseCharacter(), spells: { blast: 40 } };
  const result = learnSpell(character, 'blast', () => 0); // gap=60 → floor(15+1)=16
  assert.equal(result.learned, false);
  assert.equal(result.ability, 56);
});

test('learnSpell refuses when ability is maxed out (>90)', () => {
  const character = { ...baseCharacter(), spells: { speed: 95 } };
  const result = learnSpell(character, 'speed', () => 0);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'maxed-out');
});

test('learnSpell refuses when gold is insufficient', () => {
  const character = { ...baseCharacter(), gold: 50 };
  const result = learnSpell(character, 'speed', () => 0); // speed costs 4000
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insufficient-gold');
});

test('spell prices match the reference', () => {
  assert.deepEqual(
    Object.fromEntries(SPELLS.map((s) => [s.name, s.price])),
    { power: 100, heal: 500, blast: 1000, speed: 4000 },
  );
});

// ── Witch: +1 attribute, cubic price ──
test('attributePrice follows round(cur^3 / 100) * 100', () => {
  assert.equal(attributePrice(12), 1700); // 1728/100=17.28 -> 17 -> 1700
  assert.equal(attributePrice(15), 3400); // 3375/100=33.75 -> 34 -> 3400
  assert.equal(attributePrice(18), 5800); // 5832/100=58.32 -> 58 -> 5800
});

test('raiseAttribute bumps the stat and, for hardiness, max/current HD', () => {
  const character = { ...baseCharacter(), gold: 5000 };
  const hp = raiseAttribute(character, 'hardiness');
  assert.equal(hp.ok, true);
  assert.equal(hp.price, 3400);
  assert.equal(hp.character.hardiness, 16);
  assert.equal(hp.character.maxHd, 16);
  assert.equal(hp.character.hd, 16);

  const ag = raiseAttribute({ ...baseCharacter(), gold: 5000 }, 'agility');
  assert.equal(ag.character.agility, 13);
  assert.equal(ag.character.maxHd, 15); // unchanged for non-hardiness
});

test('raiseAttribute refuses when gold is insufficient', () => {
  const result = raiseAttribute({ ...baseCharacter(), gold: 100 }, 'hardiness');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insufficient-gold');
});

// ── Bank ──
test('bankDeposit moves gold into the bank', () => {
  const result = bankDeposit(baseCharacter(), 300);
  assert.equal(result.ok, true);
  assert.equal(result.character.gold, 700);
  assert.equal(result.character.bankGold, 300);
});

test('bankDeposit rejects amounts over gold on hand or non-positive', () => {
  assert.equal(bankDeposit(baseCharacter(), 5000).reason, 'insufficient-gold');
  assert.equal(bankDeposit(baseCharacter(), 0).reason, 'invalid-amount');
  assert.equal(bankDeposit(baseCharacter(), 'abc').reason, 'invalid-amount');
});

test('bankWithdraw moves gold out of the bank but not more than is banked', () => {
  const character = { ...baseCharacter(), gold: 100, bankGold: 500 };
  const ok = bankWithdraw(character, 200);
  assert.equal(ok.character.gold, 300);
  assert.equal(ok.character.bankGold, 300);
  assert.equal(bankWithdraw(character, 999).reason, 'insufficient-funds');
});
