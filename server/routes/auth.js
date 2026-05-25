import express from 'express';

import { hashPassword as defaultHashPassword, verifyPassword as defaultVerifyPassword } from '../auth/passwords.js';
import { createSessionToken as defaultCreateSessionToken, hashSessionToken as defaultHashSessionToken, sessionExpiry as defaultSessionExpiry } from '../auth/sessions.js';
import { createUser as defaultCreateUser, getUserByUsername as defaultGetUserByUsername, createUserSession as defaultCreateUserSession, getUserBySessionTokenHash as defaultGetUserBySessionTokenHash, deleteUserSession as defaultDeleteUserSession } from '../db/users.js';
import { createProfile as defaultCreateProfile, listProfiles as defaultListProfiles } from '../db/profiles.js';

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email ?? null,
    displayName: user.display_name ?? user.displayName ?? null,
  };
}

function normalizeUsername(username) {
  return String(username ?? '').trim().toLowerCase();
}

function validateRegistration(body = {}) {
  const username = normalizeUsername(body.username);
  const password = String(body.password ?? '');
  if (!/^[a-z0-9_-]{3,32}$/.test(username)) return { error: 'Username must be 3-32 characters using letters, numbers, underscores, or hyphens' };
  if (password.length < 10) return { error: 'Password must be at least 10 characters' };
  return { username, password };
}

function bearerToken(req) {
  const header = req?.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function resolveDeps(raw = {}) {
  return {
    db: raw.db ?? raw.pool,
    hashPassword: raw.hashPassword ?? defaultHashPassword,
    verifyPassword: raw.verifyPassword ?? defaultVerifyPassword,
    createSessionToken: raw.createSessionToken ?? defaultCreateSessionToken,
    hashSessionToken: raw.hashSessionToken ?? defaultHashSessionToken,
    sessionExpiry: raw.sessionExpiry ?? defaultSessionExpiry,
    createUser: raw.createUser ?? defaultCreateUser,
    getUserByUsername: raw.getUserByUsername ?? defaultGetUserByUsername,
    createUserSession: raw.createUserSession ?? defaultCreateUserSession,
    getUserBySessionTokenHash: raw.getUserBySessionTokenHash ?? defaultGetUserBySessionTokenHash,
    deleteUserSession: raw.deleteUserSession ?? defaultDeleteUserSession,
    createProfile: raw.createProfile ?? defaultCreateProfile,
    listProfiles: raw.listProfiles ?? defaultListProfiles,
  };
}

async function issueSession(deps, userId) {
  const sessionToken = deps.createSessionToken();
  const tokenHash = deps.hashSessionToken(sessionToken);
  await deps.createUserSession(deps.db, userId, tokenHash, deps.sessionExpiry());
  return sessionToken;
}

export function createAuthRouter(rawDeps = {}) {
  const deps = resolveDeps(rawDeps);
  const router = express.Router();

  router.post('/register', async (req, res, next) => {
    try {
      const validation = validateRegistration(req.body);
      if (validation.error) return res.status(400).json({ error: validation.error });

      const passwordHash = await deps.hashPassword(validation.password);
      const user = await deps.createUser(deps.db, {
        username: validation.username,
        email: req.body?.email,
        passwordHash,
        displayName: req.body?.displayName ?? validation.username,
      });
      const profile = await deps.createProfile(deps.db, user.id, req.body?.displayName ?? user.username);
      const profiles = [profile];
      const sessionToken = await issueSession(deps, user.id);

      return res.status(201).json({
        ok: true,
        user: publicUser(user),
        profile,
        profiles,
        activeProfile: profile,
        profileId: profile.id,
        sessionToken,
      });
    } catch (err) {
      if (err?.code === '23505') return res.status(409).json({ error: 'Username or email already exists' });
      return next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const username = normalizeUsername(req.body?.username);
      const password = String(req.body?.password ?? '');
      const user = username ? await deps.getUserByUsername(deps.db, username) : null;
      const verified = user ? await deps.verifyPassword(password, user.password_hash) : false;
      if (!verified) return res.status(401).json({ error: 'Invalid username or password' });

      const sessionToken = await issueSession(deps, user.id);
      const profiles = await deps.listProfiles(deps.db, user.id);
      return res.json({ ok: true, user: publicUser(user), profiles, activeProfile: profiles[0] ?? null, sessionToken });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/me', async (req, res, next) => {
    try {
      const token = bearerToken(req);
      if (!token) return res.status(401).json({ error: 'Authentication required' });
      const user = await deps.getUserBySessionTokenHash(deps.db, deps.hashSessionToken(token));
      if (!user) return res.status(401).json({ error: 'Invalid or expired session' });
      const profiles = await deps.listProfiles(deps.db, user.id);
      return res.json({ ok: true, user: publicUser(user), profiles, activeProfile: profiles[0] ?? null });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const token = bearerToken(req);
      if (token) await deps.deleteUserSession(deps.db, deps.hashSessionToken(token));
      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

export default createAuthRouter;
