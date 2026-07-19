// worldMap.js — the journal map. Pure functions over the adventure manifest,
// the run's visitedRooms, and the character's chronicle. Fog-of-war is
// enforced HERE: the client only ever receives rooms the player has stood in;
// unexplored exits are direction stubs with no name and no destination.

import { MAIN_HALL_SENTINEL } from './adventures.js';

const VECTORS = {
  north: [0, -1, 0],
  south: [0, 1, 0],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 0, 1],
  down: [0, 0, -1],
};

export const QUILL = { slug: 'chroniclers-quill', name: "Chronicler's Quill", price: 50, type: 'tool' };

export function hasQuill(character) {
  return (character?.inventory ?? []).some((item) => (item?.slug ?? item) === QUILL.slug);
}

function startRoomOf(adventure) {
  return adventure?.adventure?.start_room ?? adventure?.locations?.[0]?.room_number;
}

// Assign grid coordinates to every room by BFS from the entrance, walking
// compass exits. Classic Eamon graphs aren't always Euclidean (one-way doors,
// loops that don't close), so when a step lands on an occupied cell we probe
// further along the same direction until a free cell is found — the map stays
// readable and honest about topology, if not about scale. Layout is static
// per adventure; callers may cache.
export function computeLayout(adventure, onlyRooms = null) {
  const included = onlyRooms ? new Set(onlyRooms) : null;
  const rooms = new Map((adventure?.locations ?? [])
    .filter((loc) => !included || included.has(loc.room_number))
    .map((loc) => [loc.room_number, loc]));
  // Start from the adventure's entrance if visible, else any included room.
  const start = (!included || included.has(startRoomOf(adventure))) ? startRoomOf(adventure) : [...rooms.keys()][0];
  const positions = new Map();
  const occupied = new Map(); // "x,y,z" -> room_number
  const conflicts = [];
  if (!rooms.has(start)) return { positions, conflicts };

  const key = (x, y, z) => `${x},${y},${z}`;
  positions.set(start, { x: 0, y: 0, z: 0 });
  occupied.set(key(0, 0, 0), start);
  const queue = [start];

  while (queue.length) {
    const from = queue.shift();
    const at = positions.get(from);
    const exits = rooms.get(from)?.exits ?? {};
    for (const [direction, dest] of Object.entries(exits)) {
      if (!Number.isFinite(dest) || !rooms.has(dest) || positions.has(dest)) continue;
      const vec = VECTORS[direction];
      if (!vec) continue;
      let [x, y, z] = [at.x + vec[0], at.y + vec[1], at.z + vec[2]];
      // Linear probe past occupied cells (non-Euclidean loop landed here).
      let probed = false;
      while (occupied.has(key(x, y, z))) {
        probed = true;
        x += vec[0]; y += vec[1]; z += vec[2];
        if (vec[0] === 0 && vec[1] === 0 && vec[2] === 0) break;
      }
      if (probed) conflicts.push({ room: dest, direction, from });
      positions.set(dest, { x, y, z });
      occupied.set(key(x, y, z), dest);
      queue.push(dest);
    }
  }

  // Rooms unreachable by compass walk (secret teleports etc.) get parked on a
  // shelf below the mapped extent so they still render once visited.
  let shelfX = 0;
  const maxY = Math.max(0, ...[...positions.values()].map((p) => p.y));
  for (const number of rooms.keys()) {
    if (positions.has(number)) continue;
    positions.set(number, { x: shelfX, y: maxY + 2, z: 0 });
    conflicts.push({ room: number, direction: null, from: null });
    shelfX += 1;
  }
  return { positions, conflicts };
}

// kind -> the short marginalia phrase the quill inks next to a room.
const SCRIBBLES = {
  riddle: 'a riddle answered',
  secret: 'something buried, found',
  slay: 'a killing here',
  death: 'fell here once',
  spare: 'mercy shown',
  befriend: 'made a friend',
  persuade: 'words won the day',
  rescue: 'a rescue',
  truce_broken: 'an oath broken',
};

// The quill's retroactive magic: deeds recorded with a room number pin
// directly; older deeds fall back to matching the room's name inside the deed
// text ("...in the East Cell..."). Name collisions attach to the first
// visited room with that name — acceptable fuzz for legacy entries.
export function annotationsFor(adventure, run, character) {
  const deeds = character?.chronicle?.deeds ?? [];
  const visited = new Set(run?.visitedRooms ?? []);
  const byRoom = new Map();
  const nameIndex = new Map();
  for (const loc of adventure?.locations ?? []) {
    if (visited.has(loc.room_number) && !nameIndex.has(loc.name.toLowerCase())) {
      nameIndex.set(loc.name.toLowerCase(), loc.room_number);
    }
  }
  for (const deed of deeds) {
    const phrase = SCRIBBLES[deed.kind];
    if (!phrase) continue;
    let room = Number.isFinite(deed.room) && visited.has(deed.room) ? deed.room : null;
    if (room === null && typeof deed.text === 'string') {
      const lower = deed.text.toLowerCase();
      for (const [name, number] of nameIndex) {
        if (lower.includes(name)) { room = number; break; }
      }
    }
    if (room === null) continue;
    const list = byRoom.get(room) ?? [];
    if (!list.includes(phrase)) list.push(phrase);
    byRoom.set(room, list.slice(0, 3));
  }
  return byRoom;
}

// The client-facing read. Visited rooms only; unexplored exits become
// nameless direction stubs; the way out is marked as such.
export function mapRead(adventure, run, character, layout = null) {
  const visited = new Set(run?.visitedRooms ?? []);
  const { positions } = layout ?? computeLayout(adventure, visited);
  const rooms = new Map((adventure?.locations ?? []).map((loc) => [loc.room_number, loc]));
  const quill = hasQuill(character);
  const notes = quill ? annotationsFor(adventure, run, character) : new Map();

  const nodes = [];
  const edges = [];
  const stubs = [];
  for (const number of visited) {
    const loc = rooms.get(number);
    const pos = positions.get(number);
    if (!loc || !pos) continue;
    const playerNotes = run.flags?.playerNotes?.[number] ?? null;
    nodes.push({
      room: number,
      name: loc.name,
      x: pos.x, y: pos.y, z: pos.z,
      current: number === run.currentRoom,
      ...(notes.has(number) ? { notes: notes.get(number) } : {}),
      ...(playerNotes?.length ? { playerNotes } : {}),
    });
    for (const [direction, dest] of Object.entries(loc.exits ?? {})) {
      if (dest === null || dest === undefined) continue;
      if (dest === MAIN_HALL_SENTINEL) {
        stubs.push({ room: number, direction, out: true });
      } else if (visited.has(dest)) {
        if (!edges.some((e) => (e.from === dest && e.to === number))) {
          edges.push({ from: number, to: dest });
        }
      } else {
        stubs.push({ room: number, direction });
      }
    }
  }
  return { title: adventure?.adventure?.name ?? 'Adventure', quill, nodes, edges, stubs };
}
