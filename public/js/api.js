function requestHeaders({ body, sessionToken } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;
  return Object.keys(headers).length ? headers : undefined;
}

export async function gameFetch(path, { method = 'GET', body, sessionToken } = {}) {
  const response = await fetch(`/api/game${path}`, {
    method,
    headers: requestHeaders({ body, sessionToken }),
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

function cleanBody(body) {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

export function bootstrapGame({ playerId, displayName, email, sessionToken, profileId } = {}) {
  return gameFetch('/bootstrap', { method: 'POST', sessionToken, body: cleanBody({ playerId, displayName, email, profileId }) });
}

export function listGameCharacters(input) {
  if (typeof input === 'object') {
    const query = input.profileId ? `?profileId=${encodeURIComponent(input.profileId)}` : '';
    return gameFetch(`/characters${query}`, { sessionToken: input.sessionToken });
  }
  return gameFetch(`/characters?playerId=${encodeURIComponent(input)}`);
}

export function createGameCharacter(character) {
  const { sessionToken, ...body } = character;
  return gameFetch('/characters', { method: 'POST', sessionToken, body: cleanBody(body) });
}

export function sendHallCommand({ playerId, characterId, input, sessionToken, profileId }) {
  return gameFetch('/hall', { method: 'POST', sessionToken, body: cleanBody({ playerId, profileId, characterId, input }) });
}

export function startGameAdventure({ playerId, characterId, adventureId, sessionToken, profileId }) {
  return gameFetch('/start-adventure', { method: 'POST', sessionToken, body: cleanBody({ playerId, profileId, characterId, adventureId }) });
}

export function sendGameCommand({ playerId, characterId, adventureRunId, input, sessionToken, profileId }) {
  return gameFetch('/command', { method: 'POST', sessionToken, body: cleanBody({ playerId, profileId, characterId, adventureRunId, input }) });
}

export function getPortraitOptions() {
  return gameFetch('/portrait-options');
}

export function generatePortrait({ characterId, traits, sessionToken, profileId }) {
  return gameFetch('/portrait', { method: 'POST', sessionToken, body: cleanBody({ profileId, characterId, traits }) });
}
