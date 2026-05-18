import express from 'express';

import { requireAuth as defaultRequireAuth } from '../auth/middleware.js';
import { hashSessionToken as defaultHashSessionToken } from '../auth/sessions.js';
import { getUserBySessionTokenHash as defaultGetUserBySessionTokenHash } from '../db/users.js';
import { createProfile as defaultCreateProfile, listProfiles as defaultListProfiles, setSelectedCharacter as defaultSetSelectedCharacter } from '../db/profiles.js';

function resolveDeps(raw = {}) {
  return {
    db: raw.db ?? raw.pool,
    requireAuth: raw.requireAuth ?? defaultRequireAuth,
    hashSessionToken: raw.hashSessionToken ?? defaultHashSessionToken,
    getUserBySessionTokenHash: raw.getUserBySessionTokenHash ?? defaultGetUserBySessionTokenHash,
    createProfile: raw.createProfile ?? defaultCreateProfile,
    listProfiles: raw.listProfiles ?? defaultListProfiles,
    setSelectedCharacter: raw.setSelectedCharacter ?? defaultSetSelectedCharacter,
  };
}

function profileName(body = {}) {
  return String(body.name ?? '').trim();
}

export function createProfilesRouter(rawDeps = {}) {
  const deps = resolveDeps(rawDeps);
  const router = express.Router();
  const auth = deps.requireAuth({
    db: deps.db,
    hashSessionToken: deps.hashSessionToken,
    getUserBySessionTokenHash: deps.getUserBySessionTokenHash,
  });

  router.use(auth);

  router.get('/', async (req, res, next) => {
    try {
      const profiles = await deps.listProfiles(deps.db, req.auth.user.id);
      return res.json({ ok: true, profiles });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const name = profileName(req.body);
      if (!name) return res.status(400).json({ error: 'Profile name is required' });
      const profile = await deps.createProfile(deps.db, req.auth.user.id, name);
      return res.status(201).json({ ok: true, profile });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:profileId/select-character', async (req, res, next) => {
    try {
      const characterId = String(req.body?.characterId ?? '').trim();
      if (!characterId) return res.status(400).json({ error: 'characterId is required' });
      const profile = await deps.setSelectedCharacter(deps.db, req.auth.user.id, req.params.profileId, characterId);
      if (!profile) return res.status(404).json({ error: 'Profile or character not found' });
      return res.json({ ok: true, profile });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

export default createProfilesRouter;
