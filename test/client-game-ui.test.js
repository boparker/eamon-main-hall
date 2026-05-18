import test from 'node:test';
import assert from 'node:assert/strict';

import { createPhase1GameClient } from '../public/js/game-client.js';

function makeHarness({ bootstrapResponse, startResponse, sessionToken = null, profileId = null } = {}) {
  const calls = [];
  const lines = [];
  const hudCharacters = [];
  const api = {
    async bootstrapGame(input) {
      calls.push({ type: 'bootstrapGame', input });
      return bootstrapResponse;
    },
    async createGameCharacter(input) {
      calls.push({ type: 'createGameCharacter', input });
      return {
        ok: true,
        text: `${input.name} returns to the Great Hall.`,
        choices: ['Visit Weapons Shop', "Begin Beginner's Cave"],
        state: {
          phase: 'great-hall',
          player: { id: input.playerId },
          character: { id: 'char-1', name: input.name, className: input.className, hardiness: input.hardiness, agility: input.agility, charisma: input.charisma, hd: input.hd, maxHd: input.maxHd, gold: input.gold, inventory: [], equipment: {}, isAlive: true },
          characters: [],
          unlockedAdventures: [{ id: 'beginners-cave', name: "The Beginner's Cave" }],
          lockedAdventures: [],
        },
        media: { voice: null, background: null, portraits: [] },
      };
    },
    async startGameAdventure(input) {
      calls.push({ type: 'startGameAdventure', input });
      return startResponse ?? {
        ok: true,
        text: 'Entrance\nA cave mouth waits.',
        choices: ['north', 'south'],
        state: { phase: 'adventure', character: { id: input.characterId, name: 'Mara' }, adventureRun: { id: 'run-1', status: 'active' } },
        media: { voice: null, background: null, portraits: [] },
      };
    },
    async sendGameCommand(input) {
      calls.push({ type: 'sendGameCommand', input });
      return { ok: true, text: 'You look around.', choices: ['north'], state: { phase: 'adventure', character: { id: input.characterId }, adventureRun: { id: input.adventureRunId, status: 'active' } } };
    },
    async sendHallCommand(input) {
      calls.push({ type: 'sendHallCommand', input });
      return { ok: true, text: 'Bought Short Sword.', choices: ['Begin Beginner\'s Cave'], state: { phase: 'great-hall', character: { id: input.characterId, name: 'Mara', gold: 50, inventory: [{ slug: 'short-sword', name: 'Short Sword' }] } } };
    },
  };
  const client = createPhase1GameClient({
    api,
    playerId: 'p1',
    sessionToken,
    profileId,
    render: (response) => lines.push(response.text),
    renderPlayer: (text) => lines.push(`> ${text}`),
    updateHUD: (character) => { if (character !== undefined) hudCharacters.push(character); },
    statsGenerator: () => ({ hardiness: 15, agility: 12, charisma: 15, hd: 15, maxHd: 15, gold: 200 }),
  });
  return { client, calls, lines, hudCharacters };
}

const noCharacterHall = {
  ok: true,
  text: 'You stand in the Great Hall. Create Character or Register Account.',
  choices: ['Create Character', 'Register Account'],
  state: {
    phase: 'great-hall',
    player: { id: 'p1' },
    character: null,
    characters: [],
    unlockedAdventures: [{ id: 'beginners-cave', name: "The Beginner's Cave" }],
    lockedAdventures: [{ id: 'dragon-castle', name: "The Dragon's Castle" }],
  },
  media: { voice: null, background: null, portraits: [] },
};

const existingCharacterHall = {
  ok: true,
  text: 'You stand in the Great Hall with Mara. HD 10 Gold 80 Inventory: none.',
  choices: ['Visit Weapons Shop', 'Visit Armor Shop', "Begin Beginner's Cave"],
  state: {
    phase: 'great-hall',
    player: { id: 'p1' },
    character: { id: 'char-1', name: 'Mara', className: 'rogue', hardiness: 10, agility: 12, charisma: 7, hd: 10, maxHd: 10, gold: 80, inventory: [], equipment: {}, isAlive: true },
    characters: [{ id: 'char-1', name: 'Mara' }],
    unlockedAdventures: [{ id: 'beginners-cave', name: "The Beginner's Cave" }],
    lockedAdventures: [{ id: 'dragon-castle', name: "The Dragon's Castle" }],
  },
  media: { voice: null, background: null, portraits: [] },
};

test('registered game client sends session token and profile id instead of guest player id', async () => {
  const { client, calls } = makeHarness({ bootstrapResponse: existingCharacterHall, sessionToken: 'raw-session-token', profileId: 'profile-1' });

  await client.startPhase1Game();
  await client.handleInput('begin beginners cave');
  await client.handleInput('look');

  assert.deepEqual(calls[0], { type: 'bootstrapGame', input: { sessionToken: 'raw-session-token', profileId: 'profile-1' } });
  assert.equal(calls[1].type, 'startGameAdventure');
  assert.deepEqual(calls[1].input, { sessionToken: 'raw-session-token', profileId: 'profile-1', characterId: 'char-1', adventureId: 'beginners-cave' });
  assert.equal(calls[2].type, 'sendGameCommand');
  assert.deepEqual(calls[2].input, { sessionToken: 'raw-session-token', profileId: 'profile-1', characterId: 'char-1', adventureRunId: 'run-1', input: 'look' });
});

test('registered character creation includes session token and profile id without guest player id', async () => {
  const { client, calls } = makeHarness({ bootstrapResponse: noCharacterHall, sessionToken: 'raw-session-token', profileId: 'profile-1' });

  await client.startPhase1Game();
  await client.handleInput('Ariana');
  await client.handleInput('female');
  await client.handleInput('confirm');

  const createCall = calls.find((call) => call.type === 'createGameCharacter');
  assert.equal(createCall.input.sessionToken, 'raw-session-token');
  assert.equal(createCall.input.profileId, 'profile-1');
  assert.equal(Object.hasOwn(createCall.input, 'playerId'), false);
  assert.equal(createCall.input.name, 'Ariana');
});

test('startPhase1Game bootstraps player and immediately enters name prompt when no character exists', async () => {
  const { client, calls, lines } = makeHarness({ bootstrapResponse: noCharacterHall });

  await client.startPhase1Game();

  assert.deepEqual(calls.map((call) => call.type), ['bootstrapGame']);
  assert.match(lines.join('\n'), /Great Hall/i);
  assert.match(lines.join('\n'), /Create Character/i);
  assert.match(lines.join('\n'), /Name your character/i);
  assert.equal(client.getState().phase, 'great-hall');
  assert.equal(client.getState().creation.step, 'name');
});

test('startPhase1Game renders existing character in Great Hall without starting adventure', async () => {
  const { client, calls, lines } = makeHarness({ bootstrapResponse: existingCharacterHall });

  await client.startPhase1Game();

  assert.deepEqual(calls.map((call) => call.type), ['bootstrapGame']);
  assert.match(lines.join('\n'), /Mara/);
  assert.match(lines.join('\n'), /Gold 80/i);
  assert.equal(client.getState().character.id, 'char-1');
});

test('explicit begin beginners cave starts adventure from Great Hall', async () => {
  const { client, calls, lines } = makeHarness({ bootstrapResponse: existingCharacterHall });
  await client.startPhase1Game();

  await client.handleInput('begin beginners cave');

  assert.equal(calls.at(-1).type, 'startGameAdventure');
  assert.equal(calls.at(-1).input.adventureId, 'beginners-cave');
  assert.match(lines.join('\n'), /Entrance/);
  assert.equal(client.getState().phase, 'adventure');
});

test('generic begin adventure starts the single unlocked adventure', async () => {
  const { client, calls } = makeHarness({ bootstrapResponse: existingCharacterHall });
  await client.startPhase1Game();

  await client.handleInput('begin adventure');

  assert.equal(calls.at(-1).type, 'startGameAdventure');
  assert.equal(calls.at(-1).input.adventureId, 'beginners-cave');
});

test('explicit begin adventure starts selected unlocked adventure and sends locked attempts to server', async () => {
  const unlockedHall = {
    ...existingCharacterHall,
    choices: ['Begin The Dragon\'s Castle'],
    state: {
      ...existingCharacterHall.state,
      character: { ...existingCharacterHall.state.character, adventuresCompleted: ['beginners-cave'] },
      unlockedAdventures: [
        { id: 'beginners-cave', name: "The Beginner's Cave" },
        { id: 'dragon-castle', name: "The Dragon's Castle" },
      ],
      lockedAdventures: [],
    },
  };
  const { client, calls } = makeHarness({ bootstrapResponse: unlockedHall });
  await client.startPhase1Game();

  await client.handleInput('begin dragon castle');

  assert.equal(calls.at(-1).type, 'startGameAdventure');
  assert.equal(calls.at(-1).input.adventureId, 'dragon-castle');

  const { client: lockedClient, calls: lockedCalls } = makeHarness({ bootstrapResponse: existingCharacterHall });
  await lockedClient.startPhase1Game();
  await lockedClient.handleInput('begin dragon castle');
  assert.equal(lockedCalls.at(-1).type, 'startGameAdventure');
  assert.equal(lockedCalls.at(-1).input.adventureId, 'dragon-castle');
});

test('terminal or missing active run input is safe and stays in Great Hall/hall flow', async () => {
  const { client, calls, lines } = makeHarness({ bootstrapResponse: existingCharacterHall });
  await client.startPhase1Game();

  client.applyResponse({ ok: true, text: 'You return to the Great Hall.', state: { phase: 'great-hall', character: existingCharacterHall.state.character, adventureRun: { id: 'run-1', status: 'completed' } } });
  await client.handleInput('look');

  assert.notEqual(calls.at(-1).type, 'sendGameCommand');
  assert.match(lines.join('\n'), /Great Hall/);
});

test('create character clears stale character before asking for the new name', async () => {
  const { client, hudCharacters } = makeHarness({ bootstrapResponse: existingCharacterHall });
  await client.startPhase1Game();

  await client.handleInput('create character');

  assert.equal(client.getState().character, null);
  assert.equal(client.getState().creation.step, 'name');
  assert.equal(hudCharacters.at(-1), null);
});

test('character creation follows original port name/gender/rolled-stats flow, then returns Main Hall', async () => {
  const { client, calls, lines } = makeHarness({ bootstrapResponse: noCharacterHall });
  await client.startPhase1Game();

  await client.handleInput('create character');
  await client.handleInput('Ariana');
  await client.handleInput('female');

  assert.equal(calls.some((call) => call.type === 'createGameCharacter'), false);
  assert.match(lines.join('\n'), /Hardiness 15/i);
  assert.match(lines.join('\n'), /gold pieces/i);

  await client.handleInput('confirm');

  const createCall = calls.find((call) => call.type === 'createGameCharacter');
  assert.equal(createCall.input.name, 'Ariana');
  assert.equal(createCall.input.className, 'adventurer');
  assert.equal(createCall.input.gender, 'f');
  assert.equal(createCall.input.hardiness, 15);
  assert.equal(createCall.input.gold, 200);
  assert.equal(client.getState().phase, 'great-hall');
});

test('character creation can restart during confirmation', async () => {
  const { client, calls } = makeHarness({ bootstrapResponse: noCharacterHall });
  await client.startPhase1Game();

  await client.handleInput('Ariana');
  await client.handleInput('female');
  await client.handleInput('create character');
  await client.handleInput('Borin');
  await client.handleInput('male');
  await client.handleInput('confirm');

  const createCall = calls.find((call) => call.type === 'createGameCharacter');
  assert.equal(createCall.input.name, 'Borin');
  assert.equal(createCall.input.className, 'adventurer');
  assert.equal(createCall.input.gender, 'm');
});
