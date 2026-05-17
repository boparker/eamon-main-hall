import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyGameResponse,
  defaultWarriorCharacter,
  isActiveGameResponse,
  sendPhase1Command,
  startPhase1Game,
} from '../public/js/game-client.js';

test('defaultWarriorCharacter creates a Phase 1 warrior payload without client-side stat rolls', () => {
  assert.deepEqual(defaultWarriorCharacter('player-1', 'Ada Lovelace'), {
    playerId: 'player-1',
    name: 'Ada Lovelace',
    className: 'warrior',
  });
});

test('applyGameResponse renders canonical text/choices and trusts only response.state.character for HUD state', () => {
  const calls = [];
  const clientState = {
    character: { name: 'Old', gold: 99, hd: 2 },
    gameSession: {},
  };
  const response = {
    text: 'You take the gem. [GOLD:+100] [DAMAGE:3]',
    choices: ['north', 'look'],
    state: {
      character: { id: 'char-1', name: 'New', gold: 5, hd: 12, agility: 9, charisma: 8 },
      adventureRun: { id: 'run-1', status: 'active' },
      room: { name: 'Mouth of the Cave' },
    },
  };

  applyGameResponse(response, {
    state: clientState,
    renderText: (text) => calls.push(['text', text]),
    clearChoices: () => calls.push(['clearChoices']),
    addChoice: (choice) => calls.push(['choice', choice]),
    renderChoices: () => calls.push(['renderChoices']),
    updateHUD: (animate) => calls.push(['hud', animate]),
    setInputState: (hint, enabled) => calls.push(['input', hint, enabled]),
    setLocation: (location) => calls.push(['location', location]),
  });

  assert.equal(clientState.character.gold, 5);
  assert.equal(clientState.character.hd, 12);
  assert.equal(clientState.character.agility, 9);
  assert.equal(clientState.character.charisma, 8);
  assert.equal(clientState.gameSession.characterId, 'char-1');
  assert.equal(clientState.gameSession.adventureRunId, 'run-1');
  assert.deepEqual(calls, [
    ['text', 'You take the gem. [GOLD:+100] [DAMAGE:3]'],
    ['clearChoices'],
    ['choice', 'north'],
    ['choice', 'look'],
    ['renderChoices'],
    ['hud', true],
    ['input', 'action', true],
    ['location', 'Mouth of the Cave'],
  ]);
});

test('applyGameResponse disables command input for terminal adventure states', () => {
  const calls = [];
  const clientState = { character: {}, gameSession: {} };
  applyGameResponse({
    text: 'You have returned to the Main Hall.',
    choices: [],
    state: {
      character: { id: 'char-1', name: 'Ada', isAlive: true },
      adventureRun: { id: 'run-1', status: 'completed' },
    },
  }, {
    state: clientState,
    renderText: () => {},
    clearChoices: () => {},
    addChoice: () => {},
    renderChoices: () => {},
    updateHUD: () => {},
    setInputState: (hint, enabled) => calls.push(['input', hint, enabled]),
  });

  assert.equal(isActiveGameResponse({ state: { character: { isAlive: true }, adventureRun: { status: 'completed' } } }), false);
  assert.equal(isActiveGameResponse({ state: { character: { isAlive: false }, adventureRun: { status: 'active' } } }), false);
  assert.deepEqual(calls, [['input', 'action', false]]);
});

test('startPhase1Game resumes a stored active run with look instead of creating duplicates', async () => {
  const calls = [];
  const clientState = { character: {}, gameSession: { characterId: 'char-1', adventureRunId: 'run-1', adventureRun: { id: 'run-1', status: 'active' } } };
  const api = {
    bootstrapGame: async (body) => { calls.push(['bootstrap', body]); return { ok: true }; },
    createGameCharacter: async () => { throw new Error('must not create duplicate character'); },
    startGameAdventure: async () => { throw new Error('must not create duplicate run'); },
    sendGameCommand: async (body) => {
      calls.push(['command', body]);
      return { text: 'You are still here.', choices: ['look'], state: { character: { id: 'char-1', name: 'Ada' }, adventureRun: { id: 'run-1', status: 'active' } } };
    },
  };

  await startPhase1Game({
    playerId: 'player-1',
    promptName: () => 'Ada',
    api,
    state: clientState,
    renderResponse: (response) => calls.push(['render', response.text]),
  });

  assert.deepEqual(calls, [
    ['bootstrap', { playerId: 'player-1', displayName: 'Ada' }],
    ['command', { playerId: 'player-1', characterId: 'char-1', adventureRunId: 'run-1', input: 'look' }],
    ['render', 'You are still here.'],
  ]);
});

test('startPhase1Game resumes localStorage session without null defaults overwriting stored ids', async () => {
  const oldWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: () => JSON.stringify({ characterId: 'stored-char', adventureRunId: 'stored-run', adventureRun: { id: 'stored-run', status: 'active' } }),
      setItem: () => {},
    },
  };
  const calls = [];
  const clientState = { character: {}, gameSession: { playerId: 'player-1', characterId: null, adventureRunId: null } };
  const api = {
    bootstrapGame: async (body) => { calls.push(['bootstrap', body]); return { ok: true }; },
    createGameCharacter: async () => { throw new Error('must not create duplicate character'); },
    startGameAdventure: async () => { throw new Error('must not create duplicate run'); },
    sendGameCommand: async (body) => {
      calls.push(['command', body]);
      return { text: 'Stored run resumed.', choices: ['look'], state: { character: { id: 'stored-char', name: 'Ada' }, adventureRun: { id: 'stored-run', status: 'active' } } };
    },
  };

  try {
    await startPhase1Game({ playerId: 'player-1', promptName: () => 'Ada', api, state: clientState, renderResponse: () => {} });
  } finally {
    globalThis.window = oldWindow;
  }

  assert.deepEqual(calls, [
    ['bootstrap', { playerId: 'player-1', displayName: 'Ada' }],
    ['command', { playerId: 'player-1', characterId: 'stored-char', adventureRunId: 'stored-run', input: 'look' }],
  ]);
});

test('startPhase1Game ignores stored terminal runs and starts a new run for the existing character', async () => {
  const calls = [];
  const clientState = { character: {}, gameSession: { characterId: 'char-1', adventureRunId: 'old-run', adventureRun: { id: 'old-run', status: 'completed' } } };
  const api = {
    bootstrapGame: async (body) => { calls.push(['bootstrap', body]); return { state: { characters: [{ id: 'char-1', name: 'Ada', isAlive: true }] } }; },
    sendGameCommand: async () => { throw new Error('must not resume terminal run'); },
    createGameCharacter: async () => { throw new Error('must not create duplicate character'); },
    startGameAdventure: async (body) => {
      calls.push(['start', body]);
      return { text: 'New cave entrance', choices: ['south'], state: { character: { id: 'char-1', name: 'Ada' }, adventureRun: { id: 'new-run', status: 'active' } } };
    },
  };

  await startPhase1Game({ playerId: 'player-1', promptName: () => 'Ada', api, state: clientState, renderResponse: () => {} });

  assert.deepEqual(calls, [
    ['bootstrap', { playerId: 'player-1', displayName: 'Ada' }],
    ['start', { playerId: 'player-1', characterId: 'char-1', adventureId: 'beginners-cave' }],
  ]);
  assert.equal(clientState.gameSession.adventureRunId, 'new-run');
});

test('startPhase1Game reuses an existing bootstrap character before creating a new one', async () => {
  const calls = [];
  const clientState = { character: {}, gameSession: {} };
  const api = {
    bootstrapGame: async (body) => {
      calls.push(['bootstrap', body]);
      return { state: { characters: [{ id: 'char-existing', name: 'Ada', isAlive: true }] } };
    },
    createGameCharacter: async () => { throw new Error('must not create duplicate character'); },
    startGameAdventure: async (body) => {
      calls.push(['start', body]);
      return { text: 'Cave entrance', choices: ['south'], state: { character: { id: 'char-existing', name: 'Ada' }, adventureRun: { id: 'run-new', status: 'active' } } };
    },
  };

  await startPhase1Game({
    playerId: 'player-1',
    promptName: () => 'Ada',
    api,
    state: clientState,
    renderResponse: (response) => calls.push(['render', response.text]),
  });

  assert.deepEqual(calls, [
    ['bootstrap', { playerId: 'player-1', displayName: 'Ada' }],
    ['start', { playerId: 'player-1', characterId: 'char-existing', adventureId: 'beginners-cave' }],
    ['render', 'Cave entrance'],
  ]);
});

test('applyGameResponse does not mutate character when response lacks state.character', () => {
  const clientState = { character: { name: 'Server Hero', gold: 7 }, gameSession: {} };

  applyGameResponse({ text: 'Noise [GOLD:+50]', choices: [], state: {} }, {
    state: clientState,
    renderText() {},
    clearChoices() {},
    addChoice() {},
    renderChoices() {},
    updateHUD() { throw new Error('HUD must not update without server character'); },
    setInputState() {},
  });

  assert.deepEqual(clientState.character, { name: 'Server Hero', gold: 7 });
});

test('startPhase1Game bootstraps /api/game, creates default warrior, starts beginners-cave, and renders start response', async () => {
  const calls = [];
  const clientState = { character: {}, gameSession: {} };
  const api = {
    bootstrapGame: async (body) => { calls.push(['bootstrap', body]); return { ok: true }; },
    createGameCharacter: async (body) => {
      calls.push(['create', body]);
      return { state: { character: { id: 'char-1', name: body.name, gold: 0 } } };
    },
    startGameAdventure: async (body) => {
      calls.push(['start', body]);
      return { text: 'Cave entrance', choices: ['south'], state: { character: { id: 'char-1', name: 'Ada', gold: 0 }, adventureRun: { id: 'run-1' } } };
    },
  };

  await startPhase1Game({
    playerId: 'player-1',
    promptName: () => 'Ada',
    api,
    state: clientState,
    renderResponse: (response) => calls.push(['render', response.text, response.choices]),
  });

  assert.deepEqual(calls, [
    ['bootstrap', { playerId: 'player-1', displayName: 'Ada' }],
    ['create', { playerId: 'player-1', name: 'Ada', className: 'warrior' }],
    ['start', { playerId: 'player-1', characterId: 'char-1', adventureId: 'beginners-cave' }],
    ['render', 'Cave entrance', ['south']],
  ]);
  assert.equal(clientState.gameSession.characterId, 'char-1');
  assert.equal(clientState.gameSession.adventureRunId, 'run-1');
});

test('sendPhase1Command posts commands to /api/game/command only after adventure run exists', async () => {
  const calls = [];
  const clientState = { gameSession: { characterId: 'char-1', adventureRunId: 'run-1' } };
  const api = {
    sendGameCommand: async (body) => {
      calls.push(body);
      return { text: 'You go south.', choices: ['north'], state: { character: { id: 'char-1' }, adventureRun: { id: 'run-1' } } };
    },
  };

  await sendPhase1Command({
    playerId: 'player-1',
    input: 'south',
    api,
    state: clientState,
    renderResponse: (response) => calls.push(['render', response.text]),
  });

  assert.deepEqual(calls, [
    { playerId: 'player-1', characterId: 'char-1', adventureRunId: 'run-1', input: 'south' },
    ['render', 'You go south.'],
  ]);

  await assert.rejects(() => sendPhase1Command({ playerId: 'player-1', input: 'look', api, state: { gameSession: {} } }), /No active adventure run/);
});
