import crypto from 'node:crypto';

function randomId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function normalizeProfileName(name) {
  return String(name ?? '').trim();
}

export async function createProfile(db, userId, name, id = randomId('profile')) {
  const profileName = normalizeProfileName(name);
  if (!userId) throw new TypeError('userId is required');
  if (!profileName) throw new TypeError('profile name is required');

  const result = await db.query(
    `INSERT INTO player_profiles (id, user_id, name)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, name, selected_character_id, created_at, updated_at`,
    [id, userId, profileName],
  );
  return result.rows?.[0] ?? null;
}

export async function listProfiles(db, userId) {
  const result = await db.query(
    `SELECT id, user_id, name, selected_character_id, created_at, updated_at
     FROM player_profiles
     WHERE user_id = $1
     ORDER BY created_at ASC, name ASC`,
    [userId],
  );
  return result.rows ?? [];
}

export async function getProfile(db, userId, profileId) {
  const result = await db.query(
    `SELECT id, user_id, name, selected_character_id, created_at, updated_at
     FROM player_profiles
     WHERE user_id = $1 AND id = $2
     LIMIT 1`,
    [userId, profileId],
  );
  return result.rows?.[0] ?? null;
}

export async function setSelectedCharacter(db, userId, profileId, characterId) {
  const result = await db.query(
    `UPDATE player_profiles
     SET selected_character_id = $3,
         updated_at = NOW()
     WHERE user_id = $1
       AND id = $2
       AND EXISTS (
         SELECT 1
         FROM player_characters
         WHERE id = $3
           AND user_id = $1
           AND profile_id = $2
       )
     RETURNING id, user_id, name, selected_character_id, created_at, updated_at`,
    [userId, profileId, characterId],
  );
  return result.rows?.[0] ?? null;
}
