// state.js — Shared game state (single source of truth)
// All modules import from here instead of using globals.

export const SESSION_ID = 'eamon-' + Math.random().toString(36).slice(2, 10);

export const state = {
  voiceEnabled: true,
  musicEnabled: true,
  isStreaming: false,
  gamePhase: 'intro',   // title → intro → named → classed → playing
  character: {},
  currentVoiceId: null,
  pendingState: {
    goldDelta: 0,
    hdDelta: 0,
    inventoryAdds: [],
  },
};

export function applyLocalPurchase(item) {
  state.pendingState.goldDelta -= item.price || 0;
  state.pendingState.inventoryAdds.push({ name: item.name, stats: item.stats });
  state.character.gold = Math.max(0, (state.character.gold || 0) - (item.price || 0));
  if (!state.character.inventory) state.character.inventory = [];
  state.character.inventory.push({ name: item.name, stats: item.stats });
}

export function mergeServerCharacter(serverCharacter = {}) {
  // Server is authoritative for gold and hd — it already tracks stat tag changes.
  const merged = { ...state.character, ...serverCharacter };

  // Keep local inventory additions that the server doesn't know about
  if (!Array.isArray(merged.inventory)) merged.inventory = [];
  if (state.pendingState.inventoryAdds.length) {
    merged.inventory = [...merged.inventory, ...state.pendingState.inventoryAdds];
  }

  state.character = merged;

  // Clear pending state — server has caught up
  state.pendingState = { goldDelta: 0, hdDelta: 0, inventoryAdds: [] };
}
