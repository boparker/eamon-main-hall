export async function profileFetch(path, { method = 'GET', sessionToken, body, fetchImpl = fetch } = {}) {
  const headers = {};
  if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;
  if (body) headers['content-type'] = 'application/json';
  const response = await fetchImpl(`/api/profiles${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || `Profile API request failed: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function selectProfileCharacter({ sessionToken, profileId, characterId, fetchImpl } = {}) {
  return profileFetch(`/${encodeURIComponent(profileId)}/select-character`, {
    method: 'POST',
    sessionToken,
    body: { characterId },
    fetchImpl,
  });
}
