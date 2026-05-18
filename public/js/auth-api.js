function headersFor({ body, sessionToken } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;
  return Object.keys(headers).length ? headers : undefined;
}

export async function authFetch(path, { method = 'GET', body, sessionToken } = {}) {
  const response = await fetch(`/api/auth${path}`, {
    method,
    headers: headersFor({ body, sessionToken }),
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.text || payload.error || `Auth API request failed: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function registerAccount({ username, email, password }) {
  return authFetch('/register', { method: 'POST', body: { username, email, password } });
}

export function loginAccount({ username, password }) {
  return authFetch('/login', { method: 'POST', body: { username, password } });
}

export function getCurrentAccount(sessionToken) {
  return authFetch('/me', { sessionToken });
}

export function logoutAccount(sessionToken) {
  return authFetch('/logout', { method: 'POST', sessionToken });
}
