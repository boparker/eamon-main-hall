import crypto from 'node:crypto';

const jsonParam = (value) => JSON.stringify(value ?? {});

// Store a freshly generated portrait PNG for a character (one row per generation;
// we always read the most recent). `png` must be a Node Buffer (BYTEA).
export async function insertPortrait(db, { id = crypto.randomUUID(), characterId, png, meta = {} }) {
  const result = await db.query(
    `INSERT INTO character_portraits (id, character_id, png, meta)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, character_id, meta, created_at`,
    [id, characterId, png, jsonParam(meta)],
  );
  return result.rows[0] ?? null;
}

// The character's latest portrait bytes (row.png is a Buffer from BYTEA), or null.
export async function getPortraitPng(db, characterId) {
  const result = await db.query(
    `SELECT png, meta FROM character_portraits
     WHERE character_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [characterId],
  );
  return result.rows[0] ?? null;
}

export async function setCharacterPortraitUrl(db, characterId, portraitUrl) {
  const result = await db.query(
    `UPDATE player_characters SET portrait_url = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [characterId, portraitUrl],
  );
  return result.rows[0] ?? null;
}
