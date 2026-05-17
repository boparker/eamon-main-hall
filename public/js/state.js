// state.js — Shared game state (single source of truth)
// All modules import from here instead of using globals.

export const LOCAL_PLAYER_ID_KEY = 'eamon.localPlayerId';

export function getOrCreateLocalPlayerId({
  localStorage = typeof window !== 'undefined' ? window.localStorage : null,
  randomUUID = typeof crypto !== 'undefined' ? crypto.randomUUID?.bind(crypto) : null,
} = {}) {
  const existing = localStorage?.getItem?.(LOCAL_PLAYER_ID_KEY);
  if (existing) return existing;

  const suffix = typeof randomUUID === 'function'
    ? randomUUID()
    : Math.random().toString(36).slice(2, 10);
  const playerId = `local-player-${suffix}`;
  try {
    localStorage?.setItem?.(LOCAL_PLAYER_ID_KEY, playerId);
  } catch {
    // localStorage can be unavailable or quota-blocked; the fallback id still works for this session.
  }
  return playerId;
}

export const PLAYER_ID = getOrCreateLocalPlayerId();
export const SESSION_ID = PLAYER_ID;

export const state = {
  phase1Mode: true,
  // Phase 1 uses deterministic text responses. Audio/TTS/image generation paths are opt-in legacy UX.
  voiceEnabled: false,
  musicEnabled: true,
  isStreaming: false,
  gamePhase: 'title',   // title → playing
  character: {},
  currentVoiceId: null,
  gameSession: {
    playerId: PLAYER_ID,
    characterId: null,
    adventureRunId: null,
  },
};

export function mergeServerCharacter(serverCharacter = {}) {
  // Server is authoritative for every character field in Phase 1.
  state.character = { ...serverCharacter };
}
