import express from 'express';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCommand } from '../engine/commands.js';
import {
  getCurrentRoom,
  getVisibleRoomEntities,
  markContainerOpened,
  markFeatureInspected,
  markEnemyDefeated,
  markItemCollected,
  move,
} from '../engine/adventures.js';
import { resolveAttack, resolveCombatRound } from '../engine/combat.js';
import { castSpell, isSpell } from '../engine/spells.js';
import { convertTreasuresOnReturn, takeTreasure, drinkPotion } from '../engine/economy.js';
import {
  SHOP_CATALOG, findCatalogItem, buyFromShop, sellToShop,
  SPELLS, learnSpell, spellAbility,
  ATTRIBUTES, attributePrice, raiseAttribute,
  bankDeposit, bankWithdraw,
  healAtTemple, healCost,
} from '../engine/vendors.js';
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
  getActiveAdventureRunForCharacter as defaultGetActiveAdventureRunForCharacter,
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

const HALL_SHOP_ITEMS = SHOP_CATALOG;

const GREAT_HALL_TITLE = 'The Great Hall';
const MARCOS_WEAPON_SHOP_TITLE = "Marcos Cavielli's Weapons & Armour Shoppe";
const WIZARD_TITLE = "Hokas Tokas' School of Magick";
const WITCH_TITLE = "The Witch's Shop";
const BANK_TITLE = 'Bank of Eamon Towne';
const HEALER_TITLE = 'The Chapel of the Open Hand';
const ADVENTURE_GATE_TITLE = 'The Adventure Gate';

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

function itemChoice(item, openedContainers = new Set(), inspectedFeatures = new Set()) {
  // Containers offer "open" until opened (so the choice doesn't spoil contents).
  if (item.type === 'container') {
    return openedContainers.has(item.slug) ? null : `open ${item.name ?? item.slug}`;
  }
  // Features offer "inspect" until inspected, then step aside.
  if (item.type === 'feature') {
    return inspectedFeatures.has(item.slug) ? null : `inspect ${item.name ?? item.slug}`;
  }
  return `${isCollectible(item) ? 'take' : 'read'} ${item.name ?? item.slug}`;
}

function choicesForRun(adventure, run) {
  const room = getCurrentRoom(run, adventure);
  const entities = getVisibleRoomEntities(run, adventure);
  const items = visibleItems(adventure, entities);
  const opened = new Set(run.flags?.openedContainers ?? []);
  const inspected = new Set(run.flags?.inspectedFeatures ?? []);
  const exits = choicesForRoom(room);
  // Dedupe by choice text: a room can hold several items that share a display
  // name (e.g. two "inscription"s), which would otherwise render the same
  // button twice. One "Read Inscription" reads them all (see read_item).
  const itemChoices = [...new Set(items.map((item) => itemChoice(item, opened, inspected)).filter(Boolean))];
  const characterChoices = (entities.characters ?? []).flatMap((character) => {
    if (character.type === 'enemy' || character.type === 'boss') return [`attack ${character.name ?? character.slug}`];
    return [`talk ${character.name ?? character.slug}`];
  });
  return [...exits, ...itemChoices, ...characterChoices];
}

function findItem(adventure, slugOrName) {
  const target = normalizeTarget(slugOrName);
  return adventure.items.find((item) => normalizeTarget(item.slug) === target || normalizeTarget(item.name) === target) ?? null;
}

function normalizeTarget(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^(?:the|a|an)\s+/, '');
}

function findVisibleItem(adventure, run, target) {
  const normalized = normalizeTarget(target);
  const visible = getVisibleRoomEntities(run, adventure);
  const visibleSlugs = new Set((visible.placements ?? []).map((placement) => placement.item_slug));
  // Match among items visible in THIS room — several items can share a display
  // name (e.g. multiple "inscription"s across rooms), so a global lookup picks
  // the wrong instance and fails the visibility check.
  return adventure.items.find((item) => (
    visibleSlugs.has(item.slug)
    && (normalizeTarget(item.slug) === normalized || normalizeTarget(item.name) === normalized)
  )) ?? null;
}

// Every visible item in this room matching the target name/slug. Several items
// can share a display name (e.g. multiple "inscription"s on the same wall), so
// reading "inscription" should surface all of them, not just the first.
function findVisibleItems(adventure, run, target) {
  const normalized = normalizeTarget(target);
  const visible = getVisibleRoomEntities(run, adventure);
  const visibleSlugs = new Set((visible.placements ?? []).map((placement) => placement.item_slug));
  return adventure.items.filter((item) => (
    visibleSlugs.has(item.slug)
    && (normalizeTarget(item.slug) === normalized || normalizeTarget(item.name) === normalized)
  ));
}

function isCollectible(item) {
  return item?.collectible !== false && item?.weight !== -999;
}

function findVisibleContainer(adventure, run, target) {
  const normalized = normalizeTarget(target);
  const visible = getVisibleRoomEntities(run, adventure);
  const visibleSlugs = new Set((visible.placements ?? []).map((placement) => placement.item_slug));
  return adventure.items.find((item) => (
    item.type === 'container' && visibleSlugs.has(item.slug)
    && (normalizeTarget(item.slug) === normalized || normalizeTarget(item.name) === normalized)
  )) ?? null;
}

function findVisibleFeature(adventure, run, target) {
  const normalized = normalizeTarget(target);
  const visible = getVisibleRoomEntities(run, adventure);
  const visibleSlugs = new Set((visible.placements ?? []).map((placement) => placement.item_slug));
  return adventure.items.find((item) => (
    item.type === 'feature' && visibleSlugs.has(item.slug)
    && (normalizeTarget(item.slug) === normalized || normalizeTarget(item.name) === normalized)
  )) ?? null;
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

function visibleEnemy(adventure, run) {
  const visible = getVisibleRoomEntities(run, adventure);
  return (visible.characters ?? []).find((c) => c.type === 'enemy' || c.type === 'boss') ?? null;
}

function combatSide(attack) {
  if (!attack) return null;
  return {
    hit: !!attack.hit,
    roll: attack.roll ?? null,
    total: attack.attackTotal ?? null,
    target: attack.targetNumber ?? null,
    damage: attack.damage ?? 0,
  };
}

// Client-friendly combat state: head-to-head HP + (optionally) the latest round.
// Returns null when no enemy is present (so the combat scene hides). When a
// round result is supplied it is always included, so the killing blow animates.
function combatStateFor({ adventure, run, character, enemyTemplate = null, result = null, round }) {
  const enemy = enemyTemplate ?? visibleEnemy(adventure, run);
  if (!enemy) return null;
  const maxHp = enemy.hp ?? 0;
  const hp = Math.max(0, run.enemyHp?.[enemy.slug] ?? maxHp);
  if (!result && round === undefined && hp <= 0) return null;
  return {
    enemy: { slug: enemy.slug, name: enemy.name ?? enemy.slug, hp, maxHp },
    player: { name: character.name, hp: Math.max(0, character.hd ?? 0), maxHp: character.maxHd ?? character.hd ?? 0 },
    spells: character.spells ?? {}, // so the combat scene can offer cast buttons
    potions: (character.inventory ?? []) // so combat can offer an emergency drink
      .filter((item) => item?.type === 'potion')
      .map((item) => ({ slug: item.slug, name: item.name, heal: item.heal ?? item.heal_amount ?? null })),
    round: round !== undefined ? round : (result ? {
      player: combatSide(result.playerAttack),
      enemy: combatSide(result.enemyAttack),
      enemyDefeated: !!result.enemyDefeated,
      characterDefeated: !!result.characterDefeated,
    } : null),
  };
}

// Apply the equipped weapon's damage dice and armour class to the character so
// combat actually reflects gear. Mutates in place; these fields are transient
// (characterPatch never persists them).
function applyEquipmentToCombatant(character, run = null) {
  const eq = character.equipment ?? {};
  const damage = eq.weapon?.stats?.damage;
  character.weapon = damage ? { damage } : undefined;
  character.weaponOdds = Number(eq.weapon?.stats?.weaponOdds) || 0;
  character.defense = (Number(eq.armor?.stats?.armorClass) || 0) + (Number(eq.shield?.stats?.armorClass) || 0);
  // Speed spell doubles agility for the rest of the run.
  if (run?.flags?.haste) character.agility = (Number(character.agility) || 0) * 2;
  return character;
}

function findInventoryItem(character, target) {
  const normalized = normalizeTarget(target);
  return (character.inventory ?? []).find((item) => (
    normalizeTarget(item.slug) === normalized || normalizeTarget(item.name) === normalized
  )) ?? null;
}

function equipmentSlotForItem(item) {
  if (item?.equipmentSlot) return item.equipmentSlot;
  if (item?.type === 'weapon') return 'weapon';
  if (item?.type === 'armor') return 'armor';
  if (item?.type === 'shield') return 'shield';
  return null;
}

// Normalise any inventory item into an equipment entry. Shop gear already
// carries a stats block; adventure-found gear stores its damage as `damage_dice`,
// so synthesise stats from that — keeping applyEquipmentToCombatant happy.
function toEquipment(item) {
  const equipmentSlot = equipmentSlotForItem(item);
  if (item.stats) {
    return { slug: item.slug, name: item.name, equipmentSlot, stats: item.stats, ...(item.category ? { category: item.category } : {}) };
  }
  const stats = {};
  if (item.damage_dice) stats.damage = item.damage_dice;
  return { slug: item.slug, name: item.name, equipmentSlot, stats };
}

// Which equipped slot the player means: a slot name (weapon/armor/shield) or
// the name/slug of whatever is currently in a slot.
function findEquippedSlot(equipment, target) {
  const normalized = normalizeTarget(target);
  if (['weapon', 'armor', 'shield'].includes(normalized) && equipment[normalized]) return normalized;
  for (const slot of Object.keys(equipment)) {
    const equipped = equipment[slot];
    if (equipped && (normalizeTarget(equipped.slug) === normalized || normalizeTarget(equipped.name) === normalized)) {
      return slot;
    }
  }
  return null;
}

function findVisibleCharacter(adventure, run, target) {
  const normalized = normalizeTarget(target);
  const visible = getVisibleRoomEntities(run, adventure);
  return (visible.characters ?? []).find((character) => (
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
    spells: row.spells ?? {},
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

function hallChoices(character) {
  if (!character) return ['Create Character', 'Sign the Guild Rolls'];
  if (!character.isAlive || character.hd <= 0) return ['Create Character', 'Sign the Guild Rolls'];
  // A single Gate replaces a "Begin <Name>" button per adventure — it scales to
  // the whole Eamon corpus and is the home for adventure cover art.
  return ['Create Character', 'Sign the Guild Rolls', 'Visit the Weapon Shop', 'Visit the Wizard', 'Visit the Witch', 'Visit the Healer', 'Visit the Bank', 'View Equipment', 'Approach the Adventure Gate'];
}

function hallText({ player, character, unlockedAdventures, lockedAdventures, prefix = '' }) {
  const characterName = String(character?.name ?? '').trim();
  const lines = [prefix || (characterName ? `You stand in the Great Hall, ${characterName}.` : 'You stand in the Great Hall.')];
  if (!character) {
    lines.push('The Guild is ready to record a new adventurer.');
  } else {
    lines.push(`${character.name} is present in the Guild roster and ready for the next expedition.`);
  }
  // Adventures live behind the Gate now — point the player there rather than
  // listing them inline (the Gate shows covers, difficulty, and locked entries).
  if (character && character.isAlive !== false && (character.hd ?? 1) > 0) {
    lines.push('Visit the vendors to prepare, then approach the Adventure Gate to choose your expedition.');
  }
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
      locationTitle: GREAT_HALL_TITLE,
      player: playerState,
      character: activeCharacter,
      characters: mappedCharacters,
      adventures: adventures.map(adventureSummary),
      unlockedAdventures,
      lockedAdventures,
    },
  });
}

// The character the Great Hall would show (prefers a living one, else the first).
function activeCharacterRow(characters) {
  const alive = characters.find((row) => row.is_alive && (row.hd ?? 0) > 0);
  return alive ?? characters[0] ?? null;
}

// Revive-at-the-Hall: a fallen adventurer is dragged back alive and fully
// healed, but the loot carried on the doomed run is forfeited. Everything
// permanent — banked gold, bought gear, learned spells — is kept.
async function reviveFallenCharacter(deps, owner, characters) {
  const row = activeCharacterRow(characters);
  if (!row) return { revived: false, characters };
  const fallen = !row.is_alive || (row.hd ?? 0) <= 0;
  if (!fallen) return { revived: false, characters };

  const inventory = (Array.isArray(row.inventory) ? row.inventory : []).filter((item) => item?.type !== 'treasure');
  const updated = await deps.updateCharacter(deps.db, owner, row.id, {
    hd: row.max_hd ?? row.hd,
    isAlive: true,
    inventory,
  });
  return {
    revived: true,
    name: row.name,
    characters: characters.map((c) => (c.id === row.id ? (updated ?? c) : c)),
  };
}

function slugify(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function capitalize(value) {
  const text = String(value ?? '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function findShopItem(input) {
  const normalized = slugify(String(input ?? '').replace(/^buy\s+/i, ''));
  return HALL_SHOP_ITEMS.find((item) => item.slug === normalized || slugify(item.name) === normalized) ?? null;
}

function hallState({ player, character, characters, adventures, extra = {} }) {
  return {
    phase: 'great-hall',
    locationTitle: GREAT_HALL_TITLE,
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
    ? character.inventory.map((item) => `• ${item.name ?? item.slug}`).join('\n')
    : '• none';
  const equipment = character.equipment ?? {};
  const weapon = equipment.weapon?.name ?? equipment.weapon?.slug ?? 'unarmed';
  const armor = equipment.armor?.name ?? equipment.armor?.slug ?? 'none';
  const shield = equipment.shield?.name ?? equipment.shield?.slug ?? 'none';
  return [
    `${character.name}'s Equipment`,
    `Gold: ${character.gold} / Bank: ${character.bankGold}`,
    'Equipped:',
    `• Weapon: ${weapon}`,
    `• Armor: ${armor}`,
    `• Shield: ${shield}`,
    'Inventory:',
    inventory,
  ].join('\n');
}

function equipmentResponse({ player, character, characters, adventures, prefix = '' }) {
  return canonicalResponse({
    intent: { type: 'hall_equipment' },
    event: { type: 'hall_equipment' },
    text: [
      prefix || `You open your pack, ${character.name}.`,
      `Tap a weapon or armour to ready it; tap loot to sell it for gold. You have ${character.gold} gold in hand.`,
    ].join('\n'),
    choices: ['Visit the Weapon Shop', 'Return to Great Hall'],
    state: hallState({ player, character, characters, adventures, extra: { shop: { key: 'pack', mode: 'pack', title: 'Your Pack', items: [] } } }),
  });
}

function shopResponse({ player, character, characters, adventures, prefix = '' }) {
  return canonicalResponse({
    intent: { type: 'hall_shop' },
    event: { type: 'hall_shop' },
    text: [
      prefix || `Marcos Cavielli comes from the back room. "Well, as I live and breathe, if it isn't ${character.name}! What do you need?"`,
      `You have ${character.gold} gold pieces. Tap an item to buy, or sell from your pack.`,
    ].join('\n'),
    choices: ['Sell Equipment', 'Return to Great Hall'],
    state: hallState({
      player,
      character,
      characters,
      adventures,
      extra: {
        locationTitle: MARCOS_WEAPON_SHOP_TITLE,
        shop: { key: 'marcos', title: 'MARCOS CAVIELLI — WEAPONS & ARMOUR', items: HALL_SHOP_ITEMS },
      },
    }),
  });
}

function gateResponse({ player, character, characters, adventures, prefix = '' }) {
  const { unlockedAdventures, lockedAdventures } = partitionAdventures(adventures, character);
  const cards = [
    ...unlockedAdventures.map((adventure) => ({ ...adventure, unlocked: true })),
    ...lockedAdventures.map((adventure) => ({ ...adventure, unlocked: false })),
  ];
  return canonicalResponse({
    intent: { type: 'hall_gate' },
    event: { type: 'hall_gate' },
    text: [
      prefix || 'You approach the Adventure Gate — a great arch of weathered stone whose keystone is carved with a hundred roads.',
      'Beyond it lie the realms open to you. Choose your expedition, or turn back to the Hall.',
    ].join('\n'),
    choices: ['Return to Great Hall'],
    state: hallState({
      player,
      character,
      characters,
      adventures,
      extra: {
        locationTitle: ADVENTURE_GATE_TITLE,
        gate: { adventures: cards },
      },
    }),
  });
}

function sellResponse({ player, character, characters, adventures, prefix = '' }) {
  const sellable = (character.inventory ?? []).filter((item) => item?.type !== 'treasure' && Number.isFinite(item?.price ?? item?.value));
  const choices = sellable.length
    ? sellable.map((item) => `Sell ${item.name} (+${Math.floor((item.price ?? item.value ?? 0) / 2)}g)`)
    : [];
  return canonicalResponse({
    intent: { type: 'hall_sell' },
    event: { type: 'hall_sell' },
    text: [
      prefix || `"What do you want to sell? I'll give you half what it's worth," says Marcos.`,
      `You have ${character.gold} gold pieces.`,
      sellable.length ? 'Your pack:' : 'You have nothing to sell.',
    ].join('\n'),
    choices: [...choices, 'Visit the Weapon Shop', 'Return to Great Hall'],
    state: hallState({ player, character, characters, adventures, extra: { locationTitle: MARCOS_WEAPON_SHOP_TITLE } }),
  });
}

function wizardResponse({ player, character, characters, adventures, prefix = '' }) {
  const lines = SPELLS.map((spell) => {
    const ability = spellAbility(character, spell.name);
    const status = ability > 90 ? 'mastered' : ability > 0 ? `${ability}%` : 'unknown';
    return `• ${capitalize(spell.name)} (${status}) — ${spell.price} gold. ${spell.description}`;
  });
  const choices = SPELLS
    .filter((spell) => spellAbility(character, spell.name) <= 90)
    .map((spell) => `${spellAbility(character, spell.name) > 0 ? 'Upgrade' : 'Learn'} ${capitalize(spell.name)} (${spell.price}g)`);
  return canonicalResponse({
    intent: { type: 'hall_wizard' },
    event: { type: 'hall_wizard' },
    text: [
      prefix || `Hokas Tokas, the old Mage, looks up. "So you want old Hokey to teach you some magic, eh? Here are the spells I teach. Which will it be?"`,
      `You have ${character.gold} gold pieces.`,
      ...lines,
    ].join('\n'),
    choices: [...choices, 'Return to Great Hall'],
    state: hallState({ player, character, characters, adventures, extra: { locationTitle: WIZARD_TITLE } }),
  });
}

function witchResponse({ player, character, characters, adventures, prefix = '' }) {
  const lines = ATTRIBUTES.map((attr) => `• ${capitalize(attr)} (now ${character[attr]}) — ${attributePrice(character[attr])} gold for +1`);
  const choices = ATTRIBUTES.map((attr) => `Raise ${capitalize(attr)} (${attributePrice(character[attr])}g)`);
  return canonicalResponse({
    intent: { type: 'hall_witch' },
    event: { type: 'hall_witch' },
    text: [
      prefix || `A lovely young woman dressed in black smiles. "My magic potions can increase one of your attributes. My prices are:"`,
      `You have ${character.gold} gold pieces.`,
      ...lines,
    ].join('\n'),
    choices: [...choices, 'Return to Great Hall'],
    state: hallState({ player, character, characters, adventures, extra: { locationTitle: WITCH_TITLE } }),
  });
}

function bankResponse({ player, character, characters, adventures, prefix = '' }) {
  return canonicalResponse({
    intent: { type: 'hall_bank' },
    event: { type: 'hall_bank' },
    text: [
      prefix || `Seamus McFenney, the portly banker, ambles over. "Well, ${character.name}! Do you want to make a deposit or a withdrawal?"`,
      `You have ${character.gold} gold pieces in hand, and ${character.bankGold} gold pieces in the bank.`,
      'Type an amount, e.g. "deposit 250" or "withdraw 100".',
    ].join('\n'),
    choices: ['Deposit 100', 'Deposit All', 'Withdraw 100', 'Withdraw All', 'Return to Great Hall'],
    state: hallState({ player, character, characters, adventures, extra: { locationTitle: BANK_TITLE } }),
  });
}

function healerResponse({ player, character, characters, adventures, prefix = '' }) {
  const max = character.maxHd ?? character.hd ?? 0;
  const missing = Math.max(0, max - (character.hd ?? 0));
  const cost = healCost(character);
  const lines = [
    prefix || `A robed healer looks up from a guttering candle. "Wounds mend slowly in the wild, child. Here, for a fair price, they mend at once."`,
    `You have ${character.gold} gold pieces. Health: ${character.hd} / ${max}.`,
  ];
  const choices = [];
  if (missing === 0) {
    lines.push('"You are hale and whole. Go in peace."');
  } else {
    lines.push(`Full healing (+${missing} HP) costs ${cost} gold. Type "heal" to be tended.`);
    choices.push('Heal');
  }
  return canonicalResponse({
    intent: { type: 'hall_healer' },
    event: { type: 'hall_healer' },
    text: lines.join('\n'),
    choices: [...choices, 'Return to Great Hall'],
    state: hallState({ player, character, characters, adventures, extra: { locationTitle: HEALER_TITLE } }),
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
    choices: choicesForRun(adventure, run),
    state: { phase: 'adventure', locationTitle: room?.name ?? adventure?.adventure?.name ?? 'Adventure', character, adventureRun: run, room, entities, items, combat: combatStateFor({ adventure, run, character }) },
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
    getActiveAdventureRunForCharacter: deps.getActiveAdventureRunForCharacter ?? defaultGetActiveAdventureRunForCharacter,
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
      const revival = await reviveFallenCharacter(deps, context.owner, characters);
      const prefix = revival.revived
        ? `The Guild healers drag ${revival.name} back from the brink. The loot from that doomed expedition is lost — but your banked gold, your gear, and the spells you learned remain. Live, and adventure again.`
        : '';
      return res.json(hallResponse({ player, characters: revival.characters, adventures, prefix }));
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
      const { characterId, input } = req.body ?? {};
      const context = resolveGameContext(req);
      if (context.error || !characterId || !input) return error(res, 400, context.error ? context.error : 'characterId and input are required.', 'bad-request');
      const hallPlayer = context.player ?? { id: context.playerId };
      const [characterRow, adventures] = await Promise.all([
        deps.getCharacter(deps.db, context.owner, characterId),
        Promise.resolve(deps.loadAdventures()),
      ]);
      if (!characterRow) return error(res, 404, 'Character not found for this player.', 'not-found');
      const character = rowCharacter(characterRow);
      const normalizedInput = normalizeTarget(input);
      const persist = (patch) => deps.updateCharacter(deps.db, context.owner, characterId, patch);
      const render = (builder, char, row, prefix) => res.json(builder({ player: hallPlayer, character: char, characters: [row], adventures, prefix }));
      const findOwned = (raw) => {
        const target = normalizeTarget(String(raw).replace(/^sell\s+/i, '').replace(/\s*\(.*\)\s*$/, ''));
        return (character.inventory ?? []).find((owned) => slugify(owned?.slug) === slugify(target) || normalizeTarget(owned?.name) === target) ?? null;
      };

      // ── Marcos: buy / sell ──────────────────────────────────────────────
      const buyMatch = /^buy\s+(.+)/i.exec(input);
      if (buyMatch) {
        const item = findCatalogItem(buyMatch[1]);
        if (!item) return error(res, 400, `Marcos does not stock ${buyMatch[1].trim()}.`, 'invalid-purchase');
        const result = buyFromShop(character, item);
        if (!result.ok) return error(res, 409, `Not enough gold to buy ${item.name}.`, result.reason);
        const row = await persist({ gold: result.character.gold, inventory: result.character.inventory, equipment: result.character.equipment });
        return render(shopResponse, rowCharacter(row), row, `You buy ${item.name} and ready it. "Pleasure doing business!"`);
      }
      if (/^sell\s+equipment$|^sell$|^sell\s+from/.test(normalizedInput)) {
        return render(shopResponse, character, characterRow, '"Looking to sell? Let\'s see what you\'ve got," says Marcos.');
      }
      const sellMatch = /^sell\s+(.+)/i.exec(input);
      if (sellMatch) {
        const owned = findOwned(input);
        if (!owned) return error(res, 400, `You are not carrying ${sellMatch[1].replace(/\s*\(.*\)\s*$/, '').trim()}.`, 'missing-item');
        const result = sellToShop(character, owned.slug);
        if (!result.ok) return error(res, 409, `You cannot sell ${owned.name}.`, result.reason);
        const row = await persist({ gold: result.character.gold, inventory: result.character.inventory, equipment: result.character.equipment });
        return render(shopResponse, rowCharacter(row), row, `Marcos hands you ${result.goldGained} gold for ${owned.name}.`);
      }

      // ── Pack: ready a found weapon/armour from your inventory ────────────
      const equipMatch = /^(?:ready|wear|wield|equip)\s+(.+)/i.exec(input);
      if (equipMatch) {
        const item = findInventoryItem(character, equipMatch[1]);
        if (!item) return error(res, 400, `You are not carrying ${equipMatch[1].trim()}.`, 'missing-item');
        const slot = equipmentSlotForItem(item);
        if (!slot) return error(res, 400, `You cannot ready ${item.name}.`, 'not-equippable');
        const equipment = { ...(character.equipment ?? {}), [slot]: toEquipment(item) };
        const row = await persist({ equipment });
        const verb = slot === 'weapon' ? 'ready' : 'don';
        return render(equipmentResponse, rowCharacter(row), row, `You ${verb} ${item.name}.`);
      }

      // ── Pack: drink a potion to heal ────────────────────────────────────
      const drinkMatch = /^(?:drink|quaff|sip)\s+(.+)/i.exec(input);
      if (drinkMatch) {
        const carried = findInventoryItem(character, drinkMatch[1]);
        if (!carried || carried.type !== 'potion') return error(res, 400, `You have no ${drinkMatch[1].trim()} to drink.`, 'no-potion');
        const result = drinkPotion(character, carried.slug);
        if (!result.ok) {
          if (result.reason === 'already-full') return error(res, 409, 'You are already at full health.', result.reason);
          return error(res, 400, `You have no ${drinkMatch[1].trim()} to drink.`, result.reason);
        }
        const row = await persist({ hd: result.character.hd, inventory: result.character.inventory });
        return render(equipmentResponse, rowCharacter(row), row, `You drink the ${result.potion.name} and recover ${result.restored} HP.`);
      }

      // ── Hokas Tokas: learn / upgrade spells ─────────────────────────────
      const spellMatch = /(?:learn|upgrade)\s+(blast|heal|power|speed)/i.exec(normalizedInput);
      if (spellMatch) {
        const result = learnSpell(character, spellMatch[1].toLowerCase(), deps.rng);
        if (!result.ok) {
          if (result.reason === 'maxed-out') return error(res, 409, `You have already mastered ${capitalize(spellMatch[1])}.`, result.reason);
          return error(res, 409, `Not enough gold to learn ${capitalize(spellMatch[1])}.`, result.reason);
        }
        const row = await persist({ gold: result.character.gold, spells: result.character.spells });
        const verb = result.learned ? `learn ${capitalize(result.spell.name)}` : `improve ${capitalize(result.spell.name)} to ${result.ability}%`;
        return render(wizardResponse, rowCharacter(row), row, `Hokas teaches you well; you ${verb}.`);
      }

      // ── The Witch: raise attributes ─────────────────────────────────────
      const raiseMatch = /raise\s+(hardiness|agility|charisma)/i.exec(normalizedInput);
      if (raiseMatch) {
        const result = raiseAttribute(character, raiseMatch[1].toLowerCase());
        if (!result.ok) return error(res, 409, `Not enough gold to raise ${capitalize(raiseMatch[1])}.`, result.reason);
        const patch = { gold: result.character.gold, [raiseMatch[1].toLowerCase()]: result.value };
        if (raiseMatch[1].toLowerCase() === 'hardiness') { patch.maxHd = result.character.maxHd; patch.hd = result.character.hd; }
        const row = await persist(patch);
        return render(witchResponse, rowCharacter(row), row, `The potion works! Your ${capitalize(result.attribute)} rises to ${result.value}.`);
      }

      // ── Bank: deposit / withdraw ────────────────────────────────────────
      const depositMatch = /deposit\s+(\d+|all)/i.exec(normalizedInput);
      if (depositMatch) {
        const amount = depositMatch[1] === 'all' ? character.gold : parseInt(depositMatch[1], 10);
        const result = bankDeposit(character, amount);
        if (!result.ok) return error(res, 409, result.reason === 'insufficient-gold' ? "You don't have that much gold in hand." : 'Enter a positive amount.', result.reason);
        const row = await persist({ gold: result.character.gold, bankGold: result.character.bankGold });
        return render(bankResponse, rowCharacter(row), row, `Seamus takes your ${result.amount} gold and listens to it jingle.`);
      }
      const withdrawMatch = /withdraw\s+(\d+|all)/i.exec(normalizedInput);
      if (withdrawMatch) {
        const amount = withdrawMatch[1] === 'all' ? character.bankGold : parseInt(withdrawMatch[1], 10);
        const result = bankWithdraw(character, amount);
        if (!result.ok) return error(res, 409, result.reason === 'insufficient-funds' ? "That's more than you have in your account." : 'Enter a positive amount.', result.reason);
        const row = await persist({ gold: result.character.gold, bankGold: result.character.bankGold });
        return render(bankResponse, rowCharacter(row), row, `Seamus hands you ${result.amount} gold and shakes your hand.`);
      }

      // ── The Healer: pay gold to restore HP ──────────────────────────────
      if (/^heal$/.test(normalizedInput) || /^heal\s+(me|up|fully|all)$/.test(normalizedInput)) {
        const missingBefore = Math.max(0, (character.maxHd ?? character.hd ?? 0) - (character.hd ?? 0));
        const result = healAtTemple(character);
        if (!result.ok) {
          if (result.reason === 'already-full') return error(res, 409, 'You are already at full health.', result.reason);
          return error(res, 409, 'You have no gold to pay the healer.', result.reason);
        }
        const row = await persist({ gold: result.character.gold, hd: result.character.hd });
        const msg = result.healed >= missingBefore
          ? `The healer lays hands on you; warmth spreads through your wounds. ${result.healed} HP restored for ${result.cost} gold.`
          : `Your coin buys only part of the cure. ${result.healed} HP restored for ${result.cost} gold.`;
        return render(healerResponse, rowCharacter(row), row, msg);
      }

      // ── Vendor visits ───────────────────────────────────────────────────
      if (/register|account|login|sign\s*in/.test(normalizedInput)) {
        return res.json(hallResponse({
          player: hallPlayer,
          characters: [characterRow],
          adventures,
          character,
          prefix: context.isAuthenticated
            ? 'This adventurer is already preserved in your account.'
            : 'Create a free account to preserve this adventurer before leaving the Great Hall.',
        }));
      }
      if (normalizedInput === 'view equipment' || normalizedInput === 'equipment') {
        return res.json(equipmentResponse({ player: hallPlayer, character, characters: [characterRow], adventures }));
      }
      if (/weapon|marcos|^shop$|armou?r\s+shop/.test(normalizedInput)) {
        return render(shopResponse, character, characterRow);
      }
      if (/wizard|hokas|magick?|spell/.test(normalizedInput)) {
        return render(wizardResponse, character, characterRow);
      }
      if (/witch/.test(normalizedInput)) {
        return render(witchResponse, character, characterRow);
      }
      if (/bank|seamus|mcfenney/.test(normalizedInput)) {
        return render(bankResponse, character, characterRow);
      }
      if (/healer|chapel|temple|infirmary|heal\s+me/.test(normalizedInput)) {
        return render(healerResponse, character, characterRow);
      }
      if (/adventure\s*gate|^gate$|^adventures?$|approach.*(?:adventure|gate)/.test(normalizedInput)) {
        return render(gateResponse, character, characterRow);
      }

      return res.json(hallResponse({ player: hallPlayer, characters: [characterRow], adventures, character, prefix: 'You remain in the Great Hall.' }));
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
      const existingRunRow = await deps.getActiveAdventureRunForCharacter(deps.db, context.owner, characterId);
      if (existingRunRow) {
        const existingAdventure = findAdventure(adventures, existingRunRow.adventure_id);
        if (!existingAdventure) return error(res, 404, `Adventure ${existingRunRow.adventure_id} is not available.`, 'adventure-not-found');
        return res.json(roomResponse({
          adventure: existingAdventure,
          run: rowRun(existingRunRow),
          character,
          event: { type: 'resume_adventure' },
          intent: { type: 'start_adventure', source: 'rules', resumed: true },
        }));
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
        return res.json(canonicalResponse({ intent: command, event: { type: command.type, command }, text: renderInventory(character), choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
      }

      if (command.type === 'help') {
        return res.json(canonicalResponse({ intent: command, event: { type: 'help', command }, text: 'Try: look, north, south, take gem, attack rat, inventory, or leave.', choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
      }

      if (command.type === 'move') {
        const result = move(run, adventure, command.direction);
        if (!result.ok) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'blocked', command, reason: result.reason }, text: renderMoveBlocked(command.direction), choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        run = result.run;
        if (result.destination === 'main-hall') {
          const conversion = convertTreasuresOnReturn(character);
          character = conversion.character;
          // Wounds persist between adventures — the Healer in the Hall restores
          // HP for gold, so health is a real resource (not free on return).
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
        // Inspecting a room feature reveals whatever is hidden by/behind it.
        const feature = findVisibleFeature(adventure, run, command.target);
        if (feature) {
          const alreadyInspected = (run.flags?.inspectedFeatures ?? []).includes(feature.slug);
          run = markFeatureInspected(run, feature.slug);
          const updatedRun = await deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run));
          run = rowRun(updatedRun) ?? run;
          const revealed = getVisibleRoomEntities(run, adventure).placements
            .filter((placement) => placement.revealedBy === feature.slug)
            .map((placement) => adventure.items.find((item) => item.slug === placement.item_slug)?.name ?? placement.item_slug);
          const base = feature.text ?? feature.description ?? `You search the ${feature.name} carefully.`;
          const text = revealed.length
            ? `${base}\n\nHidden here, you find: ${revealed.join(', ')}.`
            : `${base}${alreadyInspected ? '' : '\n\nThere is nothing more here.'}`;
          return res.json(roomResponse({ adventure, run, character, text, event: { type: 'inspect', command, feature: feature.slug, revealed }, intent: command }));
        }

        const matches = findVisibleItems(adventure, run, command.target);
        if (matches.length === 0) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'read_failed', command, reason: 'missing-item' }, text: `There is no ${command.target} here to read.`, choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        // A wall may carry several inscriptions sharing one name — read them all.
        const text = matches
          .map((item) => item.text ?? item.description ?? `There is nothing written on ${item.name}.`)
          .join('\n\n');
        return res.json(canonicalResponse({ intent: command, event: { type: 'read_item', command, item: matches[0], items: matches }, text, choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
      }

      if (command.type === 'take') {
        const item = findVisibleItem(adventure, run, command.target);
        if (!item) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'take_failed', command, reason: 'missing-item' }, text: `There is no ${command.target} here to take.`, choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        if (!isCollectible(item)) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'take_failed', command, reason: 'not-collectible' }, text: `You cannot take ${item.name}.`, choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        const taken = takeTreasure(character, item, { allowDuplicate: true });
        if (!taken.ok) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'take_failed', command, reason: taken.reason }, text: `You cannot take ${item.name}.`, choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        character = taken.character;
        run = markItemCollected(run, item.slug);
        const [updatedCharacter, updatedRun] = await Promise.all([
          deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
          deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
        ]);
        return res.json(canonicalResponse({ intent: command, event: { type: 'take', command, item }, text: `You take ${item.name}.`, choices: choicesForRun(adventure, run), state: { character: rowCharacter(updatedCharacter), adventureRun: rowRun(updatedRun) } }));
      }

      if (command.type === 'take_all') {
        const entities = getVisibleRoomEntities(run, adventure);
        const loot = visibleItems(adventure, entities).filter(isCollectible);
        const taken = [];
        for (const item of loot) {
          const result = takeTreasure(character, item, { allowDuplicate: true });
          if (result.ok) {
            character = result.character;
            run = markItemCollected(run, item.slug);
            taken.push(item.name);
          }
        }
        if (taken.length === 0) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'take_all_failed', command, reason: 'nothing-here' }, text: 'There is nothing here to take.', choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        const [updatedCharacter, updatedRun] = await Promise.all([
          deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
          deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
        ]);
        return res.json(canonicalResponse({ intent: command, event: { type: 'take_all', command, items: taken }, text: `You gather up everything: ${taken.join(', ')}.`, choices: choicesForRun(adventure, run), state: { character: rowCharacter(updatedCharacter), adventureRun: rowRun(updatedRun) } }));
      }

      if (command.type === 'equip') {
        const item = findInventoryItem(character, command.target);
        if (!item) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'equip_failed', command, reason: 'missing-item' }, text: `You are not carrying ${command.target}.`, choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        const slot = equipmentSlotForItem(item);
        if (!slot) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'equip_failed', command, reason: 'not-equippable' }, text: `You can't ready ${item.name}.`, choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        character = { ...character, equipment: { ...(character.equipment ?? {}), [slot]: toEquipment(item) } };
        const updatedCharacter = await deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character));
        character = rowCharacter(updatedCharacter) ?? character;
        const text = slot === 'weapon' ? `You ready ${item.name}.` : `You don ${item.name}.`;
        return res.json(canonicalResponse({ intent: command, event: { type: 'equip', command, slot, item: item.slug }, text, choices: choicesForRun(adventure, run), state: { character, adventureRun: run, combat: combatStateFor({ adventure, run, character }) } }));
      }

      if (command.type === 'unequip') {
        const equipment = { ...(character.equipment ?? {}) };
        const slot = findEquippedSlot(equipment, command.target);
        if (!slot) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'unequip_failed', command, reason: 'not-equipped' }, text: `You don't have ${command.target} readied.`, choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        const removedName = equipment[slot]?.name ?? command.target;
        delete equipment[slot];
        character = { ...character, equipment };
        const updatedCharacter = await deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character));
        character = rowCharacter(updatedCharacter) ?? character;
        return res.json(canonicalResponse({ intent: command, event: { type: 'unequip', command, slot }, text: `You put away ${removedName}.`, choices: choicesForRun(adventure, run), state: { character, adventureRun: run, combat: combatStateFor({ adventure, run, character }) } }));
      }

      if (command.type === 'drink') {
        const carried = findInventoryItem(character, command.target);
        if (!carried || carried.type !== 'potion') {
          return res.json(canonicalResponse({ intent: command, event: { type: 'drink_failed', command, reason: 'no-potion' }, text: `You have no ${command.target} to drink.`, choices: choicesForRun(adventure, run), state: { character, adventureRun: run, combat: combatStateFor({ adventure, run, character }) } }));
        }
        const result = drinkPotion(character, carried.slug);
        if (!result.ok) {
          const msg = result.reason === 'already-full' ? 'You are already at full health.' : `You have no ${command.target} to drink.`;
          return error(res, 409, msg, result.reason);
        }
        character = { ...character, hd: result.character.hd, inventory: result.character.inventory };

        // In combat, drinking costs your action — the enemy strikes back.
        const enemyTemplate = visibleEnemy(adventure, run);
        let enemyAttack = null;
        let characterDefeated = false;
        if (enemyTemplate) {
          const enemy = { ...enemyTemplate, hp: run.enemyHp?.[enemyTemplate.slug] ?? enemyTemplate.hp };
          applyEquipmentToCombatant(character, run);
          enemyAttack = resolveAttack(enemy, character, deps.rng);
          character.hd = character.hp;
          if ((character.hd ?? 0) <= 0) { characterDefeated = true; character.isAlive = false; run = { ...run, status: 'dead' }; }
          run = { ...run, enemyHp: { ...(run.enemyHp ?? {}), [enemyTemplate.slug]: enemy.hp } };
        }

        const [updatedCharacter, updatedRun] = await Promise.all([
          deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
          deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
        ]);
        const enemyText = enemyAttack ? (enemyAttack.hit ? `${enemyTemplate.name} strikes for ${enemyAttack.damage} as you drink.` : `${enemyTemplate.name} lunges but misses.`) : null;
        const text = [`You drink the ${result.potion.name} and recover ${result.restored} HP.`, enemyText, characterDefeated ? 'You have been defeated.' : null].filter(Boolean).join('\n');
        const round = enemyTemplate ? { player: { heal: result.restored }, enemy: enemyAttack ? combatSide(enemyAttack) : null, enemyDefeated: false, characterDefeated } : undefined;
        const combat = enemyTemplate ? combatStateFor({ adventure, run, character, enemyTemplate, round }) : null;
        return res.json(canonicalResponse({
          intent: command,
          events: [{ type: 'drink', command, potion: result.potion.slug, restored: result.restored }],
          text,
          choices: characterDefeated ? [] : choicesForRun(adventure, run),
          state: { character: rowCharacter(updatedCharacter), adventureRun: rowRun(updatedRun), combat, entities: getVisibleRoomEntities(rowRun(updatedRun), adventure), items: visibleItems(adventure, getVisibleRoomEntities(rowRun(updatedRun), adventure)) },
        }));
      }

      if (command.type === 'attack') {
        const enemyTemplate = findVisibleEnemy(adventure, run, command.target);
        if (!enemyTemplate) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'attack_failed', command, reason: 'missing-enemy' }, text: `There is no ${command.target} here to attack.`, choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        const enemy = { ...enemyTemplate, hp: run.enemyHp?.[enemyTemplate.slug] ?? enemyTemplate.hp };
        applyEquipmentToCombatant(character, run);
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
        const combatState = combatStateFor({ adventure, run, character, enemyTemplate, result: combat });
        return res.json(canonicalResponse({
          intent: command,
          events,
          text: renderCombatResult(combat),
          choices: combat.characterDefeated ? [] : choicesForRun(adventure, run),
          state: { character: rowCharacter(updatedCharacter), adventureRun: rowRun(updatedRun), combat: combatState },
        }));
      }

      if (command.type === 'use_item') {
        const spellName = normalizeTarget(command.target);
        const stateNow = () => ({ character, adventureRun: run, combat: combatStateFor({ adventure, run, character }) });

        // Open a container (e.g. a chest) → reveal what's inside.
        const container = findVisibleContainer(adventure, run, spellName);
        if (container) {
          if ((run.flags?.openedContainers ?? []).includes(container.slug)) {
            return res.json(canonicalResponse({ intent: command, event: { type: 'open_failed', command, reason: 'already-open' }, text: `The ${container.name} is already open.`, choices: choicesForRun(adventure, run), state: stateNow() }));
          }
          run = markContainerOpened(run, container.slug);
          const updatedRun = await deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run));
          run = rowRun(updatedRun) ?? run;
          const contentNames = getVisibleRoomEntities(run, adventure).placements
            .filter((placement) => placement.container === container.slug)
            .map((placement) => adventure.items.find((item) => item.slug === placement.item_slug)?.name ?? placement.item_slug);
          const text = contentNames.length
            ? `You lift the lid of the ${container.name}. Inside you find: ${contentNames.join(', ')}.`
            : `You open the ${container.name}, but it is empty.`;
          return res.json(roomResponse({ adventure, run, character, text, event: { type: 'open', command, container: container.slug }, intent: command }));
        }

        if (!isSpell(spellName)) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'use_failed', command, reason: 'not-a-spell' }, text: `You can't use ${command.target} that way here.`, choices: choicesForRun(adventure, run), state: stateNow() }));
        }
        if ((character.spells?.[spellName] ?? 0) <= 0) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'cast_failed', command, reason: 'not-learned' }, text: `You have not learned the ${spellName} spell. Hokas Tokas can teach it back in the Guild Hall.`, choices: choicesForRun(adventure, run), state: stateNow() }));
        }

        const enemyTemplate = visibleEnemy(adventure, run);
        const enemy = enemyTemplate ? { ...enemyTemplate, hp: run.enemyHp?.[enemyTemplate.slug] ?? enemyTemplate.hp } : null;
        applyEquipmentToCombatant(character, run);
        const cast = castSpell(character, spellName, { enemy, rng: deps.rng });
        if (!cast.ok) {
          return error(res, 409, cast.reason === 'no-target' ? 'There is no enemy here to blast.' : `You cannot cast ${spellName} now.`, cast.reason);
        }
        if (cast.haste) run = { ...run, flags: { ...(run.flags ?? {}), haste: true } };

        let enemyAttack = null;
        let enemyDefeated = false;
        let characterDefeated = false;
        if (enemyTemplate) {
          if (enemy.hp <= 0) {
            enemyDefeated = true;
            run = markEnemyDefeated(run, enemyTemplate.slug);
          } else {
            enemyAttack = resolveAttack(enemy, character, deps.rng);
            character.hd = character.hp;
            if ((character.hd ?? 0) <= 0) { characterDefeated = true; character.isAlive = false; run = { ...run, status: 'dead' }; }
          }
          run = { ...run, enemyHp: { ...(run.enemyHp ?? {}), [enemyTemplate.slug]: enemy.hp } };
        }

        const [updatedCharacter, updatedRun] = await Promise.all([
          deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
          deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
        ]);

        const round = {
          player: { spell: spellName, success: cast.success, roll: cast.roll, ability: cast.ability, damage: cast.damage, heal: cast.heal, haste: cast.haste },
          enemy: enemyAttack ? combatSide(enemyAttack) : null,
          enemyDefeated,
          characterDefeated,
        };
        const enemyText = enemyAttack ? (enemyAttack.hit ? `${enemyTemplate.name} strikes back for ${enemyAttack.damage}.` : `${enemyTemplate.name} lunges but misses.`) : null;
        const text = [cast.message, enemyText, enemyDefeated ? 'The enemy is defeated.' : null, characterDefeated ? 'You have been defeated.' : null].filter(Boolean).join('\n');
        const combat = enemyTemplate ? combatStateFor({ adventure, run, character, enemyTemplate, round }) : null;
        return res.json(canonicalResponse({
          intent: command,
          events: [{ type: 'cast', spell: spellName, success: cast.success }],
          text,
          choices: characterDefeated ? [] : choicesForRun(adventure, run),
          state: { character: rowCharacter(updatedCharacter), adventureRun: rowRun(updatedRun), combat },
        }));
      }

      if (command.type === 'talk') {
        const target = findVisibleCharacter(adventure, run, command.target);
        if (!target) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'talk_failed', command, reason: 'missing-character' }, text: `There is no ${command.target} here to talk to.`, choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        const name = target.name ?? target.slug ?? 'They';
        // Hostile foes won't parley — talking doesn't dump their look-description.
        if (target.type === 'enemy' || target.type === 'boss' || target.friendliness === 'hostile' || target.is_hostile === true) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'talk_failed', command, reason: 'hostile', character: target.slug ?? name }, text: `${name} answers only with a snarl — words will not help you here.`, choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        const dialogue = target.dialogue ?? target.text ?? `${name} gives you a quiet nod but has little to say.`;
        return res.json(canonicalResponse({ intent: command, event: { type: 'talk', command, character: target.slug ?? target.id ?? name }, text: dialogue, choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
      }

      if (command.type === 'leave') {
        const abandoned = await deps.abandonAdventureRun(deps.db, context.owner, run.id);
        // You walked out alive — your treasures still weigh into gold (only a
        // death forfeits the haul). Keeps loot from ever becoming dead weight.
        const conversion = convertTreasuresOnReturn(character);
        character = conversion.character;
        const leftRow = await deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character));
        character = rowCharacter(leftRow) ?? character;
        const hall = hallResponse({
          player: { id: run.playerId },
          characters: leftRow ? [leftRow] : [],
          adventures,
          character,
          prefix: conversion.goldGained > 0
            ? `You abandon the adventure and return to the Great Hall. Sam Slicker weighs your plunder: ${conversion.goldGained} gold.`
            : 'You abandon the adventure and return to the Great Hall.',
        });
        hall.intent = command;
        hall.events = [{ type: 'abandon', command }];
        hall.event = hall.events[0];
        hall.state.adventureRun = rowRun(abandoned);
        return res.json(hall);
      }

      return res.json(canonicalResponse({ intent: command, event: { type: 'unknown', command }, text: 'I did not understand that. Try a direction, look, inventory, take, attack, or leave.', choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
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
