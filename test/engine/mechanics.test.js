import test from 'node:test';
import assert from 'node:assert/strict';

import {
  gateMove, afterMove, sayTrigger, digResult, cursedItem, guardedBy,
  revealItem, markTriggerFired, applyFlagPatch, vehicleRoom,
} from '../../server/engine/mechanics.js';

const adventure = {
  mechanics: {
    water_rooms: [9, 10],
    shore_rooms: [6, 11],
    vehicle: { item: 'boat', board_text: 'You board.', leave_text: 'You disembark.', blocked_text: 'No boat, no river.' },
    death_rooms: { 10: 'The grate. The end.' },
    say_triggers: [{ word: 'magic', near_item: 'huge-stone', reveals: 'emerald', text: 'An emerald pops out.', once: true }],
    dig_sites: [{ tool: 'shovel', room_number: 6, reveals: 'gold-coins', found_text: 'Coins!', nothing_text: 'Nothing.' }],
    cursed_items: [{ slug: 'jewel', damage: '1d10', text: 'Zap.' }],
    guarded_items: [{ slug: 'books', guard: 'high-priest', text: 'Hands off my books!' }],
  },
  placements: [{ item_slug: 'boat', room_number: 6 }],
};

const room6 = { room_number: 6, exits: { north: 9 } };
const room9 = { room_number: 9, exits: { south: 6, north: 10 } };

test('water is impassable without the boat; with it you board and it follows', () => {
  const noBoat = gateMove({ adventure, run: { flags: {} }, character: { inventory: [] }, room: { room_number: 7, exits: { north: 9 } }, direction: 'north' });
  assert.equal(noBoat.ok, false);
  assert.match(noBoat.text, /No boat/);

  const board = gateMove({ adventure, run: { flags: {} }, character: { inventory: [] }, room: room6, direction: 'north' });
  assert.equal(board.ok, true);
  assert.deepEqual(board.notes, ['You board.']);
  assert.equal(board.flagPatch.inVehicle, true);
  assert.equal(board.flagPatch.vehicleRoom, 9);

  // Already afloat: no re-boarding note, boat keeps following.
  const paddle = gateMove({ adventure, run: { flags: { inVehicle: true, vehicleRoom: 9 } }, character: { inventory: [] }, room: room9, direction: 'north' });
  assert.equal(paddle.ok, true);
  assert.deepEqual(paddle.notes, []);
  assert.equal(paddle.flagPatch.vehicleRoom, 10);
});

test('reaching shore disembarks; the deadly room kills', () => {
  const shore = afterMove({ adventure, run: { flags: { inVehicle: true } }, destination: 11 });
  assert.deepEqual(shore.notes, ['You disembark.']);
  assert.equal(shore.flagPatch.inVehicle, false);
  assert.equal(shore.deathText, null);

  const grate = afterMove({ adventure, run: { flags: { inVehicle: true } }, destination: 10 });
  assert.equal(grate.deathText, 'The grate. The end.');
});

test('locked exits open with the right key, once, and block without it', () => {
  const room = { room_number: 54, exits: { west: 55 }, locked_exits: { west: { door: 'iron-grate', key: 'skeleton-key', text: 'Locked.' } } };
  const blocked = gateMove({ adventure, run: { flags: {} }, character: { inventory: [] }, room, direction: 'west' });
  assert.equal(blocked.ok, false);
  const keyed = gateMove({ adventure, run: { flags: {} }, character: { inventory: [{ slug: 'skeleton-key' }] }, room, direction: 'west' });
  assert.equal(keyed.ok, true);
  assert.match(keyed.notes[0], /unlock the iron grate/);
  const reopened = gateMove({ adventure, run: { flags: { unlockedDoors: ['iron-grate'] } }, character: { inventory: [] }, room, direction: 'west' });
  assert.equal(reopened.ok, true);
  assert.deepEqual(reopened.notes, []);
});

test('say trigger needs the word, the nearby item, and fires once', () => {
  const hit = sayTrigger({ adventure, run: { flags: {} }, words: 'I say MAGIC aloud', roomNumber: 5, visibleItemSlugs: ['huge-stone'] });
  assert.equal(hit.reveals, 'emerald');
  assert.equal(sayTrigger({ adventure, run: { flags: {} }, words: 'magic', roomNumber: 5, visibleItemSlugs: [] }), null);
  const fired = markTriggerFired({ flags: {} }, 'magic');
  assert.equal(sayTrigger({ adventure, run: fired, words: 'magic', roomNumber: 5, visibleItemSlugs: ['huge-stone'] }), null);
});

test('dig needs the shovel, the site, and only pays out once', () => {
  assert.match(digResult({ adventure, run: { flags: {} }, character: { inventory: [] }, roomNumber: 6 }).text, /nothing to dig with/);
  const found = digResult({ adventure, run: { flags: {} }, character: { inventory: [{ slug: 'shovel' }] }, roomNumber: 6 });
  assert.equal(found.site.reveals, 'gold-coins');
  const already = digResult({ adventure, run: revealItem({ flags: {} }, 'gold-coins'), character: { inventory: [{ slug: 'shovel' }] }, roomNumber: 6 });
  assert.equal(already.site, null);
  const wrongRoom = digResult({ adventure, run: { flags: {} }, character: { inventory: [{ slug: 'shovel' }] }, roomNumber: 7 });
  assert.equal(wrongRoom.site, null);
});

test('cursed and guarded items resolve from the manifest', () => {
  assert.equal(cursedItem(adventure, 'jewel').damage, '1d10');
  assert.equal(cursedItem(adventure, 'lantern'), null);
  const g = guardedBy({ adventure, run: { defeatedEnemies: [] }, slug: 'books', presentSlugs: ['high-priest'] });
  assert.match(g.text, /Hands off/);
  assert.equal(guardedBy({ adventure, run: { defeatedEnemies: ['high-priest'] }, slug: 'books', presentSlugs: [] }), null);
  assert.equal(guardedBy({ adventure, run: { defeatedEnemies: [] }, slug: 'books', presentSlugs: [] }), null, 'guard elsewhere = free to take');
});

test('vehicleRoom falls back to the manifest placement', () => {
  assert.equal(vehicleRoom(adventure, { flags: {} }), 6);
  assert.equal(vehicleRoom(adventure, { flags: { vehicleRoom: 12 } }), 12);
  assert.equal(applyFlagPatch({ flags: { a: 1 } }, { b: 2 }).flags.b, 2);
});
