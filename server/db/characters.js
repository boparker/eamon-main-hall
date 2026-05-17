import crypto from 'node:crypto';

const JSON_FIELDS = new Set(['inventory', 'equipment', 'adventuresCompleted']);
const COLUMN_BY_FIELD = {
  name: 'name',
  className: 'class',
  hardiness: 'hardiness',
  agility: 'agility',
  charisma: 'charisma',
  hd: 'hd',
  maxHd: 'max_hd',
  gold: 'gold',
  bankGold: 'bank_gold',
  inventory: 'inventory',
  equipment: 'equipment',
  adventuresCompleted: 'adventures_completed',
  isAlive: 'is_alive',
  lastPlayedAt: 'last_played_at',
};

const jsonParam = (value) => JSON.stringify(value);

export async function createCharacter(db, {
  id = crypto.randomUUID(),
  playerId,
  name,
  className,
  hardiness,
  agility,
  charisma,
  hd,
  maxHd,
  gold = 0,
  bankGold = 0,
  inventory = [],
  equipment = {},
  adventuresCompleted = [],
  isAlive = true,
}) {
  const result = await db.query(`
    INSERT INTO player_characters (
      id, player_id, name, class, hardiness, agility, charisma, hd, max_hd,
      gold, bank_gold, inventory, equipment, adventures_completed, is_alive
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15)
    RETURNING *
  `, [
    id, playerId, name, className, hardiness, agility, charisma, hd, maxHd, gold, bankGold,
    jsonParam(inventory), jsonParam(equipment), jsonParam(adventuresCompleted), isAlive,
  ]);
  return result.rows[0] ?? null;
}

export async function listCharacters(db, playerId) {
  const result = await db.query(
    'SELECT * FROM player_characters WHERE player_id = $1 ORDER BY updated_at DESC',
    [playerId],
  );
  return result.rows;
}

export async function getCharacter(db, playerId, characterId) {
  const result = await db.query(
    'SELECT * FROM player_characters WHERE id = $1 AND player_id = $2',
    [characterId, playerId],
  );
  return result.rows[0] ?? null;
}

export async function updateCharacter(db, playerId, characterId, patch = {}) {
  const assignments = [];
  const params = [];

  for (const [field, value] of Object.entries(patch)) {
    const column = COLUMN_BY_FIELD[field];
    if (!column) continue;
    params.push(JSON_FIELDS.has(field) ? jsonParam(value) : value);
    const cast = JSON_FIELDS.has(field) ? '::jsonb' : '';
    assignments.push(`${column} = $${params.length}${cast}`);
  }

  if (assignments.length === 0) return getCharacter(db, playerId, characterId);

  params.push(characterId, playerId);
  const result = await db.query(`
    UPDATE player_characters SET
      ${assignments.join(',\n      ')},
      updated_at = NOW()
    WHERE id = $${params.length - 1} AND player_id = $${params.length}
    RETURNING *
  `, params);
  return result.rows[0] ?? null;
}
