import {
  bootstrapGame,
  createGameCharacter,
  sendGameCommand,
  sendHallCommand,
  startGameAdventure,
} from './api.js';

const DEFAULT_CLASSES = new Set(['warrior', 'rogue', 'mystic']);

function defaultStatsForClass(className) {
  if (className === 'rogue') return { hardiness: 10, agility: 12, charisma: 9, hd: 10, maxHd: 10, gold: 75 };
  if (className === 'mystic') return { hardiness: 8, agility: 9, charisma: 12, hd: 8, maxHd: 8, gold: 75 };
  return { hardiness: 12, agility: 9, charisma: 8, hd: 12, maxHd: 12, gold: 75 };
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
  statsGenerator = defaultStatsForClass,
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
      clientState.phase = 'great-hall';
      clientState.creation = { step: 'name' };
      prompt('Name your character.');
    }
    return applied;
  }

  function prompt(text) {
    render({ ok: true, text, choices: [], state: { phase: 'great-hall', character: clientState.character } });
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
      creation.step = 'class';
      prompt('Choose a class/type: warrior, rogue, or mystic.');
      return null;
    }
    if (creation.step === 'class') {
      const className = normalizeText(input).split(' ')[0];
      if (!DEFAULT_CLASSES.has(className)) {
        prompt('Choose warrior, rogue, or mystic.');
        return null;
      }
      creation.className = className;
      creation.stats = statsGenerator(className);
      creation.step = 'confirm';
      prompt(`Review stats for ${creation.name} the ${className}: Hardiness ${creation.stats.hardiness}, Agility ${creation.stats.agility}, Charisma ${creation.stats.charisma}, HD ${creation.stats.hd}/${creation.stats.maxHd}, Gold ${creation.stats.gold}. Type confirm to save.`);
      return null;
    }
    if (creation.step === 'confirm') {
      if (isCreateCharacter(input)) {
        clientState.creation = { step: 'name' };
        prompt('Name your character.');
        return null;
      }
      if (!isConfirm(input)) {
        prompt('Type confirm to create this character, or create character to restart.');
        return null;
      }
      const payload = {
        playerId,
        name: creation.name,
        className: creation.className,
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
      clientState.phase = 'great-hall';
      clientState.creation = { step: 'name' };
      prompt('Name your character.');
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
