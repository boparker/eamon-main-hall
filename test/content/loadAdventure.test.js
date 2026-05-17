import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAdventureFromFile, validateAdventureManifest } from '../../server/content/loadAdventure.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(__dirname, '../../data/adventures/beginners-cave.json');

function clone(value) {
  return structuredClone(value);
}

test('loadAdventureFromFile loads Beginner\'s Cave manifest with 26 locations', () => {
  const adventure = loadAdventureFromFile(manifestPath);

  assert.equal(adventure.locations.length, 26);
});

test('Beginner\'s Cave room 1 exits south to room 2 and north to main-hall sentinel', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const room1 = adventure.locations.find((location) => location.room_number === 1);

  assert.equal(room1.exits.south, 2);
  assert.equal(room1.exits.north, 'main-hall');
});

test('every Beginner\'s Cave location has exits, treasure array, and requires property', () => {
  const adventure = loadAdventureFromFile(manifestPath);

  for (const location of adventure.locations) {
    assert.ok(location.exits && typeof location.exits === 'object', `room ${location.room_number} has exits`);
    assert.ok(Array.isArray(location.treasure), `room ${location.room_number} has treasure array`);
    assert.ok(Object.hasOwn(location, 'requires'), `room ${location.room_number} has requires property`);
  }
});

test('Beginner\'s Cave manifest uses schema-friendly enum values and portrait descriptions', () => {
  const adventure = loadAdventureFromFile(manifestPath);

  assert.equal(adventure.adventure.image_preference, 'upload');
  assert.equal(adventure.items.find((item) => item.slug === 'healing-potion').type, 'potion');
  assert.equal(adventure.items.find((item) => item.slug === 'glowing-book').type, 'misc');
  assert.equal(adventure.characters.find((character) => character.slug === 'cynthia').friendliness, 'friendly');
  assert.equal(adventure.characters.find((character) => character.slug === 'hermit').friendliness, 'neutral');
  assert.equal(adventure.characters.find((character) => character.slug === 'heinrich').friendliness, 'neutral');

  for (const character of adventure.characters) {
    assert.ok(character.portrait_description, `${character.slug} has portrait_description`);
  }
});

test('validateAdventureManifest rejects missing adventure start_room', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const invalid = clone(adventure);
  delete invalid.adventure.start_room;

  assert.throws(
    () => validateAdventureManifest(invalid),
    /adventure.*start_room.*required/i,
  );
});

test('validateAdventureManifest rejects start_room that does not reference an existing room', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const invalid = clone(adventure);
  invalid.adventure.start_room = 999;

  assert.throws(
    () => validateAdventureManifest(invalid),
    /adventure.*start_room.*999.*does not reference an existing room/i,
  );
});

test('validateAdventureManifest rejects invalid adventure image_preference', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const invalid = clone(adventure);
  invalid.adventure.image_preference = 'never';

  assert.throws(
    () => validateAdventureManifest(invalid),
    /adventure.*image_preference.*never.*allowed/i,
  );
});

test('validateAdventureManifest rejects invalid exit destination', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const invalid = clone(adventure);
  invalid.locations[0].exits.south = 999;

  assert.throws(
    () => validateAdventureManifest(invalid),
    /exit.*south.*999.*does not reference an existing room/i,
  );
});

test('validateAdventureManifest rejects invalid character location_room', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const invalid = clone(adventure);
  invalid.characters[0].location_room = 999;

  assert.throws(
    () => validateAdventureManifest(invalid),
    /character.*location_room.*999.*does not reference an existing room/i,
  );
});

test('validateAdventureManifest rejects invalid placement item_slug', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const invalid = clone(adventure);
  invalid.placements[0].item_slug = 'not-an-item';

  assert.throws(
    () => validateAdventureManifest(invalid),
    /placement.*item_slug.*not-an-item.*does not reference an existing item/i,
  );
});

test('validateAdventureManifest rejects missing exit direction', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const invalid = clone(adventure);
  delete invalid.locations[0].exits.east;

  assert.throws(
    () => validateAdventureManifest(invalid),
    /location.*room 1.*exits.*east/i,
  );
});

test('validateAdventureManifest rejects duplicate location id', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const invalid = clone(adventure);
  invalid.locations[1].id = invalid.locations[0].id;

  assert.throws(
    () => validateAdventureManifest(invalid),
    /duplicate location id/i,
  );
});

test('validateAdventureManifest rejects duplicate item slug', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const invalid = clone(adventure);
  invalid.items[1].slug = invalid.items[0].slug;

  assert.throws(
    () => validateAdventureManifest(invalid),
    /duplicate item slug/i,
  );
});

test('validateAdventureManifest rejects invalid item type', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const invalid = clone(adventure);
  invalid.items[0].type = 'drinkable';

  assert.throws(
    () => validateAdventureManifest(invalid),
    /item.*type.*drinkable.*allowed/i,
  );
});

test('validateAdventureManifest rejects invalid character friendliness', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const invalid = clone(adventure);
  invalid.characters[0].friendliness = 'random';

  assert.throws(
    () => validateAdventureManifest(invalid),
    /character.*friendliness.*random.*allowed/i,
  );
});

test('validateAdventureManifest rejects invalid damage_dice notation', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const invalid = clone(adventure);
  invalid.characters[0].damage_dice = 'd4';

  assert.throws(
    () => validateAdventureManifest(invalid),
    /character.*damage_dice.*d4.*ndm notation/i,
  );
});

test('validateAdventureManifest rejects non-boolean placement hidden', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const invalid = clone(adventure);
  invalid.placements[0].hidden = 'false';

  assert.throws(
    () => validateAdventureManifest(invalid),
    /placement.*hidden.*boolean/i,
  );
});

test('validateAdventureManifest rejects placement with neither destination', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const invalid = clone(adventure);
  delete invalid.placements[0].room_number;

  assert.throws(
    () => validateAdventureManifest(invalid),
    /placement.*exactly one destination/i,
  );
});

test('validateAdventureManifest rejects placement with both room_number and after_defeating', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const invalid = clone(adventure);
  invalid.placements[0].after_defeating = invalid.characters[0].slug;

  assert.throws(
    () => validateAdventureManifest(invalid),
    /placement.*exactly one destination/i,
  );
});

test('validateAdventureManifest rejects invalid after_defeating slug', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const invalid = clone(adventure);
  const drop = invalid.placements.find((placement) => placement.after_defeating);
  drop.after_defeating = 'not-a-character';

  assert.throws(
    () => validateAdventureManifest(invalid),
    /placement.*after_defeating.*not-a-character.*does not reference an existing character/i,
  );
});

test('loaded Beginner\'s Cave includes Pirate\'s Cove, pirate, and TrollsFire drop placement', () => {
  const adventure = loadAdventureFromFile(manifestPath);
  const room26 = adventure.locations.find((location) => location.room_number === 26);
  const pirate = adventure.characters.find((character) => character.slug === 'pirate');
  const trollsfireDrop = adventure.placements.find(
    (placement) => placement.item_slug === 'trollsfire' && placement.after_defeating === 'pirate',
  );

  assert.equal(room26.name, "The Pirate's Cove");
  assert.equal(pirate.location_room, 26);
  assert.ok(trollsfireDrop);
  assert.equal(Object.hasOwn(trollsfireDrop, 'room_number'), false);
});
