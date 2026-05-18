import express from 'express';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCommand } from '../engine/commands.js';
import {
  getCurrentRoom,
  getVisibleRoomEntities,
  markEnemyDefeated,
  markItemCollected,
  move,
} from '../engine/adventures.js';
import { resolveCombatRound } from '../engine/combat.js';
import { convertTreasuresOnReturn, takeTreasure } from '../engine/economy.js';
import {
  renderCombatResult,
  renderInventory,
  renderMoveBlocked,
  renderReturnToHall,
  renderRoom,
} from '../engine/renderer.js';
import { upsertPlayer as defaultUpsertPlayer } from '../db/players.js';
import { optionalAuth as defaultOptionalAuth } from '../auth/middleware.js';
import { hashSessionToken as defaultHashSessionToken } from '../auth/sessions.js';
import { getUserBySessionTokenHash as defaultGetUserBySessionTokenHash } from '../db/users.js';
import {
  createCharacter as defaultCreateCharacter,
  getCharacter as defaultGetCharacter,
  listCharacters as defaultListCharacters,
  updateCharacter as defaultUpdateCharacter,
} from '../db/characters.js';
import {
  abandonAdventureRun as defaultAbandonAdventureRun,
  completeAdventureRun as defaultCompleteAdventureRun,
  createAdventureRun as defaultCreateAdventureRun,
  getAdventureRun as defaultGetAdventureRun,
  updateAdventureRun as defaultUpdateAdventureRun,
} from '../db/adventureRuns.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ADVENTURES_DIR = join(__dirname, '../../data/adventures');
const DIRECTIONS = ['north', 'south', 'east', 'west', 'up', 'down'];
const DEFAULT_CLASS_STATS = {
  adventurer: { hardiness: 15, agility: 12, charisma: 15 },
  warrior: { hardiness: 12, agility: 9, charisma: 8 },
  rogue: { hardiness: 10, agility: 12, charisma: 9 },
  mystic: { hardiness: 8, agility: 9, charisma: 12 },
};

const BEGINNERS_CAVE_ID = 'beginners-cave';

const HALL_SHOP_ITEMS = [
  { slug: 'short-sword', name: 'Short Sword', price: 30, category: 'weapon', equipmentSlot: 'weapon', stats: { damage: '1d6', type: 'Sword' } },
  { slug: 'broadsword', name: 'Broadsword', price: 60, category: 'weapon', equipmentSlot: 'weapon', stats: { damage: '2d6', type: 'Sword' } },
  { slug: 'battle-axe', name: 'Battle Axe', price: 80, category: 'weapon', equipmentSlot: 'weapon', stats: { damage: '2d8', type: 'Axe' } },
  { slug: 'mace', name: 'Mace', price: 50, category: 'weapon', equipmentSlot: 'weapon', stats: { damage: '2d4', type: 'Mace' } },
  { slug: 'spear', name: 'Spear', price: 40, category: 'weapon', equipmentSlot: 'weapon', stats: { damage: '1d8', type: 'Spear' } },
  { slug: 'war-hammer', name: 'War Hammer', price: 90, category: 'weapon', equipmentSlot: 'weapon', stats: { damage: '3d6', type: 'Hammer' } },
  { slug: 'leather-armor', name: 'Leather Armor', price: 50, category: 'armor', equipmentSlot: 'armor', stats: { defense: '+2', type: 'Armor' } },
  { slug: 'chain-mail', name: 'Chain Mail', price: 120, category: 'armor', equipmentSlot: 'armor', stats: { defense: '+5', agility: '-1', type: 'Armor' } },
  { slug: 'plate-armor', name: 'Plate Armor', price: 200, category: 'armor', equipmentSlot: 'armor', stats: { defense: '+8', agility: '-3', type: 'Armor' } },
  { slug: 'shield', name: 'Shield', price: 40, category: 'armor', equipmentSlot: 'shield', stats: { defense: '+2', type: 'Shield' } },
];

function loadJsonAdventures(adventuresDir = DEFAULT_ADVENTURES_DIR) {
  return readdirSync(adventuresDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(join(adventuresDir, file), 'utf8')));
}

function adventureSummary(manifest) {
  return {
    id: manifest.adventure.id,
    name: manifest.adventure.name,
    description: manifest.adventure.description ?? '',
    difficulty: manifest.adventure.difficulty ?? null,
    startRoom: manifest.adventure.start_room,
  };
}

function findAdventure(adventures, adventureId) {
  return adventures.find((manifest) => manifest?.adventure?.id === adventureId) ?? null;
}

function choicesForRoom(room) {
  return DIRECTIONS.filter((direction) => room?.exits?.[direction] !== null && room?.exits?.[direction] !== undefined);
}

function findItem(adventure, slugOrName) {
  const target = normalizeTarget(slugOrName);
  return adventure.items.find((item) => normalizeTarget(item.slug) === target || normalizeTarget(item.name) === target) ?? null;
}

function normalizeTarget(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^(?:the|a|an)\s+/, '');
}

function findVisibleItem(adventure, run, target) {
  const visible = getVisibleRoomEntities(run, adventure);
  const visibleSlugs = new Set((visible.placements ?? []).map((placement) => placement.item_slug));
  const item = findItem(adventure, target);
  return item && visibleSlugs.has(item.slug) ? item : null;
}

function isCollectible(item) {
  return item?.collectible !== false && item?.weight !== -999;
}

function findVisibleEnemy(adventure, run, target) {
  const normalized = normalizeTarget(target);
  const visible = getVisibleRoomEntities(run, adventure);
  return (visible.characters ?? []).find((character) => (
    character.type === 'enemy' || character.type === 'boss'
  ) && (
    normalizeTarget(character.slug) === normalized || normalizeTarget(character.name) === normalized
  )) ?? null;
}

function rowCharacter(row) {
  if (!row) return null;
  return {
    id: row.id,
    playerId: row.player_id,
    userId: row.user_id ?? null,
    profileId: row.profile_id ?? null,
    name: row.name,
    className: row.class,
    hardiness: row.hardiness,
    agility: row.agility,
    charisma: row.charisma,
    hd: row.hd,
    maxHd: row.max_hd,
    hp: row.hd,
    maxHp: row.max_hd,
    gold: row.gold,
    bankGold: row.bank_gold,
    inventory: Array.isArray(row.inventory) ? row.inventory : [],
    equipment: row.equipment ?? {},
    adventuresCompleted: Array.isArray(row.adventures_completed) ? row.adventures_completed : [],
    isAlive: row.is_alive,
  };
}

function rowRun(row) {
  if (!row) return null;
  const roomState = row.room_state ?? {};
  const enemyState = row.enemy_state ?? {};
  return {
    id: row.id,
    playerId: row.player_id,
    userId: row.user_id ?? null,
    profileId: row.profile_id ?? null,
    characterId: row.character_id,
    adventureId: row.adventure_id,
    currentRoom: row.current_room,
    visitedRooms: Array.isArray(roomState.visitedRooms) ? roomState.visitedRooms : [row.current_room],
    collectedItems: Array.isArray(row.collected_items) ? row.collected_items : [],
    discoveredItems: Array.isArray(row.discovered_items) ? row.discovered_items : [],
    defeatedEnemies: Array.isArray(enemyState.defeatedEnemies) ? enemyState.defeatedEnemies : [],
    enemyHp: enemyState.enemyHp ?? {},
    roomState,
    enemyState,
    flags: row.flags ?? {},
    status: row.status,
  };
}

function dbRunPatch(run) {
  return {
    currentRoom: run.currentRoom,
    roomState: { ...(run.roomState ?? {}), visitedRooms: run.visitedRooms ?? [] },
    enemyState: { ...(run.enemyState ?? {}), defeatedEnemies: run.defeatedEnemies ?? [], enemyHp: run.enemyHp ?? {} },
    collectedItems: run.collectedItems ?? [],
    discoveredItems: run.discoveredItems ?? [],
    flags: run.flags ?? {},
    status: run.status,
  };
}

function characterPatch(character) {
  return {
    hd: character.hd ?? character.hp,
    gold: character.gold,
    inventory: character.inventory ?? [],
    equipment: character.equipment ?? {},
    adventuresCompleted: character.adventuresCompleted ?? [],
    isAlive: character.isAlive ?? ((character.hd ?? character.hp ?? 1) > 0),
  };
}

function visibleItems(adventure, entities) {
  const visibleSlugs = new Set((entities.placements ?? []).map((placement) => placement.item_slug));
  return adventure.items.filter((item) => visibleSlugs.has(item.slug));
}

function canonicalResponse({
  intent = null,
  event = null,
  events = null,
  text,
  choices = [],
  state = {},
  media = { voice: null, background: null, portraits: [] },
}) {
  const canonicalEvents = events ?? (event ? [event] : []);
  const adventureRun = state.adventureRun ?? state.run ?? null;
  return {
    ok: true,
    intent,
    event: event ?? canonicalEvents[0] ?? null,
    events: canonicalEvents,
    text,
    choices,
    state: {
      phase: adventureRun?.status === 'active' ? 'adventure' : 'main-hall',
      ...state,
      ...(adventureRun ? { adventureRun, run: adventureRun } : {}),
    },
    media,
  };
}

function playerSummary(player) {
  if (!player) return null;
  return {
    id: player.id,
    displayName: player.display_name ?? player.displayName ?? null,
    email: player.email ?? null,
    authProvider: player.auth_provider ?? player.authProvider ?? null,
    authSubject: player.auth_subject ?? player.authSubject ?? null,
  };
}

function isBeginnerComplete(character) {
  return Array.isArray(character?.adventuresCompleted) && character.adventuresCompleted.includes(BEGINNERS_CAVE_ID);
}

function partitionAdventures(adventures, character) {
  const summaries = adventures.map(adventureSummary);
  const beginner = summaries.find((adventure) => adventure.id === BEGINNERS_CAVE_ID);
  const later = summaries.filter((adventure) => adventure.id !== BEGINNERS_CAVE_ID);
  if (!character || !isBeginnerComplete(character)) {
    return {
      unlockedAdventures: beginner ? [beginner] : [],
      lockedAdventures: later.map((adventure) => ({ ...adventure, lockedReason: "Complete The Beginner's Cave first." })),
    };
  }
  return { unlockedAdventures: summaries, lockedAdventures: [] };
}

function hallChoices(character, unlockedAdventures = []) {
  if (!character) return ['Create Character', 'Sign the Guild Rolls'];
  if (!character.isAlive || character.hd <= 0) return ['Create Character', 'Sign the Guild Rolls'];
  const adventureChoices = unlockedAdventures.map((adventure) => `Begin ${String(adventure.name).replace(/^The\s+/i, '')}`);
  return ['Create Character', 'Sign the Guild Rolls', 'Visit Weapons Shop', 'Visit Armor Shop', 'View Equipment', ...adventureChoices];
}

function hallText({ player, character, unlockedAdventures, lockedAdventures, prefix = '' }) {
  const playerName = player?.displayName || player?.id || 'wanderer';
  const lines = [prefix || `You stand in the Great Hall, ${playerName}.`];
  lines.push('The Main Hall keeps your character, equipment, gold, and adventure choices before any expedition begins.');
  if (!character) {
    lines.push('Create a new adventurer: choose a name and gender, roll prime attributes, start with 200 gold, then buy equipment. You may also sign the Guild rolls to preserve an adventurer beyond the Main Hall.');
  } else {
    lines.push(`${character.name} is present in the Guild roster and ready for the next expedition.`);
    const inventory = character.inventory?.length ? character.inventory.map((item) => item.name ?? item.slug).join(', ') : 'none';
    lines.push(`Inventory summary: ${inventory}. Use View Equipment or the HUD for full character details.`);
    lines.push('You may shop for weapons or armor, review equipment, create another character, or explicitly begin The Beginner\'s Cave.');
  }
  if (unlockedAdventures?.length) lines.push(`Unlocked adventures: ${unlockedAdventures.map((adventure) => adventure.name).join(', ')}.`);
  if (lockedAdventures?.length) lines.push(`Locked adventures: ${lockedAdventures.map((adventure) => adventure.name).join(', ')}.`);
  return lines.join('\n');
}

function hallResponse({ player, characters = [], adventures = [], character = null, prefix = '' }) {
  const mappedCharacters = characters.map(rowCharacter);
  const activeCharacter = character ?? mappedCharacters.find((candidate) => candidate?.isAlive && candidate.hd > 0) ?? mappedCharacters[0] ?? null;
  const { unlockedAdventures, lockedAdventures } = partitionAdventures(adventures, activeCharacter);
  const playerState = playerSummary(player);
  return canonicalResponse({
    intent: { type: 'hall' },
    event: { type: 'enter_hall' },
    text: hallText({ player: playerState, character: activeCharacter, unlockedAdventures, lockedAdventures, prefix }),
    choices: hallChoices(activeCharacter, unlockedAdventures),
    state: {
      phase: 'great-hall',
      player: playerState,
      character: activeCharacter,
      characters: mappedCharacters,
      adventures: adventures.map(adventureSummary),
      unlockedAdventures,
      lockedAdventures,
    },
  });
}

function slugify(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function findShopItem(input) {
  const normalized = slugify(String(input ?? '').replace(/^buy\s+/i, ''));
  return HALL_SHOP_ITEMS.find((item) => item.slug === normalized || slugify(item.name) === normalized) ?? null;
}

function shopItemsForInput(input) {
  const normalized = normalizeTarget(input);
  if (/armor|shield|equipment/.test(normalized)) {
    return HALL_SHOP_ITEMS.filter((item) => item.category === 'armor');
  }
  return HALL_SHOP_ITEMS.filter((item) => item.category === 'weapon');
}

function hallState({ player, character, characters, adventures, extra = {} }) {
  return {
    phase: 'great-hall',
    player: playerSummary(player),
    character,
    characters: characters.map((row) => rowCharacter(row) ?? row),
    adventures: adventures.map(adventureSummary),
    ...partitionAdventures(adventures, character),
    ...extra,
  };
}

function equipmentText(character) {
  const inventory = character.inventory?.length
    ? character.inventory.map((item) => item.name ?? item.slug).join(', ')
    : 'none';
  const equipment = character.equipment ?? {};
  const weapon = equipment.weapon?.name ?? equipment.weapon?.slug ?? 'unarmed';
  const armor = equipment.armor?.name ?? equipment.armor?.slug ?? 'none';
  const shield = equipment.shield?.name ?? equipment.shield?.slug ?? 'none';
  return [
    `${character.name}'s Equipment`,
    `Gold: ${character.gold}. Bank: ${character.bankGold}.`,
    `Weapon: ${weapon}. Armor: ${armor}. Shield: ${shield}.`,
    `Inventory: ${inventory}.`,
  ].join('\n');
}

function equipmentResponse({ player, character, characters, adventures }) {
  return canonicalResponse({
    intent: { type: 'hall_equipment' },
    event: { type: 'hall_equipment' },
    text: equipmentText(character),
    choices: ['Visit Weapons Shop', 'Visit Armor Shop', 'Return to Great Hall'],
    state: hallState({ player, character, characters, adventures }),
  });
}

function shopResponse({ player, character, characters, adventures, input }) {
  const items = shopItemsForInput(input);
  const title = items.some((item) => item.category === 'armor') ? 'Armor & Shields' : 'Weapons';
  const catalog = items.map((item) => `${item.name} — ${item.price} gold`).join('\n');
  return canonicalResponse({
    intent: { type: 'hall_shop', input },
    event: { type: 'hall_shop', input },
    text: `${title} available in the Great Hall:\n${catalog}\nType buy followed by the item name to purchase.`,
    choices: items.map((item) => `Buy ${item.name}`).concat(['Return to Great Hall']),
    state: hallState({ player, character, characters, adventures, extra: { shop: { title, items } } }),
  });
}

function roomResponse({ adventure, run, character, text = null, event = { type: 'look' }, intent = null, events = null }) {
  const room = getCurrentRoom(run, adventure);
  const entities = getVisibleRoomEntities(run, adventure);
  const items = visibleItems(adventure, entities);
  return canonicalResponse({
    intent,
    event,
    events,
    text: text ?? renderRoom(room, entities, items, room.exits),
    choices: choicesForRoom(room),
    state: { character, adventureRun: run, room, entities, items },
  });
}

function error(res, status, message, code = 'error') {
  return res.status(status).json({
    ok: false,
    error: code,
    text: message,
    media: { voice: null, background: null, portraits: [] },
  });
}

function requireDb(req, res, db) {
  if (!db) {
    error(res, 503, 'Game persistence is not available because DATABASE_URL is not configured.', 'database-unavailable');
    return false;
  }
  return true;
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

async function loadSession(req, res, deps, adventures) {
  const { characterId, adventureRunId } = req.body ?? {};
  const context = resolveGameContext(req);
  if (context.error || !characterId || !adventureRunId) {
    error(res, 400, context.error ? context.error : 'characterId and adventureRunId are required.', 'bad-request');
    return null;
  }

  const [characterRow, runRow] = await Promise.all([
    deps.getCharacter(deps.db, context.owner, characterId),
    deps.getAdventureRun(deps.db, context.owner, adventureRunId),
  ]);
  if (!characterRow || !runRow || runRow.character_id !== characterId) {
    error(res, 404, 'No matching character/adventure run was found for this player.', 'not-found');
    return null;
  }

  const adventure = findAdventure(adventures, runRow.adventure_id);
  if (!adventure) {
    error(res, 404, `Adventure ${runRow.adventure_id} is not available.`, 'adventure-not-found');
    return null;
  }

  return { character: rowCharacter(characterRow), run: rowRun(runRow), adventure, context };
}

function resolveGameContext(req) {
  const profileId = req.body?.profileId ?? req.query?.profileId ?? null;
  if (req.auth?.user) {
    if (!profileId) return { error: 'profileId is required for registered account play.' };
    const playerId = req.body?.playerId ?? req.query?.playerId ?? `account:${req.auth.user.id}`;
    return {
      playerId,
      owner: { playerId, userId: req.auth.user.id, profileId },
      userId: req.auth.user.id,
      profileId,
      player: { id: playerId, display_name: req.auth.user.display_name ?? req.auth.user.displayName ?? req.auth.user.username ?? null },
      isAuthenticated: true,
    };
  }
  const playerId = req.body?.playerId ?? req.query?.playerId ?? null;
  if (!playerId) return { error: 'playerId is required.' };
  return { playerId, owner: playerId, player: null, isAuthenticated: false };
}

function normalizeDeps(deps = {}) {
  return {
    db: deps.db,
    loadAdventures: deps.loadAdventures ?? loadJsonAdventures,
    upsertPlayer: deps.upsertPlayer ?? defaultUpsertPlayer,
    optionalAuth: deps.optionalAuth ?? defaultOptionalAuth,
    hashSessionToken: deps.hashSessionToken ?? defaultHashSessionToken,
    getUserBySessionTokenHash: deps.getUserBySessionTokenHash ?? defaultGetUserBySessionTokenHash,
    createCharacter: deps.createCharacter ?? defaultCreateCharacter,
    getCharacter: deps.getCharacter ?? defaultGetCharacter,
    listCharacters: deps.listCharacters ?? defaultListCharacters,
    updateCharacter: deps.updateCharacter ?? defaultUpdateCharacter,
    createAdventureRun: deps.createAdventureRun ?? defaultCreateAdventureRun,
    getAdventureRun: deps.getAdventureRun ?? defaultGetAdventureRun,
    updateAdventureRun: deps.updateAdventureRun ?? defaultUpdateAdventureRun,
    completeAdventureRun: deps.completeAdventureRun ?? defaultCompleteAdventureRun,
    abandonAdventureRun: deps.abandonAdventureRun ?? defaultAbandonAdventureRun,
    rng: deps.rng ?? Math.random,
  };
}

export function createGameRouter(rawDeps = {}) {
  const deps = normalizeDeps(rawDeps);
  const router = express.Router();

  router.use((req, res, next) => {
    if (!requireDb(req, res, deps.db)) return;
    next();
  });

  router.use(deps.optionalAuth({
    db: deps.db,
    hashSessionToken: deps.hashSessionToken,
    getUserBySessionTokenHash: deps.getUserBySessionTokenHash,
  }));

  router.post('/bootstrap', async (req, res, next) => {
    try {
      const context = resolveGameContext(req);
      if (context.error) return error(res, 400, context.error, 'bad-request');
      const player = await deps.upsertPlayer(deps.db, {
        id: context.playerId,
        displayName: req.body.displayName ?? context.player?.display_name,
        authProvider: req.auth?.user ? 'local' : req.body.authProvider,
        authSubject: req.auth?.user?.id ?? req.body.authSubject,
        email: req.auth?.user?.email ?? req.body.email,
      });
      const [characters, adventures] = await Promise.all([
        deps.listCharacters(deps.db, context.owner),
        Promise.resolve(deps.loadAdventures()),
      ]);
      return res.json(hallResponse({ player, characters, adventures }));
    } catch (err) {
      return next(err);
    }
  });

  router.get('/characters', async (req, res, next) => {
    try {
      const context = resolveGameContext(req);
      if (context.error) return error(res, 400, context.error, 'bad-request');
      const characters = await deps.listCharacters(deps.db, context.owner);
      return res.json(canonicalResponse({ text: 'Characters loaded.', choices: [], state: { characters: characters.map(rowCharacter) } }));
    } catch (err) {
      return next(err);
    }
  });

  router.post('/characters', async (req, res, next) => {
    try {
      const { name } = req.body ?? {};
      const context = resolveGameContext(req);
      const className = req.body?.className ?? req.body?.class ?? 'adventurer';
      if (context.error || !name) return error(res, 400, context.error ? context.error : 'name is required.', 'bad-request');
      if (!DEFAULT_CLASS_STATS[className]) return error(res, 400, `Unknown className ${className}.`, 'bad-request');
      await deps.upsertPlayer(deps.db, { id: context.playerId, displayName: context.player?.display_name, authProvider: context.isAuthenticated ? 'local' : undefined, authSubject: context.userId, email: req.auth?.user?.email });
      const defaults = DEFAULT_CLASS_STATS[className];
      const hardiness = numberOr(req.body.hardiness, defaults.hardiness);
      const character = await deps.createCharacter(deps.db, {
        playerId: context.playerId,
        userId: context.userId ?? null,
        profileId: context.profileId ?? null,
        name,
        className,
        hardiness,
        agility: numberOr(req.body.agility, defaults.agility),
        charisma: numberOr(req.body.charisma, defaults.charisma),
        hd: numberOr(req.body.hd, hardiness),
        maxHd: numberOr(req.body.maxHd, hardiness),
        gold: numberOr(req.body.gold, 0),
        bankGold: numberOr(req.body.bankGold, 0),
        inventory: Array.isArray(req.body.inventory) ? req.body.inventory : [],
        equipment: req.body.equipment ?? {},
        adventuresCompleted: Array.isArray(req.body.adventuresCompleted) ? req.body.adventuresCompleted : [],
      });
      const adventures = deps.loadAdventures();
      return res.status(201).json(hallResponse({ player: { id: context.playerId }, characters: [character], adventures, character: rowCharacter(character), prefix: `${character.name} is ready in the Great Hall.` }));
    } catch (err) {
      return next(err);
    }
  });

  router.post('/hall', async (req, res, next) => {
    try {
      const { playerId, characterId, input } = req.body ?? {};
      if (!playerId || !characterId || !input) return error(res, 400, 'playerId, characterId, and input are required.', 'bad-request');
      const [characterRow, adventures] = await Promise.all([
        deps.getCharacter(deps.db, playerId, characterId),
        Promise.resolve(deps.loadAdventures()),
      ]);
      if (!characterRow) return error(res, 404, 'Character not found for this player.', 'not-found');
      const character = rowCharacter(characterRow);
      const normalizedInput = normalizeTarget(input);
      if (/register|account|upgrade|login|sign\s*in/.test(normalizedInput)) {
        return res.json(hallResponse({
          player: { id: playerId },
          characters: [characterRow],
          adventures,
          character,
          prefix: 'Account registration is reserved for the next account layer. This anonymous player profile is already being saved locally for now.',
        }));
      }
      if (normalizedInput === 'view equipment' || normalizedInput === 'equipment') {
        return res.json(equipmentResponse({ player: { id: playerId }, character, characters: [characterRow], adventures }));
      }
      if (/^(?:visit\s+)?(?:weapon|weapons|armor|shield|shields|equipment)(?:\s+shop)?$/.test(normalizedInput)
        || /shop/.test(normalizedInput)) {
        return res.json(shopResponse({ player: { id: playerId }, character, characters: [characterRow], adventures, input }));
      }
      const buyMatch = /^buy\s+/i.test(input);
      if (!buyMatch) {
        return res.json(hallResponse({ player: { id: playerId }, characters: [characterRow], adventures, character, prefix: 'You remain in the Great Hall.' }));
      }
      const item = findShopItem(input);
      if (!item) return error(res, 400, `The Great Hall shop does not sell ${String(input).replace(/^buy\s+/i, '')}.`, 'invalid-purchase');
      if ((character.inventory ?? []).some((owned) => owned?.slug === item.slug || normalizeTarget(owned?.name) === normalizeTarget(item.name))) {
        return error(res, 409, `You already own ${item.name}.`, 'duplicate-purchase');
      }
      if ((character.gold ?? 0) < item.price) {
        return error(res, 409, `Not enough gold to buy ${item.name}.`, 'insufficient-gold');
      }
      const ownedItem = { slug: item.slug, name: item.name, price: item.price, category: item.category, stats: item.stats };
      const inventory = [...(character.inventory ?? []), ownedItem];
      const equipment = { ...(character.equipment ?? {}), [item.equipmentSlot]: ownedItem };
      const updated = await deps.updateCharacter(deps.db, playerId, characterId, {
        gold: character.gold - item.price,
        inventory,
        equipment,
      });
      const updatedCharacter = rowCharacter(updated);
      return res.json(hallResponse({ player: { id: playerId }, characters: [updated], adventures, character: updatedCharacter, prefix: `You buy ${item.name} and return to the Great Hall.` }));
    } catch (err) {
      return next(err);
    }
  });

  router.post('/start-adventure', async (req, res, next) => {
    try {
      const { characterId, adventureId = 'beginners-cave' } = req.body ?? {};
      const context = resolveGameContext(req);
      if (context.error || !characterId) return error(res, 400, context.error ? context.error : 'characterId is required.', 'bad-request');
      const adventures = deps.loadAdventures();
      const adventure = findAdventure(adventures, adventureId);
      if (!adventure) return error(res, 404, `Adventure ${adventureId} is not available.`, 'adventure-not-found');
      if (!context.isAuthenticated) {
        return error(res, 403, 'Preserve this adventurer with an account before beginning an expedition.', 'account-required');
      }
      const characterRow = await deps.getCharacter(deps.db, context.owner, characterId);
      if (!characterRow) return error(res, 404, 'Character not found for this player.', 'not-found');
      const character = rowCharacter(characterRow);
      if (!character.isAlive || character.hd <= 0) {
        return error(res, 409, `${character.name} is dead or defeated and cannot start a new adventure.`, 'character-dead');
      }
      if (adventureId !== BEGINNERS_CAVE_ID && !isBeginnerComplete(character)) {
        return error(res, 423, "Complete The Beginner's Cave before starting later adventures.", 'adventure-locked');
      }
      const startRoom = adventure.adventure.start_room;
      const runRow = await deps.createAdventureRun(deps.db, {
        playerId: context.playerId,
        userId: context.userId ?? null,
        profileId: context.profileId ?? null,
        characterId,
        adventureId,
        currentRoom: startRoom,
        roomState: { visitedRooms: [startRoom] },
        enemyState: { defeatedEnemies: [], enemyHp: {} },
        collectedItems: [],
        discoveredItems: [],
        flags: {},
        knownAdventureIds: new Set(adventures.map((manifest) => manifest.adventure.id)),
      });
      if (!runRow) return error(res, 404, 'Could not start adventure for this character.', 'not-found');
      return res.status(201).json(roomResponse({ adventure, run: rowRun(runRow), character, event: { type: 'start_adventure' }, intent: { type: 'start_adventure', source: 'rules' } }));
    } catch (err) {
      return next(err);
    }
  });

  router.post('/command', async (req, res, next) => {
    try {
      const adventures = deps.loadAdventures();
      const session = await loadSession(req, res, deps, adventures);
      if (!session) return undefined;
      let { character, run, adventure, context } = session;
      const command = parseCommand(req.body.input);

      if (!character.isAlive || character.hd <= 0) {
        return error(res, 409, `${character.name} is dead or defeated and cannot act.`, 'character-dead');
      }
      if (run.status !== 'active') {
        return error(res, 409, `Adventure run ${run.id} is no longer active.`, 'run-inactive');
      }

      if (command.type === 'look') {
        return res.json(roomResponse({ adventure, run, character, event: { type: 'look', command }, intent: command }));
      }

      if (command.type === 'inventory' || command.type === 'stats') {
        return res.json(canonicalResponse({ intent: command, event: { type: command.type, command }, text: renderInventory(character), choices: choicesForRoom(getCurrentRoom(run, adventure)), state: { character, adventureRun: run } }));
      }

      if (command.type === 'help') {
        return res.json(canonicalResponse({ intent: command, event: { type: 'help', command }, text: 'Try: look, north, south, take gem, attack rat, inventory, or leave.', choices: choicesForRoom(getCurrentRoom(run, adventure)), state: { character, adventureRun: run } }));
      }

      if (command.type === 'move') {
        const result = move(run, adventure, command.direction);
        if (!result.ok) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'blocked', command, reason: result.reason }, text: renderMoveBlocked(command.direction), choices: choicesForRoom(getCurrentRoom(run, adventure)), state: { character, adventureRun: run } }));
        }
        run = result.run;
        if (result.destination === 'main-hall') {
          const conversion = convertTreasuresOnReturn(character);
          character = conversion.character;
          character.adventuresCompleted = Array.from(new Set([...(character.adventuresCompleted ?? []), adventure.adventure.id]));
          const [updatedCharacter, completedRun] = await Promise.all([
            deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
            deps.completeAdventureRun(deps.db, context.owner, run.id),
          ]);
          const hall = hallResponse({
            player: { id: run.playerId },
            characters: [updatedCharacter],
            adventures,
            character: rowCharacter(updatedCharacter),
            prefix: renderReturnToHall({ ...conversion, completed: true }),
          });
          hall.intent = command;
          hall.events = [{ type: 'return_to_hall', command }];
          hall.event = hall.events[0];
          hall.state.adventureRun = rowRun(completedRun);
          return res.json(hall);
        }
        const updatedRun = await deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run));
        return res.json(roomResponse({ adventure, run: rowRun(updatedRun), character, event: { type: 'move', command }, intent: command }));
      }

      if (command.type === 'read_item') {
        const item = findVisibleItem(adventure, run, command.target);
        if (!item) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'read_failed', command, reason: 'missing-item' }, text: `There is no ${command.target} here to read.`, choices: choicesForRoom(getCurrentRoom(run, adventure)), state: { character, adventureRun: run } }));
        }
        return res.json(canonicalResponse({ intent: command, event: { type: 'read_item', command, item }, text: item.text ?? item.description ?? `There is nothing written on ${item.name}.`, choices: choicesForRoom(getCurrentRoom(run, adventure)), state: { character, adventureRun: run } }));
      }

      if (command.type === 'take') {
        const item = findVisibleItem(adventure, run, command.target);
        if (!item) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'take_failed', command, reason: 'missing-item' }, text: `There is no ${command.target} here to take.`, choices: choicesForRoom(getCurrentRoom(run, adventure)), state: { character, adventureRun: run } }));
        }
        if (!isCollectible(item)) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'take_failed', command, reason: 'not-collectible' }, text: `You cannot take ${item.name}.`, choices: choicesForRoom(getCurrentRoom(run, adventure)), state: { character, adventureRun: run } }));
        }
        const taken = takeTreasure(character, item);
        if (!taken.ok) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'take_failed', command, reason: taken.reason }, text: `You cannot take ${item.name}.`, choices: choicesForRoom(getCurrentRoom(run, adventure)), state: { character, adventureRun: run } }));
        }
        character = taken.character;
        run = markItemCollected(run, item.slug);
        const [updatedCharacter, updatedRun] = await Promise.all([
          deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
          deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
        ]);
        return res.json(canonicalResponse({ intent: command, event: { type: 'take', command, item }, text: `You take ${item.name}.`, choices: choicesForRoom(getCurrentRoom(run, adventure)), state: { character: rowCharacter(updatedCharacter), adventureRun: rowRun(updatedRun) } }));
      }

      if (command.type === 'attack') {
        const enemyTemplate = findVisibleEnemy(adventure, run, command.target);
        if (!enemyTemplate) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'attack_failed', command, reason: 'missing-enemy' }, text: `There is no ${command.target} here to attack.`, choices: choicesForRoom(getCurrentRoom(run, adventure)), state: { character, adventureRun: run } }));
        }
        const enemy = { ...enemyTemplate, hp: run.enemyHp?.[enemyTemplate.slug] ?? enemyTemplate.hp };
        const combat = resolveCombatRound(character, enemy, deps.rng);
        character.hd = character.hp;
        run = { ...run, enemyHp: { ...(run.enemyHp ?? {}), [enemyTemplate.slug]: enemy.hp } };
        const events = [{ type: 'combat', command, enemy: enemyTemplate.slug }];
        if (combat.enemyDefeated) {
          run = markEnemyDefeated(run, enemyTemplate.slug);
          events.push({ type: 'enemy_defeated', enemy: enemyTemplate.slug });
        }
        if (combat.characterDefeated) {
          character.isAlive = false;
          run = { ...run, status: 'dead' };
          events.push({ type: 'character_defeated', characterId: character.id });
        }
        const [updatedCharacter, updatedRun] = await Promise.all([
          deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
          deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
        ]);
        return res.json(canonicalResponse({
          intent: command,
          events,
          text: renderCombatResult(combat),
          choices: combat.characterDefeated ? [] : choicesForRoom(getCurrentRoom(run, adventure)),
          state: { character: rowCharacter(updatedCharacter), adventureRun: rowRun(updatedRun), combat },
        }));
      }

      if (command.type === 'leave') {
        const abandoned = await deps.abandonAdventureRun(deps.db, context.owner, run.id);
        const hall = hallResponse({
          player: { id: run.playerId },
          characters: [],
          adventures,
          character,
          prefix: 'You abandon the adventure and return to the Great Hall.',
        });
        hall.intent = command;
        hall.events = [{ type: 'abandon', command }];
        hall.event = hall.events[0];
        hall.state.adventureRun = rowRun(abandoned);
        return res.json(hall);
      }

      return res.json(canonicalResponse({ intent: command, event: { type: 'unknown', command }, text: 'I did not understand that. Try a direction, look, inventory, take, attack, or leave.', choices: choicesForRoom(getCurrentRoom(run, adventure)), state: { character, adventureRun: run } }));
    } catch (err) {
      return next(err);
    }
  });

  router.use((err, req, res, _next) => {
    console.error('[api/game]', err);
    return error(res, 500, 'The deterministic game engine hit an internal error.', 'internal-error');
  });

  return router;
}

export default createGameRouter;
