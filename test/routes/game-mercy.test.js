// The mercy loop, end to end through the route layer: ACT verbs, regard,
// yield, SPARE (reward + befriend variants), telegraph stances, freeform SAY
// with an injected AI verdict (and the keyless fallback), the merciless
// lockout, the chronicle's deed log, and the Spirit's hint.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createGameRouter } from '../../server/routes/game.js';

const fixture = {
  adventure: { id: 'mercy-cave', name: 'The Mercy Cave', start_room: 1 },
  locations: [
    {
      id: 'm1', room_number: 1, name: 'Antechamber', narration_text: 'A quiet stone room.',
      exits: { north: 'main-hall', south: 2, east: 3, west: 4, up: 5, down: null }, treasure: [], requires: null,
    },
    {
      id: 'm5', room_number: 5, name: 'Empty Vault', narration_text: 'Bare stone. Nobody here.',
      exits: { north: null, south: null, east: null, west: null, up: null, down: 1 }, treasure: [], requires: null,
    },
    {
      id: 'm2', room_number: 2, name: 'Troll Den', narration_text: 'A den that smells of moss.',
      exits: { north: 1, south: null, east: null, west: null, up: null, down: null }, treasure: [], requires: null,
    },
    {
      id: 'm3', room_number: 3, name: 'Bandit Camp', narration_text: 'A cold campfire.',
      exits: { north: null, south: null, east: null, west: 1, up: null, down: null }, treasure: [], requires: null,
    },
    {
      id: 'm4', room_number: 4, name: 'Chest Cell', narration_text: 'A bare cell with a chest.',
      exits: { north: null, south: null, east: 1, west: null, up: null, down: null }, treasure: [], requires: null,
    },
  ],
  characters: [
    {
      id: 'troll-1', slug: 'troll', name: 'Troll', type: 'enemy', friendliness: 'hostile',
      hp: 10, agility: 0, damage_dice: '1d4', location_room: 2, current_hp_from: 'hp',
      persona: 'A lonely bridge troll.',
      acts: [{ verb: 'calm', label: 'Calm', shift: 30, success_text: 'The troll blinks, soothed.' }],
      yields_at_regard: 60,
      yields_at_hp: 3,
      telegraph: { every: 1, name: 'club sweep', multiplier: 2, warn_text: 'The troll hefts its club high!' },
      yield_text: 'The troll drops its club and waits.',
      spare_text: 'The troll bows its mossy head and shuffles aside.',
      spare_gold: 10,
      frees_on_defeat: 'prisoner',
    },
    {
      id: 'prisoner-1', slug: 'prisoner', name: 'Prisoner', type: 'npc', friendliness: 'friendly',
      hp: 4, agility: 2, damage_dice: '0d0', location_room: 2, current_hp_from: 'hp',
      persona: 'A frightened captive of the troll.', escort: true,
    },
    {
      id: 'minstrel-1', slug: 'minstrel', name: 'Minstrel', type: 'npc', friendliness: 'friendly',
      hp: 6, agility: 4, damage_dice: '1d2', location_room: 1, current_hp_from: 'hp',
      persona: 'A wandering minstrel looking for a story worth singing.',
    },
    {
      id: 'bandit-1', slug: 'bandit', name: 'Bandit', type: 'enemy', friendliness: 'hostile',
      hp: 8, agility: 0, damage_dice: '1d4', location_room: 3, current_hp_from: 'hp',
      persona: 'A down-on-his-luck highwayman.',
      acts: [{ verb: 'apologize', label: 'Apologize to', shift: 60, success_text: 'The bandit hesitates.' }],
      yields_at_regard: 60,
      befriend_on_spare: true,
      yield_text: 'The bandit lowers his blade.',
      spare_text: 'The bandit grins and falls in beside you.',
    },
    {
      id: 'mimic-1', slug: 'mimic', name: 'Mimic', type: 'enemy', friendliness: 'hostile',
      hp: 7, agility: 0, damage_dice: '1d6', location_room: 4, current_hp_from: 'hp',
      first_encounter_text: 'A chest-shaped monster lunges!',
      hidden_until_opened: 'trap-chest',
      persona: 'A hungry mimic pretending to be a chest.',
    },
  ],
  items: [
    { id: 'chest-1', slug: 'trap-chest', name: 'chest', type: 'container', collectible: false, value: 0, weight: -999, description: 'A chest sits invitingly.' },
  ],
  placements: [
    { item_slug: 'trap-chest', room_number: 4, hidden: false },
  ],
};

function makeDeps(options = {}) {
  const characters = new Map();
  const runs = new Map();
  const calls = [];
  return {
    calls,
    db: { ok: true },
    loadAdventures: () => [fixture],
    rng: options.rng ?? (() => 0), // d20 roll of 1: everyone misses by default
    ai: {
      narrateRoomEntry: async () => null,
      narrateMoment: async () => null,
      judgeParley: options.judgeParley ?? (async () => ({ reply: 'The default listener listens.', shift: 0, craft: null, craftNote: null, action: 'none', source: 'rules' })),
      spiritHint: options.spiritHint ?? (async (adventure, run, character) => {
        const { spiritHint } = await import('../../server/ai/hints.js');
        return spiritHint(adventure, run, character);
      }),
      weaponLegend: async () => null,
      maybeCompress: async (character) => character,
      ...options.ai,
    },
    async upsertPlayer(_db, player) { return { id: player.id, display_name: player.displayName ?? null }; },
    async listCharacters() { return [...characters.values()]; },
    async createCharacter(_db, input) {
      const row = {
        id: `char-${characters.size + 1}`, player_id: input.playerId, user_id: input.userId ?? null, profile_id: input.profileId ?? null,
        name: input.name, class: input.className, hardiness: input.hardiness, agility: input.agility, charisma: input.charisma,
        hd: input.hd, max_hd: input.maxHd, gold: input.gold ?? 0, bank_gold: 0,
        inventory: input.inventory ?? [], equipment: input.equipment ?? {}, spells: {},
        adventures_completed: input.adventuresCompleted ?? [], chronicle: { summary: '', deeds: [] }, is_alive: true,
      };
      characters.set(row.id, row);
      return row;
    },
    async getCharacter(_db, _owner, characterId) { return characters.get(characterId) ?? null; },
    async updateCharacter(_db, _owner, characterId, patch) {
      calls.push({ type: 'updateCharacter', characterId, patch });
      const row = characters.get(characterId);
      if (!row) return null;
      const updated = {
        ...row,
        hd: patch.hd ?? row.hd,
        gold: patch.gold ?? row.gold,
        inventory: patch.inventory ?? row.inventory,
        equipment: patch.equipment ?? row.equipment,
        adventures_completed: patch.adventuresCompleted ?? row.adventures_completed,
        chronicle: patch.chronicle ?? row.chronicle,
        is_alive: patch.isAlive ?? row.is_alive,
      };
      characters.set(characterId, updated);
      return updated;
    },
    async createAdventureRun(_db, input) {
      const row = {
        id: `run-${runs.size + 1}`, player_id: input.playerId, user_id: input.userId ?? null, profile_id: input.profileId ?? null,
        character_id: input.characterId, adventure_id: input.adventureId, current_room: input.currentRoom,
        room_state: input.roomState ?? {}, enemy_state: input.enemyState ?? {},
        collected_items: [], discovered_items: [], flags: input.flags ?? {}, status: 'active',
      };
      runs.set(row.id, row);
      return row;
    },
    async getAdventureRun(_db, _owner, runId) { return runs.get(runId) ?? null; },
    async getActiveAdventureRunForCharacter() { return null; },
    async updateAdventureRun(_db, _owner, runId, patch) {
      const row = runs.get(runId);
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
      runs.set(runId, updated);
      return updated;
    },
    async completeAdventureRun(_db, _owner, runId) {
      const row = runs.get(runId);
      const updated = { ...row, status: 'completed' };
      runs.set(runId, updated);
      return updated;
    },
    async abandonAdventureRun(_db, _owner, runId) {
      const row = runs.get(runId);
      const updated = { ...row, status: 'abandoned' };
      runs.set(runId, updated);
      return updated;
    },
    hashSessionToken: (token) => `sha256$${token}`,
    async getUserBySessionTokenHash(_db, tokenHash) {
      if (tokenHash === 'sha256$raw-session-token') return { id: 'user-1', username: 'bo', display_name: 'Bo' };
      return null;
    },
  };
}

async function request(app, method, path, body) {
  const server = app.listen(0);
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: 'Bearer raw-session-token' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeApp(deps) {
  const app = express();
  app.use(express.json());
  app.use('/api/game', createGameRouter(deps));
  return app;
}

const base = { profileId: 'profile-1', playerId: 'account:user-1' };

async function startSession(app, { charisma = 10 } = {}) {
  const created = await request(app, 'POST', '/api/game/characters', {
    ...base, name: 'Tester', className: 'adventurer', hardiness: 30, agility: 12, charisma, gold: 0,
    adventuresCompleted: ['beginners-cave'], // unlocks the fixture adventure
  });
  const characterId = created.body.state.character.id;
  const started = await request(app, 'POST', '/api/game/start-adventure', { ...base, characterId, adventureId: 'mercy-cave' });
  const adventureRunId = started.body.state.adventureRun.id;
  return { characterId, adventureRunId };
}

function command(app, session, input) {
  return request(app, 'POST', '/api/game/command', { ...base, ...session, input });
}

test('ACT verb shifts regard, triggers yield, and offers SPARE', async () => {
  const deps = makeDeps();
  const app = makeApp(deps);
  const session = await startSession(app);
  await command(app, session, 'south'); // into the troll den

  const first = await command(app, session, 'calm troll'); // regard 10 → 40
  assert.match(first.body.text, /soothed/);
  assert.equal(first.body.events.some((e) => e.type === 'enemy_yielded'), false);

  const second = await command(app, session, 'Calm Troll'); // +15 (repeat) → 55, no yield yet
  assert.equal(second.body.events.some((e) => e.type === 'enemy_yielded'), false);

  const third = await command(app, session, 'calm troll'); // +15 → 70 ≥ 60 → yields
  assert.ok(third.body.events.some((e) => e.type === 'enemy_yielded'));
  assert.match(third.body.text, /drops its club/);
  assert.ok(third.body.choices.some((c) => /^spare troll$/i.test(c)));
  assert.equal(third.body.state.combat.enemy.yielded, true);
  assert.equal(third.body.state.combat.enemy.state, 'yielding');
});

test('SPARE pays the reward, records the deed, and ends the fight', async () => {
  const deps = makeDeps();
  const app = makeApp(deps);
  const session = await startSession(app);
  await command(app, session, 'south');
  await command(app, session, 'calm troll');
  await command(app, session, 'calm troll');
  await command(app, session, 'calm troll');

  const spared = await request(app, 'POST', '/api/game/command', { ...base, ...session, input: 'spare troll' });
  assert.ok(spared.body.events.some((e) => e.type === 'enemy_spared'));
  assert.match(spared.body.text, /mossy head/);
  assert.match(spared.body.text, /10 gold/);
  assert.equal(spared.body.state.character.gold, 10);
  assert.ok(spared.body.state.adventureRun.defeatedEnemies.includes('troll'));
  assert.ok(spared.body.state.adventureRun.flags.spared.troll);
  const deeds = spared.body.state.character.chronicle.deeds.map((d) => d.text);
  assert.ok(deeds.some((d) => /Showed mercy to the Troll/.test(d)));
});

test('striking a yielded enemy breaks the truce for good', async () => {
  const deps = makeDeps();
  const app = makeApp(deps);
  const session = await startSession(app);
  await command(app, session, 'south');
  await command(app, session, 'calm troll');
  await command(app, session, 'calm troll');
  await command(app, session, 'calm troll');

  const attack = await command(app, session, 'attack troll');
  assert.ok(attack.body.events.some((e) => e.type === 'mercy_broken'));
  assert.match(attack.body.text, /shatters the truce/);
  const deeds = attack.body.state.character.chronicle.deeds.map((d) => d.text);
  assert.ok(deeds.some((d) => /Broke a truce/.test(d)));

  const tryAgain = await command(app, session, 'calm troll');
  assert.match(tryAgain.body.text, /past words/);
});

test('telegraph warns after the scheduled round and DODGE evades the charged blow', async () => {
  const deps = makeDeps();
  const app = makeApp(deps);
  const session = await startSession(app);
  await command(app, session, 'south');

  const round = await command(app, session, 'attack troll'); // every:1 → wind-up after round 1
  assert.ok(round.body.events.some((e) => e.type === 'telegraph'));
  assert.match(round.body.text, /hefts its club/);
  assert.deepEqual(round.body.choices.slice(0, 3), ['Brace', 'Dodge', 'Interrupt']);
  assert.ok(round.body.state.combat.telegraph);

  const dodge = await command(app, session, 'dodge');
  assert.match(dodge.body.text, /hurl yourself aside/);
  const hpAfter = dodge.body.state.character.hd;
  assert.equal(hpAfter, 30); // untouched
  assert.equal(dodge.body.state.combat.telegraph, null);
});

test('SAY routes through the AI verdict: craft-scaled shift, craft feedback, yield by words', async () => {
  const deps = makeDeps({
    judgeParley: async ({ words }) => ({
      reply: `You said: ${words}`, shift: 20, craft: 5, craftNote: 'Named what the troll loves.', action: 'none', source: 'ai',
    }),
  });
  const app = makeApp(deps);
  const session = await startSession(app);
  await command(app, session, 'south');

  await command(app, session, 'calm troll'); // 10 → 40
  const plea = await command(app, session, 'say your bridge misses you, old one');
  // shift 20 × craft factor 1.0 = 20 → regard 60 → yield
  assert.ok(plea.body.events.some((e) => e.type === 'enemy_yielded'));
  assert.match(plea.body.text, /Troll: "You said: your bridge misses you, old one"/);
  assert.match(plea.body.text, /✦ Craft 5\/5 — Named what the troll loves\./);
  // Yielded before reprisal: no counterattack happened
  assert.equal(plea.body.text.includes('strikes at you'), false);
});

test('keyless SAY falls back to deterministic verdict and still costs the action', async () => {
  const deps = makeDeps(); // default judgeParley: rules fallback, shift 0
  const app = makeApp(deps);
  const session = await startSession(app);
  await command(app, session, 'south');

  const plea = await command(app, session, 'say please stop');
  assert.ok(plea.body.events.some((e) => e.type === 'parley' && e.source === 'rules'));
  assert.equal(plea.body.text.includes('✦ Craft'), false); // no rubric without a judge
  assert.match(plea.body.text, /lashes out|strikes at you/); // troll answers in steel (rng 0 → miss text)
});

test('SPARE on a befriend_on_spare foe recruits them instead of defeating them', async () => {
  const deps = makeDeps();
  const app = makeApp(deps);
  const session = await startSession(app);
  await command(app, session, 'east'); // bandit camp

  await command(app, session, 'apologize to bandit'); // +60 → 70 ≥ 60 → yields
  const spared = await command(app, session, 'spare bandit');
  assert.ok(spared.body.events.some((e) => e.type === 'recruit' && e.character === 'bandit'));
  assert.match(spared.body.text, /falls in beside you/);
  assert.equal(spared.body.state.adventureRun.defeatedEnemies.includes('bandit'), false);
  assert.ok(spared.body.state.adventureRun.flags.companions.some((c) => c.slug === 'bandit'));
});

test('speaking to a disguised mimic can make it reveal itself', async () => {
  const deps = makeDeps({
    judgeParley: async ({ disguised }) => ({
      reply: 'I am a perfectly normal chest.', shift: 0, craft: 2, craftNote: null, action: disguised ? 'reveal' : 'none', source: 'ai',
    }),
  });
  const app = makeApp(deps);
  const session = await startSession(app);
  await command(app, session, 'west'); // chest cell

  const said = await command(app, session, 'say hello chest, anyone home?');
  assert.match(said.body.text, /perfectly normal chest/);
  assert.ok(said.body.events.some((e) => e.type === 'ambush' && e.character === 'mimic'));
  assert.ok(said.body.state.adventureRun.flags.openedContainers.includes('trap-chest'));
});

test('HINT consults the Spirit, which nudges toward mercy when an enemy can yield', async () => {
  const deps = makeDeps();
  const app = makeApp(deps);
  const session = await startSession(app);
  await command(app, session, 'south');

  const hint = await command(app, session, 'hint');
  assert.match(hint.body.text, /Spirit of the Hall/);
  assert.match(hint.body.text, /CALM/);
  assert.equal(hint.body.event.type, 'hint');
});

test('slaying an enemy writes the deed to the chronicle', async () => {
  // rng 0.99: everyone hits, max damage
  const deps = makeDeps({ rng: () => 0.99 });
  const app = makeApp(deps);
  const session = await startSession(app);
  await command(app, session, 'south');

  let last = null;
  for (let i = 0; i < 12; i += 1) {
    last = await command(app, session, 'attack troll');
    if (last.body.events.some((e) => e.type === 'enemy_defeated')) break;
    if (last.body.events.some((e) => e.type === 'telegraph'))
      last = await command(app, session, 'interrupt');
    if (last.body.events.some((e) => e.type === 'enemy_defeated')) break;
  }
  assert.ok(last.body.events.some((e) => e.type === 'enemy_defeated'));
  const deeds = last.body.state.character.chronicle.deeds.map((d) => d.text);
  assert.ok(deeds.some((d) => /Slew the Troll in Troll Den/.test(d)));
});

test('implicit speech: un-parsed sentences are spoken to whoever is present', async () => {
  const deps = makeDeps({
    judgeParley: async ({ words }) => ({
      reply: `Heard: ${words}`, shift: 5, craft: 3, craftNote: null, action: 'none', source: 'ai',
    }),
  });
  const app = makeApp(deps);
  const session = await startSession(app);
  await command(app, session, 'south'); // troll den

  // No "say" prefix — exactly what a new player types.
  const plea = await command(app, session, 'please stop, I mean you no harm');
  assert.ok(plea.body.events.some((e) => e.type === 'parley'));
  assert.match(plea.body.text, /Troll: "Heard: please stop, I mean you no harm"/);
  assert.match(plea.body.text, /✦ Craft 3\/5/);
});

test('implicit speech does not shadow ACT verbs or fire in empty rooms', async () => {
  const deps = makeDeps({
    judgeParley: async () => ({ reply: 'should not be called', shift: 0, craft: 0, craftNote: null, action: 'none', source: 'ai' }),
  });
  const app = makeApp(deps);
  const session = await startSession(app);

  // Empty vault: multi-word gibberish stays a parser error.
  await command(app, session, 'up');
  const alone = await command(app, session, 'fiddle the sproingle');
  assert.equal(alone.body.event.type, 'unknown');

  await command(app, session, 'down');
  await command(app, session, 'south');
  // "calm troll" must still be the authored ACT, not speech.
  const act = await command(app, session, 'calm troll');
  assert.ok(act.body.events.some((e) => e.type === 'act'));
  assert.equal(act.body.events.some((e) => e.type === 'parley'), false);
  // Single-word gibberish near the troll: still a parser error, not speech.
  const typo = await command(app, session, 'norht');
  assert.equal(typo.body.event.type, 'unknown');
});

test('a free NPC can be talked into joining; the engine seats them in the party', async () => {
  const deps = makeDeps({
    judgeParley: async ({ joinable }) => ({
      reply: joinable ? 'A story worth walking for! Lead on.' : 'no', shift: 10, craft: 4, craftNote: null, action: 'join', source: 'ai',
    }),
  });
  const app = makeApp(deps);
  const session = await startSession(app);

  const plea = await command(app, session, 'come with me, minstrel — this cave will make a fine song');
  assert.ok(plea.body.events.some((e) => e.type === 'recruit' && e.character === 'minstrel'));
  assert.match(plea.body.text, /Minstrel falls in beside you/);
  assert.ok(plea.body.state.adventureRun.flags.companions.some((c) => c.slug === 'minstrel'));
  const deeds = plea.body.state.character.chronicle.deeds.map((d) => d.text);
  assert.ok(deeds.some((d) => /Persuaded Minstrel/.test(d)));
});

test('a captive cannot be talked into leaving while the captor stands — and the player is told', async () => {
  // Model misbehaves and says "join" anyway: the engine must refuse it.
  const deps = makeDeps({
    judgeParley: async () => ({ reply: 'Yes! Take me with you!', shift: 10, craft: 4, craftNote: null, action: 'join', source: 'ai' }),
  });
  const app = makeApp(deps);
  const session = await startSession(app);
  await command(app, session, 'south'); // troll den, troll alive, prisoner captive

  const plea = await command(app, session, 'tell prisoner follow me and I will get you home safely');
  assert.equal(plea.body.events.some((e) => e.type === 'recruit'), false);
  assert.match(plea.body.text, /no captive may leave while their captor stands/);
  assert.equal(plea.body.state.adventureRun.flags.companions?.some?.((c) => c.slug === 'prisoner') ?? false, false);

  // TALK (canned dialogue) also spells out the catch.
  const talk = await command(app, session, 'talk prisoner');
  assert.match(talk.body.text, /cannot leave while the troll stands/);
});

test('sparing the captor frees the captive, who joins as before', async () => {
  const deps = makeDeps();
  const app = makeApp(deps);
  const session = await startSession(app);
  await command(app, session, 'south');
  await command(app, session, 'calm troll');
  await command(app, session, 'calm troll');
  await command(app, session, 'calm troll');
  const spared = await command(app, session, 'spare troll');
  assert.ok(spared.body.events.some((e) => e.type === 'recruit' && e.character === 'prisoner'));
  assert.ok(spared.body.state.adventureRun.flags.companions.some((c) => c.slug === 'prisoner'));
});

test('unnamed speech that mentions a bystander by name goes to them, not the enemy', async () => {
  const heard = [];
  const deps = makeDeps({
    judgeParley: async ({ npc }) => { heard.push(npc.slug); return { reply: 'I hear you.', shift: 0, craft: 2, craftNote: null, action: 'none', source: 'ai' }; },
  });
  const app = makeApp(deps);
  const session = await startSession(app);
  await command(app, session, 'south'); // troll (enemy) + prisoner (captive bystander)

  const plea = await command(app, session, 'stay strong, prisoner — I will come back for you');
  assert.deepEqual(heard, ['prisoner']);
  assert.match(plea.body.text, /Prisoner: "I hear you\."/);
});
