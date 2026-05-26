import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCommand } from '../../server/engine/commands.js';

test('parseCommand parses required movement examples', () => {
  assert.deepEqual(parseCommand('north'), { type: 'move', direction: 'north', source: 'rules' });
  assert.deepEqual(parseCommand('go north'), { type: 'move', direction: 'north', source: 'rules' });
});

test('parseCommand parses direction abbreviations', () => {
  assert.deepEqual(parseCommand('n'), { type: 'move', direction: 'north', source: 'rules' });
  assert.deepEqual(parseCommand('s'), { type: 'move', direction: 'south', source: 'rules' });
  assert.deepEqual(parseCommand('e'), { type: 'move', direction: 'east', source: 'rules' });
  assert.deepEqual(parseCommand('w'), { type: 'move', direction: 'west', source: 'rules' });
  assert.deepEqual(parseCommand('u'), { type: 'move', direction: 'up', source: 'rules' });
  assert.deepEqual(parseCommand('d'), { type: 'move', direction: 'down', source: 'rules' });
});

test('parseCommand parses movement verb variants', () => {
  assert.deepEqual(parseCommand('move south'), { type: 'move', direction: 'south', source: 'rules' });
  assert.deepEqual(parseCommand('walk east'), { type: 'move', direction: 'east', source: 'rules' });
  assert.deepEqual(parseCommand('head west'), { type: 'move', direction: 'west', source: 'rules' });
});

test('parseCommand parses exact informational commands', () => {
  assert.deepEqual(parseCommand('look'), { type: 'look', source: 'rules' });
  assert.deepEqual(parseCommand('search'), { type: 'search', source: 'rules' });
  assert.deepEqual(parseCommand('inventory'), { type: 'inventory', source: 'rules' });
  assert.deepEqual(parseCommand('i'), { type: 'inventory', source: 'rules' });
  assert.deepEqual(parseCommand('inv'), { type: 'inventory', source: 'rules' });
  assert.deepEqual(parseCommand('stats'), { type: 'stats', source: 'rules' });
  assert.deepEqual(parseCommand('status'), { type: 'stats', source: 'rules' });
  assert.deepEqual(parseCommand('help'), { type: 'help', source: 'rules' });
});

test('parseCommand parses read and look-at targets for readable artifacts', () => {
  assert.deepEqual(parseCommand('read inscription'), { type: 'read_item', target: 'inscription', source: 'rules' });
  assert.deepEqual(parseCommand('look at writing'), { type: 'read_item', target: 'writing', source: 'rules' });
  assert.deepEqual(parseCommand('examine glowing book'), { type: 'read_item', target: 'glowing book', source: 'rules' });
});

test('parseCommand parses required attack examples and variants', () => {
  assert.deepEqual(parseCommand('attack goblin'), { type: 'attack', target: 'goblin', source: 'rules' });
  assert.deepEqual(parseCommand('hit goblin with sword'), { type: 'attack', target: 'goblin', weapon: 'sword', source: 'rules' });
  assert.deepEqual(parseCommand('fight cave troll'), { type: 'attack', target: 'cave troll', source: 'rules' });
  assert.deepEqual(parseCommand('kill rat with rusty dagger'), { type: 'attack', target: 'rat', weapon: 'rusty dagger', source: 'rules' });
  assert.deepEqual(parseCommand('smack spider'), { type: 'attack', target: 'spider', source: 'rules' });
});

test('parseCommand parses required take example and variants', () => {
  assert.deepEqual(parseCommand('take rusty dagger'), { type: 'take', target: 'rusty dagger', source: 'rules' });
  assert.deepEqual(parseCommand('get coins'), { type: 'take', target: 'coins', source: 'rules' });
  assert.deepEqual(parseCommand('grab brass key'), { type: 'take', target: 'brass key', source: 'rules' });
  assert.deepEqual(parseCommand('pick up healing potion'), { type: 'take', target: 'healing potion', source: 'rules' });
});

test('parseCommand parses use, cast, and open deterministically as use_item', () => {
  assert.deepEqual(parseCommand('use potion'), { type: 'use_item', target: 'potion', source: 'rules' });
  assert.deepEqual(parseCommand('cast heal'), { type: 'use_item', target: 'heal', source: 'rules' });
  assert.deepEqual(parseCommand('open door'), { type: 'use_item', target: 'door', source: 'rules' });
});

test('parseCommand parses talk required example and variants', () => {
  assert.deepEqual(parseCommand('talk to cynthia'), { type: 'talk', target: 'cynthia', source: 'rules' });
  assert.deepEqual(parseCommand('talk cynthia'), { type: 'talk', target: 'cynthia', source: 'rules' });
});

test('parseCommand parses shop, buy, and leave commands', () => {
  assert.deepEqual(parseCommand('shop'), { type: 'shop', source: 'rules' });
  assert.deepEqual(parseCommand('buy sword'), { type: 'buy', target: 'sword', source: 'rules' });
  assert.deepEqual(parseCommand('leave'), { type: 'leave', source: 'rules' });
  assert.deepEqual(parseCommand('quit'), { type: 'leave', source: 'rules' });
  assert.deepEqual(parseCommand('exit'), { type: 'leave', source: 'rules' });
  assert.deepEqual(parseCommand('back'), { type: 'leave', source: 'rules' });
  assert.deepEqual(parseCommand('return'), { type: 'leave', source: 'rules' });
});

test('parseCommand normalizes capitalization and extra spaces', () => {
  assert.deepEqual(parseCommand('  HIT   Goblin   WITH   Sword  '), {
    type: 'attack',
    target: 'goblin',
    weapon: 'sword',
    source: 'rules',
  });
});

test('parseCommand returns unknown for unsupported or empty input', () => {
  assert.deepEqual(parseCommand('dance wildly'), { type: 'unknown', raw: 'dance wildly', source: 'rules' });
  assert.deepEqual(parseCommand(''), { type: 'unknown', raw: '', source: 'rules' });
  assert.deepEqual(parseCommand(null), { type: 'unknown', raw: '', source: 'rules' });
});
