import { randomUUID } from 'node:crypto';

const MAIN_HALL_SENTINEL = 'main-hall';

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

export function getVisibleRoomEntities(run, adventure) {
  const room = getCurrentRoom(run, adventure);
  const defeatedEnemies = new Set(run.defeatedEnemies);
  const collectedItems = new Set(run.collectedItems);
  const openedContainers = new Set(run.flags?.openedContainers ?? []);
  const characterRooms = new Map(
    adventure.characters.map((character) => [character.slug, character.location_room]),
  );

  return {
    characters: adventure.characters.filter(
      (character) => character.location_room === room.room_number && !defeatedEnemies.has(character.slug),
    ),
    placements: (adventure.placements ?? []).filter(
      (placement) => {
        if (collectedItems.has(placement.item_slug)) return false;
        // Hidden items stay hidden — unless they're inside a container the
        // player has opened (then they become visible/takeable).
        if (placement.hidden === true) {
          if (!placement.container || !openedContainers.has(placement.container)) return false;
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
