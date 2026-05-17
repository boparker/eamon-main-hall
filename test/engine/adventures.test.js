import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAdventureFromFile } from '../../server/content/loadAdventure.js';
import {
  createAdventureRun,
  getCurrentRoom,
  getVisibleRoomEntities,
  markEnemyDefeated,
  markItemCollected,
  move,
} from '../../server/engine/adventures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(__dirname, '../../data/adventures/beginners-cave.json');

function loadBeginnersCave() {
  return loadAdventureFromFile(manifestPath);
}

function room3Run(adventure) {
  const run = createAdventureRun(adventure, 'character-1');
  return {
    ...run,
    currentRoom: 3,
    visitedRooms: [...run.visitedRooms, 3],
  };
}

function roomRun(adventure, roomNumber) {
  const run = createAdventureRun(adventure, 'character-1');
  return {
    ...run,
    currentRoom: roomNumber,
    visitedRooms: run.visitedRooms.includes(roomNumber) ? run.visitedRooms : [...run.visitedRooms, roomNumber],
  };
}

test('createAdventureRun starts at adventure start_room with active status', () => {
  const adventure = loadBeginnersCave();
  const run = createAdventureRun(adventure, 'character-1');

  assert.ok(run.id);
  assert.equal(run.characterId, 'character-1');
  assert.equal(run.adventureId, 'beginners-cave');
  assert.equal(run.currentRoom, adventure.adventure.start_room);
  assert.deepEqual(run.visitedRooms, [adventure.adventure.start_room]);
  assert.deepEqual(run.collectedItems, []);
  assert.deepEqual(run.defeatedEnemies, []);
  assert.equal(run.status, 'active');
});

test('getCurrentRoom returns Cave Entrance for new Beginner\'s Cave run', () => {
  const adventure = loadBeginnersCave();
  const run = createAdventureRun(adventure, 'character-1');

  assert.equal(getCurrentRoom(run, adventure).name, 'Cave Entrance');
});

test('move south from room 1 moves to room 2', () => {
  const adventure = loadBeginnersCave();
  const run = createAdventureRun(adventure, 'character-1');
  const result = move(run, adventure, 'south');

  assert.equal(result.ok, true);
  assert.equal(result.from, 1);
  assert.equal(result.to, 2);
  assert.equal(result.run.currentRoom, 2);
  assert.deepEqual(result.run.visitedRooms, [1, 2]);
  assert.equal(result.room.name, 'Dark North/South Tunnel');
  assert.equal(run.currentRoom, 1);
});

test('invalid direction or nonexistent exit does not change currentRoom', () => {
  const adventure = loadBeginnersCave();
  const run = createAdventureRun(adventure, 'character-1');

  const invalidDirection = move(run, adventure, 'sideways');
  assert.equal(invalidDirection.ok, false);
  assert.equal(invalidDirection.reason, 'blocked');
  assert.equal(invalidDirection.run.currentRoom, 1);

  const nonexistentExit = move(run, adventure, 'east');
  assert.equal(nonexistentExit.ok, false);
  assert.equal(nonexistentExit.reason, 'blocked');
  assert.equal(nonexistentExit.run.currentRoom, 1);
});

test('north from room 1 returns main-hall sentinel behavior', () => {
  const adventure = loadBeginnersCave();
  const run = createAdventureRun(adventure, 'character-1');
  const result = move(run, adventure, 'north');

  assert.equal(result.ok, true);
  assert.equal(result.destination, 'main-hall');
  assert.equal(result.from, 1);
  assert.equal(result.run.currentRoom, 1);
  assert.equal(result.run.status, 'leaving');
});

test('move rejects inactive runs without changing currentRoom', () => {
  const adventure = loadBeginnersCave();
  const run = createAdventureRun(adventure, 'character-1');
  const leaving = move(run, adventure, 'north').run;
  const result = move(leaving, adventure, 'south');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'inactive');
  assert.equal(result.run.currentRoom, 1);
  assert.equal(result.run.status, 'leaving');
  assert.match(result.text, /cannot move/i);
});

test('revisiting an existing room does not duplicate visitedRooms', () => {
  const adventure = loadBeginnersCave();
  const run = createAdventureRun(adventure, 'character-1');
  const room2 = move(run, adventure, 'south').run;
  const room1 = move(room2, adventure, 'north').run;

  assert.equal(room1.currentRoom, 1);
  assert.deepEqual(room1.visitedRooms, [1, 2]);
});

test('getVisibleRoomEntities in room 3 includes rat and diamonds initially', () => {
  const adventure = loadBeginnersCave();
  const run = room3Run(adventure);
  const visible = getVisibleRoomEntities(run, adventure);

  assert.deepEqual(visible.characters.map((character) => character.slug), ['rat']);
  assert.deepEqual(visible.placements.map((placement) => placement.item_slug), ['diamonds']);
});

test('getVisibleRoomEntities excludes hidden room placements by default', () => {
  const adventure = structuredClone(loadBeginnersCave());
  adventure.placements.push({ item_slug: 'hidden-test-item', room_number: 3, hidden: true });
  const visible = getVisibleRoomEntities(room3Run(adventure), adventure);

  assert.equal(visible.placements.some((placement) => placement.item_slug === 'hidden-test-item'), false);
});

test('after_defeating placement appears in defeated enemy room until collected', () => {
  const adventure = loadBeginnersCave();
  const run = roomRun(adventure, 26);

  assert.deepEqual(
    getVisibleRoomEntities(run, adventure).placements.map((placement) => placement.item_slug),
    ['jewels'],
  );

  const defeatedPirate = markEnemyDefeated(run, 'pirate');
  assert.deepEqual(
    getVisibleRoomEntities(defeatedPirate, adventure).placements.map((placement) => placement.item_slug),
    ['trollsfire', 'jewels'],
  );

  const collectedTrollsfire = markItemCollected(defeatedPirate, 'trollsfire');
  assert.deepEqual(
    getVisibleRoomEntities(collectedTrollsfire, adventure).placements.map((placement) => placement.item_slug),
    ['jewels'],
  );
});

test('after_defeating placements use defeated character location rooms', () => {
  const adventure = loadBeginnersCave();

  const defeatedHermit = markEnemyDefeated(roomRun(adventure, 5), 'hermit');
  assert.deepEqual(
    getVisibleRoomEntities(defeatedHermit, adventure).placements.map((placement) => placement.item_slug),
    ['axe', 'healing-potion'],
  );

  const defeatedHeinrich = markEnemyDefeated(roomRun(adventure, 6), 'heinrich');
  assert.deepEqual(
    getVisibleRoomEntities(defeatedHeinrich, adventure).placements.map((placement) => placement.item_slug),
    ['sword'],
  );
});

test('markEnemyDefeated rat removes rat from visible entities', () => {
  const adventure = loadBeginnersCave();
  const run = markEnemyDefeated(room3Run(adventure), 'rat');
  const visible = getVisibleRoomEntities(run, adventure);

  assert.deepEqual(visible.characters.map((character) => character.slug), []);
  assert.deepEqual(visible.placements.map((placement) => placement.item_slug), ['diamonds']);
});

test('markItemCollected diamonds removes diamonds placement', () => {
  const adventure = loadBeginnersCave();
  const run = markItemCollected(room3Run(adventure), 'diamonds');
  const visible = getVisibleRoomEntities(run, adventure);

  assert.deepEqual(visible.characters.map((character) => character.slug), ['rat']);
  assert.deepEqual(visible.placements.map((placement) => placement.item_slug), []);
});

test('markItemCollected and markEnemyDefeated are idempotent with no duplicate state', () => {
  const adventure = loadBeginnersCave();
  let run = room3Run(adventure);

  run = markItemCollected(run, 'diamonds');
  run = markItemCollected(run, 'diamonds');
  run = markEnemyDefeated(run, 'rat');
  run = markEnemyDefeated(run, 'rat');

  assert.deepEqual(run.collectedItems, ['diamonds']);
  assert.deepEqual(run.defeatedEnemies, ['rat']);
});
