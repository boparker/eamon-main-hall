import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canAfford,
  buyItem,
  sellItem,
  takeTreasure,
  convertTreasuresOnReturn,
  drinkPotion,
} from '../../server/engine/economy.js';

test('drinkPotion heals by the potion amount, caps at max, and consumes it', () => {
  const character = { hd: 5, maxHd: 15, inventory: [{ slug: 'hp', name: 'healing potion', type: 'potion', heal_amount: 6 }] };
  const r = drinkPotion(character, 'hp');
  assert.equal(r.ok, true);
  assert.equal(r.restored, 6);
  assert.equal(r.character.hd, 11);
  assert.equal(r.character.inventory.length, 0);

  const nearFull = { hd: 13, maxHd: 15, inventory: [{ slug: 'hp', type: 'potion', heal_amount: 6 }] };
  assert.equal(drinkPotion(nearFull, 'hp').restored, 2); // capped at max
});

test('drinkPotion refuses when already full or carrying no such potion', () => {
  assert.equal(drinkPotion({ hd: 15, maxHd: 15, inventory: [{ slug: 'hp', type: 'potion' }] }, 'hp').reason, 'already-full');
  assert.equal(drinkPotion({ hd: 5, maxHd: 15, inventory: [] }, 'hp').reason, 'no-potion');
});

test('canAfford handles true/false boundaries including exact gold', () => {
  assert.equal(canAfford({ gold: 10, inventory: [] }, 0), true);
  assert.equal(canAfford({ gold: 10, inventory: [] }, 10), true);
  assert.equal(canAfford({ gold: 10, inventory: [] }, 11), false);
  assert.equal(canAfford({ gold: 0, inventory: [] }, 1), false);
  assert.equal(canAfford(null, 0), false);
  assert.equal(canAfford({ gold: 10, inventory: [] }, -1), false);
  assert.equal(canAfford({ gold: 10, inventory: [] }, '5'), false);
});

test('buyItem subtracts gold and adds item without mutating original', () => {
  const character = { gold: 25, inventory: [] };
  const item = { slug: 'sword', name: 'Sword', type: 'weapon', value: 15 };

  const result = buyItem(character, item);

  assert.equal(result.ok, true);
  assert.equal(result.item, item);
  assert.equal(result.character.gold, 10);
  assert.deepEqual(result.character.inventory, [item]);
  assert.deepEqual(character, { gold: 25, inventory: [] });
  assert.notEqual(result.character, character);
  assert.notEqual(result.character.inventory, character.inventory);
});

test('buyItem uses item.price when present', () => {
  const character = { gold: 25, inventory: [] };
  const item = { slug: 'shield', name: 'Shield', type: 'armor', value: 100, price: 12 };

  const result = buyItem(character, item);

  assert.equal(result.ok, true);
  assert.equal(result.character.gold, 13);
  assert.deepEqual(result.character.inventory, [item]);
});

test('buyItem blocks insufficient funds and leaves gold unchanged', () => {
  const character = { gold: 5, inventory: [] };
  const item = { slug: 'armor', name: 'Armor', type: 'armor', value: 20 };

  const result = buyItem(character, item);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insufficient-gold');
  assert.equal(result.character, character);
  assert.equal(result.character.gold, 5);
  assert.deepEqual(result.character.inventory, []);
});

test('buyItem blocks missing item', () => {
  const character = { gold: 25, inventory: [] };

  const result = buyItem(character, null);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-item');
  assert.equal(result.character, character);
});

test('buyItem blocks duplicate inventory item', () => {
  const item = { slug: 'sword', name: 'Sword', type: 'weapon', value: 15 };
  const character = { gold: 25, inventory: [item] };

  const result = buyItem(character, item);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'already-owned');
  assert.equal(result.character, character);
  assert.equal(result.character.gold, 25);
  assert.deepEqual(result.character.inventory, [item]);
});

test('buyItem blocks invalid prices and malformed gold without mutating', () => {
  const character = { gold: Number.NaN, inventory: [] };
  const item = { slug: 'sword', name: 'Sword', type: 'weapon', value: 15 };

  const invalidGold = buyItem(character, item);
  assert.equal(invalidGold.ok, false);
  assert.equal(invalidGold.reason, 'invalid-gold');
  assert.equal(invalidGold.character, character);

  const invalidPrice = buyItem({ gold: 25, inventory: [] }, { ...item, price: -1 });
  assert.equal(invalidPrice.ok, false);
  assert.equal(invalidPrice.reason, 'invalid-price');
});

test('sellItem removes non-treasure item and adds floor(value * 0.25) without mutating original', () => {
  const sword = { slug: 'sword', name: 'Sword', type: 'weapon', value: 15 };
  const shield = { slug: 'shield', name: 'Shield', type: 'armor', value: 40 };
  const character = { gold: 10, inventory: [sword, shield] };

  const result = sellItem(character, 'shield');

  assert.equal(result.ok, true);
  assert.equal(result.item, shield);
  assert.equal(result.goldGained, 10);
  assert.equal(result.character.gold, 20);
  assert.deepEqual(result.character.inventory, [sword]);
  assert.deepEqual(character, { gold: 10, inventory: [sword, shield] });
  assert.notEqual(result.character, character);
  assert.notEqual(result.character.inventory, character.inventory);
});

test('sellItem blocks missing item', () => {
  const character = { gold: 10, inventory: [] };

  const result = sellItem(character, 'missing');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-item');
  assert.equal(result.character, character);
});

test('sellItem blocks invalid item slug without matching malformed inventory entries', () => {
  const character = { gold: 10, inventory: [null] };

  const result = sellItem(character, undefined);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-item-slug');
  assert.equal(result.character, character);
  assert.deepEqual(result.character.inventory, [null]);
});

test('takeTreasure adds treasure to inventory but does not change gold', () => {
  const character = { gold: 10, inventory: [] };
  const treasure = { slug: 'ruby', name: 'Ruby', type: 'treasure', value: 100 };

  const result = takeTreasure(character, treasure);

  assert.equal(result.ok, true);
  assert.equal(result.item, treasure);
  assert.equal(result.character.gold, 10);
  assert.deepEqual(result.character.inventory, [treasure]);
  assert.deepEqual(character, { gold: 10, inventory: [] });
});

test('takeTreasure blocks duplicate item', () => {
  const treasure = { slug: 'ruby', name: 'Ruby', type: 'treasure', value: 100 };
  const character = { gold: 10, inventory: [treasure] };

  const result = takeTreasure(character, treasure);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'already-owned');
  assert.equal(result.character, character);
});

test('takeTreasure allows a duplicate when allowDuplicate is set', () => {
  const potion = { slug: 'healing-potion', name: 'healing potion', type: 'potion', value: 50, weight: 2 };
  const character = { gold: 10, inventory: [potion] };

  const result = takeTreasure(character, potion, { allowDuplicate: true });

  assert.equal(result.ok, true);
  assert.equal(result.character.inventory.length, 2);
  assert.deepEqual(result.character.inventory.map((i) => i.slug), ['healing-potion', 'healing-potion']);
});

test('takeTreasure blocks missing item', () => {
  const character = { gold: 10, inventory: [] };

  const result = takeTreasure(character, null);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-item');
  assert.equal(result.character, character);
});

test('takeTreasure blocks missing character instead of throwing', () => {
  const treasure = { slug: 'ruby', name: 'Ruby', type: 'treasure', value: 100 };

  const result = takeTreasure(null, treasure);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-character');
  assert.equal(result.character, null);
});

test('sellItem blocks treasure so adventure treasure only converts on return', () => {
  const ruby = { slug: 'ruby', name: 'Ruby', type: 'treasure', value: 100 };
  const character = { gold: 10, inventory: [ruby] };

  const result = sellItem(character, 'ruby');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'treasure-converts-on-return');
  assert.equal(result.character, character);
  assert.equal(result.character.gold, 10);
  assert.deepEqual(result.character.inventory, [ruby]);
});

test('sellItem blocks malformed character gold instead of producing NaN', () => {
  const sword = { slug: 'sword', name: 'Sword', type: 'weapon', value: 20 };
  const character = { gold: '10', inventory: [sword] };

  const result = sellItem(character, 'sword');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-gold');
  assert.equal(result.character, character);
  assert.equal(result.character.gold, '10');
  assert.deepEqual(result.character.inventory, [sword]);
});

test('convertTreasuresOnReturn converts treasure value to gold and removes treasure only', () => {
  const ruby = { slug: 'ruby', name: 'Ruby', type: 'treasure', value: 100 };
  const diamonds = { slug: 'diamonds', name: 'Diamonds', type: 'treasure', value: 75 };
  const sword = { slug: 'sword', name: 'Sword', type: 'weapon', value: 20 };
  const character = { gold: 10, inventory: [ruby, sword, diamonds] };

  const result = convertTreasuresOnReturn(character);

  assert.equal(result.ok, true);
  assert.equal(result.goldGained, 175);
  assert.deepEqual(result.convertedItems, [ruby, diamonds]);
  assert.equal(result.character.gold, 185);
  assert.deepEqual(result.character.inventory, [sword]);
  assert.deepEqual(character, { gold: 10, inventory: [ruby, sword, diamonds] });
});

test('convertTreasuresOnReturn blocks malformed character gold', () => {
  const ruby = { slug: 'ruby', name: 'Ruby', type: 'treasure', value: 100 };
  const character = { gold: Number.NaN, inventory: [ruby] };

  const result = convertTreasuresOnReturn(character);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-gold');
  assert.equal(result.character, character);
  assert.deepEqual(result.character.inventory, [ruby]);
});
