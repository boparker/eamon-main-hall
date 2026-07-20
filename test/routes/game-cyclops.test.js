// The Cyclops's Cave — the gimmick audit, written alongside the content per
// doctrine. Runs the REAL premium manifest through the live route.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';

import { createGameRouter } from '../../server/routes/game.js';

const cyclops = JSON.parse(readFileSync('data/adventures/odyssey-cyclops.json', 'utf8'));

function makeDeps() {
  const characters = new Map();
  const runs = new Map();
  const entitlements = ['odyssey-cyclops'];
  return {
    db: { ok: true },
    loadAdventures: () => [cyclops],
    rng: () => 0,
    ai: {
      narrateRoomEntry: async () => null,
      narrateMoment: async () => null,
      judgeParley: async () => ({ reply: 'The giant grunts.', shift: 0, craft: null, craftNote: null, action: 'none', source: 'rules' }),
      spiritHint: async () => null,
      weaponLegend: async () => null,
      maybeCompress: async (c) => c,
    },
    async upsertPlayer(_db, player) { return { id: player.id, display_name: null }; },
    async listCharacters() { return [...characters.values()]; },
    async createCharacter(_db, input) {
      const row = {
        id: `char-${characters.size + 1}`, player_id: input.playerId, user_id: null, profile_id: input.profileId ?? null,
        name: input.name, class: input.className, hardiness: input.hardiness, agility: input.agility, charisma: input.charisma,
        hd: input.hd, max_hd: input.maxHd, gold: input.gold ?? 0, bank_gold: 0,
        inventory: input.inventory ?? [], equipment: input.equipment ?? {}, spells: {},
        adventures_completed: input.adventuresCompleted ?? [], chronicle: { summary: '', deeds: [] }, is_alive: true,
      };
      characters.set(row.id, row);
      return row;
    },
    async getCharacter(_db, _owner, id) { return characters.get(id) ?? null; },
    async updateCharacter(_db, _owner, id, patch) {
      const row = characters.get(id);
      if (!row) return null;
      const updated = {
        ...row,
        hd: patch.hd ?? row.hd, gold: patch.gold ?? row.gold,
        inventory: patch.inventory ?? row.inventory, equipment: patch.equipment ?? row.equipment,
        adventures_completed: patch.adventuresCompleted ?? row.adventures_completed,
        chronicle: patch.chronicle ?? row.chronicle, is_alive: patch.isAlive ?? row.is_alive,
      };
      characters.set(id, updated);
      return updated;
    },
    async createAdventureRun(_db, input) {
      const row = {
        id: `run-${runs.size + 1}`, player_id: input.playerId, user_id: null, profile_id: input.profileId ?? null,
        character_id: input.characterId, adventure_id: input.adventureId, current_room: input.currentRoom,
        room_state: input.roomState ?? {}, enemy_state: input.enemyState ?? {},
        collected_items: [], discovered_items: [], flags: input.flags ?? {}, status: 'active',
      };
      runs.set(row.id, row);
      return row;
    },
    async getAdventureRun(_db, _owner, id) { return runs.get(id) ?? null; },
    async getActiveAdventureRunForCharacter() { return null; },
    hashSessionToken: (token) => `sha256$${token}`,
    async getUserBySessionTokenHash(_db, tokenHash) {
      return tokenHash === 'sha256$raw-session-token' ? { id: 'user-1', username: 'tester', display_name: 'Tester', entitlements } : null;
    },
    async updateAdventureRun(_db, _owner, id, patch) {
      const row = runs.get(id);
      if (!row) return null;
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
      runs.set(id, updated);
      return updated;
    },
    _runs: runs,
  };
}

async function request(app, method, path, body) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { 'Content-Type': 'application/json', authorization: 'Bearer raw-session-token' }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

function makeApp(deps) {
  const app = express();
  app.use(express.json());
  app.use('/api/game', createGameRouter(deps));
  return app;
}

const base = { profileId: 'profile-1', playerId: 'account:user-1' };

async function start(app) {
  const created = await request(app, 'POST', '/api/game/characters', {
    ...base, name: 'Tester', className: 'adventurer', hardiness: 30, agility: 12, charisma: 12, gold: 0,
    adventuresCompleted: ['beginners-cave'],
  });
  const characterId = created.body.state.character.id;
  const started = await request(app, 'POST', '/api/game/start-adventure', { ...base, characterId, adventureId: 'odyssey-cyclops' });
  assert.equal(started.status, 201, JSON.stringify(started.body).slice(0, 200));
  return { characterId, adventureRunId: started.body.state.adventureRun.id };
}

const cmd = (app, session, input) => request(app, 'POST', '/api/game/command', { ...base, ...session, input });

test('the prologue sings and the manifest is sound', async () => {
  const deps = makeDeps();
  const app = makeApp(deps);
  const created = await request(app, 'POST', '/api/game/characters', { ...base, name: 'Tester', className: 'adventurer', hardiness: 30, agility: 12, charisma: 12, adventuresCompleted: ['beginners-cave'] });
  const started = await request(app, 'POST', '/api/game/start-adventure', { ...base, characterId: created.body.state.character.id, adventureId: 'odyssey-cyclops' });
  assert.match(started.body.state.intro.text, /Sing in me, Muse/);
  const numbers = new Set(cyclops.locations.map((l) => l.room_number));
  for (const loc of cyclops.locations) {
    for (const [dir, dest] of Object.entries(loc.exits)) {
      if (dest === null || dest === 'main-hall') continue;
      assert.ok(numbers.has(dest), `room ${loc.room_number} ${dir} -> ${dest} missing`);
    }
  }
});

test('living art: room responses declare the breathing layer when loops exist on disk', async () => {
  const deps = makeDeps();
  const app = makeApp(deps);
  const created = await request(app, 'POST', '/api/game/characters', { ...base, name: 'Tester', className: 'adventurer', hardiness: 30, agility: 12, charisma: 12, adventuresCompleted: ['beginners-cave'] });
  const started = await request(app, 'POST', '/api/game/start-adventure', { ...base, characterId: created.body.state.character.id, adventureId: 'odyssey-cyclops' });
  const state = started.body.state;
  const { existsSync } = await import('node:fs');
  if (existsSync('public/scenes/odyssey-cyclops/room-1-living.mp4')) {
    // Loops shipped: room 1 must declare its living background, versioned.
    assert.match(state.living?.background ?? '', /room-1-living\.mp4\?l=\d/);
  } else {
    // No loops on disk (fresh checkout): the field must be absent/null, never a broken URL.
    assert.equal(state.living?.background ?? null, null);
  }
});

test('AUDIT the whole night: wine, sleep, stake, tally, name, rams, and out at dawn', async () => {
  const deps = makeDeps();
  const app = makeApp(deps);
  const session = await start(app);

  // The grove: read the warning, take the wine.
  await cmd(app, session, 'east');            // 2 landing beach
  await cmd(app, session, 'north');           // 3 grove
  const read = await cmd(app, session, 'read votive stone');
  assert.match(read.body.text, /ONE measure.*TWENTY|verdict/is);
  await cmd(app, session, 'take wine of maron');
  await cmd(app, session, 'south');           // 2
  await cmd(app, session, 'east');            // 4 cliff path
  await cmd(app, session, 'up');              // 5 pens
  await cmd(app, session, 'east');            // 6 door stone
  const meet = await cmd(app, session, 'east'); // 7 — the giant
  assert.match(meet.body.text, /Polyphemus|Guests/);

  // Trapped: steel is futile; the door stone will not move.
  const swing = await cmd(app, session, 'attack polyphemus');
  assert.match(swing.body.text, /reed on river stone|THINK/i);
  await cmd(app, session, 'west');            // back to 6
  const barred = await cmd(app, session, 'west');
  assert.match(barred.body.text, /door stone|barred|groove/i);
  await cmd(app, session, 'east');            // 7 again

  // The name, planted while he is awake.
  const nobody = await cmd(app, session, 'say my name is Nobody');
  assert.match(nobody.body.text, /THE NAME IS PLANTED|eat you LAST/i);

  // The wine — and the slide into sleep (2 turns of movement).
  const wine = await cmd(app, session, 'give wine of maron to polyphemus');
  assert.match(wine.body.text, /drains|Sweet fire/i);
  await cmd(app, session, 'south');           // 9 (turn 1)
  await cmd(app, session, 'north');           // 7 (turn 2 → asleep)
  const look = await cmd(app, session, 'look');
  assert.match(look.body.text, /snor|wrecked|sleep/i);

  // The tally, moved while the eye is shut.
  await cmd(app, session, 'west');            // 6
  const tally = await cmd(app, session, 'use tally stones');
  assert.match(tally.body.text, /COUNT WILL LIE|bury them/i);
  await cmd(app, session, 'east');            // 7

  // The stake (fetched from the deep shadow), and the blinding.
  await cmd(app, session, 'south');
  await cmd(app, session, 'take olive stake');
  await cmd(app, session, 'north');
  const blind = await cmd(app, session, 'use olive stake');
  assert.match(blind.body.text, /NOBODY! Nobody is killing me/i);

  // Under the rams, out through the door, no penalties — dawn.
  const hide = await cmd(app, session, 'hide under rams');
  assert.match(hide.body.text, /belly-wool|great ram/i);
  await cmd(app, session, 'west');            // 6 (hidden)
  const out = await cmd(app, session, 'west'); // the door
  assert.match(out.body.text, /Sweet ram|light of morning/i);
  assert.doesNotMatch(out.body.text, /row comes up wrong|scream/i, 'no tally penalty');
  assert.doesNotMatch(out.body.text, /boulders on the hillside/i, 'no name penalty');
});

test('AUDIT sloppiness costs crew: no tally, no Nobody', async () => {
  const deps = makeDeps();
  const app = makeApp(deps);
  const session = await start(app);
  // Speed-run without the tally or the name: seed to the giant with wine+stake.
  const run = deps._runs.get(session.adventureRunId);
  run.current_room = 7;
  run.room_state = { visitedRooms: [1, 7] };
  const ch = [...(await deps.listCharacters())][0];
  ch.inventory = [{ slug: 'wine-of-maron', name: 'wine of maron', type: 'misc' }, { slug: 'olive-stake', name: 'olive stake', type: 'misc' }];
  await cmd(app, session, 'give wine of maron to polyphemus');
  await cmd(app, session, 'south');
  await cmd(app, session, 'north');
  await cmd(app, session, 'use olive stake');
  await cmd(app, session, 'hide under rams');
  await cmd(app, session, 'west');
  const out = await cmd(app, session, 'west');
  assert.match(out.body.text, /row comes up wrong/i, 'tally penalty fires');
  assert.match(out.body.text, /boulders on the hillside/i, 'name penalty fires');
  const lost = deps._runs.get(session.adventureRunId).flags.attritionLost ?? [];
  assert.ok(lost.length >= 2, `two crew lost to sloppiness, got ${JSON.stringify(lost)}`);
});

test('AUDIT the clock: dawdling in the great cave feeds the giant', async () => {
  const deps = makeDeps();
  const app = makeApp(deps);
  const session = await start(app);
  const run = deps._runs.get(session.adventureRunId);
  run.current_room = 7;
  run.room_state = { visitedRooms: [1, 7] };
  // Pace the cave: each 7th move in room 7 costs a named crewman.
  let eaten = null;
  for (let i = 0; i < 16 && !eaten; i++) {
    await cmd(app, session, 'south');
    const back = await cmd(app, session, 'north'); // ends turn in room 7
    if (/is gone\. The crew presses|HURRY/i.test(back.body.text)) eaten = back;
  }
  assert.ok(eaten, 'the attrition clock eventually bites');
  assert.match(eaten.body.text, /Elpenor|Perimedes|Eurylochus/);
});

test('AUDIT hubris: boasting your name from the ship is chronicled forever', async () => {
  const deps = makeDeps();
  const app = makeApp(deps);
  const session = await start(app);
  // At the ship (room 1), the black-ship feature is present from the start.
  const boast = await cmd(app, session, 'say tell them it was I — remember my name!');
  assert.match(boast.body.text, /HUBRIS|Poseidon/i);
  const deeds = boast.body.state.character.chronicle.deeds;
  assert.ok(deeds.some((d) => d.kind === 'hubris'), 'hubris deed recorded');
  // Once only — the sea heard you the first time.
  const again = await cmd(app, session, 'say my name once more');
  assert.doesNotMatch(again.body.text, /HUBRIS/);
});
