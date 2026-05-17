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
  warrior: { hardiness: 12, agility: 9, charisma: 8 },
  rogue: { hardiness: 10, agility: 12, charisma: 9 },
  mystic: { hardiness: 8, agility: 9, charisma: 12 },
};

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
  const { playerId, characterId, adventureRunId } = req.body ?? {};
  if (!playerId || !characterId || !adventureRunId) {
    error(res, 400, 'playerId, characterId, and adventureRunId are required.', 'bad-request');
    return null;
  }

  const [characterRow, runRow] = await Promise.all([
    deps.getCharacter(deps.db, playerId, characterId),
    deps.getAdventureRun(deps.db, playerId, adventureRunId),
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

  return { character: rowCharacter(characterRow), run: rowRun(runRow), adventure };
}

function normalizeDeps(deps = {}) {
  return {
    db: deps.db,
    loadAdventures: deps.loadAdventures ?? loadJsonAdventures,
    upsertPlayer: deps.upsertPlayer ?? defaultUpsertPlayer,
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

  router.post('/bootstrap', async (req, res, next) => {
    try {
      const playerId = req.body?.playerId;
      if (!playerId) return error(res, 400, 'playerId is required.', 'bad-request');
      const player = await deps.upsertPlayer(deps.db, {
        id: playerId,
        displayName: req.body.displayName,
        authProvider: req.body.authProvider,
        authSubject: req.body.authSubject,
        email: req.body.email,
      });
      const [characters, adventures] = await Promise.all([
        deps.listCharacters(deps.db, player.id),
        Promise.resolve(deps.loadAdventures()),
      ]);
      return res.json(canonicalResponse({
        text: 'Game bootstrap complete.',
        choices: [],
        state: {
          player: { id: player.id, displayName: player.display_name, email: player.email },
          characters: characters.map(rowCharacter),
          adventures: adventures.map(adventureSummary),
        },
      }));
    } catch (err) {
      return next(err);
    }
  });

  router.get('/characters', async (req, res, next) => {
    try {
      const playerId = req.query.playerId;
      if (!playerId) return error(res, 400, 'playerId is required.', 'bad-request');
      const characters = await deps.listCharacters(deps.db, playerId);
      return res.json(canonicalResponse({ text: 'Characters loaded.', choices: [], state: { characters: characters.map(rowCharacter) } }));
    } catch (err) {
      return next(err);
    }
  });

  router.post('/characters', async (req, res, next) => {
    try {
      const { playerId, name } = req.body ?? {};
      const className = req.body?.className ?? req.body?.class ?? 'warrior';
      if (!playerId || !name) return error(res, 400, 'playerId and name are required.', 'bad-request');
      if (!DEFAULT_CLASS_STATS[className]) return error(res, 400, `Unknown className ${className}.`, 'bad-request');
      await deps.upsertPlayer(deps.db, { id: playerId });
      const defaults = DEFAULT_CLASS_STATS[className];
      const hardiness = numberOr(req.body.hardiness, defaults.hardiness);
      const character = await deps.createCharacter(deps.db, {
        playerId,
        name,
        className,
        hardiness,
        agility: numberOr(req.body.agility, defaults.agility),
        charisma: numberOr(req.body.charisma, defaults.charisma),
        hd: numberOr(req.body.hd, hardiness),
        maxHd: numberOr(req.body.maxHd, hardiness),
        gold: numberOr(req.body.gold, 0),
        inventory: Array.isArray(req.body.inventory) ? req.body.inventory : [],
        equipment: req.body.equipment ?? {},
      });
      return res.status(201).json(canonicalResponse({ text: `${character.name} is ready.`, choices: [], state: { character: rowCharacter(character) } }));
    } catch (err) {
      return next(err);
    }
  });

  router.post('/start-adventure', async (req, res, next) => {
    try {
      const { playerId, characterId, adventureId = 'beginners-cave' } = req.body ?? {};
      if (!playerId || !characterId) return error(res, 400, 'playerId and characterId are required.', 'bad-request');
      const adventures = deps.loadAdventures();
      const adventure = findAdventure(adventures, adventureId);
      if (!adventure) return error(res, 404, `Adventure ${adventureId} is not available.`, 'adventure-not-found');
      const characterRow = await deps.getCharacter(deps.db, playerId, characterId);
      if (!characterRow) return error(res, 404, 'Character not found for this player.', 'not-found');
      const character = rowCharacter(characterRow);
      if (!character.isAlive || character.hd <= 0) {
        return error(res, 409, `${character.name} is dead or defeated and cannot start a new adventure.`, 'character-dead');
      }
      const startRoom = adventure.adventure.start_room;
      const runRow = await deps.createAdventureRun(deps.db, {
        playerId,
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
      let { character, run, adventure } = session;
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
          const [updatedCharacter, completedRun] = await Promise.all([
            deps.updateCharacter(deps.db, character.playerId, character.id, characterPatch(character)),
            deps.completeAdventureRun(deps.db, run.playerId, run.id),
          ]);
          return res.json(canonicalResponse({
            intent: command,
            event: { type: 'return_to_hall', command },
            text: renderReturnToHall({ ...conversion, completed: true }),
            choices: [],
            state: { character: rowCharacter(updatedCharacter), adventureRun: rowRun(completedRun) },
          }));
        }
        const updatedRun = await deps.updateAdventureRun(deps.db, run.playerId, run.id, dbRunPatch(run));
        return res.json(roomResponse({ adventure, run: rowRun(updatedRun), character, event: { type: 'move', command }, intent: command }));
      }

      if (command.type === 'take') {
        const item = findVisibleItem(adventure, run, command.target);
        if (!item) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'take_failed', command, reason: 'missing-item' }, text: `There is no ${command.target} here to take.`, choices: choicesForRoom(getCurrentRoom(run, adventure)), state: { character, adventureRun: run } }));
        }
        const taken = takeTreasure(character, item);
        if (!taken.ok) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'take_failed', command, reason: taken.reason }, text: `You cannot take ${item.name}.`, choices: choicesForRoom(getCurrentRoom(run, adventure)), state: { character, adventureRun: run } }));
        }
        character = taken.character;
        run = markItemCollected(run, item.slug);
        const [updatedCharacter, updatedRun] = await Promise.all([
          deps.updateCharacter(deps.db, character.playerId, character.id, characterPatch(character)),
          deps.updateAdventureRun(deps.db, run.playerId, run.id, dbRunPatch(run)),
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
          deps.updateCharacter(deps.db, character.playerId, character.id, characterPatch(character)),
          deps.updateAdventureRun(deps.db, run.playerId, run.id, dbRunPatch(run)),
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
        const abandoned = await deps.abandonAdventureRun(deps.db, run.playerId, run.id);
        return res.json(canonicalResponse({ intent: command, event: { type: 'abandon', command }, text: 'You abandon the adventure and return to the Main Hall.', choices: [], state: { character, adventureRun: rowRun(abandoned) } }));
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
