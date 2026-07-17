import { randomUUID } from 'node:crypto';

export const MAIN_HALL_SENTINEL = 'main-hall';

function getAdventureId(adventure) {
  return adventure?.adventure?.id;
}

function getStartRoom(adventure) {
  return adventure?.adventure?.start_room;
}

function findRoom(adventure, roomNumber) {
  return adventure?.locations?.find((location) => location.room_number === roomNumber);
}

function addUnique(values, value) {
  return values.includes(value) ? [...values] : [...values, value];
}

export function createAdventureRun(adventure, characterId) {
  const startRoom = getStartRoom(adventure);

  return {
    id: randomUUID(),
    characterId,
    adventureId: getAdventureId(adventure),
    currentRoom: startRoom,
    visitedRooms: [startRoom],
    collectedItems: [],
    defeatedEnemies: [],
    status: 'active',
  };
}

export function getCurrentRoom(run, adventure) {
  const room = findRoom(adventure, run?.currentRoom);

  if (!room) {
    throw new Error(`Adventure run currentRoom ${String(run?.currentRoom)} does not reference an existing room`);
  }

  return room;
}

export function move(run, adventure, direction) {
  if (run?.status !== 'active') {
    return {
      ok: false,
      reason: 'inactive',
      run,
      text: 'You cannot move because this adventure run is no longer active.',
    };
  }

  const currentRoom = getCurrentRoom(run, adventure);
  const destination = currentRoom.exits?.[direction];

  if (destination === null || destination === undefined) {
    return {
      ok: false,
      reason: 'blocked',
      run,
      text: `You cannot go ${direction} from here.`,
    };
  }

  if (destination === MAIN_HALL_SENTINEL) {
    return {
      ok: true,
      destination: MAIN_HALL_SENTINEL,
      from: currentRoom.room_number,
      run: {
        ...run,
        status: 'leaving',
      },
      text: 'You leave the adventure and return to the Main Hall.',
    };
  }

  const destinationRoom = findRoom(adventure, destination);
  if (!destinationRoom) {
    return {
      ok: false,
      reason: 'blocked',
      run,
      text: `You cannot go ${direction} from here.`,
    };
  }

  const updatedRun = {
    ...run,
    currentRoom: destination,
    visitedRooms: addUnique(run.visitedRooms, destination),
  };

  return {
    ok: true,
    run: updatedRun,
    from: currentRoom.room_number,
    to: destination,
    room: destinationRoom,
    text: destinationRoom.narration_text,
  };
}

// Resolve a character's effective disposition, honouring a recorded random
// encounter outcome (hermit/Heinrich rolled friend-or-foe on first meeting).
export function dispositionOf(character, run) {
  const outcome = run?.flags?.encounters?.[character?.slug];
  if (outcome === 'friend') return 'friendly';
  if (outcome === 'foe') return 'hostile';
  if (character?.type === 'enemy' || character?.type === 'boss'
    || character?.is_hostile === true || character?.friendliness === 'hostile') return 'hostile';
  if (character?.friendliness === 'friendly') return 'friendly';
  return 'neutral';
}

export function getCompanions(run) {
  return Array.isArray(run?.flags?.companions) ? run.flags.companions : [];
}

export function getVisibleRoomEntities(run, adventure) {
  const room = getCurrentRoom(run, adventure);
  const defeatedEnemies = new Set(run.defeatedEnemies);
  const collectedItems = new Set(run.collectedItems);
  const openedContainers = new Set(run.flags?.openedContainers ?? []);
  const inspectedFeatures = new Set(run.flags?.inspectedFeatures ?? []);
  const relocated = run.flags?.relocated ?? {};
  const effectiveRoom = (character) => relocated[character.slug] ?? character.location_room;
  const characterRooms = new Map(
    adventure.characters.map((character) => [character.slug, effectiveRoom(character)]),
  );

  // Companions travel WITH you — they appear in whatever room you are in,
  // regardless of where they were first met, and never as a room native.
  const companions = getCompanions(run);
  const companionSlugs = new Set(companions.map((c) => c.slug));
  const bySlug = new Map(adventure.characters.map((c) => [c.slug, c]));
  const companionEntities = companions
    .map((c) => {
      const npc = bySlug.get(c.slug);
      if (!npc) return null;
      return { ...npc, hp: c.hp, maxHp: c.maxHp ?? npc.hp, disposition: 'friendly', companion: true, following: true };
    })
    .filter(Boolean);

  return {
    characters: [
      ...adventure.characters
        .filter((character) => effectiveRoom(character) === room.room_number
          && !defeatedEnemies.has(character.slug) && !companionSlugs.has(character.slug)
          // A disguised monster (e.g. a mimic) stays hidden until its container is opened.
          && (!character.hidden_until_opened || openedContainers.has(character.hidden_until_opened)))
        .map((character) => ({ ...character, disposition: dispositionOf(character, run) })),
      ...companionEntities,
    ],
    placements: (adventure.placements ?? []).filter(
      (placement) => {
        if (collectedItems.has(placement.item_slug)) return false;
        // Hidden items stay hidden until their trigger fires: a container the
        // player has opened, or a room feature the player has inspected.
        if (placement.hidden === true) {
          const byContainer = placement.container && openedContainers.has(placement.container);
          const byInspection = placement.revealedBy && inspectedFeatures.has(placement.revealedBy);
          if (!byContainer && !byInspection) return false;
        }

        if (placement.after_defeating) {
          return defeatedEnemies.has(placement.after_defeating)
            && characterRooms.get(placement.after_defeating) === room.room_number;
        }

        return placement.room_number === room.room_number;
      },
    ),
  };
}

export function markContainerOpened(run, containerSlug) {
  const flags = run.flags ?? {};
  const opened = Array.isArray(flags.openedContainers) ? flags.openedContainers : [];
  if (opened.includes(containerSlug)) return run;
  return { ...run, flags: { ...flags, openedContainers: [...opened, containerSlug] } };
}

// A readable scenery item (inscription, writing, scroll) the player has read.
// Tracked so the UI can gray it out rather than inviting endless re-reading.
export function markItemRead(run, itemSlug) {
  const flags = run.flags ?? {};
  const read = Array.isArray(flags.readItems) ? flags.readItems : [];
  if (read.includes(itemSlug)) return run;
  return { ...run, flags: { ...flags, readItems: [...read, itemSlug] } };
}

export function isItemRead(run, itemSlug) {
  return Array.isArray(run?.flags?.readItems) && run.flags.readItems.includes(itemSlug);
}

export function markFeatureInspected(run, featureSlug) {
  const flags = run.flags ?? {};
  const inspected = Array.isArray(flags.inspectedFeatures) ? flags.inspectedFeatures : [];
  if (inspected.includes(featureSlug)) return run;
  return { ...run, flags: { ...flags, inspectedFeatures: [...inspected, featureSlug] } };
}

export function markItemCollected(run, itemSlug) {
  return {
    ...run,
    collectedItems: addUnique(run.collectedItems, itemSlug),
  };
}

export function markEnemyDefeated(run, enemySlug) {
  return {
    ...run,
    defeatedEnemies: addUnique(run.defeatedEnemies, enemySlug),
  };
}

// Free any captive whose captor is already dead and who is in the player's
// current room but not yet travelling with them. State-based (not tied to the
// exact kill event), so it repairs runs where the captor was slain before the
// companion system existed, and is robust if a recruit is ever missed.
export function freeDefeatedCaptives(run, adventure) {
  const defeated = new Set(run.defeatedEnemies);
  const companions = new Set(getCompanions(run).map((c) => c.slug));
  const room = getCurrentRoom(run, adventure);
  const relocated = run.flags?.relocated ?? {};
  const freed = [];
  let next = run;
  for (const captor of adventure.characters) {
    const captiveSlug = captor.frees_on_defeat;
    if (!captiveSlug || !defeated.has(captor.slug) || companions.has(captiveSlug)) continue;
    const captive = adventure.characters.find((c) => c.slug === captiveSlug);
    if (!captive) continue;
    if ((relocated[captiveSlug] ?? captive.location_room) !== room.room_number) continue;
    next = recruitCompanion(next, captive);
    freed.push(captiveSlug);
  }
  return { run: next, freed };
}

// A character's authored entrance text is shown once per run, on first sight.
export function isIntroduced(run, slug) {
  return Array.isArray(run?.flags?.introduced) && run.flags.introduced.includes(slug);
}

export function markIntroduced(run, slug) {
  const flags = run.flags ?? {};
  const introduced = Array.isArray(flags.introduced) ? flags.introduced : [];
  if (introduced.includes(slug)) return run;
  return { ...run, flags: { ...flags, introduced: [...introduced, slug] } };
}

// Record a resolved random-encounter outcome ('friend' | 'foe') so it stays
// stable for the rest of the run.
export function recordEncounter(run, slug, outcome) {
  const flags = run.flags ?? {};
  const encounters = flags.encounters ?? {};
  if (encounters[slug] === outcome) return run;
  return { ...run, flags: { ...flags, encounters: { ...encounters, [slug]: outcome } } };
}

// Add an NPC to the travelling party (idempotent). Stores current + max HP so
// combat damage persists across rooms/rounds.
export function recruitCompanion(run, npc) {
  const flags = run.flags ?? {};
  const companions = Array.isArray(flags.companions) ? flags.companions : [];
  if (companions.some((c) => c.slug === npc.slug)) return run;
  const entry = { slug: npc.slug, hp: npc.hp ?? npc.maxHp ?? 1, maxHp: npc.hp ?? npc.maxHp ?? 1 };
  return { ...run, flags: { ...flags, companions: [...companions, entry] } };
}

export function setCompanionHp(run, slug, hp) {
  const flags = run.flags ?? {};
  const companions = Array.isArray(flags.companions) ? flags.companions : [];
  const next = companions.map((c) => (c.slug === slug ? { ...c, hp: Math.max(0, hp) } : c));
  return { ...run, flags: { ...flags, companions: next } };
}

// Move a character to a different room for the rest of the run (e.g. rats that
// scatter to the great chamber). Overrides their manifest location_room.
export function relocateCharacter(run, slug, room) {
  const flags = run.flags ?? {};
  return { ...run, flags: { ...flags, relocated: { ...(flags.relocated ?? {}), [slug]: room } } };
}

// Mark an enemy as fleeing — it no longer turns to fight (one-sided pursuit).
export function markFleeing(run, slug) {
  const flags = run.flags ?? {};
  return { ...run, flags: { ...flags, fleeing: { ...(flags.fleeing ?? {}), [slug]: true } } };
}

export function isFleeing(run, slug) {
  return !!run?.flags?.fleeing?.[slug];
}

// Bump and return how many combat rounds have been fought against an enemy.
export function bumpCombatRound(run, slug) {
  const flags = run.flags ?? {};
  const rounds = (flags.combatRounds?.[slug] ?? 0) + 1;
  return { run: { ...run, flags: { ...flags, combatRounds: { ...(flags.combatRounds ?? {}), [slug]: rounds } } }, rounds };
}

export function combatRoundsFought(run, slug) {
  return run?.flags?.combatRounds?.[slug] ?? 0;
}

// Remove a fallen companion from the party and remember them as fallen.
export function removeCompanion(run, slug) {
  const flags = run.flags ?? {};
  const companions = Array.isArray(flags.companions) ? flags.companions : [];
  const fallen = Array.isArray(flags.fallenCompanions) ? flags.fallenCompanions : [];
  return {
    ...run,
    flags: {
      ...flags,
      companions: companions.filter((c) => c.slug !== slug),
      fallenCompanions: fallen.includes(slug) ? fallen : [...fallen, slug],
    },
  };
}
