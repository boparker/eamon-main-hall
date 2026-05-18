import {
  bootstrapGame,
  createGameCharacter,
  sendGameCommand,
  sendHallCommand,
  startGameAdventure,
} from './api.js';

function rollDie(sides, rng = Math.random) {
  return Math.floor(rng() * sides) + 1;
}

function roll3d7(rng = Math.random) {
  return rollDie(7, rng) + rollDie(7, rng) + rollDie(7, rng);
}

function defaultStatsForAdventurer(_ignored, rng = Math.random) {
  let hardiness = 0;
  let agility = 0;
  let charisma = 0;
  while (hardiness < 15 || agility < 12 || hardiness + agility + charisma < 42) {
    hardiness = roll3d7(rng);
    agility = roll3d7(rng);
    charisma = roll3d7(rng);
  }
  return { hardiness, agility, charisma, hd: hardiness, maxHd: hardiness, gold: 200 };
}

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function isBeginAdventure(input) {
  const normalized = normalizeText(input);
  const match = normalized.match(/^(begin|start|enter|play)\s+(?:the\s+)?(.+)$/);
  return match?.[2] ?? null;
}

function adventureIdForInput(input, adventures = []) {
  const requested = isBeginAdventure(input);
  if (!requested) return null;
  const normalizedRequested = normalizeText(requested);
  const match = adventures.find((adventure) => {
    const name = normalizeText(adventure.name ?? adventure.title ?? adventure.id);
    const id = normalizeText(adventure.id);
    return normalizedRequested === name || normalizedRequested === id || name.includes(normalizedRequested) || normalizedRequested.includes(id);
  });
  if (match) return match.id;
  if (normalizedRequested === 'adventure' && adventures.length === 1) return adventures[0].id;
  if (/beginner/.test(normalizedRequested) && /cave/.test(normalizedRequested)) return 'beginners-cave';
  return normalizedRequested.replace(/\s+/g, '-');
}

function isCreateCharacter(input) {
  return /create\s+(a\s+)?character|new\s+character/i.test(input);
}

function isConfirm(input) {
  return /^(confirm|yes|y|save|accept)$/i.test(String(input ?? '').trim());
}

function responseCharacter(response) {
  return response?.state?.character ?? response?.state?.characters?.find((character) => character?.isAlive) ?? null;
}

export function createPhase1GameClient({
  api = { bootstrapGame, createGameCharacter, sendGameCommand, sendHallCommand, startGameAdventure },
  playerId,
  displayName = null,
  email = null,
  render = () => {},
  renderPlayer = () => {},
  updateHUD = () => {},
  statsGenerator = defaultStatsForAdventurer,
} = {}) {
  const clientState = {
    phase: 'title',
    player: null,
    character: null,
    characters: [],
    adventureRun: null,
    choices: [],
    unlockedAdventures: [],
    lockedAdventures: [],
    creation: null,
    lastResponse: null,
  };

  function applyResponse(response) {
    clientState.lastResponse = response;
    const state = response?.state ?? {};
    clientState.phase = state.phase ?? clientState.phase;
    clientState.player = state.player ?? clientState.player;
    clientState.character = responseCharacter(response) ?? clientState.character;
    clientState.characters = state.characters ?? clientState.characters;
    clientState.adventureRun = state.adventureRun ?? state.run ?? clientState.adventureRun;
    if (clientState.adventureRun && clientState.adventureRun.status !== 'active' && clientState.phase !== 'adventure') {
      clientState.adventureRun = null;
    }
    clientState.choices = response?.choices ?? [];
    clientState.unlockedAdventures = state.unlockedAdventures ?? clientState.unlockedAdventures;
    clientState.lockedAdventures = state.lockedAdventures ?? clientState.lockedAdventures;
    if (clientState.character) updateHUD(clientState.character, response);
    render(response);
    return response;
  }

  async function startPhase1Game() {
    const response = await api.bootstrapGame({ playerId, displayName, email });
    const applied = applyResponse(response);
    if (!clientState.character) {
      beginCharacterCreation();
    }
    return applied;
  }

  function prompt(text, character = clientState.character) {
    updateHUD(character, { state: { phase: 'great-hall', character } });
    render({ ok: true, text, choices: [], state: { phase: 'great-hall', character } });
  }

  function beginCharacterCreation() {
    clientState.phase = 'great-hall';
    clientState.character = null;
    clientState.adventureRun = null;
    clientState.creation = { step: 'name' };
    prompt('Name your character.', null);
  }

  async function handleCreationInput(input) {
    const creation = clientState.creation;
    if (creation.step === 'name') {
      if (isCreateCharacter(input)) {
        prompt('Name your character.');
        return null;
      }
      if (/register|account|upgrade|login|sign\s*in/i.test(String(input ?? ''))) {
        prompt('Account registration comes next. For now, name this local character so the Great Hall can save your progress.');
        return null;
      }
      creation.name = String(input ?? '').trim().split(/\s+/).slice(0, 3).join(' ');
      creation.step = 'gender';
      prompt('Choose a gender: male or female.');
      return null;
    }
    if (creation.step === 'gender') {
      const normalizedGender = normalizeText(input);
      if (!['m', 'male', 'f', 'female'].includes(normalizedGender)) {
        prompt('Choose a gender: male or female.');
        return null;
      }
      creation.gender = normalizedGender.startsWith('f') ? 'f' : 'm';
      creation.stats = statsGenerator('adventurer');
      creation.step = 'confirm';
      prompt(`Your prime attributes are: Hardiness ${creation.stats.hardiness}, Agility ${creation.stats.agility}, Charisma ${creation.stats.charisma}. You will start with ${creation.stats.gold} gold pieces. Type confirm to begin your adventuring career, reroll to roll again, or create character to restart.`);
      return null;
    }
    if (creation.step === 'confirm') {
      if (isCreateCharacter(input)) {
        beginCharacterCreation();
        return null;
      }
      if (/^(reroll|roll again)$/i.test(String(input ?? '').trim())) {
        creation.stats = statsGenerator('adventurer');
        prompt(`Your prime attributes are: Hardiness ${creation.stats.hardiness}, Agility ${creation.stats.agility}, Charisma ${creation.stats.charisma}. You will start with ${creation.stats.gold} gold pieces. Type confirm to begin your adventuring career, reroll to roll again, or create character to restart.`);
        return null;
      }
      if (!isConfirm(input)) {
        prompt('Type confirm to create this adventurer, reroll to roll again, or create character to restart.');
        return null;
      }
      const payload = {
        playerId,
        name: creation.name,
        className: 'adventurer',
        gender: creation.gender,
        hardiness: creation.stats.hardiness,
        agility: creation.stats.agility,
        charisma: creation.stats.charisma,
        hd: creation.stats.hd ?? creation.stats.hardiness,
        maxHd: creation.stats.maxHd ?? creation.stats.hardiness,
        gold: creation.stats.gold ?? 0,
      };
      clientState.creation = null;
      const response = await api.createGameCharacter(payload);
      return applyResponse(response);
    }
    return null;
  }

  async function handleInput(input) {
    const text = String(input ?? '').trim();
    if (!text) return null;
    renderPlayer(text);

    if (clientState.creation) return handleCreationInput(text);

    if (clientState.phase !== 'adventure' && isCreateCharacter(text)) {
      beginCharacterCreation();
      return null;
    }

    const requestedAdventure = clientState.phase !== 'adventure' ? isBeginAdventure(text) : null;
    const adventurePool = normalizeText(requestedAdventure) === 'adventure'
      ? clientState.unlockedAdventures
      : [...clientState.unlockedAdventures, ...clientState.lockedAdventures];
    const adventureId = requestedAdventure ? adventureIdForInput(text, adventurePool) : null;
    if (adventureId) {
      if (!clientState.character?.id) {
        prompt('Create a character before beginning an adventure.');
        return null;
      }
      const response = await api.startGameAdventure({ playerId, characterId: clientState.character.id, adventureId });
      return applyResponse(response);
    }

    if (clientState.phase === 'adventure' && clientState.adventureRun?.status === 'active') {
      const response = await api.sendGameCommand({
        playerId,
        characterId: clientState.character?.id,
        adventureRunId: clientState.adventureRun.id,
        input: text,
      });
      return applyResponse(response);
    }

    if (clientState.character?.id) {
      const response = await api.sendHallCommand({ playerId, characterId: clientState.character.id, input: text });
      return applyResponse(response);
    }

    prompt('You are in the Great Hall. Create a character before adventuring.');
    return null;
  }

  return {
    startPhase1Game,
    handleInput,
    applyResponse,
    getState: () => ({ ...clientState }),
  };
}
