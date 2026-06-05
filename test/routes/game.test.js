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
    // Same display name as the room-2 inscription, different slug, listed first
    // (reproduces the cross-room duplicate-name read bug).
    { id: 'inscription-2', slug: 'inscription-entrance', name: 'inscription', type: 'misc', description: 'An inscription reads: "Entrance warning."', value: 0, weight: -999, collectible: false },
    { id: 'inscription-1', slug: 'inscription', name: 'inscription', type: 'misc', description: 'An inscription reads: "Original tutorial text."', value: 0, weight: -999, collectible: false },
    // A SECOND inscription on the same room-2 wall, same display name: must
    // collapse to one "read inscription" button that reads both (the duplicate
    // "Read Inscription" twice bug).
    { id: 'inscription-3', slug: 'inscription-extra', name: 'inscription', type: 'misc', description: 'An inscription reads: "Second tutorial note."', value: 0, weight: -999, collectible: false },
    // A feature you inspect to reveal a hidden item (the close-reading reward).
    { id: 'crack-1', slug: 'wall-crack', name: 'crack in the wall', type: 'feature', description: 'You widen the crack and find a hollow behind it.', value: 0, weight: -999, collectible: false },
    { id: 'pouch-1', slug: 'coin-pouch', name: 'coin pouch', type: 'treasure', value: 20, weight: 1 },
  ],
  placements: [
    { item_slug: 'gem', room_number: 2, hidden: false },
    { item_slug: 'inscription-entrance', room_number: 1, hidden: false },
    { item_slug: 'inscription', room_number: 2, hidden: false },
    { item_slug: 'inscription-extra', room_number: 2, hidden: false },
    { item_slug: 'wall-crack', room_number: 2, hidden: false },
    { item_slug: 'coin-pouch', room_number: 2, hidden: true, revealedBy: 'wall-crack' },
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
        spells: input.spells ?? {},
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
        name: patch.name ?? row.name,
        hardiness: patch.hardiness ?? row.hardiness,
        agility: patch.agility ?? row.agility,
        charisma: patch.charisma ?? row.charisma,
        hd: patch.hd ?? row.hd,
        max_hd: patch.maxHd ?? row.max_hd,
        gold: patch.gold ?? row.gold,
        bank_gold: patch.bankGold ?? row.bank_gold,
        inventory: patch.inventory ?? row.inventory,
        equipment: patch.equipment ?? row.equipment,
        spells: patch.spells ?? row.spells,
        adventures_completed: patch.adventuresCompleted ?? row.adventures_completed,
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
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
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
  assert.equal(response.body.choices.some((choice) => /adventure gate/i.test(choice)), true);
  assert.equal(response.body.choices.some((choice) => /begin/i.test(choice)), false); // per-adventure buttons replaced by the Gate
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
  assert.equal(created.body.choices.some((choice) => /adventure gate/i.test(choice)), true);
  assert.equal(deps.calls.some((call) => call.type === 'createRun'), false);
});

test('POST /api/game/hall approach the adventure gate lists unlocked and locked expeditions', async () => {
  const { app } = makeApp(makeDeps({ adventures: [beginner, advanced] }));
  const created = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Gatekeeper Test', className: 'adventurer', hardiness: 12, agility: 12, charisma: 12, hd: 12, maxHd: 12, gold: 40,
  });
  const characterId = created.body.state.character.id;

  const gate = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId, input: 'approach the adventure gate' });
  assert.equal(gate.status, 200);
  assert.equal(gate.body.state.locationTitle, 'The Adventure Gate');
  assert.ok(gate.body.state.gate, 'gate state present');

  const cards = gate.body.state.gate.adventures;
  const beginnersCard = cards.find((adventure) => adventure.id === 'beginners-cave');
  const dragonCard = cards.find((adventure) => adventure.id === 'dragon-castle');
  assert.equal(beginnersCard.unlocked, true);
  assert.equal(dragonCard.unlocked, false);
  assert.match(dragonCard.lockedReason, /Beginner/i);
  // The Gate offers a way back, and does not bleed per-adventure begin buttons.
  assert.equal(gate.body.choices.some((choice) => /return to great hall/i.test(choice)), true);
});

test('POST /api/game/hall buys equipment server-side and blocks invalid or unaffordable purchases', async () => {
  const { app } = makeApp(makeDeps({ adventures: [beginner, advanced] }));
  const created = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Mara', className: 'rogue', hardiness: 10, agility: 12, charisma: 7, gold: 80,
  });
  const characterId = created.body.state.character.id;

  const shop = await request(app, 'POST', '/api/game/hall', {
    playerId: 'p1', characterId, input: 'visit the weapon shop',
  });
  assert.equal(shop.status, 200);
  assert.equal(shop.body.state.locationTitle, "Marcos Cavielli's Weapons & Armour Shoppe");
  assert.equal(shop.body.state.shop.key, 'marcos');
  // one combined shop carrying both weapons and armor
  assert.equal(shop.body.state.shop.items.some((item) => item.slug === 'short-sword'), true);
  assert.equal(shop.body.state.shop.items.some((item) => item.category === 'armor'), true);

  const bought = await request(app, 'POST', '/api/game/hall', {
    playerId: 'p1', characterId, input: 'buy short sword',
  });
  assert.equal(bought.status, 200);
  assert.equal(bought.body.state.phase, 'great-hall');
  // buying keeps you in Marcos's shop
  assert.equal(bought.body.state.locationTitle, "Marcos Cavielli's Weapons & Armour Shoppe");
  assert.equal(bought.body.state.character.gold, 50);
  assert.equal(bought.body.state.character.inventory.some((item) => item.slug === 'short-sword'), true);
  assert.equal(bought.body.state.character.equipment.weapon.slug, 'short-sword');

  // Marcos has an endless supply — buying again is allowed (gold drops further)
  const again = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId, input: 'buy club' });
  assert.equal(again.status, 200);
  assert.equal(again.body.state.character.gold, 35);

  // sell it back at half value
  const sold = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId, input: 'sell club' });
  assert.equal(sold.status, 200);
  assert.equal(sold.body.state.character.gold, 35 + Math.floor(15 / 2));
  assert.equal(sold.body.state.character.inventory.some((item) => item.slug === 'club'), false);

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
    profileId: 'profile-1', characterId, input: 'visit the weapon shop',
  }, accountHeaders);
  assert.equal(shop.status, 200);
  assert.equal(shop.body.state.locationTitle, "Marcos Cavielli's Weapons & Armour Shoppe");
  assert.equal(shop.body.state.shop.items.some((item) => item.slug === 'short-sword'), true);

  const bought = await request(app, 'POST', '/api/game/hall', {
    profileId: 'profile-1', characterId, input: 'buy short sword',
  }, accountHeaders);
  assert.equal(bought.status, 200);
  assert.equal(bought.body.state.character.userId, 'user-1');
  assert.equal(bought.body.state.character.profileId, 'profile-1');
  assert.equal(bought.body.state.character.gold, 50);
  assert.equal(bought.body.state.character.equipment.weapon.slug, 'short-sword');
});

test('POST /api/game/hall — Hokas Tokas teaches spells for a flat price', async () => {
  const { app } = makeApp(makeDeps({ adventures: [beginner], rng: () => 0 }));
  const created = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Mage', className: 'mystic', hardiness: 12, agility: 12, charisma: 18, gold: 200,
  });
  const characterId = created.body.state.character.id;

  const visit = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId, input: 'visit the wizard' });
  assert.equal(visit.body.state.locationTitle, "Hokas Tokas' School of Magick");
  assert.equal(visit.body.state.shop.mode, 'options'); // pic + tiles
  assert.equal(visit.body.state.shop.options.some((o) => /learn power/i.test(o.command)), true);

  const learned = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId, input: 'learn power' });
  assert.equal(learned.status, 200);
  assert.equal(learned.body.state.character.gold, 100); // power costs 100
  assert.ok(learned.body.state.character.spells.power > 0);

  const broke = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId, input: 'learn speed' });
  assert.equal(broke.status, 409); // speed costs 4000
  assert.equal(broke.body.error, 'insufficient-gold');
});

test('POST /api/game/hall — the Witch raises attributes at a cubic price', async () => {
  const { app } = makeApp(makeDeps({ adventures: [beginner] }));
  const created = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Brute', className: 'warrior', hardiness: 15, agility: 12, charisma: 9, gold: 4000,
  });
  const characterId = created.body.state.character.id;

  const visit = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId, input: 'visit the witch' });
  assert.equal(visit.body.state.locationTitle, "The Witch's Shop");
  assert.equal(visit.body.state.shop.mode, 'options'); // pic + tiles
  assert.equal(visit.body.state.shop.options.some((o) => /raise hardiness/i.test(o.command)), true);

  const raised = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId, input: 'raise hardiness' });
  assert.equal(raised.status, 200);
  assert.equal(raised.body.state.character.hardiness, 16);
  assert.equal(raised.body.state.character.gold, 4000 - 3400); // price for hardiness 15
  assert.equal(raised.body.state.character.maxHd, 16); // hardiness raises HD
});

test('POST /api/game/hall — the Bank stores and returns gold', async () => {
  const { app } = makeApp(makeDeps({ adventures: [beginner] }));
  const created = await request(app, 'POST', '/api/game/characters', {
    playerId: 'p1', name: 'Saver', className: 'rogue', hardiness: 12, agility: 15, charisma: 9, gold: 200,
  });
  const characterId = created.body.state.character.id;

  const deposit = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId, input: 'deposit 150' });
  assert.equal(deposit.status, 200);
  assert.equal(deposit.body.state.character.gold, 50);
  assert.equal(deposit.body.state.character.bankGold, 150);

  const withdraw = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId, input: 'withdraw 100' });
  assert.equal(withdraw.body.state.character.gold, 150);
  assert.equal(withdraw.body.state.character.bankGold, 50);

  const overdraw = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId, input: 'withdraw 999' });
  assert.equal(overdraw.status, 409);
});

test('POST /api/game/hall — the Healer restores HP for gold', async () => {
  const deps = makeDeps({ adventures: [beginner] });
  const { app } = makeApp(deps);
  await deps.createCharacter(deps.db, {
    id: 'hurt-1', playerId: 'p1', name: 'Hurt', className: 'rogue',
    hardiness: 15, agility: 12, charisma: 9, hd: 7, maxHd: 15, gold: 100, isAlive: true,
  });

  const visit = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId: 'hurt-1', input: 'visit the healer' });
  assert.equal(visit.status, 200);
  assert.equal(visit.body.state.locationTitle, 'The Chapel of the Open Hand');
  assert.match(visit.body.text, /Health: 7 \/ 15/);

  const heal = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId: 'hurt-1', input: 'heal' });
  assert.equal(heal.status, 200);
  assert.equal(heal.body.state.character.hd, 15);          // restored to max
  assert.equal(heal.body.state.character.gold, 100 - 8 * 3); // 8 HP at 3 gold each

  const again = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId: 'hurt-1', input: 'heal' });
  assert.equal(again.status, 409); // already full
});

test('POST /api/game/hall — View Equipment opens the pack and readies a found weapon', async () => {
  const deps = makeDeps({ adventures: [beginner] });
  const { app } = makeApp(deps);
  await deps.createCharacter(deps.db, {
    id: 'packrat-1', playerId: 'p1', name: 'Packrat', className: 'rogue',
    hardiness: 12, agility: 12, charisma: 9, hd: 12, maxHd: 12, gold: 50,
    inventory: [{ slug: 'trollsfire', name: 'Trollsfire', type: 'weapon', value: 125, damage_dice: '1d12' }],
    isAlive: true,
  });

  const view = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId: 'packrat-1', input: 'view equipment' });
  assert.equal(view.status, 200);
  assert.equal(view.body.state.shop.mode, 'pack'); // tile view, not a text list

  const ready = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId: 'packrat-1', input: 'ready trollsfire' });
  assert.equal(ready.status, 200);
  assert.equal(ready.body.state.character.equipment.weapon.slug, 'trollsfire');
  assert.equal(ready.body.state.character.equipment.weapon.stats.damage, '1d12'); // synthesised from damage_dice
});

test('POST /api/game/hall — drinking a healing potion restores HP and consumes it', async () => {
  const deps = makeDeps({ adventures: [beginner] });
  const { app } = makeApp(deps);
  await deps.createCharacter(deps.db, {
    id: 'sip-1', playerId: 'p1', name: 'Sip', className: 'rogue', hardiness: 15, agility: 12, charisma: 9,
    hd: 5, maxHd: 15, gold: 0,
    inventory: [{ slug: 'healing-potion', name: 'healing potion', type: 'potion', heal_amount: 6, value: 50 }],
    isAlive: true,
  });

  const drink = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId: 'sip-1', input: 'drink healing potion' });
  assert.equal(drink.status, 200);
  assert.equal(drink.body.state.character.hd, 11); // 5 + 6
  assert.equal(drink.body.state.character.inventory.some((i) => i.slug === 'healing-potion'), false);

  const again = await request(app, 'POST', '/api/game/hall', { playerId: 'p1', characterId: 'sip-1', input: 'drink healing potion' });
  assert.equal(again.status, 400); // none left
});

test('POST /api/game/command — abandoning a run still cashes treasures to gold', async () => {
  const deps = makeDeps();
  const { app } = makeApp(deps);
  await deps.createCharacter(deps.db, {
    id: 'bail-1', userId: 'user-1', profileId: 'profile-1', playerId: 'account:user-1',
    name: 'Bail', className: 'rogue', hardiness: 12, agility: 12, charisma: 9, hd: 12, maxHd: 12, gold: 0,
    inventory: [{ slug: 'diamonds', name: 'diamonds', type: 'treasure', value: 200 }], isAlive: true,
  });
  const started = await startAccountAdventure(app, 'bail-1');
  const left = await accountCommand(app, 'bail-1', started.body.state.run.id, 'leave');
  assert.equal(left.status, 200);
  assert.equal(left.body.state.character.gold, 200); // diamonds weighed into gold
  assert.equal(left.body.state.character.inventory.some((i) => i.slug === 'diamonds'), false);
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
  assert.deepEqual(started.body.choices, ['north', 'south', 'read inscription']);
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
  assert.deepEqual(moved.body.choices, ['north', 'take Gem', 'read inscription', 'inspect crack in the wall', 'attack Rat', 'talk Hermit']);
  assert.equal(deps.calls.some((call) => call.type === 'updateRun' && call.patch.currentRoom === 2), true);
});

test('wounds persist after returning from a completed adventure (heal at the Healer instead)', async () => {
  const deps = makeDeps();
  const { app } = makeApp(deps);
  // A wounded adventurer (4 of 12 HD) who survived the cave.
  await deps.createCharacter(deps.db, {
    id: 'wynn-1', userId: 'user-1', profileId: 'profile-1', playerId: 'account:user-1',
    name: 'Wynn', className: 'rogue', hardiness: 12, agility: 12, charisma: 9, hd: 4, maxHd: 12, gold: 0, isAlive: true,
  });
  const started = await startAccountAdventure(app, 'wynn-1');
  const runId = started.body.state.run.id;

  // Walk out the entrance (room 1 north → main-hall) — completes the run.
  const out = await accountCommand(app, 'wynn-1', runId, 'north');
  assert.equal(out.status, 200);
  assert.equal(out.body.events[0].type, 'return_to_hall');
  assert.equal(out.body.state.character.hd, 4); // wounds persist — not free-healed
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
  // Room 2 holds two inscriptions on the same wall — reading surfaces both.
  assert.equal(read.body.text, 'An inscription reads: "Original tutorial text."\n\nAn inscription reads: "Second tutorial note."');

  const take = await accountCommand(app, character.body.state.character.id, started.body.state.run.id, 'take inscription');
  assert.equal(take.status, 200);
  assert.equal(take.body.events[0].type, 'take_failed');
  assert.equal(take.body.events[0].reason, 'not-collectible');
  assert.match(take.body.text, /cannot take/i);
  assert.equal(take.body.state.character.inventory.some((item) => item.slug === 'inscription'), false);
  assert.equal(deps.calls.some((call) => call.type === 'updateRun' && call.patch.collectedItems?.includes('inscription')), false);
});

test('POST /api/game/command reads the same-named artifact belonging to the current room', async () => {
  const { app } = makeApp();
  const character = await createAccountCharacter(app);
  const started = await startAccountAdventure(app, character.body.state.character.id);
  const runId = started.body.state.run.id;
  const charId = character.body.state.character.id;

  // Room 1 has its own "inscription"; reading it returns the entrance text.
  const entrance = await accountCommand(app, charId, runId, 'read inscription');
  assert.equal(entrance.status, 200);
  assert.equal(entrance.body.text, 'An inscription reads: "Entrance warning."');

  // Room 2 has different "inscription"s (same name); reading there returns THEIR
  // text, not "there is no inscription here" (the cross-room duplicate-name bug).
  await accountCommand(app, charId, runId, 'south');
  const rat = await accountCommand(app, charId, runId, 'read inscription');
  assert.equal(rat.status, 200);
  assert.equal(rat.body.text, 'An inscription reads: "Original tutorial text."\n\nAn inscription reads: "Second tutorial note."');
});

test('POST /api/game/command inspecting a feature reveals a hidden item you can then take', async () => {
  const { app } = makeApp();
  const character = await createAccountCharacter(app);
  const runId = (await startAccountAdventure(app, character.body.state.character.id)).body.state.run.id;
  const charId = character.body.state.character.id;
  await accountCommand(app, charId, runId, 'south'); // room 2 has the crack

  // Hidden item is not takeable before inspection.
  const tooSoon = await accountCommand(app, charId, runId, 'take coin pouch');
  assert.equal(tooSoon.body.events[0].type, 'take_failed');

  // Inspect the crack → the coin pouch is revealed (and the inspect choice retires).
  const inspect = await accountCommand(app, charId, runId, 'inspect crack in the wall');
  assert.equal(inspect.status, 200);
  assert.equal(inspect.body.events[0].type, 'inspect');
  assert.match(inspect.body.text, /coin pouch/i);
  assert.equal(inspect.body.choices.some((c) => /inspect crack/i.test(c)), false);
  assert.equal(inspect.body.choices.some((c) => /take coin pouch/i.test(c)), true);

  // Now it can be taken.
  const taken = await accountCommand(app, charId, runId, 'take coin pouch');
  assert.equal(taken.body.state.character.inventory.some((item) => item.slug === 'coin-pouch'), true);
});

test('POST /api/game/command shows one Read Inscription button for several same-named inscriptions', async () => {
  const { app } = makeApp();
  const character = await createAccountCharacter(app);
  const started = await startAccountAdventure(app, character.body.state.character.id);
  const runId = started.body.state.run.id;
  const charId = character.body.state.character.id;

  const moved = await accountCommand(app, charId, runId, 'south'); // room 2 has two inscriptions
  const readChoices = moved.body.choices.filter((choice) => choice === 'read inscription');
  assert.deepEqual(readChoices, ['read inscription']); // exactly one, not two
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
  assert.deepEqual(talk.body.choices, ['north', 'take Gem', 'read inscription', 'inspect crack in the wall', 'attack Rat', 'talk Hermit']);
});

test('POST /api/game/command — talking to a hostile foe will not parley (no look-dump)', async () => {
  const { app } = makeApp();
  const character = await createAccountCharacter(app);
  const started = await startAccountAdventure(app, character.body.state.character.id);
  const runId = started.body.state.run.id;
  const charId = character.body.state.character.id;
  await accountCommand(app, charId, runId, 'south'); // into the Rat Room

  const talk = await accountCommand(app, charId, runId, 'talk rat');
  assert.equal(talk.status, 200);
  assert.equal(talk.body.events[0].reason, 'hostile');
  assert.match(talk.body.text, /snarl|will not help/i);
  assert.doesNotMatch(talk.body.text, /You see/i); // never dumps the look-description as speech
});

test('POST /api/game/command — equipped weapon damage is used in combat', async () => {
  const { app } = makeApp(makeDeps({ rng: () => 0.99 })); // max rolls: guaranteed hit + max damage
  const created = await createAccountCharacter(app, { gold: 300 });
  const charId = created.body.state.character.id;

  // Buy a two-handed sword (1d10) — it should be auto-equipped.
  const bought = await request(app, 'POST', '/api/game/hall', { profileId: 'profile-1', characterId: charId, input: 'buy two-handed sword' }, accountHeaders);
  assert.equal(bought.body.state.character.equipment.weapon.slug, 'two-handed-sword');

  const started = await startAccountAdventure(app, charId);
  const runId = started.body.state.run.id;
  await accountCommand(app, charId, runId, 'south'); // into the Rat Room
  const atk = await accountCommand(app, charId, runId, 'attack rat');
  // 1d10 at max = 10 damage, not the unarmed 1d2 default (which would cap at 2).
  assert.equal(atk.body.state.combat.round.player.damage, 10);
});

test('POST /api/game/command — casting a learned blast in combat damages the enemy', async () => {
  const { app } = makeApp(makeDeps({ rng: () => 0 })); // deterministic: learn raises ability, cast rolls 1 (success)
  const created = await createAccountCharacter(app, { gold: 1500 });
  const charId = created.body.state.character.id;

  const learned = await request(app, 'POST', '/api/game/hall', { profileId: 'profile-1', characterId: charId, input: 'learn blast' }, accountHeaders);
  assert.ok(learned.body.state.character.spells.blast > 0);

  const started = await startAccountAdventure(app, charId);
  const runId = started.body.state.run.id;
  await accountCommand(app, charId, runId, 'south'); // into the Rat Room

  const cast = await accountCommand(app, charId, runId, 'cast blast');
  assert.equal(cast.status, 200);
  assert.equal(cast.body.events[0].type, 'cast');
  assert.equal(cast.body.state.combat.round.player.spell, 'blast');
  assert.equal(cast.body.state.combat.round.player.success, true);
  assert.ok(cast.body.state.combat.round.player.damage > 0);
});

test('POST /api/game/command — casting an unlearned spell is refused', async () => {
  const { app } = makeApp();
  const created = await createAccountCharacter(app);
  const charId = created.body.state.character.id;
  const started = await startAccountAdventure(app, charId);
  const runId = started.body.state.run.id;
  await accountCommand(app, charId, runId, 'south');

  const cast = await accountCommand(app, charId, runId, 'cast blast');
  assert.equal(cast.body.events[0].reason, 'not-learned');
  assert.match(cast.body.text, /not learned/i);
});

test('POST /api/game/bootstrap revives a fallen character, forfeiting run loot but keeping gear', async () => {
  const deps = makeDeps();
  const { app } = makeApp(deps);
  // A fallen adventurer carrying treasure (run loot) and a bought sword (permanent).
  await deps.createCharacter(deps.db, {
    id: 'fallen-1', playerId: 'p1', name: 'Theron', className: 'rogue',
    hardiness: 12, agility: 12, charisma: 9, hd: 0, maxHd: 12, gold: 50,
    inventory: [
      { slug: 'gem', name: 'Gem', type: 'treasure', value: 5 },
      { slug: 'sword', name: 'Sword', type: 'weapon', price: 75, stats: { damage: '1d8' } },
    ],
    isAlive: false,
  });

  const boot = await request(app, 'POST', '/api/game/bootstrap', { playerId: 'p1' });
  assert.equal(boot.status, 200);
  assert.match(boot.body.text, /back from the brink/i);
  assert.equal(boot.body.state.character.isAlive, true);
  assert.equal(boot.body.state.character.hd, 12); // healed to max
  assert.equal(boot.body.state.character.gold, 50); // gold on hand kept
  assert.equal(boot.body.state.character.inventory.some((i) => i.slug === 'gem'), false); // run loot forfeited
  assert.equal(boot.body.state.character.inventory.some((i) => i.slug === 'sword'), true); // bought gear kept
});

test('POST /api/game/command take all gathers every loose item but not scenery', async () => {
  const { app } = makeApp();
  const character = await createAccountCharacter(app);
  const runId = (await startAccountAdventure(app, character.body.state.character.id)).body.state.run.id;
  const charId = character.body.state.character.id;
  await accountCommand(app, charId, runId, 'south'); // room 2: gem + two inscriptions

  const all = await accountCommand(app, charId, runId, 'take all');
  assert.equal(all.status, 200);
  assert.equal(all.body.intent.type, 'take_all');
  assert.match(all.body.text, /Gem/);
  assert.equal(all.body.state.character.inventory.some((item) => item.slug === 'gem'), true);
  // inscriptions are scenery — never swept up
  assert.equal(all.body.state.character.inventory.some((item) => String(item.slug).includes('inscription')), false);
});

test('POST /api/game/command ready and remove swap the readied weapon mid-adventure', async () => {
  const { app } = makeApp();
  const character = await createAccountCharacter(app, { gold: 200 });
  const charId = character.body.state.character.id;

  // Buy a weapon in the Hall (auto-readied), then descend.
  await request(app, 'POST', '/api/game/hall', { profileId: 'profile-1', characterId: charId, input: 'visit the weapon shop' }, accountHeaders);
  const bought = await request(app, 'POST', '/api/game/hall', { profileId: 'profile-1', characterId: charId, input: 'buy short sword' }, accountHeaders);
  assert.equal(bought.body.state.character.equipment.weapon.slug, 'short-sword');

  const runId = (await startAccountAdventure(app, charId)).body.state.run.id;

  // Remove it — the slot empties.
  const removed = await accountCommand(app, charId, runId, 'remove short sword');
  assert.equal(removed.status, 200);
  assert.equal(removed.body.intent.type, 'unequip');
  assert.equal(removed.body.state.character.equipment.weapon, undefined);

  // Ready it again from inventory — the slot refills with combat stats intact.
  const readied = await accountCommand(app, charId, runId, 'ready short sword');
  assert.equal(readied.status, 200);
  assert.equal(readied.body.intent.type, 'equip');
  assert.equal(readied.body.state.character.equipment.weapon.slug, 'short-sword');
  assert.equal(readied.body.state.character.equipment.weapon.stats.damage, '1d6');
  assert.match(readied.body.text, /ready short sword/i);
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

// ── Companion / NPC follower system ───────────────────────────────────────────
const companionAdventure = {
  adventure: { id: 'beginners-cave', name: "The Beginner's Cave", start_room: 1 },
  locations: [
    { id: 'c1', room_number: 1, name: 'Entrance', narration_text: 'A cave mouth waits.', exits: { north: 'main-hall', south: 2, east: null, west: null, up: null, down: null }, treasure: [], requires: null },
    { id: 'c2', room_number: 2, name: 'Temple', narration_text: 'An altar looms.', exits: { north: 1, south: null, east: 3, west: null, up: null, down: null }, treasure: [], requires: null },
    { id: 'c3', room_number: 3, name: 'Nook', narration_text: 'A grizzled figure waits.', exits: { west: 2, north: null, south: null, east: null, up: null, down: null }, treasure: [], requires: null },
  ],
  characters: [
    { id: 'priest-1', slug: 'priest', name: 'Priest', type: 'enemy', friendliness: 'hostile', hp: 1, agility: 0, damage_dice: '1d1', location_room: 2, frees_on_defeat: 'cynthia', current_hp_from: 'hp' },
    { id: 'cynthia-1', slug: 'cynthia', name: 'Cynthia', type: 'npc', friendliness: 'friendly', escort: true, hp: 5, agility: 5, damage_dice: '0d0', location_room: 2, dialogue: 'Take me to my father!' },
    { id: 'hermit-1', slug: 'hermit', name: 'Hermit', type: 'npc', friendliness: 'neutral', encounter_behavior: 'random', hp: 5, agility: 0, damage_dice: '1d4', location_room: 3, dialogue: 'Hmph.' },
  ],
  items: [],
  placements: [],
};

async function startCompanionRun(rng, charisma = 15) {
  const { app } = makeApp(makeDeps({ adventures: [companionAdventure], rng }));
  const created = await createAccountCharacter(app, { charisma });
  const charId = created.body.state.character.id;
  const start = await startAccountAdventure(app, charId);
  return { app, charId, runId: start.body.state.adventureRun.id };
}

test('defeating the priest frees Cynthia, who then travels with you and pays out on return', async () => {
  const { app, charId, runId } = await startCompanionRun(() => 0.99, 15);
  await accountCommand(app, charId, runId, 'south'); // into the temple
  const kill = await accountCommand(app, charId, runId, 'attack priest');
  assert.ok(kill.body.events.some((e) => e.type === 'enemy_defeated' && e.enemy === 'priest'));
  assert.ok(kill.body.events.some((e) => e.type === 'recruit' && e.character === 'cynthia'));
  assert.ok((kill.body.state.combat?.companions ?? []).some((c) => c.slug === 'cynthia' && c.escort === true));

  const back = await accountCommand(app, charId, runId, 'north'); // back to entrance
  assert.match(back.body.text, /Travelling with you: Cynthia\./);

  const hall = await accountCommand(app, charId, runId, 'north'); // out to the Hall
  assert.ok(hall.body.events.some((e) => e.type === 'escort_reward' && e.gold === 150)); // 10 × charisma 15
  assert.match(hall.body.text, /Cynthia/);
  assert.ok(hall.body.state.character.gold >= 150);
});

test('a high-charisma adventurer befriends the random hermit, who joins as a companion', async () => {
  // charisma 15 -> 75% friendly; rng 0.10 -> roll 10 < 75 -> friend.
  const { app, charId, runId } = await startCompanionRun(() => 0.10, 15);
  await accountCommand(app, charId, runId, 'south');
  const east = await accountCommand(app, charId, runId, 'east'); // into the hermit's nook
  assert.ok(east.body.events.some((e) => e.type === 'recruit' && e.character === 'hermit'));
  assert.match(east.body.text, /joins your party/);
  const hermit = east.body.state.entities.characters.find((c) => c.slug === 'hermit');
  assert.equal(hermit.following, true);
});

test('a low roll turns the hermit hostile and attackable instead of friendly', async () => {
  // charisma 7 -> 35% friendly; rng 0.99 -> roll 99 >= 35 -> foe.
  const { app, charId, runId } = await startCompanionRun(() => 0.99, 7);
  await accountCommand(app, charId, runId, 'south');
  const east = await accountCommand(app, charId, runId, 'east');
  assert.ok(east.body.events.some((e) => e.type === 'turned_hostile' && e.character === 'hermit'));
  assert.ok(east.body.choices.includes('attack Hermit'));
});

// ── Beginner's Cave twists: TrollsFire magic word + mimic chest ───────────────
const twistsAdventure = {
  adventure: { id: 'beginners-cave', name: "The Beginner's Cave", start_room: 1 },
  locations: [
    { id: 't1', room_number: 1, name: 'Entrance', narration_text: 'A blade lies here.', exits: { north: 'main-hall', south: 2, east: null, west: null, up: null, down: null }, treasure: [], requires: null },
    { id: 't2', room_number: 2, name: 'Cell', narration_text: 'A chest waits.', exits: { north: 1, south: null, east: null, west: null, up: null, down: null }, treasure: [], requires: null },
  ],
  characters: [
    { id: 'dummy-1', slug: 'dummy', name: 'Dummy', type: 'enemy', friendliness: 'hostile', hp: 100, agility: 0, damage_dice: '1d1', location_room: 1, current_hp_from: 'hp' },
    { id: 'mimic-1', slug: 'mimic', name: 'Mimic', type: 'enemy', friendliness: 'hostile', hp: 7, agility: 0, damage_dice: '1d2', location_room: 2, hidden_until_opened: 'mimic-chest', first_encounter_text: 'A tentacled horror lunges from the chest!', current_hp_from: 'hp' },
  ],
  items: [
    { id: 'tf-1', slug: 'trollsfire', name: 'TrollsFire', type: 'weapon', value: 125, weight: 8, damage_dice: '2d10', magic_word: 'trollsfire', stats: { damage: '2d10', weaponOdds: 0, flameDamage: '3d12', flameOdds: 40 } },
    { id: 'mc-1', slug: 'mimic-chest', name: 'chest', type: 'container', description: 'A wooden chest.', value: 0, weight: -999, collectible: false },
  ],
  placements: [
    { item_slug: 'trollsfire', room_number: 1, hidden: false },
    { item_slug: 'mimic-chest', room_number: 2, hidden: false },
  ],
};

async function startTwistsRun(rng) {
  const { app } = makeApp(makeDeps({ adventures: [twistsAdventure], rng }));
  const created = await createAccountCharacter(app, { agility: 12 });
  const charId = created.body.state.character.id;
  const start = await startAccountAdventure(app, charId);
  return { app, charId, runId: start.body.state.adventureRun.id };
}

test('TrollsFire: speaking its name ignites green flame and boosts a wielded blade', async () => {
  const { app, charId, runId } = await startTwistsRun(() => 0.99);
  await accountCommand(app, charId, runId, 'take trollsfire');
  await accountCommand(app, charId, runId, 'ready trollsfire');
  const unlit = await accountCommand(app, charId, runId, 'attack dummy');
  assert.equal(unlit.body.state.combat.round.player.damage, 20); // 2d10 max

  const say = await accountCommand(app, charId, runId, 'trollsfire');
  assert.ok(say.body.events.some((e) => e.type === 'magic_word' && e.lit === true));
  assert.match(say.body.text, /green fire/i);

  const lit = await accountCommand(app, charId, runId, 'attack dummy');
  assert.equal(lit.body.state.combat.round.player.damage, 36); // 3d12 max while lit
});

test('TrollsFire: lighting it while not wielding it singes you', async () => {
  const { app, charId, runId } = await startTwistsRun(() => 0.99);
  const took = await accountCommand(app, charId, runId, 'take trollsfire'); // carried, not readied
  const hpBefore = took.body.state.character.hd;
  const say = await accountCommand(app, charId, runId, 'trollsfire');
  assert.match(say.body.text, /sear/i);
  assert.equal(say.body.state.character.hd, hpBefore - 3);
});

test('Mimic: the chest is harmless until opened, then erupts into an attackable mimic', async () => {
  const { app, charId, runId } = await startTwistsRun(() => 0.99);
  await accountCommand(app, charId, runId, 'south');
  const early = await accountCommand(app, charId, runId, 'attack mimic');
  assert.match(early.body.text, /no mimic/i); // still disguised

  const open = await accountCommand(app, charId, runId, 'open chest');
  assert.match(open.body.text, /ERUPTS/);
  assert.ok(open.body.events.some((e) => e.type === 'ambush' && e.character === 'mimic'));

  const fight = await accountCommand(app, charId, runId, 'attack mimic');
  assert.ok(fight.body.events.some((e) => e.type === 'combat' && e.enemy === 'mimic'));
});
