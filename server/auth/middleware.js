import { hashSessionToken } from './sessions.js';
import { getUserBySessionTokenHash } from '../db/users.js';

function extractBearerToken(req) {
  const header = req?.headers?.authorization ?? req?.headers?.Authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function resolveDb(options = {}) {
  return options.db ?? options.pool;
}

export function optionalAuth(options = {}) {
  const db = resolveDb(options);
  return async function optionalAuthMiddleware(req, res, next) {
    const token = extractBearerToken(req);
    if (!token) {
      req.auth = null;
      return next();
    }

    const tokenHash = hashSessionToken(token);
    const user = await getUserBySessionTokenHash(db, tokenHash);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    req.auth = { user };
    return next();
  };
}

export function requireAuth(options = {}) {
  const db = resolveDb(options);
  return async function requireAuthMiddleware(req, res, next) {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const tokenHash = hashSessionToken(token);
    const user = await getUserBySessionTokenHash(db, tokenHash);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    req.auth = { user };
    return next();
  };
}
