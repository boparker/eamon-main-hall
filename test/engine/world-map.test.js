import test from 'node:test';
import assert from 'node:assert/strict';

import { computeLayout, mapRead, annotationsFor, hasQuill, QUILL } from '../../server/engine/worldMap.js';

const fixture = {
  adventure: { id: 'map-cave', name: 'The Map Cave', start_room: 1 },
  locations: [
    { id: 'r1', room_number: 1, name: 'Entrance', exits: { north: 'main-hall', south: 2, east: null, west: null, up: null, down: null } },
    { id: 'r2', room_number: 2, name: 'Passage', exits: { north: 1, south: null, east: 3, west: null, up: null, down: null } },
    { id: 'r3', room_number: 3, name: 'East Cell', exits: { north: 4, south: null, east: null, west: 2, up: null, down: null } },
    // Room 4's west exit walks back onto the entrance's cell — the classic
    // non-Euclidean Eamon loop. The layout must probe past the collision.
    { id: 'r4', room_number: 4, name: 'Loop Room', exits: { north: null, south: 3, east: null, west: 5, up: 6, down: null } },
    { id: 'r5', room_number: 5, name: 'Squeezed Room', exits: { north: null, south: null, east: 4, west: null, up: null, down: null } },
    { id: 'r6', room_number: 6, name: 'Upper Vault', exits: { north: null, south: null, east: null, west: null, up: null, down: 4 } },
  ],
};

test('COMPASS LAW: every directional exit draws in its direction', () => {
  const { positions } = computeLayout(fixture);
  const p = (n) => positions.get(n);
  // south draws downward, east rightward, north upward, west leftward, up a level.
  assert.ok(p(2).y > p(1).y, 'south = down');
  assert.ok(p(3).x > p(2).x, 'east = right');
  assert.ok(p(4).y < p(3).y, 'north = up');
  assert.ok(p(5).x < p(4).x, 'west = left');
  assert.ok(p(6).z > p(4).z, 'up = next level');
  // No two rooms share a cell.
  const cells = new Set([...positions.values()].map((q) => `${q.x},${q.y},${q.z}`));
  assert.equal(cells.size, positions.size);
});

test('cell collisions are spread order-safely and reported', () => {
  const { positions, conflicts } = computeLayout(fixture);
  // Rooms 1 and 5 both want the same solved cell; the spread keeps 5 west of 4.
  assert.ok(positions.get(5).x < positions.get(4).x);
  assert.ok(conflicts.length >= 1, 'the collision is reported for port review');
});

test('mapRead is fog-of-war: unvisited rooms never leave the server', () => {
  const run = { currentRoom: 2, visitedRooms: [1, 2] };
  const map = mapRead(fixture, run, { inventory: [] });
  assert.deepEqual(map.nodes.map((n) => n.room).sort(), [1, 2]);
  assert.equal(map.nodes.find((n) => n.room === 2).current, true);
  assert.deepEqual(map.edges, [{ from: 1, to: 2 }]);
  // Room 2's east exit is unexplored: a direction stub, no name, no destination.
  const stub = map.stubs.find((s) => s.room === 2);
  assert.deepEqual(stub, { room: 2, direction: 'east' });
  assert.equal(JSON.stringify(map).includes('East Cell'), false);
  // The way home is marked.
  assert.ok(map.stubs.some((s) => s.room === 1 && s.out === true));
});

test('quill annotations pin by room number and fall back to name matching', () => {
  const run = { currentRoom: 3, visitedRooms: [1, 2, 3] };
  const character = {
    inventory: [{ ...QUILL }],
    chronicle: {
      summary: '',
      deeds: [
        { text: 'Slew the Guard in the East Cell (The Map Cave).', kind: 'slay', room: 3 }, // pinned
        { text: 'Showed mercy to the Rat in the Passage (The Map Cave).', kind: 'spare' }, // legacy: name match
        { text: 'Slew something in the Upper Vault.', kind: 'slay' }, // unvisited room: hidden
        { text: 'Bought a pie.', kind: 'other' }, // no scribble for this kind
      ],
    },
  };
  assert.equal(hasQuill(character), true);
  const map = mapRead(fixture, run, character);
  assert.equal(map.quill, true);
  assert.deepEqual(map.nodes.find((n) => n.room === 3).notes, ['a killing here']);
  assert.deepEqual(map.nodes.find((n) => n.room === 2).notes, ['mercy shown']);
  assert.equal(map.nodes.find((n) => n.room === 1).notes, undefined);
});

test('without the quill the map carries no marginalia', () => {
  const run = { currentRoom: 1, visitedRooms: [1, 2] };
  const character = {
    inventory: [],
    chronicle: { summary: '', deeds: [{ text: 'Slew the Rat in the Passage.', kind: 'slay', room: 2 }] },
  };
  const map = mapRead(fixture, run, character);
  assert.equal(map.quill, false);
  assert.ok(map.nodes.every((n) => n.notes === undefined));
});

test('annotationsFor caps a room at three distinct scribbles', () => {
  const run = { currentRoom: 2, visitedRooms: [2] };
  const character = {
    chronicle: {
      summary: '',
      deeds: ['slay', 'slay', 'spare', 'befriend', 'persuade', 'death'].map((kind) => ({ text: 'x', kind, room: 2 })),
    },
  };
  const notes = annotationsFor(fixture, run, character);
  assert.equal(notes.get(2).length, 3);
  assert.deepEqual([...new Set(notes.get(2))].length, 3);
});
