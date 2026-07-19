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

test('conflicting east+west to the same room is always a warp', () => {
  const weird = {
    adventure: { id: 'warp-camp', name: 'Warp Camp', start_room: 1 },
    locations: [
      { room_number: 1, name: 'Camp', exits: { north: null, south: null, east: 2, west: 2, up: null, down: null } },
      { room_number: 2, name: 'Forest', exits: { north: 2, south: 2, east: 1, west: 1, up: null, down: null } },
    ],
  };
  const run = { currentRoom: 1, visitedRooms: [1, 2] };
  const map = mapRead(weird, run, { inventory: [] });
  assert.ok(map.edges.length >= 1);
  assert.ok(map.edges.every((e) => e.warp), 'Gypsy-style dual directions cannot be Euclidean');
});

test('Minotaur layout: compass law, one chart, no phantom ocean', async () => {
  const { readFileSync } = await import('node:fs');
  const adventure = JSON.parse(readFileSync(new URL('../../data/adventures/lair-of-the-minotaur.json', import.meta.url), 'utf8'));
  const layout = computeLayout(adventure);
  const { positions } = layout;
  const rooms = new Map(adventure.locations.map((l) => [l.room_number, l]));

  // Every finite cardinal exit either obeys the compass or is a true cycle/self-loop warp.
  let mapped = 0;
  let obeyed = 0;
  for (const [num, loc] of rooms) {
    const a = positions.get(num);
    for (const [dir, dest] of Object.entries(loc.exits ?? {})) {
      if (!Number.isFinite(dest) || dir === 'up' || dir === 'down') continue;
      if (dest === num) continue; // self-loop
      mapped++;
      const b = positions.get(dest);
      let ok = true;
      if (dir === 'north' && !(b.y < a.y)) ok = false;
      if (dir === 'south' && !(b.y > a.y)) ok = false;
      if (dir === 'east' && !(b.x > a.x)) ok = false;
      if (dir === 'west' && !(b.x < a.x)) ok = false;
      if (ok) obeyed++;
    }
  }
  // Most exits map cleanly; the remainder are directional cycles (Insanity, maze loops).
  assert.ok(obeyed / mapped >= 0.85, `compass obedience ${obeyed}/${mapped}`);

  const all = [...positions.values()];
  const w = Math.max(...all.map((p) => p.x)) + 1;
  const h = Math.max(...all.map((p) => p.y)) + 1;
  const occupancy = positions.size / (w * h);
  assert.ok(w <= 20 && h <= 20, `extent ${w}x${h} should not sprawl into a 28-wide phantom corridor`);
  assert.ok(occupancy >= 0.34, `occupancy ${(occupancy * 100).toFixed(1)}% — chart should be one compact parchment`);

  // One 8-connected spatial cluster: no two continents with an empty ocean.
  const byCell = new Map([...positions.entries()].map(([n, p]) => [`${p.x},${p.y},${p.z}`, { n, ...p }]));
  const seen = new Set();
  let clusters = 0;
  for (const [k, start] of byCell) {
    if (seen.has(k)) continue;
    clusters++;
    const q = [start];
    seen.add(k);
    while (q.length) {
      const cur = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nk = `${cur.x + dx},${cur.y + dy},${cur.z}`;
        if (byCell.has(nk) && !seen.has(nk)) { seen.add(nk); q.push(byCell.get(nk)); }
      }
    }
  }
  assert.equal(clusters, 1, 'all rooms form one contiguous chart');

  const run = { currentRoom: 1, visitedRooms: adventure.locations.map((l) => l.room_number) };
  const map = mapRead(adventure, run, { inventory: [] }, layout);
  const normal = map.edges.filter((e) => !e.warp);
  const lengths = normal.map((e) => {
    const a = positions.get(e.from); const b = positions.get(e.to);
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }).sort((a, b) => a - b);
  const short = lengths.filter((md) => md <= 2).length;
  assert.ok(short / lengths.length >= 0.8, `short corridors ${short}/${lengths.length}`);
  // Gypsy Camp sits next to the Forest warp, not twenty cells across the parchment.
  const gypsy = positions.get(90); const forest = positions.get(92);
  assert.ok(Math.abs(gypsy.x - forest.x) + Math.abs(gypsy.y - forest.y) <= 2, 'Forest packs beside Gypsy Camp');
});

test('chooseCorridorPath bows around rooms and long spans', async () => {
  const { chooseCorridorPath } = await import('../../public/js/journal-map.js');
  const a = { room: 1, x: 0, y: 0, z: 0 };
  const b = { room: 2, x: 2, y: 0, z: 0 };
  assert.deepEqual(chooseCorridorPath(a, b, []), { kind: 'line' });

  const c = { room: 3, x: 1, y: 1, z: 0 };
  // Clear short diagonal → elbow.
  assert.equal(chooseCorridorPath(a, c, []).kind, 'elbow');

  // Both elbow orientations blocked → bow.
  const blockers = [
    { room: 9, x: 0, y: 1, z: 0 },
    { room: 8, x: 1, y: 0, z: 0 },
  ];
  assert.deepEqual(chooseCorridorPath(a, c, blockers), { kind: 'bow' });

  // Long non-aligned span → bow even with a clear elbow.
  const far = { room: 4, x: 3, y: 1, z: 0 };
  assert.deepEqual(chooseCorridorPath(a, far, []), { kind: 'bow' });
});
