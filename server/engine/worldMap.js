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

// Canonical layout by CONSTRAINT SOLVING, not BFS walking. The cardinal
// directions are law: every north exit must draw upward, every east exit
// rightward — stretched if necessary, never inverted. Each axis is solved
// independently as a layering problem: directional exits become ordering
// arcs, directional CYCLES (the data's true warps) are collapsed into one
// layer (Tarjan SCC), and longest-path layering assigns coordinates that
// satisfy every remaining constraint. Deterministic from the manifest alone.

function sccCollapse(nodes, arcs) {
  // Tarjan strongly-connected components over arcs: u -> v.
  const adj = new Map(nodes.map((n) => [n, []]));
  for (const [u, v] of arcs) adj.get(u)?.push(v);
  let index = 0;
  const idx = new Map(); const low = new Map(); const onStack = new Set();
  const stack = []; const comp = new Map(); let compCount = 0;
  const strong = (v) => {
    idx.set(v, index); low.set(v, index); index++;
    stack.push(v); onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.set(w, compCount); } while (w !== v);
      compCount++;
    }
  };
  for (const n of nodes) if (!idx.has(n)) strong(n);
  return { comp, compCount };
}

// Layer nodes so that for every arc u -> v: layer(v) >= layer(u) + 1
// (cycle members share a layer). Longest-path over the SCC condensation.
function layerAxis(nodes, arcs) {
  const { comp, compCount } = sccCollapse(nodes, arcs);
  const cAdj = new Map(); const indeg = new Map();
  for (let i = 0; i < compCount; i++) { cAdj.set(i, new Set()); indeg.set(i, 0); }
  for (const [u, v] of arcs) {
    const cu = comp.get(u); const cv = comp.get(v);
    if (cu !== cv && !cAdj.get(cu).has(cv)) { cAdj.get(cu).add(cv); indeg.set(cv, indeg.get(cv) + 1); }
  }
  const layer = new Map(); const queue = [];
  for (let i = 0; i < compCount; i++) if (indeg.get(i) === 0) { layer.set(i, 0); queue.push(i); }
  while (queue.length) {
    const c = queue.shift();
    for (const d of cAdj.get(c)) {
      layer.set(d, Math.max(layer.get(d) ?? 0, layer.get(c) + 1));
      indeg.set(d, indeg.get(d) - 1);
      if (indeg.get(d) === 0) queue.push(d);
    }
  }
  const out = new Map();
  for (const n of nodes) out.set(n, layer.get(comp.get(n)) ?? 0);
  return { layers: out, comp };
}

export function computeLayout(adventure) {
  const locs = (adventure?.locations ?? []);
  const rooms = new Map(locs.map((loc) => [loc.room_number, loc]));
  const nodes = [...rooms.keys()];
  const positions = new Map();
  const conflicts = [];
  if (!nodes.length) return { positions, conflicts };

  // Ordering arcs per axis: arc [u,v] means coord(v) >= coord(u) + 1.
  const yArcs = []; const xArcs = []; const zArcs = [];
  for (const [num, loc] of rooms) {
    for (const [dir, dest] of Object.entries(loc.exits ?? {})) {
      if (!Number.isFinite(dest) || !rooms.has(dest)) continue;
      if (dir === 'south') yArcs.push([num, dest]);
      else if (dir === 'north') yArcs.push([dest, num]);
      else if (dir === 'east') xArcs.push([num, dest]);
      else if (dir === 'west') xArcs.push([dest, num]);
      else if (dir === 'up') zArcs.push([num, dest]);
      else if (dir === 'down') zArcs.push([dest, num]);
    }
  }
  const { layers: ys, comp: yComp } = layerAxis(nodes, yArcs);
  // Floors: rooms connected by ANY horizontal exit share a z-level; only
  // up/down arcs separate floors. Union horizontally, layer the groups.
  const zParent = new Map(nodes.map((n) => [n, n]));
  const zFind = (a) => { while (zParent.get(a) !== a) { zParent.set(a, zParent.get(zParent.get(a))); a = zParent.get(a); } return a; };
  for (const [num, loc] of rooms) {
    for (const [dir, dest] of Object.entries(loc.exits ?? {})) {
      if (!Number.isFinite(dest) || !rooms.has(dest)) continue;
      if (dir === 'north' || dir === 'south' || dir === 'east' || dir === 'west') {
        const ra = zFind(num); const rb = zFind(dest);
        if (ra !== rb) zParent.set(ra, rb);
      }
    }
  }
  const zGroups = [...new Set(nodes.map(zFind))];
  const zGroupArcs = zArcs.map(([u, v]) => [zFind(u), zFind(v)]).filter(([u, v]) => u !== v);
  const { layers: zGroupLayers } = layerAxis(zGroups, zGroupArcs);
  const zs = new Map(nodes.map((n) => [n, zGroupLayers.get(zFind(n)) ?? 0]));
  const { layers: xsRaw, comp: xComp } = layerAxis(nodes, xArcs);

  // X alignment: x-layering fixes order WITHIN each east/west-CONNECTED
  // component (undirected — Tarjan SCCs are singletons in a DAG and moving
  // those individually would break the solved order). Whole components float;
  // nudge each one toward the x of rooms it touches via north/south/up/down
  // exits (median pull), a few passes.
  const xs = new Map(nodes.map((n) => [n, xsRaw.get(n)]));
  const parent = new Map(nodes.map((n) => [n, n]));
  const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const [u, v] of xArcs) union(u, v);
  const compMembers = new Map();
  for (const n of nodes) {
    const c = find(n);
    if (!compMembers.has(c)) compMembers.set(c, []);
    compMembers.get(c).push(n);
  }
  const compOf = (n) => find(n);
  const crossEdges = [];
  for (const [num, loc] of rooms) {
    for (const [dir, dest] of Object.entries(loc.exits ?? {})) {
      if (!Number.isFinite(dest) || !rooms.has(dest)) continue;
      if (dir === 'north' || dir === 'south' || dir === 'up' || dir === 'down') crossEdges.push([num, dest]);
    }
  }
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (const [c, members] of compMembers) {
      const pulls = [];
      for (const [a, b] of crossEdges) {
        if (compOf(a) === c && compOf(b) !== c) pulls.push(xs.get(b) - xs.get(a));
        if (compOf(b) === c && compOf(a) !== c) pulls.push(xs.get(a) - xs.get(b));
      }
      if (!pulls.length) continue;
      pulls.sort((p, q) => p - q);
      const offset = pulls[Math.floor(pulls.length / 2)]; // median pull
      if (offset !== 0) {
        for (const m of members) xs.set(m, xs.get(m) + offset);
        moved = true;
      }
    }
    if (!moved) break;
  }

  // Multi-room SCCs are the data's true warps: their internal exits cannot
  // all obey the compass at once. Skip those constraints during placement so
  // cycle members pack as a tight cluster instead of dripping into a long
  // fake corridor (Minotaur's north/south maze was the worst offender).
  const ySccSize = new Map();
  const xSccSize = new Map();
  for (const n of nodes) {
    const yc = yComp.get(n); const xc = xComp.get(n);
    ySccSize.set(yc, (ySccSize.get(yc) ?? 0) + 1);
    xSccSize.set(xc, (xSccSize.get(xc) ?? 0) + 1);
  }
  const yWarpPair = (a, b) => yComp.get(a) === yComp.get(b) && (ySccSize.get(yComp.get(a)) ?? 0) > 1;
  const xWarpPair = (a, b) => xComp.get(a) === xComp.get(b) && (xSccSize.get(xComp.get(a)) ?? 0) > 1;

  // Cell assignment: rooms take their solved cells; colliders move to the
  // nearest free cell that still satisfies every *mappable* directional
  // constraint. Prefer cells near already-placed exit-neighbors so the chart
  // stays one compact parchment, not two continents with an ocean between.
  const occupied = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  const ideal = new Map(nodes.map((n) => [n, { x: xs.get(n), y: ys.get(n), z: zs.get(n) }]));
  const constraintsOf = new Map(nodes.map((n) => [n, []]));
  const incomingOf = new Map(nodes.map((n) => [n, []]));
  const neighborsOf = new Map(nodes.map((n) => [n, new Set()]));
  for (const [num, loc] of rooms) {
    for (const [dir, dest] of Object.entries(loc.exits ?? {})) {
      if (!Number.isFinite(dest) || !rooms.has(dest)) continue;
      constraintsOf.get(num).push([dir, dest]);
      if (dir === 'up' || dir === 'down') continue;
      incomingOf.get(dest).push([dir, num]);
      neighborsOf.get(num).add(dest);
      neighborsOf.get(dest).add(num);
    }
  }
  const mappable = (n, dir, other) => {
    if (n === other) return false; // self-loop: unmappable warp, never a placement constraint
    if (dir === 'north' || dir === 'south') return !yWarpPair(n, other);
    if (dir === 'east' || dir === 'west') return !xWarpPair(n, other);
    return true;
  };
  const compassOk = (n, cand, resolve = false) => {
    for (const [dir, other] of constraintsOf.get(n) ?? []) {
      if (dir === 'up' || dir === 'down') continue;
      if (!mappable(n, dir, other)) continue;
      const o = positions.get(other) ?? (resolve ? null : ideal.get(other));
      if (!o) continue;
      if (dir === 'north' && !(o.y < cand.y)) return false;
      if (dir === 'south' && !(o.y > cand.y)) return false;
      if (dir === 'east' && !(o.x > cand.x)) return false;
      if (dir === 'west' && !(o.x < cand.x)) return false;
    }
    for (const [dir, from] of incomingOf.get(n) ?? []) {
      if (!mappable(from, dir, n)) continue;
      const o = positions.get(from) ?? (resolve ? null : ideal.get(from));
      if (!o) continue;
      if (dir === 'north' && !(cand.y < o.y)) return false;
      if (dir === 'south' && !(cand.y > o.y)) return false;
      if (dir === 'east' && !(cand.x > o.x)) return false;
      if (dir === 'west' && !(cand.x < o.x)) return false;
    }
    return true;
  };
  const neighborGravity = (n) => {
    let sx = 0; let sy = 0; let c = 0;
    for (const other of neighborsOf.get(n) ?? []) {
      const o = positions.get(other);
      if (!o) continue;
      sx += o.x; sy += o.y; c++;
    }
    if (!c) return null;
    return { x: Math.round(sx / c), y: Math.round(sy / c) };
  };
  for (const n of [...nodes].sort((a, b) => a - b)) {
    const want = ideal.get(n);
    if (!occupied.has(key(want.x, want.y, want.z)) && compassOk(n, want)) {
      positions.set(n, { ...want });
      occupied.set(key(want.x, want.y, want.z), n);
      continue;
    }
    conflicts.push({ room: n, direction: null, from: occupied.get(key(want.x, want.y, want.z)) ?? null });
    // Spiral from neighbor centroid when the ideal cell is taken or unmappable —
    // keeps maze-cycle leftovers packed against the rooms that actually connect
    // out of the warp instead of marching them east in a phantom corridor.
    const grav = neighborGravity(n);
    const seed = grav ? { x: grav.x, y: grav.y, z: want.z } : { ...want };
    let placedAt = null;
    let best = null;
    let bestScore = Infinity;
    for (let r = 0; r <= 14; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cand = { x: seed.x + dx, y: seed.y + dy, z: want.z };
          if (occupied.has(key(cand.x, cand.y, cand.z))) continue;
          if (!compassOk(n, cand)) continue;
          let pull = 0; let pc = 0;
          for (const other of neighborsOf.get(n) ?? []) {
            const o = positions.get(other);
            if (!o) continue;
            pull += Math.abs(o.x - cand.x) + Math.abs(o.y - cand.y);
            pc++;
          }
          const score = (Math.abs(dx) + Math.abs(dy)) * 10 + (pc ? pull / pc : 0);
          if (score < bestScore) { bestScore = score; best = cand; }
        }
      }
      if (best) { placedAt = best; break; }
    }
    if (!placedAt) {
      let d = 1;
      let cand = { ...want };
      while (occupied.has(key(cand.x, cand.y, cand.z))) { cand = { x: want.x + d, y: want.y, z: want.z }; d++; }
      placedAt = cand;
    }
    positions.set(n, placedAt);
    occupied.set(key(placedAt.x, placedAt.y, placedAt.z), n);
  }

  // Neighbor compaction: slide rooms toward exit-neighbors when a free cell
  // still obeys every mappable cardinal constraint (one-way inbound included).
  const neighborScore = (n, cand) => {
    let dist = 0;
    let adjacent = 0;
    for (const other of neighborsOf.get(n) ?? []) {
      const o = positions.get(other);
      if (!o || o.z !== cand.z) continue;
      const md = Math.abs(o.x - cand.x) + Math.abs(o.y - cand.y);
      dist += md;
      if (md === 1) adjacent++;
    }
    return { dist, adjacent };
  };
  const better = (a, b) => a.adjacent > b.adjacent || (a.adjacent === b.adjacent && a.dist < b.dist);
  for (let pass = 0; pass < 16; pass++) {
    let moved = false;
    for (const n of [...nodes].sort((a, b) => a - b)) {
      const cur = positions.get(n);
      if (!cur) continue;
      const bestScore = neighborScore(n, cur);
      if (bestScore.dist === 0) continue;
      let best = null;
      let bestS = bestScore;
      for (let r = 1; r <= 12; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const cand = { x: cur.x + dx, y: cur.y + dy, z: cur.z };
            if (occupied.has(key(cand.x, cand.y, cand.z))) continue;
            if (!compassOk(n, cand, true)) continue;
            const s = neighborScore(n, cand);
            if (better(s, bestS)) { bestS = s; best = cand; }
          }
        }
      }
      if (best) {
        occupied.delete(key(cur.x, cur.y, cur.z));
        positions.set(n, best);
        occupied.set(key(best.x, best.y, best.z), n);
        moved = true;
      }
    }
    if (!moved) break;
  }

  // Collapse entirely-empty columns and rows: monotone remap keeps compass
  // order, but dead voids between clusters vanish.
  for (const axis of ['x', 'y']) {
    const used = [...new Set([...positions.values()].map((p) => p[axis]))].sort((a, b) => a - b);
    const remap = new Map(used.map((v, i) => [v, i]));
    for (const p of positions.values()) p[axis] = remap.get(p[axis]);
  }

  // Report true directional cycles (unmappable warps) for port-time review.
  const cycles = new Set();
  for (const [u, v] of yArcs) if (yComp.get(u) === yComp.get(v)) { cycles.add(u); cycles.add(v); }
  for (const [u, v] of xArcs) if (xComp.get(u) === xComp.get(v)) { cycles.add(u); cycles.add(v); }
  for (const r of cycles) conflicts.push({ room: r, direction: 'cycle', from: null });

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
  // THE map: one canonical survey of the world, identical for every player,
  // every run, forever. Fog-of-war reveals it; nothing ever rearranges it.
  const visited = new Set(run?.visitedRooms ?? []);
  const { positions } = layout ?? computeLayout(adventure);
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
          const a = positions.get(number); const b = positions.get(dest);
          let warp = false;
          if (a && b) {
            if (direction === 'north' && !(b.y < a.y)) warp = true;
            if (direction === 'south' && !(b.y > a.y)) warp = true;
            if (direction === 'east' && !(b.x > a.x)) warp = true;
            if (direction === 'west' && !(b.x < a.x)) warp = true;
            // Conflicting directions to the same dest (Gypsy east+west → Forest)
            // cannot be Euclidean — always a warp, even when one dir happens to
            // point the right way on the chart.
            const dirsToDest = Object.entries(loc.exits ?? [])
              .filter(([, d]) => d === dest)
              .map(([d]) => d);
            if (dirsToDest.includes('east') && dirsToDest.includes('west')) warp = true;
            if (dirsToDest.includes('north') && dirsToDest.includes('south')) warp = true;
          }
          edges.push({ from: number, to: dest, ...(warp ? { warp: true } : {}) });
        }
      } else {
        stubs.push({ room: number, direction });
      }
    }
  }
  // The full canonical extent — the fixed frame of THE map, so the client
  // canvas never resizes as fog lifts.
  const all = [...positions.values()];
  const extent = {
    w: Math.max(...all.map((p) => p.x)) + 1,
    h: Math.max(...all.map((p) => p.y)) + 1,
  };
  return { title: adventure?.adventure?.name ?? 'Adventure', quill, nodes, edges, stubs, extent };
}
