import { readFileSync } from 'node:fs';

const MAIN_HALL_SENTINEL = 'main-hall';
const DIRECTIONS = ['north', 'south', 'east', 'west', 'up', 'down'];
const ADVENTURE_IMAGE_PREFERENCES = ['generate', 'upload'];
const ITEM_TYPES = ['weapon', 'armor', 'shield', 'potion', 'spell', 'scroll', 'treasure', 'key', 'misc'];
const CHARACTER_TYPES = ['npc', 'enemy', 'boss', 'merchant'];
const FRIENDLINESS_VALUES = ['friendly', 'neutral', 'hostile'];
const DAMAGE_DICE_PATTERN = /^(?:0|[1-9]\d*)d(?:0|[1-9]\d*)$/;

function roomLabel(location) {
  return `room ${location?.room_number ?? '<unknown>'}`;
}

function assertArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`Adventure manifest ${fieldName} must be an array`);
  }
}

function assertRequired(object, fieldName, label, options = {}) {
  const allowsNull = options.allowNull === true;
  if (!Object.hasOwn(object, fieldName) || (!allowsNull && object[fieldName] === null) || object[fieldName] === undefined || object[fieldName] === '') {
    throw new Error(`${label} ${fieldName} is required`);
  }
}

function assertAllowed(value, allowedValues, fieldName, label) {
  if (!allowedValues.includes(value)) {
    throw new Error(`${label} ${fieldName} ${String(value)} is not allowed; expected one of ${allowedValues.join(', ')}`);
  }
}

function assertDamageDice(value, label) {
  if (value !== undefined && value !== null && !DAMAGE_DICE_PATTERN.test(value)) {
    throw new Error(`${label} damage_dice ${String(value)} must use NdM notation`);
  }
}

export function validateAdventureManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Adventure manifest must be an object');
  }

  assertArray(manifest.locations, 'locations');
  assertArray(manifest.characters, 'characters');
  assertArray(manifest.items, 'items');

  if (!manifest.adventure || typeof manifest.adventure !== 'object' || Array.isArray(manifest.adventure)) {
    throw new Error('Adventure manifest adventure must be an object');
  }

  for (const field of ['id', 'name', 'start_room', 'image_preference']) {
    assertRequired(manifest.adventure, field, 'Adventure manifest adventure');
  }
  assertAllowed(
    manifest.adventure.image_preference,
    ADVENTURE_IMAGE_PREFERENCES,
    'image_preference',
    'Adventure manifest adventure',
  );

  const roomNumbers = new Set();
  const locationIds = new Set();
  for (const location of manifest.locations) {
    for (const field of ['id', 'room_number', 'name', 'narration_text', 'background_description', 'light_level', 'exits', 'treasure']) {
      assertRequired(location, field, `Location ${roomLabel(location)}`);
    }
    assertRequired(location, 'requires', `Location ${roomLabel(location)}`, { allowNull: true });
    if (locationIds.has(location.id)) {
      throw new Error(`Duplicate location id ${location.id}`);
    }
    locationIds.add(location.id);
    if (!Number.isInteger(location.room_number)) {
      throw new Error(`Location ${location.name ?? '<unnamed>'} has invalid room_number`);
    }
    if (roomNumbers.has(location.room_number)) {
      throw new Error(`Duplicate location room_number ${location.room_number}`);
    }
    roomNumbers.add(location.room_number);
  }

  if (!Number.isInteger(manifest.adventure.start_room)) {
    throw new Error(`Adventure manifest adventure start_room ${String(manifest.adventure.start_room)} must be an integer`);
  }
  if (!roomNumbers.has(manifest.adventure.start_room)) {
    throw new Error(
      `Adventure manifest adventure start_room ${manifest.adventure.start_room} does not reference an existing room`,
    );
  }

  for (const location of manifest.locations) {
    if (!location.exits || typeof location.exits !== 'object' || Array.isArray(location.exits)) {
      throw new Error(`Location ${roomLabel(location)} must have exits object`);
    }
    if (!Array.isArray(location.treasure)) {
      throw new Error(`Location ${roomLabel(location)} must have treasure array`);
    }
    if (!Object.hasOwn(location, 'requires')) {
      throw new Error(`Location ${roomLabel(location)} must have requires property`);
    }

    for (const direction of DIRECTIONS) {
      if (!Object.hasOwn(location.exits, direction)) {
        throw new Error(`Location ${roomLabel(location)} exits must include ${direction}`);
      }
    }

    for (const [direction, destination] of Object.entries(location.exits)) {
      if (destination === null || destination === undefined) {
        continue;
      }
      if (destination === MAIN_HALL_SENTINEL) {
        continue;
      }
      if (!Number.isInteger(destination)) {
        throw new Error(
          `Location ${roomLabel(location)} exit ${direction} destination ${String(destination)} must be a room number or ${MAIN_HALL_SENTINEL}`,
        );
      }
      if (!roomNumbers.has(destination)) {
        throw new Error(
          `Location ${roomLabel(location)} exit ${direction} destination ${destination} does not reference an existing room`,
        );
      }
    }
  }

  const characterSlugs = new Set();
  const characterIds = new Set();
  for (const character of manifest.characters) {
    for (const field of ['id', 'slug', 'name', 'type', 'friendliness', 'hp', 'location_room', 'portrait_description', 'current_hp_from']) {
      assertRequired(character, field, `Character ${character.slug ?? character.name ?? '<unnamed>'}`);
    }
    if (characterIds.has(character.id)) {
      throw new Error(`Duplicate character id ${character.id}`);
    }
    characterIds.add(character.id);
    if (characterSlugs.has(character.slug)) {
      throw new Error(`Duplicate character slug ${character.slug}`);
    }
    characterSlugs.add(character.slug);

    assertAllowed(character.type, CHARACTER_TYPES, 'type', `Character ${character.slug}`);
    assertAllowed(character.friendliness, FRIENDLINESS_VALUES, 'friendliness', `Character ${character.slug}`);
    assertDamageDice(character.damage_dice, `Character ${character.slug}`);

    if (!roomNumbers.has(character.location_room)) {
      throw new Error(
        `Character ${character.slug} location_room ${character.location_room} does not reference an existing room`,
      );
    }
  }

  const itemSlugs = new Set();
  const itemIds = new Set();
  for (const item of manifest.items) {
    for (const field of ['id', 'slug', 'name', 'type', 'value', 'weight']) {
      assertRequired(item, field, `Item ${item.slug ?? item.name ?? '<unnamed>'}`);
    }
    if (itemIds.has(item.id)) {
      throw new Error(`Duplicate item id ${item.id}`);
    }
    itemIds.add(item.id);
    if (itemSlugs.has(item.slug)) {
      throw new Error(`Duplicate item slug ${item.slug}`);
    }
    itemSlugs.add(item.slug);
    assertAllowed(item.type, ITEM_TYPES, 'type', `Item ${item.slug}`);
    assertDamageDice(item.damage_dice, `Item ${item.slug}`);
  }

  if (manifest.placements !== undefined) {
    assertArray(manifest.placements, 'placements');
  }

  for (const placement of manifest.placements ?? []) {
    const hasRoomNumber = Object.hasOwn(placement, 'room_number');
    const hasAfterDefeating = Object.hasOwn(placement, 'after_defeating');

    if (hasRoomNumber === hasAfterDefeating) {
      throw new Error(`Placement for item_slug ${placement.item_slug ?? '<unknown>'} must have exactly one destination: room_number or after_defeating`);
    }
    if (Object.hasOwn(placement, 'hidden') && typeof placement.hidden !== 'boolean') {
      throw new Error(`Placement for item_slug ${placement.item_slug ?? '<unknown>'} hidden must be boolean`);
    }
    if (!itemSlugs.has(placement.item_slug)) {
      throw new Error(
        `Placement item_slug ${placement.item_slug} does not reference an existing item`,
      );
    }

    if (hasRoomNumber && !roomNumbers.has(placement.room_number)) {
      throw new Error(
        `Placement room_number ${placement.room_number} does not reference an existing room`,
      );
    }

    if (hasAfterDefeating && !characterSlugs.has(placement.after_defeating)) {
      throw new Error(
        `Placement after_defeating ${placement.after_defeating} does not reference an existing character`,
      );
    }
  }

  return manifest;
}

export function loadAdventureFromFile(path) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  return validateAdventureManifest(manifest);
}
