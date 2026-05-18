import crypto from 'node:crypto';

export function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashSessionToken(token) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new TypeError('session token must be a non-empty string');
  }
  return `sha256$${crypto.createHash('sha256').update(token).digest('base64url')}`;
}

export function sessionExpiry(days = 30) {
  const numericDays = Number.isFinite(days) && days > 0 ? days : 30;
  return new Date(Date.now() + numericDays * 24 * 60 * 60 * 1000);
}
