// mechanics.js — generic, manifest-driven adventure mechanics. An adventure's
// manifest may carry a `mechanics` block (rivers/vehicles, deadly rooms,
// say-word triggers, dig sites, cursed and guarded items). Everything here is
// a pure function over (adventure, run, character) — the route layer applies
// the results. First consumer: The Lair of the Minotaur (boat, grate death,
// "magic" mirror, buried coins, Jewel of Molinar, the High Priest's books).

export function mechanicsOf(adventure) {
  return adventure?.mechanics ?? {};
}

const inList = (list, n) => Array.isArray(list) && list.includes(n);

export function isWaterRoom(adventure, roomNumber) {
  return inList(mechanicsOf(adventure).water_rooms, roomNumber);
}

export function isShoreRoom(adventure, roomNumber) {
  return inList(mechanicsOf(adventure).shore_rooms, roomNumber);
}

// Where the vehicle currently rests: it follows the player over water.
export function vehicleRoom(adventure, run) {
  const m = mechanicsOf(adventure);
  if (!m.vehicle) return null;
  if (Number.isFinite(run.flags?.vehicleRoom)) return run.flags.vehicleRoom;
  const placement = (adventure.placements ?? []).find((p) => p.item_slug === m.vehicle.item);
  return placement?.room_number ?? null;
}

// Gate a move against locked exits and water. Returns:
//   { ok: true, notes: [...], flagPatch: {...} } — allowed, with side effects
//   { ok: false, text } — blocked
export function gateMove({ adventure, run, character, room, direction }) {
  const dest = room?.exits?.[direction];
  const notes = [];
  const flagPatch = {};

  // Locked exits: an inventory key unlocks silently-forever; no key = blocked.
  const lock = room?.locked_exits?.[direction];
  if (lock) {
    const unlocked = (run.flags?.unlockedDoors ?? []).includes(lock.door);
    if (!unlocked) {
      const hasKey = lock.key && (character.inventory ?? []).some((i) => (i?.slug ?? i) === lock.key);
      if (!hasKey) {
        return { ok: false, text: lock.text ?? `A locked ${lock.door.replace(/-/g, ' ')} blocks the way ${direction}.` };
      }
      notes.push(`You unlock the ${lock.door.replace(/-/g, ' ')} with the ${lock.key.replace(/-/g, ' ')}.`);
      flagPatch.unlockedDoors = [...(run.flags?.unlockedDoors ?? []), lock.door];
    }
  }

  const m = mechanicsOf(adventure);
  if (Number.isFinite(dest) && isWaterRoom(adventure, dest) && m.vehicle) {
    const inBoat = run.flags?.inVehicle === true;
    const boatHere = vehicleRoom(adventure, run) === room.room_number;
    if (!inBoat && !boatHere) {
      return { ok: false, text: m.vehicle.blocked_text ?? 'You cannot go that way without a vessel.' };
    }
    if (!inBoat) {
      notes.push(m.vehicle.board_text ?? 'You climb aboard.');
      flagPatch.inVehicle = true;
    }
    flagPatch.vehicleRoom = dest; // the boat travels with you on water
  }

  return { ok: true, notes, flagPatch };
}

// After a successful move: disembarking and deadly rooms.
export function afterMove({ adventure, run, destination }) {
  const m = mechanicsOf(adventure);
  const notes = [];
  const flagPatch = {};
  if (run.flags?.inVehicle && Number.isFinite(destination) && !isWaterRoom(adventure, destination)) {
    notes.push(m.vehicle?.leave_text ?? 'You climb out.');
    flagPatch.inVehicle = false;
    flagPatch.vehicleRoom = destination;
  }
  const deathText = m.death_rooms?.[String(destination)] ?? null;
  return { notes, flagPatch, deathText };
}

// SAY-word triggers: a word spoken near a visible trigger item reveals another.
export function sayTrigger({ adventure, run, words, roomNumber, visibleItemSlugs }) {
  const m = mechanicsOf(adventure);
  const spoken = String(words ?? '').toLowerCase();
  for (const trigger of m.say_triggers ?? []) {
    if (!new RegExp(`\\b${trigger.word}\\b`, 'i').test(spoken)) continue;
    if (trigger.near_item && !visibleItemSlugs.includes(trigger.near_item)) continue;
    if (trigger.once && (run.flags?.firedTriggers ?? []).includes(trigger.word)) {
      // A solved riddle should say so, not fall through to "nobody's here".
      return { spent: true, text: trigger.already_text ?? 'The word has already done its work here.' };
    }
    return trigger;
  }
  return null;
}

// DIG (or USE <tool>): reveals a buried item at the right site, once.
export function digResult({ adventure, run, character, roomNumber }) {
  const m = mechanicsOf(adventure);
  const sites = m.dig_sites ?? [];
  if (!sites.length) return null;
  const tools = new Set(sites.map((s) => s.tool));
  const heldTool = (character.inventory ?? []).find((i) => tools.has(i?.slug ?? i));
  if (!heldTool) return { ok: false, text: 'You have nothing to dig with.' };
  const site = sites.find((s) => s.room_number === roomNumber);
  if (site && !(run.flags?.revealedItems ?? []).includes(site.reveals)) {
    return { ok: true, site };
  }
  const nothing = sites[0].nothing_text ?? 'You dig a while and find nothing.';
  return { ok: true, site: null, text: nothing };
}

export function cursedItem(adventure, slug) {
  return (mechanicsOf(adventure).cursed_items ?? []).find((c) => c.slug === slug) ?? null;
}

// An item its living guard will not let you take.
export function guardedBy({ adventure, run, slug, presentSlugs }) {
  const g = (mechanicsOf(adventure).guarded_items ?? []).find((c) => c.slug === slug);
  if (!g) return null;
  const defeated = new Set(run.defeatedEnemies ?? []);
  if (defeated.has(g.guard) || !presentSlugs.includes(g.guard)) return null;
  return g;
}

export function markTriggerFired(run, word) {
  const fired = run.flags?.firedTriggers ?? [];
  if (fired.includes(word)) return run;
  return { ...run, flags: { ...(run.flags ?? {}), firedTriggers: [...fired, word] } };
}

export function revealItem(run, slug) {
  const revealed = run.flags?.revealedItems ?? [];
  if (revealed.includes(slug)) return run;
  return { ...run, flags: { ...(run.flags ?? {}), revealedItems: [...revealed, slug] } };
}

export function applyFlagPatch(run, patch) {
  if (!patch || !Object.keys(patch).length) return run;
  return { ...run, flags: { ...(run.flags ?? {}), ...patch } };
}

// ── Staged NPCs ──────────────────────────────────────────────────────────────
// The set-piece engine: an NPC moves through authored stages (awake → drunk →
// asleep → blinded → ...), each with its own description, hostility, and
// vulnerability. Transitions fire on GIVE, USE, or elapsed turns. Manifest:
//   mechanics.npc_stages[slug] = {
//     initial: 'awake',
//     stages: { awake: { description, hostile?, invulnerable?, futile_text? }, ... },
//     transitions: [{ from, to, on: { give?|use?|turns? }, text, once? }],
//   }

export function stagedNpc(adventure, slug) {
  return mechanicsOf(adventure).npc_stages?.[slug] ?? null;
}

export function stageOf(adventure, run, slug) {
  const spec = stagedNpc(adventure, slug);
  if (!spec) return null;
  return run.flags?.npcStage?.[slug] ?? spec.initial;
}

export function stageData(adventure, run, slug) {
  const spec = stagedNpc(adventure, slug);
  if (!spec) return null;
  return spec.stages?.[stageOf(adventure, run, slug)] ?? null;
}

export function setStage(run, slug, stage) {
  return {
    ...run,
    flags: {
      ...(run.flags ?? {}),
      npcStage: { ...(run.flags?.npcStage ?? {}), [slug]: stage },
      npcStageTurns: { ...(run.flags?.npcStageTurns ?? {}), [slug]: 0 },
    },
  };
}

// A GIVE or USE aimed at a staged NPC: does it advance the stage?
export function stageTransition({ adventure, run, slug, on }) {
  const spec = stagedNpc(adventure, slug);
  if (!spec) return null;
  const current = stageOf(adventure, run, slug);
  for (const t of spec.transitions ?? []) {
    if (t.from !== current) continue;
    if (on.give && t.on?.give === on.give) return t;
    if (on.use && t.on?.use === on.use) return t;
  }
  return null;
}

// Called once per player turn: ages stage timers, fires turn-based
// transitions (the drunk giant slumping into sleep), and advances any
// attrition clock. Returns { run, notes: [] }.
export function tickStages(adventure, run) {
  const m = mechanicsOf(adventure);
  const notes = [];
  let next = run;
  for (const [slug, spec] of Object.entries(m.npc_stages ?? {})) {
    const current = stageOf(adventure, next, slug);
    const turns = (next.flags?.npcStageTurns?.[slug] ?? 0) + 1;
    next = { ...next, flags: { ...(next.flags ?? {}), npcStageTurns: { ...(next.flags?.npcStageTurns ?? {}), [slug]: turns } } };
    const t = (spec.transitions ?? []).find((tr) => tr.from === current && Number.isFinite(tr.on?.turns) && turns >= tr.on.turns);
    if (t) {
      next = setStage(next, slug, t.to);
      if (t.text) notes.push(t.text);
    }
  }
  return { run: next, notes };
}

// ── The attrition clock (the crew and the giant's appetite) ──────────────────
// mechanics.attrition = { every: N, victims: [slug...], room_number?, text }
// Every N player turns while the clock's condition holds (player in
// room_number if given), the next living victim is consumed.
export function tickAttrition({ adventure, run, roomNumber }) {
  const a = mechanicsOf(adventure).attrition;
  if (!a) return null;
  if (Number.isFinite(a.room_number) && roomNumber !== a.room_number) return null;
  const eaten = new Set(run.flags?.attritionLost ?? []);
  const remaining = (a.victims ?? []).filter((v) => !eaten.has(v) && !(run.defeatedEnemies ?? []).includes(v));
  if (!remaining.length) return null;
  const count = (run.flags?.attritionClock ?? 0) + 1;
  let next = { ...run, flags: { ...(run.flags ?? {}), attritionClock: count } };
  if (count % a.every !== 0) return { run: next, victim: null };
  const victim = remaining[0];
  next = { ...next, flags: { ...next.flags, attritionLost: [...eaten, victim] } };
  return { run: next, victim };
}
