// port-adventure.mjs — convert an Eamon Remastered fixture dump into our
// adventure manifest. Usage:
//   node tools/port-adventure.mjs <fixtures.json> <adventure-id> [overlay.json]
//
// The fixture format is Django serialization (kdechant/eamon, MIT). The
// original adventure text is Donald Brown's freeware Eamon (1980). An overlay
// JSON (hand-authored mercy layer, ambience, name fixes) is deep-merged last,
// so re-running the converter never clobbers authored content.
//
// Emits data/adventures/<adventure-id>.json in the beginners-cave schema.

import { readFileSync, writeFileSync } from 'node:fs';

const [fixturePath, adventureId, overlayPath] = process.argv.slice(2);
if (!fixturePath || !adventureId) {
  console.error('usage: node tools/port-adventure.mjs <fixtures.json> <adventure-id> [overlay.json]');
  process.exit(1);
}

const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'));
const overlay = overlayPath ? JSON.parse(readFileSync(overlayPath, 'utf8')) : {};
const byModel = (m) => fixtures.filter((x) => x.model === m).map((x) => ({ pk: x.pk, ...x.fields }));

const advRec = byModel('adventure.adventure')[0];
const rooms = byModel('adventure.room');
const exits = byModel('adventure.roomexit');
const artifacts = byModel('adventure.artifact');
const monsters = byModel('adventure.monster');
const effects = byModel('adventure.effect');

const roomByPk = new Map(rooms.map((r) => [r.pk, r]));
const effectText = (id) => effects.find((e) => e.effect_id === id)?.text ?? null;

const DIRS = { n: 'north', s: 'south', e: 'east', w: 'west', u: 'up', d: 'down' };

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// "in the coffin room. (S)" -> "The Coffin Room"
function roomName(raw) {
  let n = String(raw).replace(/\s*\([^)]*\)\s*\.?\s*$/, '').replace(/;.*$/, '').replace(/\.$/, '').trim();
  n = n.replace(/^(you are |you're )/i, '');
  n = n.replace(/^(in|on|at|below|beside|inside) (the |a |an )?/i, '');
  n = n.split(' ').map((w) => (w.length > 2 && !/^(and|of|the|a|an|to|in|on)$/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  return ('The ' + n).replace(/^The The /, 'The ');
}

// Ambience from the existing bed library, by room text keywords.
function ambienceFor(room) {
  const t = `${room.name} ${room.description}`.toLowerCase();
  if (/river|beach|water|grotto|boat/.test(t)) return { track: 'cove', volume: 0.3 };
  if (/temple|chapel|altar|kalimar|priest/.test(t)) return { track: 'temple', volume: 0.22 };
  if (/coffin|crypt|cell|prison|tomb/.test(t)) return { track: 'cell', volume: 0.3 };
  if (/bushes|clearing|outside|daylight|gypsy|camp/.test(t)) return { track: 'entrance', volume: 0.3 };
  return { track: 'tunnel', volume: 0.3 };
}

// ── Locations ────────────────────────────────────────────────────────────────
const locations = rooms.map((r) => {
  const ex = { north: null, south: null, east: null, west: null, up: null, down: null };
  const locked = {};
  for (const e of exits.filter((e) => e.room_from === r.pk)) {
    const dir = DIRS[e.direction];
    if (!dir) continue;
    ex[dir] = e.room_to === -999 ? 'main-hall' : e.room_to;
    if (e.door_id) {
      const door = artifacts.find((a) => a.artifact_id === e.door_id);
      if (door) locked[dir] = { door: slugify(door.name), key: door.key_id ? slugify(artifacts.find((a) => a.artifact_id === door.key_id)?.name ?? '') : null, text: door.description };
    }
  }
  return {
    id: `${adventureId}-${r.room_id}`,
    room_number: r.room_id,
    name: roomName(r.name),
    narration_text: r.description,
    background_description: r.description,
    light_level: r.is_dark ? 'dark' : 'dim',
    is_combat_zone: true,
    exits: ex,
    ...(Object.keys(locked).length ? { locked_exits: locked } : {}),
    treasure: [],
    requires: null,
    ambience: ambienceFor(r),
    canonical_name: r.name,
    text_source: 'The Lair of the Minotaur (Donald Brown, c. 1980) via Eamon Remastered fixtures',
  };
});

// ── Items (artifacts) ────────────────────────────────────────────────────────
// Remastered artifact types: 0 gold, 1 treasure, 2 weapon, 3 magic weapon,
// 4 container, 5 light source, 6 drinkable, 7 readable, 8 door/gate,
// 10 bound-monster marker, 13 wearable.
const TYPE_MAP = { 0: 'treasure', 1: 'treasure', 2: 'weapon', 3: 'weapon', 4: 'container', 5: 'misc', 6: 'potion', 7: 'scroll', 13: 'misc' };
const artifactById = new Map(artifacts.map((a) => [a.artifact_id, a]));
const items = [];
const placements = [];

for (const a of artifacts) {
  if (a.type === 8 || a.type === 10) continue; // doors wire into exits; bound markers into captives
  if (/'s body$|^smashed skeleton$/i.test(a.name)) continue; // remastered corpse artifacts — our engine has no corpses
  const slug = slugify(a.name);
  const item = {
    id: `${adventureId}-${slug}`,
    name: a.name.toLowerCase(),
    slug,
    type: TYPE_MAP[a.type] ?? 'misc',
    collectible: a.type !== 4,
    value: a.type === 0 ? (a.quantity ?? a.value ?? 0) : (a.value ?? 0),
    weight: a.weight ?? 1,
    description: a.description,
    canonical_name: a.name,
    text_source: 'The Lair of the Minotaur (Donald Brown, c. 1980)',
  };
  if (item.type === 'weapon') {
    item.damage_dice = `${a.dice ?? 1}d${a.sides ?? 4}`;
    if (a.type === 3) item.magic = true;
  }
  if (item.type === 'container') { item.collectible = false; item.weight = -999; }
  if (a.type === 5) item.light_source = true;
  items.push(item);

  if (a.container_id) {
    const holder = artifactById.get(a.container_id);
    placements.push({ item_slug: slug, room_number: holder?.room_id ?? 0, hidden: true, container: slugify(holder?.name ?? '') });
  } else if (a.room_id) {
    placements.push({ item_slug: slug, room_number: a.room_id, hidden: !!(a.hidden || a.embedded) });
  } else if (a.monster_id) {
    // carried by a monster: drops on defeat — modeled as hidden placement in their room
    const m = monsters.find((mm) => mm.monster_id === a.monster_id);
    if (m?.room_id) placements.push({ item_slug: slug, room_number: m.room_id, hidden: true, after_defeating: slugify(m.name) });
  }
}

// ── Characters (monsters) ────────────────────────────────────────────────────
const characters = monsters
  .filter((m) => !(overlay.skip_monsters ?? []).includes(slugify(m.name)))
  .map((m) => {
    const slug = slugify(m.name);
    const container = m.container_id ? artifactById.get(m.container_id) : null;
    const c = {
      id: `${adventureId}-${slug}`,
      name: m.name,
      slug,
      type: m.friendliness === 'friend' ? 'npc' : 'enemy',
      friendliness: m.friendliness === 'friend' ? 'friendly' : (m.friendliness === 'random' ? 'random' : 'hostile'),
      description: m.description,
      first_encounter_text: m.description,
      hp: m.hardiness,
      current_hp_from: 'hp',
      agility: m.agility,
      damage_dice: `${m.weapon_dice ?? 1}d${m.weapon_sides ?? 4}`,
      gold: 0,
      location_room: container?.room_id ?? m.room_id ?? 0,
      ...(container ? { hidden_until_opened: slugify(container.name) } : {}),
      canonical_name: m.name,
      text_source: 'The Lair of the Minotaur (Donald Brown, c. 1980)',
    };
    return c;
  });

// ── Mechanics (adventure-specific, engine-generic) ───────────────────────────
const mechanics = overlay.mechanics ?? {};

const manifest = {
  adventure: {
    id: adventureId,
    name: advRec.name,
    description: advRec.description,
    artist_style: 'earle',
    difficulty: 2,
    author: 'Donald Brown (ported)',
    intro: (overlay.intro ?? advRec.intro_text ?? '').replace(/\r/g, ''),
    start_room: 1,
    full_description: advRec.description,
    text_source: 'Eamon adventure #2 (c. 1980), data via Eamon Remastered (MIT)',
  },
  mechanics,
  locations,
  characters,
  items,
  placements,
};

// ── Overlay merge (hand-authored content wins) ───────────────────────────────
function mergeBy(listName, key) {
  for (const patch of overlay[listName] ?? []) {
    const target = manifest[listName].find((x) => x[key] === patch[key]);
    if (target) Object.assign(target, patch);
    else manifest[listName].push(patch);
  }
}
mergeBy('locations', 'room_number');
mergeBy('characters', 'slug');
mergeBy('items', 'slug');
if (overlay.adventure) Object.assign(manifest.adventure, overlay.adventure);
for (const patch of overlay.placements ?? []) {
  const t = manifest.placements.find((p) => p.item_slug === patch.item_slug);
  if (t) Object.assign(t, patch); else manifest.placements.push(patch);
}

const out = `data/adventures/${adventureId}.json`;
writeFileSync(out, JSON.stringify(manifest, null, 1));
console.log(`${out}: ${locations.length} rooms, ${characters.length} characters, ${items.length} items, ${placements.length} placements`);
const orphans = exits.filter((e) => e.room_to > 0 && !rooms.some((r) => r.room_id === e.room_to));
if (orphans.length) console.warn('WARNING dangling exits:', orphans);
