import { hashSessionToken as defaultHashSessionToken } from './sessions.js';
import { getUserBySessionTokenHash as defaultGetUserBySessionTokenHash } from '../db/users.js';

function extractBearerToken(req) {
  const header = req?.headers?.authorization ?? req?.headers?.Authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function resolveDeps(options = {}) {
  return {
    db: options.db ?? options.pool,
    hashSessionToken: options.hashSessionToken ?? defaultHashSessionToken,
    getUserBySessionTokenHash: options.getUserBySessionTokenHash ?? defaultGetUserBySessionTokenHash,
  };
}

export function optionalAuth(options = {}) {
  const deps = resolveDeps(options);
  return async function optionalAuthMiddleware(req, res, next) {
    const token = extractBearerToken(req);
    if (!token) {
      req.auth = null;
      return next();
    }

    const tokenHash = deps.hashSessionToken(token);
    const user = await deps.getUserBySessionTokenHash(deps.db, tokenHash);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    req.auth = { user };
    return next();
  };
}

export function requireAuth(options = {}) {
  const deps = resolveDeps(options);
  return async function requireAuthMiddleware(req, res, next) {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const tokenHash = deps.hashSessionToken(token);
    const user = await deps.getUserBySessionTokenHash(deps.db, tokenHash);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    req.auth = { user };
    return next();
  };
}
