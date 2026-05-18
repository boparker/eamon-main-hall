import crypto from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ADVENTURES_DIR = join(__dirname, '../../data/adventures');

function loadKnownAdventureIds(adventuresDir = DEFAULT_ADVENTURES_DIR) {
  try {
    return new Set(readdirSync(adventuresDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => JSON.parse(readFileSync(join(adventuresDir, file), 'utf8'))?.adventure?.id)
      .filter(Boolean));
  } catch {
    return new Set();
  }
}

const DEFAULT_KNOWN_ADVENTURE_IDS = loadKnownAdventureIds();

function assertKnownAdventureId(adventureId, knownAdventureIds = DEFAULT_KNOWN_ADVENTURE_IDS) {
  if (!knownAdventureIds?.has?.(adventureId)) {
    throw new Error(`Unknown adventure_id ${String(adventureId)}; expected a known JSON adventure slug`);
  }
}

const JSON_FIELDS = new Set(['roomState', 'enemyState', 'collectedItems', 'discoveredItems', 'flags']);
const COLUMN_BY_FIELD = {
  currentRoom: 'current_room',
  roomState: 'room_state',
  enemyState: 'enemy_state',
  collectedItems: 'collected_items',
  discoveredItems: 'discovered_items',
  flags: 'flags',
  status: 'status',
  completedAt: 'completed_at',
};

const jsonParam = (value) => JSON.stringify(value);

function runOwnerWhere(owner, startIndex = 2) {
  if (typeof owner === 'object' && owner?.playerId && owner?.userId && owner?.profileId) {
    return {
      clause: `player_id = $${startIndex} AND user_id = $${startIndex + 1} AND profile_id = $${startIndex + 2}`,
      params: [owner.playerId, owner.userId, owner.profileId],
    };
  }
  return { clause: `player_id = $${startIndex}`, params: [owner] };
}

export async function createAdventureRun(db, {
  id = crypto.randomUUID(),
  playerId,
  userId = null,
  profileId = null,
  characterId,
  adventureId,
  currentRoom,
  roomState = {},
  enemyState = {},
  collectedItems = [],
  discoveredItems = [],
  flags = {},
  knownAdventureIds = DEFAULT_KNOWN_ADVENTURE_IDS,
}) {
  assertKnownAdventureId(adventureId, knownAdventureIds);

  const registered = userId && profileId;
  const columns = registered
    ? 'id, player_id, user_id, profile_id, character_id, adventure_id, current_room,\n      room_state, enemy_state, collected_items, discovered_items, flags'
    : 'id, player_id, character_id, adventure_id, current_room,\n      room_state, enemy_state, collected_items, discovered_items, flags';
  const select = registered
    ? '$1, $2, $3, $4, pc.id, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb'
    : '$1, $2, pc.id, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb';
  const where = registered
    ? 'pc.id = $5 AND pc.user_id = $3 AND pc.profile_id = $4'
    : 'pc.id = $3 AND pc.player_id = $2';
  const params = registered
    ? [id, playerId, userId, profileId, characterId, adventureId, currentRoom, jsonParam(roomState), jsonParam(enemyState), jsonParam(collectedItems), jsonParam(discoveredItems), jsonParam(flags)]
    : [id, playerId, characterId, adventureId, currentRoom, jsonParam(roomState), jsonParam(enemyState), jsonParam(collectedItems), jsonParam(discoveredItems), jsonParam(flags)];

  const result = await db.query(`
    INSERT INTO adventure_runs (
      ${columns}
    )
    SELECT ${select}
    FROM player_characters pc
    WHERE ${where}
    RETURNING *
  `, params);
  return result.rows[0] ?? null;
}

export async function getAdventureRun(db, owner, runId) {
  const scope = runOwnerWhere(owner, 2);
  const result = await db.query(
    `SELECT * FROM adventure_runs WHERE id = $1 AND ${scope.clause}`,
    [runId, ...scope.params],
  );
  return result.rows[0] ?? null;
}

export async function updateAdventureRun(db, owner, runId, patch = {}) {
  const assignments = [];
  const params = [];

  for (const [field, value] of Object.entries(patch)) {
    const column = COLUMN_BY_FIELD[field];
    if (!column) continue;
    params.push(JSON_FIELDS.has(field) ? jsonParam(value) : value);
    const cast = JSON_FIELDS.has(field) ? '::jsonb' : '';
    assignments.push(`${column} = $${params.length}${cast}`);
  }

  if (assignments.length === 0) return getAdventureRun(db, owner, runId);

  params.push(runId);
  const scope = runOwnerWhere(owner, params.length + 1);
  params.push(...scope.params);
  const result = await db.query(`
    UPDATE adventure_runs SET
      ${assignments.join(',\n      ')},
      updated_at = NOW()
    WHERE id = $${params.length - scope.params.length} AND ${scope.clause}
    RETURNING *
  `, params);
  return result.rows[0] ?? null;
}

export async function completeAdventureRun(db, playerId, runId) {
  const result = await db.query(`
    UPDATE adventure_runs SET
      status = 'completed',
      updated_at = NOW(),
      completed_at = NOW()
    WHERE id = $1 AND player_id = $2
    RETURNING *
  `, [runId, playerId]);
  return result.rows[0] ?? null;
}

export async function abandonAdventureRun(db, playerId, runId) {
  const result = await db.query(`
    UPDATE adventure_runs SET
      status = 'abandoned',
      updated_at = NOW(),
      completed_at = NOW()
    WHERE id = $1 AND player_id = $2
    RETURNING *
  `, [runId, playerId]);
  return result.rows[0] ?? null;
}
