import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAdventureFromFile } from '../../server/content/loadAdventure.js';
import {
  createAdventureRun,
  getVisibleRoomEntities,
  dispositionOf,
  getCompanions,
  recordEncounter,
  recruitCompanion,
  setCompanionHp,
  removeCompanion,
} from '../../server/engine/adventures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = resolve(__dirname, '../../data/adventures/beginners-cave.json');

function runAt(adventure, room) {
  return { ...createAdventureRun(adventure, 'c1'), currentRoom: room, flags: {} };
}
function npc(adventure, slug) {
  return adventure.characters.find((c) => c.slug === slug);
}

test('recruitCompanion / setCompanionHp / removeCompanion manage the party in flags', () => {
  const adventure = loadAdventureFromFile(manifest);
  let run = runAt(adventure, 18);
  run = recruitCompanion(run, { slug: 'cynthia', hp: 5 });
  assert.deepEqual(getCompanions(run), [{ slug: 'cynthia', hp: 5, maxHp: 5 }]);
  run = recruitCompanion(run, { slug: 'cynthia', hp: 5 }); // idempotent
  assert.equal(getCompanions(run).length, 1);
  run = setCompanionHp(run, 'cynthia', 2);
  assert.equal(getCompanions(run)[0].hp, 2);
  run = removeCompanion(run, 'cynthia');
  assert.deepEqual(getCompanions(run), []);
  assert.deepEqual(run.flags.fallenCompanions, ['cynthia']);
});

test('a recruited companion travels into other rooms as a following NPC', () => {
  const adventure = loadAdventureFromFile(manifest);
  let run = runAt(adventure, 18);
  run = recruitCompanion(run, { slug: 'cynthia', hp: 5 });
  // Move the player to room 3 (where Cynthia is NOT natively located).
  run = { ...run, currentRoom: 3 };
  const entities = getVisibleRoomEntities(run, adventure);
  const cyn = entities.characters.find((c) => c.slug === 'cynthia');
  assert.ok(cyn, 'Cynthia should appear in the room she is escorted into');
  assert.equal(cyn.following, true);
  assert.equal(cyn.companion, true);
  assert.equal(cyn.disposition, 'friendly');
});

test('a recruited companion is not double-listed in their home room', () => {
  const adventure = loadAdventureFromFile(manifest);
  let run = runAt(adventure, 18); // Cynthia's home room
  run = recruitCompanion(run, { slug: 'cynthia', hp: 5 });
  const cyns = getVisibleRoomEntities(run, adventure).characters.filter((c) => c.slug === 'cynthia');
  assert.equal(cyns.length, 1);
  assert.equal(cyns[0].following, true);
});

test('dispositionOf honours a recorded random-encounter outcome', () => {
  const adventure = loadAdventureFromFile(manifest);
  const hermit = npc(adventure, 'hermit');
  let run = runAt(adventure, 5);
  assert.equal(dispositionOf(hermit, run), 'neutral'); // unrolled
  run = recordEncounter(run, 'hermit', 'foe');
  assert.equal(dispositionOf(hermit, run), 'hostile');
  run = recordEncounter(run, 'hermit', 'friend');
  assert.equal(dispositionOf(hermit, run), 'friendly');
});

test('a foe-rolled hermit is annotated hostile in the room entities', () => {
  const adventure = loadAdventureFromFile(manifest);
  let run = runAt(adventure, 5); // hermit's room
  run = recordEncounter(run, 'hermit', 'foe');
  const hermit = getVisibleRoomEntities(run, adventure).characters.find((c) => c.slug === 'hermit');
  assert.equal(hermit.disposition, 'hostile');
});

test('freeDefeatedCaptives recruits a captive whose captor is already dead (repairs old saves)', async () => {
  const { freeDefeatedCaptives } = await import('../../server/engine/adventures.js');
  const adventure = loadAdventureFromFile(manifest);
  // Priest already slain, Cynthia never recruited, player standing in the temple (18).
  let run = { ...runAt(adventure, 18), defeatedEnemies: ['priest'] };
  assert.equal(getCompanions(run).length, 0);
  const out = freeDefeatedCaptives(run, adventure);
  assert.deepEqual(out.freed, ['cynthia']);
  assert.ok(getCompanions(out.run).some((c) => c.slug === 'cynthia'));
});

test('freeDefeatedCaptives does nothing if the captor still lives or you are elsewhere', async () => {
  const { freeDefeatedCaptives } = await import('../../server/engine/adventures.js');
  const adventure = loadAdventureFromFile(manifest);
  // Captor alive
  assert.deepEqual(freeDefeatedCaptives({ ...runAt(adventure, 18), defeatedEnemies: [] }, adventure).freed, []);
  // Captor dead but player not in Cynthia's room
  assert.deepEqual(freeDefeatedCaptives({ ...runAt(adventure, 3), defeatedEnemies: ['priest'] }, adventure).freed, []);
});
