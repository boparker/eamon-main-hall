const AUTH_SESSION_KEY = 'eamonAuthSession';

function safeStorage(storage = globalThis.localStorage) {
  return storage ?? null;
}

export function activeProfileId(session = {}) {
  const profiles = Array.isArray(session.profiles) ? session.profiles : [];
  if (session.selectedProfileId && profiles.some((profile) => profile?.id === session.selectedProfileId)) {
    return session.selectedProfileId;
  }
  return profiles[0]?.id ?? null;
}

function normalizeSession(input = {}) {
  const sessionToken = input.sessionToken ?? input.token ?? null;
  if (!sessionToken) return null;
  const profiles = Array.isArray(input.profiles) ? input.profiles : [];
  const profileId = input.profileId ?? activeProfileId({ ...input, profiles });
  return {
    sessionToken,
    user: input.user ?? null,
    profiles,
    profileId,
  };
}

export function getStoredAuthSession(storage = globalThis.localStorage) {
  const target = safeStorage(storage);
  if (!target) return null;
  try {
    const raw = target.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const session = normalizeSession(JSON.parse(raw));
    if (!session?.sessionToken || !session?.profileId) {
      target.removeItem(AUTH_SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    target.removeItem(AUTH_SESSION_KEY);
    return null;
  }
}

export function saveAuthSession(input, storage = globalThis.localStorage) {
  const target = safeStorage(storage);
  const session = normalizeSession(input);
  if (!target || !session?.sessionToken || !session?.profileId) return null;
  target.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  return session;
}

export function clearAuthSession(storage = globalThis.localStorage) {
  const target = safeStorage(storage);
  target?.removeItem?.(AUTH_SESSION_KEY);
}
