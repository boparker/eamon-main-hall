// game-client.js — Phase 1 browser adapter for the deterministic /api/game engine.
// This module is intentionally DOM-light/testable; main.js injects rendering callbacks.

const SESSION_STORAGE_KEY = 'eamon.phase1Session';

export const DEFAULT_ADVENTURE_ID = 'beginners-cave';

export function sanitizeCharacterName(name) {
  const cleaned = String(name ?? '').trim().split(/\s+/).slice(0, 3).join(' ');
  return cleaned || 'Adventurer';
}

export function defaultWarriorCharacter(playerId, name) {
  return {
    playerId,
    name: sanitizeCharacterName(name),
    className: 'warrior',
  };
}

function getAdventureRunId(run) {
  return run?.id ?? run?.adventureRunId ?? null;
}

export function isActiveGameResponse(response) {
  const character = response?.state?.character;
  const run = response?.state?.adventureRun ?? response?.state?.run;
  return character?.isAlive !== false && run?.status === 'active';
}

function getStoredSession(storage = typeof window !== 'undefined' ? window.localStorage : null) {
  try {
    return JSON.parse(storage?.getItem?.(SESSION_STORAGE_KEY) || 'null') || {};
  } catch {
    return {};
  }
}

function persistSession(session, storage = typeof window !== 'undefined' ? window.localStorage : null) {
  try {
    storage?.setItem?.(SESSION_STORAGE_KEY, JSON.stringify(session ?? {}));
  } catch {
    // Session persistence is a convenience only; gameplay still works for this tab.
  }
}

function mergeSessions(stored = {}, current = {}) {
  const merged = { ...stored };
  for (const [key, value] of Object.entries(current ?? {})) {
    if (value !== null && value !== undefined) merged[key] = value;
  }
  return merged;
}

function selectExistingCharacter(characters = [], preferredName = '') {
  const aliveCharacters = characters.filter((character) => character?.isAlive !== false);
  const normalized = sanitizeCharacterName(preferredName).toLowerCase();
  return aliveCharacters.find((character) => String(character.name ?? '').toLowerCase() === normalized)
    ?? aliveCharacters[0]
    ?? null;
}

export function syncGameSessionFromResponse(response, clientState) {
  if (!clientState.gameSession) clientState.gameSession = {};

  const character = response?.state?.character;
  if (character) {
    clientState.character = { ...character };
    if (character.id) clientState.gameSession.characterId = character.id;
  }

  const adventureRun = response?.state?.adventureRun ?? response?.state?.run;
  const adventureRunId = getAdventureRunId(adventureRun);
  if (adventureRunId) clientState.gameSession.adventureRunId = adventureRunId;
  if (adventureRun) {
    clientState.gameSession.adventureRun = adventureRun;
    if (adventureRun.status && adventureRun.status !== 'active') {
      delete clientState.gameSession.adventureRunId;
    }
  }
  persistSession(clientState.gameSession);
}

export function applyGameResponse(response, {
  state,
  renderText,
  clearChoices,
  addChoice,
  renderChoices,
  updateHUD,
  setInputState,
  setLocation,
} = {}) {
  if (!response) return;

  if (typeof renderText === 'function' && response.text) {
    renderText(response.text);
  }

  if (typeof clearChoices === 'function') clearChoices();
  for (const choice of response.choices ?? []) {
    if (typeof addChoice === 'function') addChoice(choice);
  }
  if (typeof renderChoices === 'function') renderChoices();

  const hadServerCharacter = !!response?.state?.character;
  if (state) syncGameSessionFromResponse(response, state);

  if (hadServerCharacter && typeof updateHUD === 'function') updateHUD(true);
  if (typeof setInputState === 'function') setInputState('action', isActiveGameResponse(response));

  // Optional only: Phase 1 main.js deliberately does not pass this callback, avoiding
  // deterministic room names triggering AI image generation through scene.setLocation().
  const roomName = response?.state?.room?.name;
  if (roomName && typeof setLocation === 'function') setLocation(roomName);
}

export async function startPhase1Game({
  playerId,
  promptName,
  api,
  state,
  renderResponse,
  adventureId = DEFAULT_ADVENTURE_ID,
} = {}) {
  if (!playerId) throw new Error('playerId is required to start Phase 1 game');
  if (!api) throw new Error('api helpers are required to start Phase 1 game');

  if (state) {
    state.gameSession = mergeSessions(getStoredSession(), state.gameSession);
  }

  const name = sanitizeCharacterName(typeof promptName === 'function' ? promptName() : 'Adventurer');
  const bootstrapResponse = await api.bootstrapGame({ playerId, displayName: name });

  const storedCharacterId = state?.gameSession?.characterId;
  const storedAdventureRunId = state?.gameSession?.adventureRun?.status === 'active'
    ? state?.gameSession?.adventureRunId
    : null;
  if (storedCharacterId && storedAdventureRunId) {
    const resumeResponse = await api.sendGameCommand({
      playerId,
      characterId: storedCharacterId,
      adventureRunId: storedAdventureRunId,
      input: 'look',
    });
    syncGameSessionFromResponse(resumeResponse, state);
    if (typeof renderResponse === 'function') renderResponse(resumeResponse);
    return resumeResponse;
  }

  const existingCharacter = selectExistingCharacter(bootstrapResponse?.state?.characters, name);
  let characterResponse;
  if (existingCharacter) {
    characterResponse = { state: { character: existingCharacter } };
  } else {
    characterResponse = await api.createGameCharacter(defaultWarriorCharacter(playerId, name));
  }
  syncGameSessionFromResponse(characterResponse, state);

  const characterId = state?.gameSession?.characterId ?? characterResponse?.state?.character?.id;
  if (!characterId) throw new Error('Game API did not return a character id');

  const startResponse = await api.startGameAdventure({ playerId, characterId, adventureId });
  syncGameSessionFromResponse(startResponse, state);
  if (typeof renderResponse === 'function') renderResponse(startResponse);
  return startResponse;
}

export async function sendPhase1Command({
  playerId,
  input,
  api,
  state,
  renderResponse,
} = {}) {
  const characterId = state?.gameSession?.characterId;
  const adventureRunId = state?.gameSession?.adventureRunId;
  if (!characterId || !adventureRunId) throw new Error('No active adventure run is available for commands');

  const response = await api.sendGameCommand({
    playerId,
    characterId,
    adventureRunId,
    input,
  });
  syncGameSessionFromResponse(response, state);
  if (typeof renderResponse === 'function') renderResponse(response);
  return response;
}
