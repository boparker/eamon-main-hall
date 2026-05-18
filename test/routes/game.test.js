import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createGameRouter } from '../../server/routes/game.js';

const beginner = {
  adventure: { id: 'beginners-cave', name: "The Beginner's Cave", start_room: 1 },
  locations: [
    {
      id: 'r1', room_number: 1, name: 'Entrance', narration_text: 'A cave mouth waits.',
      exits: { north: 'main-hall', south: 2, east: null, west: null, up: null, down: null },
      treasure: [], requires: null,
    },
    {
      id: 'r2', room_number: 2, name: 'Rat Room', narration_text: 'A rat guards a gem.',
      exits: { north: 1, south: null, east: null, west: null, up: null, down: null },
      treasure: [], requires: null,
    },
  ],
  characters: [
    { id: 'rat-1', slug: 'rat', name: 'Rat', type: 'enemy', friendliness: 'hostile', hp: 2, agility: 0, damage_dice: '1d1', location_room: 2, portrait_description: 'rat', current_hp_from: 'hp' },
  ],
  items: [
    { id: 'gem-1', slug: 'gem', name: 'Gem', type: 'treasure', value: 5, weight: 1 },
  ],
  placements: [
    { item_slug: 'gem', room_number: 2, hidden: false },
  ],
};

const advanced = {
  adventure: {
    id: 'dragon-castle',
    name: "The Dragon's Castle",
    description: 'A dangerous second adventure.',
    difficulty: 2,
    start_room: 1,
  },
  locations: [
    { id: 'd1', room_number: 1, name: 'Gatehouse', narration_text: 'A locked castle waits.', exits: { north: null, south: null, east: null, west: null, up: null, down: null }, treasure: [], requires: null },
  ],
  characters: [],
  items: [],
  placements: [],
};

function makeDeps(options = {}) {
  const players = new Map();
  const characters = new Map();
  const runs = new Map();
  const calls = [];

  return {
    calls,
    db: { ok: true },
    loadAdventures: () => options.adventures ?? [beginner],
    async upsertPlayer(_db, player) {
      const row = {
        id: player.id,
        display_name: player.displayName ?? null,
        auth_provider: player.authProvider ?? null,
        auth_subject: player.authSubject ?? null,
        email: player.email ?? null,
      };
      players.set(row.id, row);
      return row;
    },
    async listCharacters(_db, playerId) {
      return [...characters.values()].filter((character) => character.player_id === playerId);
    },
    async createCharacter(_db, input) {
      const row = {
        id: input.id ?? `char-${characters.size + 1}`,
        player_id: input.playerId,
        name: input.name,
        class: input.className,
        hardiness: input.hardiness,
        agility: input.agility,
        charisma: input.charisma,
        hd: input.hd,
        max_hd: input.maxHd,
        gold: input.gold ?? 0,
        bank_gold: input.bankGold ?? 0,
        inventory: input.inventory ?? [],
        equipment: input.equipment ?? {},
        adventures_completed: input.adventuresCompleted ?? [],
        is_alive: input.isAlive ?? true,
      };
      characters.set(row.id, row);
      return row;
    },
    async getCharacter(_db, playerId, characterId) {
      const row = characters.get(characterId);
      return row?.player_id === playerId ? row : null;
    },
    async updateCharacter(_db, playerId, characterId, patch) {
      calls.push({ type: 'updateCharacter', playerId, characterId, patch });
      const row = characters.get(characterId);
      if (!row || row.player_id !== playerId) return null;
      const updated = {
        ...row,
        hd: patch.hd ?? row.hd,
        gold: patch.gold ?? row.gold,
        inventory: patch.inventory ?? row.inventory,
        equipment: patch.equipment ?? row.equipment,
        is_alive: patch.isAlive ?? row.is_alive,
      };
      characters.set(characterId, updated);
      return updated;
    },
    async createAdventureRun(_db, input) {
      calls.push({ type: 'createRun', input });
      const row = {
        id: input.id ?? `run-${runs.size + 1}`,
        player_id: input.playerId,
        character_id: input.characterId,
        adventure_id: input.adventureId,
        current_room: input.currentRoom,
        room_state: input.roomState ?? {},
        enemy_state: input.enemyState ?? {},
        collected_items: input.collectedItems ?? [],
        discovered_items: input.discoveredItems ?? [],
        flags: input.flags ?? {},
        status: 'active',
      };
      runs.set(row.id, row);
      return row;
    },
    async getAdventureRun(_db, playerId, runId) {
      const row = runs.get(runId);
      return row?.player_id === playerId ? row : null;
    },
    async updateAdventureRun(_db, playerId, runId, patch) {
      calls.push({ type: 'updateRun', playerId, runId, patch });
      const row = runs.get(runId);
      if (!row || row.player_id !== playerId) return null;
      const updated = {
        ...row,
        current_room: patch.currentRoom ?? row.current_room,
        room_state: patch.roomState ?? row.room_state,
        enemy_state: patch.enemyState ?? row.enemy_state,
        collected_items: patch.collectedItems ?? row.collected_items,
        discovered_items: patch.discoveredItems ?? row.discovered_items,
        flags: patch.flags ?? row.flags,
        status: patch.status ?? row.status,
      };
      runs.set(runId, updated);
      return updated;
    },
    async completeAdventureRun(_db, playerId, runId) {
      const row = runs.get(runId);
      if (!row || row.player_id !== playerId) return null;
      const updated = { ...row, status: 'completed', completed_at: new Date().toISOString() };
      runs.set(runId, updated);
      return updated;
    },
    async abandonAdventureRun(_db, playerId, runId) {
      const row = runs.get(runId);
      if (!row || row.player_id !== playerId) return null;
      const updated = { ...row, status: 'abandoned', completed_at: new Date().toISOString() };
      runs.set(runId, updated);
      return updated;
    },
    rng: options.rng,
  };
}

async function request(app, method, path, body) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json();
    return { status: response.status, body: json };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeApp(deps = makeDeps()) {
  const app = express();
  app.use(express.json());
  app.use('/api/game', createGameRouter(deps));
  return { app, deps };
}

test('POST /api/game/bootstrap upserts player and returns adventure/character lists', async () => {
  const { app } = makeApp();
  const response = await request(app, 'POST', '/api/game/bootstrap', { playerId: 'local-player-1', displayName: 'Bo' });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.state.player.id, 'local-player-1');
  assert.equal(response.body.state.characters.length, 0);
  assert.equal(response.body.state.adventures[0].id, 'beginners-cave');
});

test('POST /api/game/bootstrap returns Great Hall with create/account choices and no adventure start when no character exists', async () => {
  const { app, deps } = makeApp(makeDeps({ adventures: [beginner, advanced] }));
  const response = await request(app, 'POST', '/api/game/bootstrap', { playerId: 'local-player-1', displayName: 'Bo' });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.intent.type, 'hall');
  assert.equal(response.body.events[0].type, 'enter_hall');
  assert.equal(response.body.state.phase, 'great-hall');
  assert.match(response.body.text, /Great Hall/i);
  assert.equal(response.body.state.character, null);
  assert.equal(response.body.choices.some((choice) => /create character/i.test(choice)), true);
  assert.equal(response.body.choices.some((choice) => /account|register/i.test(choice)), true);
  assert.equal(response.body.choices.some((choice) => /begin|start/i.test(choice)), false);
  assert.deepEqual(response.body.state.unlockedAdventures.map((adventure) => adventure.id), ['beginners-cave']);
  assert.deepEqual(response.body.state.lockedAdventures.map((adventure) => adventure.id), ['dragon-castle']);
  assert.equal(deps.calls.some((call) => call.type === 'createRun'), false);
});

test('POST /api/game/bootstrap returns Great Hall with existing character, shop choices, and locked later adventures', async () => {
  const { app } = makeApp(makeDeps({ adventures: [beginner, advanced] }));
  const character = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Mara', className: 'rogue', hardiness: 10, agility: 12, charisma: 7, gold: 80,
  });

  const response = await request(app, 'POST', '/api/game/bootstrap', { playerId: 'p1' });

  assert.equal(response.status, 200);
  assert.equal(response.body.state.phase, 'great-hall');
  assert.equal(response.body.state.character.id, character.body.state.character.id);
  assert.equal(response.body.state.character.className, 'rogue');
  assert.equal(response.body.choices.some((choice) => /create character/i.test(choice)), true);
  assert.equal(response.body.choices.some((choice) => /account|register/i.test(choice)), true);
  assert.equal(response.body.choices.some((choice) => /weapon|shop/i.test(choice)), true);
  assert.equal(response.body.choices.some((choice) => /armor|equipment/i.test(choice)), true);
  assert.equal(response.body.choices.some((choice) => /begin beginner/i.test(choice)), true);
  assert.deepEqual(response.body.state.unlockedAdventures.map((adventure) => adventure.id), ['beginners-cave']);
  assert.deepEqual(response.body.state.lockedAdventures.map((adventure) => adventure.id), ['dragon-castle']);
  assert.match(response.body.text, /Mara/);
  assert.match(response.body.text, /gold/i);
});

test('POST /api/game/characters returns to Great Hall and preserves explicit class/stats without auto-starting', async () => {
  const { app, deps } = makeApp(makeDeps({ adventures: [beginner, advanced] }));
  const created = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Cedric', className: 'mystic', hardiness: 8, agility: 9, charisma: 13, hd: 8, maxHd: 8, gold: 75,
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.state.phase, 'great-hall');
  assert.equal(created.body.state.character.className, 'mystic');
  assert.equal(created.body.state.character.charisma, 13);
  assert.equal(created.body.state.character.gold, 75);
  assert.equal(created.body.choices.some((choice) => /begin beginner/i.test(choice)), true);
  assert.equal(deps.calls.some((call) => call.type === 'createRun'), false);
});

test('POST /api/game/hall buys equipment server-side and blocks invalid or unaffordable purchases', async () => {
  const { app } = makeApp(makeDeps({ adventures: [beginner, advanced] }));
  const created = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Mara', className: 'rogue', hardiness: 10, agility: 12, charisma: 7, gold: 80,
  });
  const characterId = created.body.state.character.id;

  const shop = await request(app, 'POST', '/api/game/hall', {
    playerId: 'p1', characterId, input: 'visit weapons shop',
  });
  assert.equal(shop.status, 200);
  assert.match(shop.body.text, /Short Sword/);
  assert.equal(shop.body.choices.some((choice) => /buy short sword/i.test(choice)), true);

  const equipment = await request(app, 'POST', '/api/game/hall', {
    playerId: 'p1', characterId, input: 'view equipment',
  });
  assert.equal(equipment.status, 200);
  assert.match(equipment.body.text, /Equipment/i);
  assert.doesNotMatch(equipment.body.text, /Short Sword.*30 gold/);

  const bought = await request(app, 'POST', '/api/game/hall', {
    playerId: 'p1', characterId, input: 'buy short sword',
  });
  assert.equal(bought.status, 200);
  assert.equal(bought.body.state.phase, 'great-hall');
  assert.equal(bought.body.state.character.gold, 50);
  assert.equal(bought.body.state.character.inventory.some((item) => item.slug === 'short-sword'), true);
  assert.equal(bought.body.state.character.equipment.weapon.slug, 'short-sword');

  const duplicate = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId, input: 'buy short sword' });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.text, /already own|already have/i);

  const invalid = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId, input: 'buy moon blade' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.ok, false);

  const unaffordable = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId, input: 'buy plate armor' });
  assert.equal(unaffordable.status, 409);
  assert.match(unaffordable.body.text, /not enough|insufficient/i);
});

test('Beginner completion unlocks later adventure metadata in Great Hall', async () => {
  const { app } = makeApp(makeDeps({ adventures: [beginner, advanced] }));
  const created = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Mara', className: 'rogue', hardiness: 10, agility: 12, charisma: 7, adventuresCompleted: ['beginners-cave'],
  });

  const response = await request(app, 'POST', '/api/game/bootstrap', { playerId: 'p1' });

  assert.equal(created.status, 201);
  assert.deepEqual(response.body.state.unlockedAdventures.map((adventure) => adventure.id), ['beginners-cave', 'dragon-castle']);
  assert.deepEqual(response.body.state.lockedAdventures, []);
});

test('POST and GET /api/game/characters create and list player-owned characters', async () => {
  const { app } = makeApp();

  const created = await request(app, 'POST', '/api/game/characters', {
    playerId: 'local-player-1', name: 'Cedric', className: 'warrior', hardiness: 12, agility: 9, charisma: 8,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.state.character.name, 'Cedric');
  assert.equal(created.body.state.character.hd, 12);

  const listed = await request(app, 'GET', '/api/game/characters?playerId=local-player-1');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.state.characters.length, 1);
  assert.equal(listed.body.state.characters[0].id, created.body.state.character.id);
});

test('POST /api/game/start-adventure creates persistent run and renders starting room', async () => {
  const { app } = makeApp();
  const character = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Mara', className: 'rogue', hardiness: 10, agility: 12, charisma: 7,
  });

  const started = await request(app, 'POST', '/api/game/start-adventure', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureId: 'beginners-cave',
  });

  assert.equal(started.status, 201);
  assert.equal(started.body.state.run.currentRoom, 1);
  assert.match(started.body.text, /Entrance/);
  assert.deepEqual(started.body.choices, ['north', 'south']);
});

test('POST /api/game/command handles movement deterministically and persists run state', async () => {
  const { app, deps } = makeApp();
  const character = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Mara', className: 'rogue', hardiness: 10, agility: 12, charisma: 7,
  });
  const started = await request(app, 'POST', '/api/game/start-adventure', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureId: 'beginners-cave',
  });

  const moved = await request(app, 'POST', '/api/game/command', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureRunId: started.body.state.run.id, input: 'go south',
  });

  assert.equal(moved.status, 200);
  assert.equal(moved.body.intent.type, 'move');
  assert.equal(moved.body.events[0].type, 'move');
  assert.equal(moved.body.state.phase, 'adventure');
  assert.equal(moved.body.state.adventureRun.currentRoom, 2);
  assert.deepEqual(moved.body.media, { voice: null, background: null, portraits: [] });
  assert.match(moved.body.text, /Rat Room/);
  assert.equal(deps.calls.some((call) => call.type === 'updateRun' && call.patch.currentRoom === 2), true);
});

test('POST /api/game/command handles take, inventory, and return-to-hall without AI tags', async () => {
  const { app } = makeApp();
  const character = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Mara', className: 'rogue', hardiness: 10, agility: 12, charisma: 7,
  });
  const started = await request(app, 'POST', '/api/game/start-adventure', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureId: 'beginners-cave',
  });
  await request(app, 'POST', '/api/game/command', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureRunId: started.body.state.run.id, input: 'south',
  });

  const take = await request(app, 'POST', '/api/game/command', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureRunId: started.body.state.run.id, input: 'take gem',
  });
  assert.equal(take.status, 200);
  assert.equal(take.body.state.character.inventory[0].slug, 'gem');
  assert.doesNotMatch(take.body.text, /\[[A-Za-z_-]+(?::[^\]]*)?\]/);

  const inventory = await request(app, 'POST', '/api/game/command', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureRunId: started.body.state.run.id, input: 'inventory',
  });
  assert.match(inventory.body.text, /Gem/);

  await request(app, 'POST', '/api/game/command', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureRunId: started.body.state.run.id, input: 'north',
  });
  const leave = await request(app, 'POST', '/api/game/command', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureRunId: started.body.state.run.id, input: 'north',
  });

  assert.equal(leave.status, 200);
  assert.equal(leave.body.intent.type, 'move');
  assert.equal(leave.body.events[0].type, 'return_to_hall');
  assert.equal(leave.body.state.character.gold, 5);
  assert.equal(leave.body.state.adventureRun.status, 'completed');
  assert.equal(leave.body.state.phase, 'great-hall');
  assert.equal(leave.body.state.unlockedAdventures.some((adventure) => adventure.id === 'beginners-cave'), true);
  assert.equal(leave.body.choices.some((choice) => /shop|begin|character/i.test(choice)), true);
});

test('POST /api/game/command abandon returns full Great Hall response', async () => {
  const { app } = makeApp();
  const character = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Mara', className: 'rogue', hardiness: 10, agility: 12, charisma: 7,
  });
  const started = await request(app, 'POST', '/api/game/start-adventure', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureId: 'beginners-cave',
  });

  const abandon = await request(app, 'POST', '/api/game/command', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureRunId: started.body.state.run.id, input: 'leave',
  });

  assert.equal(abandon.status, 200);
  assert.equal(abandon.body.state.phase, 'great-hall');
  assert.equal(abandon.body.state.adventureRun.status, 'abandoned');
  assert.equal(abandon.body.choices.some((choice) => /shop|begin|character/i.test(choice)), true);
});

test('POST /api/game/command returns clear errors for bad ownership or unknown commands', async () => {
  const { app } = makeApp();
  const missing = await request(app, 'POST', '/api/game/command', {
    playerId: 'p1', characterId: 'missing', adventureRunId: 'missing', input: 'dance wildly',
  });

  assert.equal(missing.status, 404);
  assert.equal(missing.body.ok, false);

  const character = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Mara', className: 'rogue', hardiness: 10, agility: 12, charisma: 7,
  });
  const started = await request(app, 'POST', '/api/game/start-adventure', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureId: 'beginners-cave',
  });
  const unknown = await request(app, 'POST', '/api/game/command', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureRunId: started.body.state.run.id, input: 'dance wildly',
  });

  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.events[0].type, 'unknown');
  assert.match(unknown.body.text, /did not understand/i);
});

test('POST /api/game/command rejects mutation after run is completed', async () => {
  const { app, deps } = makeApp();
  const character = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Mara', className: 'rogue', hardiness: 10, agility: 12, charisma: 7,
  });
  const started = await request(app, 'POST', '/api/game/start-adventure', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureId: 'beginners-cave',
  });
  await request(app, 'POST', '/api/game/command', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureRunId: started.body.state.adventureRun.id, input: 'north',
  });
  const beforeCalls = deps.calls.length;

  const stale = await request(app, 'POST', '/api/game/command', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureRunId: started.body.state.adventureRun.id, input: 'south',
  });

  assert.equal(stale.status, 409);
  assert.equal(stale.body.ok, false);
  assert.match(stale.body.text, /no longer active/i);
  assert.equal(deps.calls.length, beforeCalls);
});

test('POST /api/game/command marks dead characters and runs terminal', async () => {
  const { app } = makeApp(makeDeps({ rng: () => 0.99 }));
  const character = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Mara', className: 'rogue', hardiness: 1, agility: 0, charisma: 7, hd: 1, maxHd: 1,
  });
  const started = await request(app, 'POST', '/api/game/start-adventure', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureId: 'beginners-cave',
  });
  await request(app, 'POST', '/api/game/command', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureRunId: started.body.state.adventureRun.id, input: 'south',
  });

  const combat = await request(app, 'POST', '/api/game/command', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureRunId: started.body.state.adventureRun.id, input: 'attack rat',
  });

  assert.equal(combat.status, 200);
  assert.equal(combat.body.events.some((event) => event.type === 'character_defeated'), true);
  assert.equal(combat.body.state.character.isAlive, false);
  assert.equal(combat.body.state.adventureRun.status, 'dead');
  assert.equal(combat.body.state.phase, 'main-hall');

  const afterDeath = await request(app, 'POST', '/api/game/command', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureRunId: started.body.state.adventureRun.id, input: 'take gem',
  });
  assert.equal(afterDeath.status, 409);
  assert.match(afterDeath.body.text, /dead|defeated/i);
});

test('POST /api/game/start-adventure rejects dead characters', async () => {
  const { app } = makeApp();
  const character = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Mara', className: 'rogue', hardiness: 0, agility: 12, charisma: 7, hd: 0, maxHd: 1,
  });

  const started = await request(app, 'POST', '/api/game/start-adventure', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureId: 'beginners-cave',
  });

  assert.equal(started.status, 409);
  assert.match(started.body.text, /dead|defeated/i);
});
