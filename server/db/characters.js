import crypto from 'node:crypto';

const JSON_FIELDS = new Set(['inventory', 'equipment', 'spells', 'adventuresCompleted']);
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
  spells: 'spells',
  adventuresCompleted: 'adventures_completed',
  isAlive: 'is_alive',
  lastPlayedAt: 'last_played_at',
};

const jsonParam = (value) => JSON.stringify(value);

function ownerScope(owner) {
  if (typeof owner === 'object' && owner?.userId && owner?.profileId) {
    return { where: 'user_id = $1 AND profile_id = $2', params: [owner.userId, owner.profileId], userId: owner.userId, profileId: owner.profileId };
  }
  return { where: 'player_id = $1', params: [owner], playerId: owner };
}

function characterOwnerWhere(owner, startIndex = 2) {
  if (typeof owner === 'object' && owner?.userId && owner?.profileId) {
    return {
      clause: `user_id = $${startIndex} AND profile_id = $${startIndex + 1}`,
      params: [owner.userId, owner.profileId],
    };
  }
  return { clause: `player_id = $${startIndex}`, params: [owner] };
}

export async function createCharacter(db, {
  id = crypto.randomUUID(),
  playerId,
  userId = null,
  profileId = null,
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
      id, player_id, user_id, profile_id, name, class, hardiness, agility, charisma, hd, max_hd,
      gold, bank_gold, inventory, equipment, adventures_completed, is_alive
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16::jsonb, $17)
    RETURNING *
  `, [
    id, playerId, userId, profileId, name, className, hardiness, agility, charisma, hd, maxHd, gold, bankGold,
    jsonParam(inventory), jsonParam(equipment), jsonParam(adventuresCompleted), isAlive,
  ]);
  return result.rows[0] ?? null;
}

export async function listCharacters(db, owner) {
  const scope = ownerScope(owner);
  const result = await db.query(
    `SELECT * FROM player_characters WHERE ${scope.where} ORDER BY updated_at DESC`,
    scope.params,
  );
  return result.rows;
}

export async function getCharacter(db, owner, characterId) {
  const scope = characterOwnerWhere(owner, 2);
  const result = await db.query(
    `SELECT * FROM player_characters WHERE id = $1 AND ${scope.clause}`,
    [characterId, ...scope.params],
  );
  return result.rows[0] ?? null;
}

export async function updateCharacter(db, owner, characterId, patch = {}) {
  const assignments = [];
  const params = [];

  for (const [field, value] of Object.entries(patch)) {
    const column = COLUMN_BY_FIELD[field];
    if (!column) continue;
    params.push(JSON_FIELDS.has(field) ? jsonParam(value) : value);
    const cast = JSON_FIELDS.has(field) ? '::jsonb' : '';
    assignments.push(`${column} = $${params.length}${cast}`);
  }

  if (assignments.length === 0) return getCharacter(db, owner, characterId);

  params.push(characterId);
  const ownerWhere = characterOwnerWhere(owner, params.length + 1);
  params.push(...ownerWhere.params);
  const result = await db.query(`
    UPDATE player_characters SET
      ${assignments.join(',\n      ')},
      updated_at = NOW()
    WHERE id = $${params.length - ownerWhere.params.length} AND ${ownerWhere.clause}
    RETURNING *
  `, params);
  return result.rows[0] ?? null;
}

export async function claimGuestCharacter(db, { guestPlayerId, characterId, userId, profileId }) {
  const result = await db.query(`
    UPDATE player_characters SET
      user_id = $1,
      profile_id = $2,
      updated_at = NOW()
    WHERE id = $3 AND player_id = $4 AND user_id IS NULL AND profile_id IS NULL
    RETURNING *
  `, [userId, profileId, characterId, guestPlayerId]);
  return result.rows[0] ?? null;
}
