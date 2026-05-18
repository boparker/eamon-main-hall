import {
  registerAccount,
  loginAccount,
  getCurrentAccount,
  logoutAccount,
} from './auth-api.js';
import {
  getStoredAuthSession,
  saveAuthSession,
  clearAuthSession,
} from './auth-state.js';

function sessionFromAuthPayload(payload, previousSession = null) {
  const profiles = payload.profiles ?? previousSession?.profiles ?? [];
  const payloadProfileId = payload.profileId;
  const previousProfileId = previousSession?.profileId;
  const profileId = payloadProfileId ?? (profiles.some((profile) => profile?.id === previousProfileId) ? previousProfileId : undefined);
  return {
    token: payload.token ?? payload.sessionToken ?? previousSession?.sessionToken,
    user: payload.user ?? previousSession?.user ?? null,
    profiles,
    profileId,
  };
}

export function createAuthController({
  api = { registerAccount, loginAccount, getCurrentAccount, logoutAccount },
  storage = globalThis.localStorage,
} = {}) {
  let session = getStoredAuthSession(storage);

  function persist(payload) {
    session = saveAuthSession(payload, storage);
    return session;
  }

  return {
    getSession() {
      return session;
    },

    gameIdentity() {
      if (!session?.sessionToken || !session?.profileId) return null;
      return { sessionToken: session.sessionToken, profileId: session.profileId };
    },

    async register(input) {
      const payload = await api.registerAccount(input);
      return persist(sessionFromAuthPayload(payload));
    },

    async login(input) {
      const payload = await api.loginAccount(input);
      return persist(sessionFromAuthPayload(payload));
    },

    async refreshCurrentAccount() {
      if (!session?.sessionToken) return null;
      const payload = await api.getCurrentAccount(session.sessionToken);
      return persist(sessionFromAuthPayload(payload, session));
    },

    selectProfile(profileId) {
      if (!session?.sessionToken) throw new Error('No account session is active.');
      const profiles = Array.isArray(session.profiles) ? session.profiles : [];
      if (!profiles.some((profile) => profile?.id === profileId)) {
        throw new Error('Profile is not available for this account session.');
      }
      return persist({ ...session, profileId });
    },

    async logout() {
      const token = session?.sessionToken;
      if (token) await api.logoutAccount(token);
      clearAuthSession(storage);
      session = null;
      return null;
    },
  };
}
