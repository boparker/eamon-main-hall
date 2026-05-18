export async function gameFetch(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/game${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.text || payload.error || `Game API request failed: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function bootstrapGame({ playerId, displayName, email } = {}) {
  return gameFetch('/bootstrap', { method: 'POST', body: { playerId, displayName, email } });
}

export function listGameCharacters(playerId) {
  return gameFetch(`/characters?playerId=${encodeURIComponent(playerId)}`);
}

export function createGameCharacter(character) {
  return gameFetch('/characters', { method: 'POST', body: character });
}

export function sendHallCommand({ playerId, characterId, input }) {
  return gameFetch('/hall', { method: 'POST', body: { playerId, characterId, input } });
}

export function startGameAdventure({ playerId, characterId, adventureId }) {
  return gameFetch('/start-adventure', { method: 'POST', body: { playerId, characterId, adventureId } });
}

export function sendGameCommand({ playerId, characterId, adventureRunId, input }) {
  return gameFetch('/command', { method: 'POST', body: { playerId, characterId, adventureRunId, input } });
}
