import crypto from 'node:crypto';

export async function upsertPlayer(db, {
  id = crypto.randomUUID(),
  displayName = null,
  authProvider = null,
  authSubject = null,
  email = null,
} = {}) {
  let playerId = id;

  if ((authProvider && authSubject) || email) {
    const existing = await db.query(`
      SELECT id FROM players
      WHERE ($1::text IS NOT NULL AND $2::text IS NOT NULL AND auth_provider = $1 AND auth_subject = $2)
         OR ($3::text IS NOT NULL AND lower(email) = lower($3))
      ORDER BY updated_at DESC
      LIMIT 1
    `, [authProvider, authSubject, email]);
    playerId = existing.rows?.[0]?.id ?? id;
  }

  const result = await db.query(`
    INSERT INTO players (id, display_name, auth_provider, auth_subject, email, last_seen_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (id) DO UPDATE SET
      display_name = COALESCE(EXCLUDED.display_name, players.display_name),
      auth_provider = COALESCE(EXCLUDED.auth_provider, players.auth_provider),
      auth_subject = COALESCE(EXCLUDED.auth_subject, players.auth_subject),
      email = COALESCE(EXCLUDED.email, players.email),
      updated_at = NOW(),
      last_seen_at = NOW()
    RETURNING *
  `, [playerId, displayName, authProvider, authSubject, email]);
  return result.rows[0] ?? null;
}

export async function getPlayer(db, id) {
  const result = await db.query('SELECT * FROM players WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}
