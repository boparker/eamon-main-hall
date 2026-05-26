import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderCombatResult,
  renderDeath,
  renderInventory,
  renderMoveBlocked,
  renderReturnToHall,
  renderRoom,
} from '../../server/engine/renderer.js';

function assertPlainText(text) {
  assert.equal(typeof text, 'string');
  assert.doesNotMatch(text, /\[[A-Za-z_-]+(?::|\])/);
  assert.doesNotMatch(text, /<[^>]+>/);
  assert.doesNotMatch(text, /\{[^}]+\}/);
  assert.doesNotMatch(text, /\*\*|__|\[[^\]]+\]\([^)]+\)|https?:\/\/|\bwww\./);
  assert.doesNotMatch(text, /(^|\s)[*_][^*_\n]+[*_](?=\s|[.,;:!?]|$)/);
}

test('renderRoom lists room name, description, visible characters, visible items, and sorted exits', () => {
  const room = {
    name: 'Cave Entrance',
    description: 'A cool wind flows from the dark tunnel.',
    narration_text: 'Fallback narration should not be used when description exists.',
  };
  const entities = {
    characters: [
      { name: 'Rat' },
      { display_name: 'Cynthia the Guide' },
    ],
  };
  const items = {
    placements: [
      { item: { name: 'Gold Coins' } },
      { item_name: 'Ruby' },
    ],
  };
  const exits = { south: 2, north: 'main-hall', west: null, east: undefined };

  const text = renderRoom(room, entities, items, exits);

  assert.equal(text, [
    'Cave Entrance',
    'A cool wind flows from the dark tunnel.',
    'You see: Rat, Cynthia the Guide.',
    'Items here: Gold Coins, Ruby.',
    'Exits: north, south.',
  ].join('\n'));
  assertPlainText(text);
});

test('renderRoom supports adventure visible entity shape and robust empty inputs', () => {
  const text = renderRoom(
    { title: 'Empty Room', narration_text: 'There is very little here.' },
    { characters: [], placements: [{ item_slug: 'diamonds' }] },
  );

  assert.equal(text, [
    'Empty Room',
    'There is very little here.',
    'You see no one else here.',
    'Items here: diamonds.',
    'Exits: none.',
  ].join('\n'));
  assertPlainText(text);

  assert.doesNotThrow(() => renderRoom(null, null, null, null));
  assertPlainText(renderRoom(null, null, null, null));
});

test('renderRoom does not list the same visible item twice when given resolved items plus placements', () => {
  const text = renderRoom(
    { title: 'Small Room', narration_text: 'A hermit watches from the corner.' },
    { characters: [{ name: 'Hermit' }], placements: [{ item_slug: 'healing-potion' }] },
    [{ slug: 'healing-potion', name: 'Healing Potion' }],
    { west: 4 },
  );

  assert.equal(text, [
    'Small Room',
    'A hermit watches from the corner.',
    'You see: Hermit.',
    'Items here: Healing Potion.',
    'Exits: west.',
  ].join('\n'));
});

test('renderRoom strips lowercase tags, markdown, and tolerates malformed collections', () => {
  const text = renderRoom(
    { name: '**Bold** [hidden:foo] [Click](http://x.test)', narration_text: 'Go <b>north</b> {now} [VOICE: narrator]. _italic_ and *em* [tag-name:secret]' },
    { characters: { bad: true }, placements: { bad: true } },
    { items: { bad: true }, placements: { bad: true } },
    { north: 1 },
  );

  assert.doesNotThrow(() => renderRoom({}, {}, { items: { bad: true } }));
  assert.match(text, /Bold/);
  assert.match(text, /Click/);
  assert.match(text, /italic and em/);
  assert.doesNotMatch(text, /hidden|VOICE|tag-name|secret|http|<b>|\{|\}|\*\*|\*em\*|_italic_/);
  assertPlainText(text);
});

test('renderCombatResult describes hit, miss, enemy defeat, counterattack, and character defeat', () => {
  const victory = renderCombatResult({
    playerAttack: { hit: true, roll: 15, attackTotal: 18, targetNumber: 12, rawDamage: 7, damage: 5, defenderHp: 0 },
    enemyAttack: null,
    enemyDefeated: true,
    characterDefeated: false,
  });

  assert.equal(victory, [
    'You hit for 5 damage. Enemy HP is now 0.',
    'The enemy is defeated.',
  ].join('\n'));
  assertPlainText(victory);

  const exchange = renderCombatResult({
    playerAttack: { hit: false, roll: 2, attackTotal: 4, targetNumber: 15, rawDamage: 0, damage: 0, defenderHp: 8 },
    enemyAttack: { hit: true, roll: 19, attackTotal: 19, targetNumber: 10, rawDamage: 6, damage: 6, defenderHp: 0 },
    enemyDefeated: false,
    characterDefeated: true,
  });

  assert.equal(exchange, [
    'You miss. Enemy HP remains 8.',
    'The enemy hits you for 6 damage. Your HP is now 0.',
    'You have been defeated.',
  ].join('\n'));
  assertPlainText(exchange);
});

test('renderMoveBlocked returns deterministic blocked movement text', () => {
  const text = renderMoveBlocked('east');

  assert.equal(text, 'You cannot go east from here.');
  assertPlainText(text);
});

test('renderInventory handles empty and populated inventory', () => {
  const empty = renderInventory({ name: 'Elena', inventory: [] });
  assert.equal(empty, 'Elena is carrying nothing.');
  assertPlainText(empty);

  const populated = renderInventory({
    name: 'Elena',
    gold: 23,
    inventory: [
      { name: 'Torch' },
      { item_name: 'Iron Key' },
      'rope',
    ],
  });
  assert.equal(populated, 'Elena is carrying: Torch, Iron Key, rope. Gold: 23.');
  assertPlainText(populated);
});

test('renderDeath returns playable death text', () => {
  const text = renderDeath({ name: 'Elena' });

  assert.equal(text, 'Elena has died. The adventure is over.');
  assertPlainText(text);
});

test('renderReturnToHall summarizes treasure and completion plainly', () => {
  const text = renderReturnToHall({
    characterName: 'Elena',
    gold: 12,
    treasures: [
      { name: 'Ruby', value: 50 },
      'silver cup',
    ],
    completed: true,
  });

  assert.equal(text, [
    'Elena returns to the Main Hall.',
    'Adventure completed.',
    'Gold recovered: 12.',
    'Treasures recovered: Ruby (50 gold), silver cup.',
  ].join('\n'));
  assertPlainText(text);
});

test('renderReturnToHall supports economy conversion result shape and malformed treasures', () => {
  const economyText = renderReturnToHall({
    character: { name: 'Elena', gold: 185 },
    goldGained: 175,
    convertedItems: [
      { name: 'Ruby', value: 100 },
      { name: 'Diamonds', value: 75 },
    ],
  });

  assert.equal(economyText, [
    'Elena returns to the Main Hall.',
    'Adventure ended.',
    'Gold recovered: 175.',
    'Treasures recovered: Ruby (100 gold), Diamonds (75 gold).',
  ].join('\n'));
  assertPlainText(economyText);

  assert.doesNotThrow(() => renderReturnToHall({ treasures: { name: 'Ruby' } }));
  assertPlainText(renderReturnToHall({ treasures: { name: 'Ruby' } }));
});
