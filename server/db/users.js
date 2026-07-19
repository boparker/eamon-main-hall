import crypto from 'node:crypto';

function normalizeUsername(username) {
  return String(username ?? '').trim().toLowerCase();
}

function normalizeEmail(email) {
  const value = String(email ?? '').trim().toLowerCase();
  return value || null;
}

function randomId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export async function createUser(db, input) {
  const id = input?.id ?? randomId('user');
  const username = normalizeUsername(input?.username);
  const email = normalizeEmail(input?.email);
  const passwordHash = input?.passwordHash;
  const displayName = input?.displayName ?? null;

  if (!username) throw new TypeError('username is required');
  if (!passwordHash) throw new TypeError('passwordHash is required');

  const result = await db.query(
    `INSERT INTO users (id, username, email, password_hash, display_name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, email, display_name, created_at, updated_at, last_login_at`,
    [id, username, email, passwordHash, displayName],
  );
  return result.rows?.[0] ?? null;
}

export async function getUserByUsername(db, username) {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  const result = await db.query(
    `SELECT id, username, email, password_hash, display_name, created_at, updated_at, last_login_at
     FROM users
     WHERE lower(username) = $1
     LIMIT 1`,
    [normalized],
  );
  return result.rows?.[0] ?? null;
}

export async function createUserSession(db, userId, tokenHash, expiresAt, id = randomId('session')) {
  const result = await db.query(
    `INSERT INTO user_sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, token_hash, created_at, expires_at, last_seen_at`,
    [id, userId, tokenHash, expiresAt],
  );
  return result.rows?.[0] ?? null;
}

export async function getUserBySessionTokenHash(db, tokenHash) {
  const result = await db.query(
    `WITH touched AS (
       UPDATE user_sessions
       SET last_seen_at = NOW()
       WHERE token_hash = $1 AND expires_at > NOW()
       RETURNING id, user_id, token_hash, created_at, expires_at, last_seen_at
     )
     SELECT touched.id AS session_id,
            touched.token_hash,
            touched.expires_at,
            touched.last_seen_at,
            u.id,
            u.username,
            u.email,
            u.display_name,
            u.created_at,
            u.updated_at,
            u.last_login_at,
            u.entitlements
     FROM touched
     JOIN users u ON u.id = touched.user_id
     LIMIT 1`,
    [tokenHash],
  );
  return result.rows?.[0] ?? null;
}

export async function deleteUserSession(db, tokenHash) {
  await db.query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
}
