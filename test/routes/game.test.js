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
    { id: 'hermit-1', slug: 'hermit', name: 'Hermit', type: 'npc', friendliness: 'friendly', hp: 5, agility: 1, location_room: 2, portrait_description: 'hermit', dialogue: 'The hermit nods toward the darkness and keeps his counsel.' },
  ],
  items: [
    { id: 'gem-1', slug: 'gem', name: 'Gem', type: 'treasure', value: 5, weight: 1 },
    { id: 'inscription-1', slug: 'inscription', name: 'inscription', type: 'misc', description: 'An inscription reads: "Original tutorial text."', value: 0, weight: -999, collectible: false },
  ],
  placements: [
    { item_slug: 'gem', room_number: 2, hidden: false },
    { item_slug: 'inscription', room_number: 2, hidden: false },
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
    async listCharacters(_db, owner) {
      if (typeof owner === 'object') {
        return [...characters.values()].filter((character) => character.user_id === owner.userId && character.profile_id === owner.profileId);
      }
      return [...characters.values()].filter((character) => character.player_id === owner);
    },
    async createCharacter(_db, input) {
      const row = {
        id: input.id ?? `char-${characters.size + 1}`,
        player_id: input.playerId,
        user_id: input.userId ?? null,
        profile_id: input.profileId ?? null,
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
    async getCharacter(_db, owner, characterId) {
      const row = characters.get(characterId);
      if (typeof owner === 'object') return row?.user_id === owner.userId && row?.profile_id === owner.profileId ? row : null;
      return row?.player_id === owner ? row : null;
    },
    async updateCharacter(_db, owner, characterId, patch) {
      calls.push({ type: 'updateCharacter', owner, characterId, patch });
      const row = characters.get(characterId);
      const owns = typeof owner === 'object'
        ? row?.user_id === owner.userId && row?.profile_id === owner.profileId
        : row?.player_id === owner;
      if (!row || !owns) return null;
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
        user_id: input.userId ?? null,
        profile_id: input.profileId ?? null,
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
    async getAdventureRun(_db, owner, runId) {
      const row = runs.get(runId);
      if (typeof owner === 'object') return row?.player_id === owner.playerId && row?.user_id === owner.userId && row?.profile_id === owner.profileId ? row : null;
      return row?.player_id === owner ? row : null;
    },
    async getActiveAdventureRunForCharacter(_db, owner, characterId) {
      const rows = [...runs.values()].filter((row) => row.character_id === characterId && row.status === 'active');
      const row = rows.at(-1);
      if (typeof owner === 'object') return row?.player_id === owner.playerId && row?.user_id === owner.userId && row?.profile_id === owner.profileId ? row : null;
      return row?.player_id === owner ? row : null;
    },
    async updateAdventureRun(_db, owner, runId, patch) {
      calls.push({ type: 'updateRun', owner, runId, patch });
      const row = runs.get(runId);
      const owns = typeof owner === 'object'
        ? row?.player_id === owner.playerId && row?.user_id === owner.userId && row?.profile_id === owner.profileId
        : row?.player_id === owner;
      if (!row || !owns) return null;
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
    async completeAdventureRun(_db, owner, runId) {
      calls.push({ type: 'completeRun', owner, runId });
      const row = runs.get(runId);
      const owns = typeof owner === 'object'
        ? row?.player_id === owner.playerId && row?.user_id === owner.userId && row?.profile_id === owner.profileId
        : row?.player_id === owner;
      if (!row || !owns) return null;
      const updated = { ...row, status: 'completed', completed_at: new Date().toISOString() };
      runs.set(runId, updated);
      return updated;
    },
    async abandonAdventureRun(_db, owner, runId) {
      calls.push({ type: 'abandonRun', owner, runId });
      const row = runs.get(runId);
      const owns = typeof owner === 'object'
        ? row?.player_id === owner.playerId && row?.user_id === owner.userId && row?.profile_id === owner.profileId
        : row?.player_id === owner;
      if (!row || !owns) return null;
      const updated = { ...row, status: 'abandoned', completed_at: new Date().toISOString() };
      runs.set(runId, updated);
      return updated;
    },
    rng: options.rng,
    hashSessionToken: (token) => `sha256$${token}`,
    async getUserBySessionTokenHash(_db, tokenHash) {
      calls.push({ type: 'getUserBySessionTokenHash', tokenHash });
      if (tokenHash === 'sha256$raw-session-token') return { id: 'user-1', username: 'bo', display_name: 'Bo' };
      return null;
    },
  };
}

async function request(app, method, path, body, headers = {}) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
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

const accountHeaders = { authorization: 'Bearer raw-session-token' };

async function createAccountCharacter(app, input = {}) {
  return request(app, 'POST', '/api/game/characters', {
    profileId: 'profile-1',
    name: 'Mara',
    className: 'rogue',
    hardiness: 10,
    agility: 12,
    charisma: 7,
    ...input,
  }, accountHeaders);
}

async function startAccountAdventure(app, characterId, input = {}) {
  return request(app, 'POST', '/api/game/start-adventure', {
    profileId: 'profile-1',
    characterId,
    adventureId: 'beginners-cave',
    ...input,
  }, accountHeaders);
}

function accountCommand(app, characterId, adventureRunId, input, body = {}) {
  return request(app, 'POST', '/api/game/command', {
    profileId: 'profile-1',
    characterId,
    adventureRunId,
    input,
    ...body,
  }, accountHeaders);
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
  assert.equal(response.body.text.startsWith('You stand in the Great Hall.'), true);
  assert.equal(response.body.state.character, null);
  assert.equal(response.body.choices.some((choice) => /create character/i.test(choice)), true);
  assert.equal(response.body.choices.some((choice) => /guild rolls/i.test(choice)), true);
  assert.equal(response.body.choices.some((choice) => /begin|start/i.test(choice)), false);
  assert.deepEqual(response.body.state.unlockedAdventures.map((adventure) => adventure.id), ['beginners-cave']);
  assert.deepEqual(response.body.state.lockedAdventures.map((adventure) => adventure.id), ['dragon-castle']);
  assert.equal(deps.calls.some((call) => call.type === 'createRun'), false);
});

test('POST /api/game/bootstrap omits player-name salutation when no display name is known', async () => {
  const { app } = makeApp(makeDeps({ adventures: [beginner, advanced] }));
  const response = await request(app, 'POST', '/api/game/bootstrap', { playerId: 'local-player-1' });

  assert.equal(response.status, 200);
  assert.equal(response.body.text.startsWith('You stand in the Great Hall.'), true);
  assert.doesNotMatch(response.body.text.split('\n')[0], /local-player-1|adventurer|wanderer/i);
});

test('authenticated game bootstrap uses profile ownership without requiring a guest player id', async () => {
  const { app } = makeApp(makeDeps({ adventures: [beginner, advanced] }));
  const headers = { authorization: 'Bearer raw-session-token' };

  const created = await request(app, 'POST', '/api/game/characters', {
    profileId: 'profile-1', name: 'Account Mara', className: 'adventurer', hardiness: 15, agility: 12, charisma: 15, gold: 200,
  }, headers);
  const response = await request(app, 'POST', '/api/game/bootstrap', { profileId: 'profile-1' }, headers);

  assert.equal(created.status, 201);
  assert.equal(response.status, 200);
  assert.equal(response.body.state.player.id, 'account:user-1');
  assert.equal(response.body.state.character.id, created.body.state.character.id);
  assert.equal(response.body.state.character.playerId, 'account:user-1');
  assert.equal(response.body.state.character.userId, 'user-1');
  assert.equal(response.body.state.character.profileId, 'profile-1');
});

test('authenticated character list is scoped to the requested profile', async () => {
  const { app } = makeApp(makeDeps({ adventures: [beginner, advanced] }));
  const headers = { authorization: 'Bearer raw-session-token' };

  await request(app, 'POST', '/api/game/characters', { profileId: 'profile-1', name: 'One', className: 'adventurer' }, headers);
  await request(app, 'POST', '/api/game/characters', { profileId: 'profile-2', name: 'Two', className: 'adventurer' }, headers);

  const response = await request(app, 'GET', '/api/game/characters?profileId=profile-1', null, headers);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.state.characters.map((character) => character.name), ['One']);
});

test('POST /api/game/bootstrap returns Great Hall with existing character, shop choices, and locked later adventures', async () => {
  const { app } = makeApp(makeDeps({ adventures: [beginner, advanced] }));
  const character = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Mara', className: 'rogue', hardiness: 10, agility: 12, charisma: 7, gold: 80,
  });

  const response = await request(app, 'POST', '/api/game/bootstrap', { playerId: 'p1' });

  assert.equal(response.status, 200);
  assert.equal(response.body.state.phase, 'great-hall');
  assert.equal(response.body.state.locationTitle, 'The Great Hall');
  assert.equal(response.body.state.character.id, character.body.state.character.id);
  assert.equal(response.body.state.character.className, 'rogue');
  assert.equal(response.body.choices.some((choice) => /create character/i.test(choice)), true);
  assert.equal(response.body.choices.some((choice) => /guild rolls/i.test(choice)), true);
  assert.equal(response.body.choices.some((choice) => /weapon|shop/i.test(choice)), true);
  assert.equal(response.body.choices.some((choice) => /armor|equipment/i.test(choice)), true);
  assert.equal(response.body.choices.some((choice) => /begin beginner/i.test(choice)), true);
  assert.deepEqual(response.body.state.unlockedAdventures.map((adventure) => adventure.id), ['beginners-cave']);
  assert.deepEqual(response.body.state.lockedAdventures.map((adventure) => adventure.id), ['dragon-castle']);
  assert.match(response.body.text, /Mara/);
  assert.doesNotMatch(response.body.text, /Inventory summary|Use View Equipment|HUD|shop for weapons|explicitly begin/i);
  assert.doesNotMatch(response.body.text, /HD \d+\/\d+/i);
  assert.doesNotMatch(response.body.text, /Hardiness|Agility|Charisma|Gold \d+|Bank \d+|Equipment: \{/i);
});

test('POST /api/game/characters returns to Great Hall and preserves explicit class/stats without auto-starting', async () => {
  const { app, deps } = makeApp(makeDeps({ adventures: [beginner, advanced] }));
  const created = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Cedric', className: 'mystic', hardiness: 8, agility: 9, charisma: 13, hd: 8, maxHd: 8, gold: 75,
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.state.phase, 'great-hall');
  assert.equal(created.body.state.locationTitle, 'The Great Hall');
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
  assert.equal(shop.body.state.locationTitle, "Marcos Cavielli's Weapon Shop");
  assert.equal(shop.body.state.shop.title, "Marcos Cavielli's Weapon Shop");
  assert.equal(shop.body.state.shop.section, 'Weapons');
  assert.match(shop.body.text, /• Short Sword — 30 gold/);
  assert.equal(shop.body.choices.some((choice) => /buy short sword/i.test(choice)), true);

  const equipment = await request(app, 'POST', '/api/game/hall', {
    playerId: 'p1', characterId, input: 'view equipment',
  });
  assert.equal(equipment.status, 200);
  assert.match(equipment.body.text, /Equipment/i);
  assert.match(equipment.body.text, /• Weapon: unarmed/);
  assert.match(equipment.body.text, /Inventory:\n• none/);
  assert.doesNotMatch(equipment.body.text, /Short Sword.*30 gold/);

  const bought = await request(app, 'POST', '/api/game/hall', {
    playerId: 'p1', characterId, input: 'buy short sword',
  });
  assert.equal(bought.status, 200);
  assert.equal(bought.body.state.phase, 'great-hall');
  assert.equal(bought.body.state.locationTitle, 'The Great Hall');
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

test('authenticated POST /api/game/hall uses account profile ownership without requiring playerId', async () => {
  const { app } = makeApp(makeDeps({ adventures: [beginner, advanced] }));
  const created = await createAccountCharacter(app, { name: 'Account Mara', gold: 80 });
  const characterId = created.body.state.character.id;

  const shop = await request(app, 'POST', '/api/game/hall', {
    profileId: 'profile-1', characterId, input: 'visit weapons shop',
  }, accountHeaders);
  assert.equal(shop.status, 200);
  assert.equal(shop.body.state.locationTitle, "Marcos Cavielli's Weapon Shop");
  assert.match(shop.body.text, /Short Sword/);

  const bought = await request(app, 'POST', '/api/game/hall', {
    profileId: 'profile-1', characterId, input: 'buy short sword',
  }, accountHeaders);
  assert.equal(bought.status, 200);
  assert.equal(bought.body.state.character.userId, 'user-1');
  assert.equal(bought.body.state.character.profileId, 'profile-1');
  assert.equal(bought.body.state.character.gold, 50);
  assert.equal(bought.body.state.character.equipment.weapon.slug, 'short-sword');
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

test('authenticated start-adventure scopes character lookup to the requested profile', async () => {
  const { app } = makeApp(makeDeps({ adventures: [beginner, advanced] }));
  const headers = { authorization: 'Bearer raw-session-token' };

  const created = await request(app, 'POST', '/api/game/characters', {
    profileId: 'profile-1', name: 'Profile Hero', className: 'adventurer', hardiness: 15, agility: 12, charisma: 15,
  }, headers);
  const blocked = await request(app, 'POST', '/api/game/start-adventure', {
    profileId: 'profile-2', characterId: created.body.state.character.id, adventureId: 'beginners-cave',
  }, headers);
  const started = await request(app, 'POST', '/api/game/start-adventure', {
    profileId: 'profile-1', characterId: created.body.state.character.id, adventureId: 'beginners-cave',
  }, headers);

  assert.equal(blocked.status, 404);
  assert.equal(started.status, 201);
  assert.equal(started.body.state.character.userId, 'user-1');
  assert.equal(started.body.state.character.profileId, 'profile-1');
  assert.equal(started.body.state.adventureRun.playerId, 'account:user-1');
});

test('guest characters must be preserved to an account before starting Beginner\'s Cave', async () => {
  const { app, deps } = makeApp();
  const character = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Mara', className: 'rogue', hardiness: 10, agility: 12, charisma: 7,
  });

  const started = await request(app, 'POST', '/api/game/start-adventure', {
    playerId: 'p1', characterId: character.body.state.character.id, adventureId: 'beginners-cave',
  });

  assert.equal(started.status, 403);
  assert.equal(started.body.error, 'account-required');
  assert.match(started.body.text, /preserve.*adventurer|account/i);
  assert.equal(deps.calls.some((call) => call.type === 'createRun'), false);
});

test('POST /api/game/start-adventure creates persistent run and renders starting room for account characters', async () => {
  const { app } = makeApp();
  const headers = { authorization: 'Bearer raw-session-token' };
  const character = await request(app, 'POST', '/api/game/characters', {
    profileId: 'profile-1', name: 'Mara', className: 'rogue', hardiness: 10, agility: 12, charisma: 7,
  }, headers);

  const started = await request(app, 'POST', '/api/game/start-adventure', {
    profileId: 'profile-1', characterId: character.body.state.character.id, adventureId: 'beginners-cave',
  }, headers);

  assert.equal(started.status, 201);
  assert.equal(started.body.state.run.currentRoom, 1);
  assert.match(started.body.text, /Entrance/);
  assert.deepEqual(started.body.choices, ['north', 'south']);
});

test('POST /api/game/start-adventure resumes an existing active run instead of crashing on duplicate active run', async () => {
  const { app, deps } = makeApp();
  const headers = { authorization: 'Bearer raw-session-token' };
  const character = await request(app, 'POST', '/api/game/characters', {
    profileId: 'profile-1', name: 'Mara', className: 'rogue', hardiness: 10, agility: 12, charisma: 7,
  }, headers);

  const started = await request(app, 'POST', '/api/game/start-adventure', {
    profileId: 'profile-1', characterId: character.body.state.character.id, adventureId: 'beginners-cave',
  }, headers);
  const resumed = await request(app, 'POST', '/api/game/start-adventure', {
    profileId: 'profile-1', characterId: character.body.state.character.id, adventureId: 'beginners-cave',
  }, headers);

  assert.equal(started.status, 201);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.event.type, 'resume_adventure');
  assert.equal(resumed.body.state.adventureRun.id, started.body.state.adventureRun.id);
  assert.equal(resumed.body.state.locationTitle, 'Entrance');
  assert.equal(deps.calls.filter((call) => call.type === 'createRun').length, 1);
});

test('authenticated command scopes character and run mutations to the requested profile', async () => {
  const { app, deps } = makeApp(makeDeps({ adventures: [beginner, advanced] }));
  const headers = { authorization: 'Bearer raw-session-token' };

  const created = await request(app, 'POST', '/api/game/characters', {
    profileId: 'profile-1', name: 'Command Hero', className: 'adventurer', hardiness: 15, agility: 12, charisma: 15,
  }, headers);
  const started = await request(app, 'POST', '/api/game/start-adventure', {
    profileId: 'profile-1', characterId: created.body.state.character.id, adventureId: 'beginners-cave',
  }, headers);

  const blocked = await request(app, 'POST', '/api/game/command', {
    profileId: 'profile-2', characterId: created.body.state.character.id, adventureRunId: started.body.state.adventureRun.id, input: 'south',
  }, headers);
  const moved = await request(app, 'POST', '/api/game/command', {
    profileId: 'profile-1', characterId: created.body.state.character.id, adventureRunId: started.body.state.adventureRun.id, input: 'south',
  }, headers);

  assert.equal(blocked.status, 404);
  assert.equal(moved.status, 200);
  assert.equal(moved.body.state.adventureRun.currentRoom, 2);
  assert.equal(moved.body.state.character.userId, 'user-1');
  assert.equal(moved.body.state.character.profileId, 'profile-1');
  assert.deepEqual(deps.calls.findLast((call) => call.type === 'updateRun').owner, { playerId: 'account:user-1', userId: 'user-1', profileId: 'profile-1' });
});

test('POST /api/game/command handles movement deterministically and persists run state', async () => {
  const { app, deps } = makeApp();
  const character = await createAccountCharacter(app);
  const started = await startAccountAdventure(app, character.body.state.character.id);

  const moved = await accountCommand(app, character.body.state.character.id, started.body.state.run.id, 'go south');

  assert.equal(moved.status, 200);
  assert.equal(moved.body.intent.type, 'move');
  assert.equal(moved.body.events[0].type, 'move');
  assert.equal(moved.body.state.phase, 'adventure');
  assert.equal(moved.body.state.adventureRun.currentRoom, 2);
  assert.deepEqual(moved.body.media, { voice: null, background: null, portraits: [] });
  assert.match(moved.body.text, /Rat Room/);
  assert.deepEqual(moved.body.choices, ['north', 'take Gem', 'read inscription', 'attack Rat', 'talk Hermit']);
  assert.equal(deps.calls.some((call) => call.type === 'updateRun' && call.patch.currentRoom === 2), true);
});

test('POST /api/game/command handles take, inventory, and return-to-hall without AI tags', async () => {
  const { app } = makeApp();
  const character = await createAccountCharacter(app);
  const started = await startAccountAdventure(app, character.body.state.character.id);
  await accountCommand(app, character.body.state.character.id, started.body.state.run.id, 'south');

  const take = await accountCommand(app, character.body.state.character.id, started.body.state.run.id, 'take gem');
  assert.equal(take.status, 200);
  assert.equal(take.body.state.character.inventory[0].slug, 'gem');
  assert.doesNotMatch(take.body.text, /\[[A-Za-z_-]+(?::[^\]]*)?\]/);

  const inventory = await accountCommand(app, character.body.state.character.id, started.body.state.run.id, 'inventory');
  assert.match(inventory.body.text, /Gem/);

  await accountCommand(app, character.body.state.character.id, started.body.state.run.id, 'north');
  const leave = await accountCommand(app, character.body.state.character.id, started.body.state.run.id, 'north');

  assert.equal(leave.status, 200);
  assert.equal(leave.body.intent.type, 'move');
  assert.equal(leave.body.events[0].type, 'return_to_hall');
  assert.equal(leave.body.state.character.gold, 5);
  assert.equal(leave.body.state.adventureRun.status, 'completed');
  assert.equal(leave.body.state.phase, 'great-hall');
  assert.equal(leave.body.state.unlockedAdventures.some((adventure) => adventure.id === 'beginners-cave'), true);
  assert.equal(leave.body.choices.some((choice) => /shop|begin|character/i.test(choice)), true);
});

test('POST /api/game/command reads original noncollectible artifacts without collecting them', async () => {
  const { app, deps } = makeApp();
  const character = await createAccountCharacter(app);
  const started = await startAccountAdventure(app, character.body.state.character.id);
  await accountCommand(app, character.body.state.character.id, started.body.state.run.id, 'south');

  const read = await accountCommand(app, character.body.state.character.id, started.body.state.run.id, 'read inscription');
  assert.equal(read.status, 200);
  assert.equal(read.body.intent.type, 'read_item');
  assert.equal(read.body.events[0].type, 'read_item');
  assert.equal(read.body.text, 'An inscription reads: "Original tutorial text."');

  const take = await accountCommand(app, character.body.state.character.id, started.body.state.run.id, 'take inscription');
  assert.equal(take.status, 200);
  assert.equal(take.body.events[0].type, 'take_failed');
  assert.equal(take.body.events[0].reason, 'not-collectible');
  assert.match(take.body.text, /cannot take/i);
  assert.equal(take.body.state.character.inventory.some((item) => item.slug === 'inscription'), false);
  assert.equal(deps.calls.some((call) => call.type === 'updateRun' && call.patch.collectedItems?.includes('inscription')), false);
});

test('POST /api/game/command supports talking to visible non-hostile characters', async () => {
  const { app } = makeApp();
  const character = await createAccountCharacter(app);
  const started = await startAccountAdventure(app, character.body.state.character.id);
  await accountCommand(app, character.body.state.character.id, started.body.state.run.id, 'south');

  const talk = await accountCommand(app, character.body.state.character.id, started.body.state.run.id, 'talk to hermit');

  assert.equal(talk.status, 200);
  assert.equal(talk.body.intent.type, 'talk');
  assert.equal(talk.body.events[0].type, 'talk');
  assert.match(talk.body.text, /hermit nods/i);
  assert.deepEqual(talk.body.choices, ['north', 'take Gem', 'read inscription', 'attack Rat', 'talk Hermit']);
});

test('POST /api/game/command pick up synonym takes visible items', async () => {
  const { app } = makeApp();
  const character = await createAccountCharacter(app);
  const started = await startAccountAdventure(app, character.body.state.character.id);
  await accountCommand(app, character.body.state.character.id, started.body.state.run.id, 'south');

  const take = await accountCommand(app, character.body.state.character.id, started.body.state.run.id, 'pick up gem');

  assert.equal(take.status, 200);
  assert.equal(take.body.intent.type, 'take');
  assert.equal(take.body.state.character.inventory[0].slug, 'gem');
});

test('authenticated leave command abandons only the requested profile run', async () => {
  const { app, deps } = makeApp(makeDeps({ adventures: [beginner, advanced] }));
  const headers = { authorization: 'Bearer raw-session-token' };

  const created = await request(app, 'POST', '/api/game/characters', {
    profileId: 'profile-1', name: 'Leaving Hero', className: 'adventurer', hardiness: 15, agility: 12, charisma: 15,
  }, headers);
  const started = await request(app, 'POST', '/api/game/start-adventure', {
    profileId: 'profile-1', characterId: created.body.state.character.id, adventureId: 'beginners-cave',
  }, headers);
  const left = await request(app, 'POST', '/api/game/command', {
    profileId: 'profile-1', characterId: created.body.state.character.id, adventureRunId: started.body.state.adventureRun.id, input: 'leave',
  }, headers);

  assert.equal(left.status, 200);
  assert.equal(left.body.state.adventureRun.status, 'abandoned');
  assert.deepEqual(deps.calls.findLast((call) => call.type === 'abandonRun').owner, { playerId: 'account:user-1', userId: 'user-1', profileId: 'profile-1' });
});

test('POST /api/game/command abandon returns full Great Hall response', async () => {
  const { app } = makeApp();
  const character = await createAccountCharacter(app);
  const started = await startAccountAdventure(app, character.body.state.character.id);

  const abandon = await accountCommand(app, character.body.state.character.id, started.body.state.run.id, 'leave');

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

  const character = await createAccountCharacter(app);
  const started = await startAccountAdventure(app, character.body.state.character.id);
  const unknown = await accountCommand(app, character.body.state.character.id, started.body.state.run.id, 'dance wildly');

  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.events[0].type, 'unknown');
  assert.match(unknown.body.text, /did not understand/i);
});

test('POST /api/game/command rejects mutation after run is completed', async () => {
  const { app, deps } = makeApp();
  const character = await createAccountCharacter(app);
  const started = await startAccountAdventure(app, character.body.state.character.id);
  await accountCommand(app, character.body.state.character.id, started.body.state.adventureRun.id, 'north');
  const updateRunCallsBefore = deps.calls.filter((call) => call.type === 'updateRun').length;

  const stale = await accountCommand(app, character.body.state.character.id, started.body.state.adventureRun.id, 'south');

  assert.equal(stale.status, 409);
  assert.equal(stale.body.ok, false);
  assert.match(stale.body.text, /no longer active/i);
  assert.equal(deps.calls.filter((call) => call.type === 'updateRun').length, updateRunCallsBefore);
});

test('POST /api/game/command marks dead characters and runs terminal', async () => {
  const rolls = [0, 0.99, 0.99];
  const { app } = makeApp(makeDeps({ rng: () => rolls.shift() ?? 0.99 }));
  const character = await createAccountCharacter(app, { hardiness: 1, agility: 0, hd: 1, maxHd: 1 });
  const started = await startAccountAdventure(app, character.body.state.character.id);
  await accountCommand(app, character.body.state.character.id, started.body.state.adventureRun.id, 'south');

  const combat = await accountCommand(app, character.body.state.character.id, started.body.state.adventureRun.id, 'attack rat');

  assert.equal(combat.status, 200);
  assert.equal(combat.body.events.some((event) => event.type === 'character_defeated'), true);
  assert.equal(combat.body.state.character.isAlive, false);
  assert.equal(combat.body.state.adventureRun.status, 'dead');
  assert.equal(combat.body.state.phase, 'main-hall');

  const afterDeath = await accountCommand(app, character.body.state.character.id, started.body.state.adventureRun.id, 'take gem');
  assert.equal(afterDeath.status, 409);
  assert.match(afterDeath.body.text, /dead|defeated/i);
});

test('POST /api/game/start-adventure rejects dead characters', async () => {
  const { app } = makeApp();
  const character = await createAccountCharacter(app, { hardiness: 0, hd: 0, maxHd: 1 });

  const started = await startAccountAdventure(app, character.body.state.character.id);

  assert.equal(started.status, 409);
  assert.match(started.body.text, /dead|defeated/i);
});
