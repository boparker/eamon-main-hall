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
  markItemRead,
  markEnemyDefeated,
  markItemCollected,
  markIntroduced,
  isIntroduced,
  move,
  dispositionOf,
  getCompanions,
  recordEncounter,
  recruitCompanion,
  freeDefeatedCaptives,
  setCompanionHp,
  removeCompanion,
  relocateCharacter,
  markFleeing,
  isFleeing,
  bumpCombatRound,
  combatRoundsFought,
} from '../engine/adventures.js';
import { resolveAttack, resolveCombatRound, resolvePartyRound, resolveTelegraphRound, isDead } from '../engine/combat.js';
import { resolveEncounter, isEscort, buildFighter } from '../engine/companions.js';
import {
  getRegard, shiftRegard, actsFor, findAct, applyAct,
  canYield, checkYield, hasYielded, markYielded, markMerciless, isMerciless, markSpared,
  behaviorState, telegraphFor, telegraphPending, setTelegraph, shouldTelegraph,
} from '../engine/acts.js';
import { narrateRoomEntry as defaultNarrateRoomEntry, narrateMoment as defaultNarrateMoment } from '../ai/narrator.js';
import {
  judgeParley as defaultJudgeParley, craftScaledShift,
  parleyCount, bumpParley, parleyShiftUsed, recordParleyShift,
  MAX_PARLEYS_PER_NPC, MAX_PARLEY_SHIFT,
} from '../ai/parley.js';
import { spiritHint as defaultSpiritHint } from '../ai/hints.js';
import { weaponLegend as defaultWeaponLegend } from '../ai/lore.js';
import { recordDeed, recordDeeds, maybeCompress as defaultMaybeCompress } from '../ai/chronicle.js';
import {
  computeReputation, reputationRead, reputationForPrompt,
  encounterBonus, firstSightRegard, yieldMods, escortMultiplier,
} from '../engine/reputation.js';
import { castSpell, isSpell } from '../engine/spells.js';
import { convertTreasuresOnReturn, takeTreasure, drinkPotion, buyItem } from '../engine/economy.js';
import { mapRead, computeLayout, hasQuill, QUILL } from '../engine/worldMap.js';
import { gateMove, afterMove, sayTrigger, digResult, cursedItem, guardedBy, markTriggerFired, revealItem, applyFlagPatch, stagedNpc, stageOf, stageData, setStage, stageTransition, tickStages, tickAttrition, mechanicsOf } from '../engine/mechanics.js';
import { rollDice } from '../engine/dice.js';
import {
  SHOP_CATALOG, findCatalogItem, buyFromShop, sellToShop,
  SPELLS, SPELL_MAX, learnSpell, spellAbility,
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
import {
  insertPortrait as defaultInsertPortrait,
  getPortraitPng as defaultGetPortraitPng,
  setCharacterPortraitUrl as defaultSetCharacterPortraitUrl,
  countRecentPortraits as defaultCountRecentPortraits,
} from '../db/portraits.js';
import { generatePortraitImage as defaultGenerateImage } from '../media/generate.js';
import { composePortraitPrompt, sanitizeTraits, portraitOptions, isValidClass } from '../engine/portraitTraits.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ADVENTURES_DIR = join(__dirname, '../../data/adventures');
const DIRECTIONS = ['north', 'south', 'east', 'west', 'up', 'down'];
// Cap AI portrait generations per character per rolling 24h window (cost guard).
const PORTRAIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const PORTRAIT_DAILY_LIMIT = Number(process.env.PORTRAIT_DAILY_LIMIT) || 8;
const DEFAULT_CLASS_STATS = {
  adventurer: { hardiness: 15, agility: 12, charisma: 15 },
  warrior: { hardiness: 12, agility: 9, charisma: 8 },
  rogue: { hardiness: 10, agility: 12, charisma: 9 },
  mystic: { hardiness: 8, agility: 9, charisma: 12 },
};

const BEGINNERS_CAVE_ID = 'beginners-cave';

// Living paintings: premium adventures ship seamless-loop mp4s beside their
// stills (room-N-living.mp4, portraits/<slug>-living.mp4). Scan each
// adventure's scenes dir once and remember what exists, so every room
// response can say which art breathes without touching the disk again.
const SCENES_DIR = join(__dirname, '../../public/scenes');
const livingArtCache = new Map();
function livingArtFor(advId) {
  if (!advId) return { rooms: new Set(), portraits: new Set() };
  if (!livingArtCache.has(advId)) {
    const rooms = new Set();
    const portraits = new Set();
    try {
      for (const f of readdirSync(join(SCENES_DIR, advId))) {
        const m = /^room-(\d+)-living\.mp4$/.exec(f);
        if (m) rooms.add(Number(m[1]));
      }
      for (const f of readdirSync(join(SCENES_DIR, advId, 'portraits'))) {
        const m = /^(.+)-living\.mp4$/.exec(f);
        if (m) portraits.add(m[1]);
      }
    } catch { /* no scenes dir (or no portraits) — nothing lives */ }
    livingArtCache.set(advId, { rooms, portraits });
  }
  return livingArtCache.get(advId);
}

// The state.living payload for a room: the background loop (if this room has
// one) plus a slug→url map for every character portrait that breathes.
// ?l=2 versions the media cache — bump when a loop is re-authored.
function livingFor(adventure, room, entities) {
  const advId = adventure?.adventure?.id;
  const art = livingArtFor(advId);
  const background = room && art.rooms.has(room.room_number)
    ? `scenes/${advId}/room-${room.room_number}-living.mp4?l=2`
    : null;
  const portraits = {};
  for (const c of entities?.characters ?? []) {
    if (c.slug && art.portraits.has(c.slug)) {
      portraits[c.slug] = `scenes/${advId}/portraits/${c.slug}-living.mp4?l=2`;
    }
  }
  return background || Object.keys(portraits).length ? { background, portraits } : null;
}

const HALL_SHOP_ITEMS = SHOP_CATALOG;

const GREAT_HALL_TITLE = 'The Great Hall';
const MARCOS_WEAPON_SHOP_TITLE = "Marcos Cavielli's Weapons & Armour Shoppe";
const WIZARD_TITLE = "Hokas Tokas' School of Magick";
const WITCH_TITLE = "The Witch's Shop";
const BANK_TITLE = 'Bank of Eamon Towne';
const HEALER_TITLE = 'The Chapel of the Open Hand';
const ADVENTURE_GATE_TITLE = 'The Adventure Gate';
const HALL_OF_RECORDS_TITLE = 'The Hall of Records';

function loadJsonAdventures(adventuresDir = DEFAULT_ADVENTURES_DIR) {
  return readdirSync(adventuresDir)
    .filter((file) => file.endsWith('.json') && !file.endsWith('.overlay.json'))
    .map((file) => JSON.parse(readFileSync(join(adventuresDir, file), 'utf8')));
}

function adventureSummary(manifest) {
  return {
    id: manifest.adventure.id,
    name: manifest.adventure.name,
    description: manifest.adventure.description ?? '',
    difficulty: manifest.adventure.difficulty ?? null,
    author: manifest.adventure.author ?? null,
    premium: manifest.adventure.premium === true,
    year: manifest.adventure.year ?? null,
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

function choicesForRun(adventure, run, character = null) {
  const room = getCurrentRoom(run, adventure);
  const entities = getVisibleRoomEntities(run, adventure);
  const items = visibleItems(adventure, entities);
  const opened = new Set(run.flags?.openedContainers ?? []);
  const inspected = new Set(run.flags?.inspectedFeatures ?? []);
  const exits = choicesForRoom(room);
  // A carried magic-word item (TrollsFire) offers a tap-to-ignite/douse action.
  const magicChoices = (character?.inventory ?? [])
    .filter((it) => it.magic_word)
    .map((it) => `${run.flags?.litItems?.[it.slug] ? 'Douse' : 'Ignite'} ${it.name}`);
  // Dedupe by choice text: a room can hold several items that share a display
  // name (e.g. two "inscription"s), which would otherwise render the same
  // button twice. One "Read Inscription" reads them all (see read_item).
  const itemChoices = [...new Set(items.map((item) => itemChoice(item, opened, inspected)).filter(Boolean))];
  let stanceChoices = [];
  const characterChoices = (entities.characters ?? []).flatMap((entity) => {
    const disposition = entity.disposition ?? dispositionOf(entity, run);
    const name = entity.name ?? entity.slug;
    if (disposition === 'hostile') {
      // A yielded enemy waits on your mercy: spare it, or finish it.
      if (hasYielded(run, entity.slug)) return [`spare ${name}`, `attack ${name}`];
      // A telegraphed wind-up demands an answer before anything else.
      if (telegraphPending(run, entity.slug)) stanceChoices = ['Brace', 'Dodge', 'Interrupt'];
      const acts = isMerciless(run, entity.slug)
        ? []
        : actsFor(entity).map((act) => `${act.label ?? act.verb} ${name}`);
      return [`attack ${name}`, ...acts];
    }
    return [`talk ${entity.name ?? entity.slug}`];
  });
  return [...stanceChoices, ...exits, ...itemChoices, ...characterChoices, ...magicChoices];
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
    (character.disposition ?? dispositionOf(character, run)) === 'hostile'
  ) && (
    normalizeTarget(character.slug) === normalized || normalizeTarget(character.name) === normalized
  )) ?? null;
}

function visibleEnemy(adventure, run) {
  const visible = getVisibleRoomEntities(run, adventure);
  return (visible.characters ?? []).find((c) => (c.disposition ?? dispositionOf(c, run)) === 'hostile') ?? null;
}

// Roll friend-or-foe for any unresolved "random" NPCs in the player's current
// room (charisma-gated), recruiting the friendly ones. Pure: returns the updated
// run + a narration note + events. Caller persists.
function resolveRoomEncounters(run, adventure, character, rng) {
  const room = getCurrentRoom(run, adventure);
  const defeated = new Set(run.defeatedEnemies);
  const resolved = run.flags?.encounters ?? {};
  const notes = [];
  const events = [];
  let next = run;
  // The world remembers: reputation (derived from the chronicle) nudges the
  // dice. Merciful adventurers attract company; the dreaded walk alone.
  const rep = computeReputation(character?.chronicle);
  const repBonus = encounterBonus(rep);
  const repRegard = firstSightRegard(rep);
  // First-sight introductions: a character's authored entrance text prints
  // once per run, BEFORE any friend-or-foe outcome, so the player always
  // meets whoever the buttons point at — a captor standing over their
  // captive uses the staged captive_intro instead.
  for (const present of getVisibleRoomEntities(next, adventure).characters ?? []) {
    if (present.companion || isIntroduced(next, present.slug)) continue;
    // Your name walks in before you do (once, at first sight).
    if (repRegard) next = shiftRegard(next, present, repRegard).run;
    const captive = present.frees_on_defeat
      ? (getVisibleRoomEntities(next, adventure).characters ?? []).find((c) => c.slug === present.frees_on_defeat)
      : null;
    const intro = (captive && present.captive_intro) || present.first_encounter_text || present.description;
    if (!intro) continue;
    notes.push(intro);
    next = markIntroduced(next, present.slug);
    events.push({ type: 'introduced', character: present.slug });
  }
  for (const npc of adventure.characters) {
    if (npc.location_room !== room.room_number) continue;
    if (npc.encounter_behavior !== 'random') continue;
    if (defeated.has(npc.slug) || resolved[npc.slug]) continue;
    const outcome = resolveEncounter(npc, character.charisma, rng, repBonus);
    next = recordEncounter(next, npc.slug, outcome);
    const who = npc.name ?? npc.slug;
    if (outcome === 'friend') {
      next = recruitCompanion(next, npc);
      notes.push(`${who} sizes you up, decides you are a friend, and joins your party.`);
      events.push({ type: 'recruit', character: npc.slug });
    } else {
      notes.push(`${who} eyes you with hostility and reaches for a weapon.`);
      events.push({ type: 'turned_hostile', character: npc.slug });
    }
  }
  // Also free any captive whose captor is already dead and who is here with you
  // but not yet in your party (repairs saves where the captor died earlier).
  const released = freeDefeatedCaptives(next, adventure);
  next = released.run;
  for (const slug of released.freed) {
    const captive = adventure.characters.find((c) => c.slug === slug);
    notes.push(`${captive?.name ?? slug}, no longer a captive, falls in gratefully beside you.`);
    events.push({ type: 'recruit', character: slug });
  }
  return { run: next, note: notes.join(' '), events };
}

// Transient combat entities for the fighting companions (escorts like Cynthia
// flee and are excluded). HP comes from the persisted party state.
function companionFighters(run, adventure) {
  const bySlug = new Map(adventure.characters.map((c) => [c.slug, c]));
  return getCompanions(run)
    .map((c) => {
      const npc = bySlug.get(c.slug);
      if (!npc || isEscort(npc)) return null;
      return buildFighter(npc, c.hp);
    })
    .filter(Boolean);
}

// Any escort companions (Cynthia) delivered alive to the Hall pay out 10×Charisma
// gold from their grateful patron. Returns the gold gained + a narration line.
function deliverEscorts(character, run, adventure) {
  const bySlug = new Map(adventure.characters.map((c) => [c.slug, c]));
  let gold = 0;
  const lines = [];
  const names = [];
  // Patrons pay a famously honorable escort more gladly.
  const rewardMult = escortMultiplier(computeReputation(character?.chronicle));
  for (const c of getCompanions(run)) {
    const npc = bySlug.get(c.slug);
    if (!npc || !isEscort(npc)) continue;
    const reward = Math.round(10 * (Number(character.charisma) || 0) * rewardMult);
    gold += reward;
    names.push(npc.name ?? npc.slug);
    lines.push(`You return ${npc.name ?? npc.slug} safely. ${npc.patron ?? 'Her grateful father'} rewards you with ${reward} gold.`);
  }
  return { gold, message: lines.join(' '), names };
}

// Words and gestures cost your action: a hostile, un-yielded enemy strikes
// while you spend your turn on them. Mutates character (HP), returns updates.
function hostileReprisal({ run, character, npc, rng }) {
  const hostile = (npc.disposition ?? dispositionOf(npc, run)) === 'hostile';
  if (!hostile || hasYielded(run, npc.slug) || isFleeing(run, npc.slug)) {
    return { run, character, enemyAttack: null, characterDefeated: false, text: null };
  }
  const enemy = { ...npc, hp: run.enemyHp?.[npc.slug] ?? npc.hp };
  applyEquipmentToCombatant(character, run);
  const enemyAttack = resolveAttack(enemy, character, rng);
  character.hd = character.hp;
  let characterDefeated = false;
  if ((character.hd ?? 0) <= 0) {
    characterDefeated = true;
    character.isAlive = false;
    run = { ...run, status: 'dead' };
  }
  const text = enemyAttack.hit
    ? `${npc.name} strikes at you mid-word for ${enemyAttack.damage}!`
    : `${npc.name} lashes out while you speak — and misses.`;
  return { run, character, enemyAttack, characterDefeated, text };
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
  const partyBySlug = new Map((adventure?.characters ?? []).map((c) => [c.slug, c]));
  const yielded = hasYielded(run, enemy.slug);
  const pendingTelegraph = telegraphPending(run, enemy.slug) ? telegraphFor(enemy) : null;
  return {
    enemy: {
      slug: enemy.slug, name: enemy.name ?? enemy.slug, hp, maxHp,
      image: `scenes/${adventure?.adventure?.id}/portraits/${enemy.slug}.png?p=3`,
      state: behaviorState(enemy, { hp, maxHp, regard: getRegard(run, enemy), yielded }),
      yielded,
      canParley: !!enemy.persona && !isMerciless(run, enemy.slug),
    },
    telegraph: pendingTelegraph ? { name: pendingTelegraph.name, warn: pendingTelegraph.warn_text } : null,
    player: { name: character.name, hp: Math.max(0, character.hd ?? 0), maxHp: character.maxHd ?? character.hd ?? 0, image: character.portraitUrl ?? (character.className ? `scenes/classes/${character.className}.png` : null) },
    companions: getCompanions(run).map((c) => {
      const npc = partyBySlug.get(c.slug);
      return { slug: c.slug, name: npc?.name ?? c.slug, hp: Math.max(0, c.hp ?? 0), maxHp: c.maxHp ?? npc?.hp ?? 0, escort: isEscort(npc) };
    }),
    // Carried magic-word items (e.g. TrollsFire) + lit state, so the combat bar
    // can offer a tap-to-ignite/douse button.
    magicWords: (character.inventory ?? []).filter((it) => it.magic_word).map((it) => ({
      slug: it.slug, name: it.name, word: it.magic_word, lit: !!run.flags?.litItems?.[it.slug],
    })),
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
  // A lit magic blade (e.g. TrollsFire, kindled by its magic word) burns hotter:
  // bigger damage dice + a to-hit bonus, but ONLY while it is the wielded weapon.
  if (run?.flags?.litItems?.[eq.weapon?.slug] && eq.weapon?.stats?.flameDamage) {
    character.weapon = { damage: eq.weapon.stats.flameDamage };
    character.weaponOdds += Number(eq.weapon.stats.flameOdds) || 0;
  }
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
    chronicle: row.chronicle && typeof row.chronicle === 'object' ? row.chronicle : { summary: '', deeds: [] },
    // Derived, never stored: the world's memory of this adventurer.
    reputation: computeReputation(row.chronicle && typeof row.chronicle === 'object' ? row.chronicle : {}),
    isAlive: row.is_alive,
    portraitUrl: row.portrait_url ?? null,
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
    chronicle: character.chronicle ?? { summary: '', deeds: [] },
    isAlive: character.isAlive ?? ((character.hd ?? character.hp ?? 1) > 0),
  };
}

function visibleItems(adventure, entities) {
  const visibleSlugs = new Set((entities.placements ?? []).map((placement) => placement.item_slug));
  return adventure.items.filter((item) => visibleSlugs.has(item.slug));
}

// Tag visible items the player has already read, so the client can gray the
// "Read" tile (like an unaffordable shop item) instead of inviting re-reads.
function withReadState(items, run) {
  const read = new Set(run?.flags?.readItems ?? []);
  return items.map((item) => (read.has(item.slug) ? { ...item, read: true } : item));
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

function isEntitled(adventure, entitlements = []) {
  return !adventure.premium || entitlements.includes(adventure.id) || entitlements.includes('premium-all');
}

function partitionAdventures(adventures, character, entitlements = []) {
  const summaries = adventures.map(adventureSummary);
  const beginner = summaries.find((adventure) => adventure.id === BEGINNERS_CAVE_ID);
  const later = summaries.filter((adventure) => adventure.id !== BEGINNERS_CAVE_ID);
  if (!character || !isBeginnerComplete(character)) {
    return {
      unlockedAdventures: beginner ? [beginner] : [],
      lockedAdventures: later.map((adventure) => ({ ...adventure, lockedReason: adventure.premium && !isEntitled(adventure, entitlements) ? PREMIUM_LOCK_REASON : "Complete The Beginner's Cave first." })),
    };
  }
  const unlockedAdventures = summaries.filter((adventure) => isEntitled(adventure, entitlements));
  const lockedAdventures = summaries.filter((adventure) => !isEntitled(adventure, entitlements))
    .map((adventure) => ({ ...adventure, lockedReason: PREMIUM_LOCK_REASON }));
  return { unlockedAdventures, lockedAdventures };
}
const PREMIUM_LOCK_REASON = 'A premium adventure of the Second Age.';

function hallChoices(character) {
  if (!character) return ['Create Character', 'Sign the Guild Rolls'];
  if (!character.isAlive || character.hd <= 0) return ['Create Character', 'Sign the Guild Rolls'];
  // A single Gate replaces a "Begin <Name>" button per adventure — it scales to
  // the whole Eamon corpus and is the home for adventure cover art.
  return ['Create Character', 'Sign the Guild Rolls', 'Visit the Weapon Shop', 'Visit the Wizard', 'Visit the Witch', 'Visit the Healer', 'Visit the Bank', 'Visit the Hall of Records', 'View Equipment', 'Approach the Adventure Gate'];
}

function hallText({ player, character, unlockedAdventures, lockedAdventures, prefix = '' }) {
  const characterName = String(character?.name ?? '').trim();
  const epithet = character?.reputation?.epithet;
  const titled = characterName ? (epithet ? `${characterName} ${epithet}` : characterName) : '';
  const lines = [prefix || (titled ? `You stand in the Great Hall, ${titled}.` : 'You stand in the Great Hall.')];
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
  const { unlockedAdventures, lockedAdventures } = partitionAdventures(adventures, activeCharacter, player?.entitlements);
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
    ...partitionAdventures(adventures, character, player?.entitlements),
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
  const { unlockedAdventures, lockedAdventures } = partitionAdventures(adventures, character, player?.entitlements);
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
  // Spells as tiles in the shop scene (portrait + grid).
  const options = SPELLS
    .filter((spell) => spellAbility(character, spell.name) <= SPELL_MAX)
    .map((spell) => {
      const ability = spellAbility(character, spell.name);
      return {
        icon: '✦',
        name: capitalize(spell.name),
        stat: ability > 0 ? `now ${ability}% — improve` : spell.description,
        price: spell.price,
        command: `${ability > 0 ? 'upgrade' : 'learn'} ${spell.name}`,
        confirmLabel: `${ability > 0 ? 'Upgrade' : 'Learn'} ${capitalize(spell.name)}`,
      };
    });
  return canonicalResponse({
    intent: { type: 'hall_wizard' },
    event: { type: 'hall_wizard' },
    text: prefix || `Hokas Tokas, the old Mage, looks up. "So you want old Hokey to teach you some magic, eh?"`,
    choices: ['Return to Great Hall'],
    state: hallState({ player, character, characters, adventures, extra: {
      locationTitle: WIZARD_TITLE,
      shop: { key: 'hokas', title: 'HOKAS TOKAS — SCHOOL OF MAGICK', mode: 'options', line: prefix || '"Here are the spells I teach. Which will it be?"', options },
    } }),
  });
}

function witchResponse({ player, character, characters, adventures, prefix = '' }) {
  const options = ATTRIBUTES.map((attr) => ({
    icon: '◆',
    name: capitalize(attr),
    stat: `now ${character[attr]} → ${character[attr] + 1}`,
    price: attributePrice(character[attr]),
    command: `raise ${attr}`,
    confirmLabel: `Raise ${capitalize(attr)}`,
  }));
  return canonicalResponse({
    intent: { type: 'hall_witch' },
    event: { type: 'hall_witch' },
    text: prefix || `A lovely young woman dressed in black smiles. "My magic potions can increase one of your attributes."`,
    choices: ['Return to Great Hall'],
    state: hallState({ player, character, characters, adventures, extra: {
      locationTitle: WITCH_TITLE,
      shop: { key: 'witch', title: "THE WITCH'S SHOP", mode: 'options', line: prefix || '"Choose the attribute you would raise."', options },
    } }),
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
    state: hallState({ player, character, characters, adventures, extra: { locationTitle: BANK_TITLE, vendor: { name: 'Seamus McFenney', kind: 'neutral' } } }),
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
    state: hallState({ player, character, characters, adventures, extra: { locationTitle: HEALER_TITLE, vendor: { name: 'Brother Aldous', kind: 'neutral' } } }),
  });
}

// The Hall of Records: the Archivist's guidance room + tribute to the originals.
// The browsable codex lives client-side (records.js), reusing the same stat facts
// as the inline tooltips; the server just opens the panel with the Archivist's line.
function recordsResponse({ player, character, characters, adventures, prefix = '' }) {
  return canonicalResponse({
    intent: { type: 'hall_records' },
    event: { type: 'hall_records' },
    text: prefix || `The Archivist looks up from a great ledger and inclines his head. "Welcome to the Hall of Records${character?.name ? `, ${character.name}` : ''}. Here the Guild keeps its lore — how an adventurer's mettle is measured, the ways of arms and mercy, and the memory of those who first lit this lamp. Read a while, and go the wiser for it."${hasQuill(character) ? '' : ` On the counter rests a long grey quill in a case of worn leather, marked ${QUILL.price} gold.`}`,
    choices: [...(hasQuill(character) ? [] : [`The Chronicler's Quill (${QUILL.price} gold)`]), 'Return to Great Hall'],
    state: hallState({ player, character, characters, adventures, extra: { locationTitle: HALL_OF_RECORDS_TITLE, records: { open: true, ledger: reputationRead(computeReputation(character?.chronicle), character?.name), quill: { owned: hasQuill(character), price: QUILL.price }, note: prefix || null, authors: adventures.map((a) => ({ name: a.adventure.name, author: a.adventure.author ?? 'author unknown', year: a.adventure.year ?? null })) } } }),
  });
}

// One canonical layout per adventure — the world's fixed geography, cached.
const mapLayoutCache = new Map();
function mapFor(adventure, run, character) {
  const id = adventure?.adventure?.id;
  if (!mapLayoutCache.has(id)) mapLayoutCache.set(id, computeLayout(adventure));
  return mapRead(adventure, run, character, mapLayoutCache.get(id));
}

// A staged NPC wears its current stage's face (the drunk giant, the blinded
// giant) wherever it is rendered.
function withStageFaces(adventure, run, entities) {
  return {
    ...entities,
    characters: (entities.characters ?? []).map((c) => {
      const data = stageData(adventure, run, c.slug);
      if (!data) return c;
      return { ...c, ...(data.description ? { description: data.description, first_encounter_text: data.description } : {}), ...(data.hostile === false ? { disposition: 'neutral' } : {}) };
    }),
  };
}

function roomResponse({ adventure, run, character, text = null, prefix = null, event = { type: 'look' }, intent = null, events = null, narration = null }) {
  const room = getCurrentRoom(run, adventure);
  const entities = withStageFaces(adventure, run, getVisibleRoomEntities(run, adventure));
  const items = visibleItems(adventure, entities);
  // AI narration replaces only the description line; the mechanical truth
  // (who is here, items, exits) always comes from the engine.
  const renderedRoom = narration ? { ...room, narration_text: narration, description: undefined } : room;
  let body = text ?? renderRoom(renderedRoom, entities, items, room.exits);
  // A staged NPC's condition is world state the player must SEE: the sleeping
  // giant reads as sleeping on every look, not just at the transition.
  if (!text) {
    const stageLines = (entities.characters ?? [])
      .map((c) => stageData(adventure, run, c.slug)?.description)
      .filter(Boolean);
    if (stageLines.length) body = `${body}\n\n${stageLines.join('\n')}`;
  }
  return canonicalResponse({
    intent,
    event,
    events,
    text: prefix ? `${prefix}\n\n${body}` : body,
    choices: choicesForRun(adventure, run, character),
    state: { phase: 'adventure', locationTitle: room?.name ?? adventure?.adventure?.name ?? 'Adventure', background: `scenes/${adventure?.adventure?.id}/room-${room?.room_number}.png?a=5`, living: livingFor(adventure, room, entities), character, adventureRun: run, room, entities, items: withReadState(items, run), combat: combatStateFor({ adventure, run, character }), map: mapFor(adventure, run, character) },
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
      player: { id: playerId, display_name: req.auth.user.display_name ?? req.auth.user.displayName ?? req.auth.user.username ?? null, entitlements: Array.isArray(req.auth.user.entitlements) ? req.auth.user.entitlements : [] },
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
    generateImage: deps.generateImage ?? defaultGenerateImage,
    insertPortrait: deps.insertPortrait ?? defaultInsertPortrait,
    getPortraitPng: deps.getPortraitPng ?? defaultGetPortraitPng,
    setCharacterPortraitUrl: deps.setCharacterPortraitUrl ?? defaultSetCharacterPortraitUrl,
    countRecentPortraits: deps.countRecentPortraits ?? defaultCountRecentPortraits,
    rng: deps.rng ?? Math.random,
    // The AI layer is flavor over the rules engine: every entry point returns
    // null on failure and the caller falls back to authored text. Injectable
    // so tests run deterministic and keyless.
    ai: {
      narrateRoomEntry: deps.ai?.narrateRoomEntry ?? defaultNarrateRoomEntry,
      narrateMoment: deps.ai?.narrateMoment ?? defaultNarrateMoment,
      judgeParley: deps.ai?.judgeParley ?? defaultJudgeParley,
      spiritHint: deps.ai?.spiritHint ?? defaultSpiritHint,
      weaponLegend: deps.ai?.weaponLegend ?? defaultWeaponLegend,
      maybeCompress: deps.ai?.maybeCompress ?? defaultMaybeCompress,
    },
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

      // ── Archivist: the Chronicler's Quill (before Marcos's generic buy) ──
      if (/quill/.test(normalizedInput)) {
        if (hasQuill(character)) {
          return render(recordsResponse, character, characterRow, 'The Archivist smiles. "Your quill is bought and your book is the better for it. Open your map and see."');
        }
        const result = buyItem(character, QUILL);
        if (!result.ok) {
          return render(recordsResponse, character, characterRow, `The Archivist closes the leather case gently. "The Chronicler's Quill asks ${QUILL.price} gold, and no less. The Guild's cartographers must eat."`);
        }
        const bought = recordDeed(result.character, "Bought the Chronicler's Quill from the Archivist, and watched old deeds ink themselves onto the journal's map.", { kind: 'other' });
        const row = await persist({ gold: bought.gold, inventory: bought.inventory, chronicle: bought.chronicle });
        return render(recordsResponse, rowCharacter(row) ?? bought, row, `You count out ${QUILL.price} gold. The Archivist lifts a long grey quill from its case and lays it across your palm. "It remembers where you have been," he says. "Every deed already done, and every one to come, will ink itself into your journal's map." Somewhere in your pack, pages begin to whisper.`);
      }

      // ── Marcos: buy / sell ──────────────────────────────────────────────
      const buyMatch = /^buy\s+(.+)/i.exec(input);
      if (buyMatch) {
        const item = findCatalogItem(buyMatch[1]);
        if (!item) return error(res, 400, `Marcos does not stock ${buyMatch[1].trim()}.`, 'invalid-purchase');
        const result = buyFromShop(character, item);
        if (!result.ok) return error(res, 409, `Not enough gold to buy ${item.name}.`, result.reason);
        const row = await persist({ gold: result.character.gold, inventory: result.character.inventory, equipment: result.character.equipment });
        // A named magic weapon comes with its legend (AI-told, stats untouched).
        const legend = item.magic ? await deps.ai.weaponLegend(item) : null;
        const receipt = `You buy ${item.name} and ready it. "Pleasure doing business!"`;
        return render(shopResponse, rowCharacter(row), row, legend ? `${receipt}\nMarcos leans on the counter. "${legend}"` : receipt);
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
      if (/hall\s*of\s*records|records|archivist|library|lore|codex/.test(normalizedInput)) {
        return render(recordsResponse, character, characterRow);
      }

      return res.json(hallResponse({ player: hallPlayer, characters: [characterRow], adventures, character, prefix: 'You remain in the Great Hall.' }));
    } catch (err) {
      return next(err);
    }
  });

  // The portrait builder's trait vocabulary (for rendering the picker UI).
  router.get('/portrait-options', (_req, res) => res.json({ ok: true, options: portraitOptions() }));

  // Paint a custom character portrait from picked traits. Reward-gated behind
  // clearing the Beginner's Cave. Traits are an enumerated allowlist, so the
  // prompt is fully server-composed (no free text to moderate).
  router.post('/portrait', async (req, res, next) => {
    try {
      if (!requireDb(req, res, deps.db)) return;
      const { characterId, traits } = req.body ?? {};
      const context = resolveGameContext(req);
      if (context.error || !characterId) return error(res, 400, context.error ? context.error : 'characterId is required.', 'bad-request');
      if (!context.isAuthenticated) return error(res, 403, 'Sign in to paint a portrait.', 'account-required');
      const row = await deps.getCharacter(deps.db, context.owner, characterId);
      if (!row) return error(res, 404, 'Character not found for this player.', 'not-found');
      const character = rowCharacter(row);
      if (!isValidClass(character.className)) return error(res, 400, 'Unknown character class.', 'bad-request');
      if (!isBeginnerComplete(character)) return error(res, 403, "Clear the Beginner's Cave to unlock your portrait.", 'locked');

      // Cost guard: cap generations per character per rolling 24h.
      const since = new Date(Date.now() - PORTRAIT_WINDOW_MS).toISOString();
      const usage = await deps.countRecentPortraits(deps.db, characterId, since);
      if ((usage?.count ?? 0) >= PORTRAIT_DAILY_LIMIT) {
        const retryAt = usage?.oldest ? new Date(new Date(usage.oldest).getTime() + PORTRAIT_WINDOW_MS).toISOString() : null;
        return res.status(429).json({
          ok: false, error: 'rate-limited',
          text: `You have repainted your portrait ${PORTRAIT_DAILY_LIMIT} times today — come back tomorrow to paint a new one.`,
          retryAt, limit: PORTRAIT_DAILY_LIMIT,
          media: { voice: null, background: null, portraits: [] },
        });
      }

      const cleanTraits = sanitizeTraits(traits);
      const prompt = composePortraitPrompt(cleanTraits, character.className);
      const gen = await deps.generateImage(prompt);
      if (!gen?.png) return error(res, 502, 'The portrait could not be painted right now. Try again shortly.', gen?.error ?? 'generation-failed');

      const saved = await deps.insertPortrait(deps.db, { characterId, png: gen.png, meta: { traits: cleanTraits, className: character.className } });
      // Cache-bust by the new portrait's id so a re-roll shows immediately.
      const portraitUrl = `/api/game/portrait/${characterId}/render.png?v=${saved?.id ?? gen.png.length}`;
      const updated = await deps.setCharacterPortraitUrl(deps.db, characterId, portraitUrl);
      const remaining = Math.max(0, PORTRAIT_DAILY_LIMIT - (usage.count + 1));
      return res.json({ ok: true, portraitUrl, traits: cleanTraits, remaining, dailyLimit: PORTRAIT_DAILY_LIMIT, character: rowCharacter(updated ?? row) });
    } catch (err) {
      return next(err);
    }
  });

  // Serve a character's saved portrait PNG (public — it's just an avatar image).
  router.get('/portrait/:characterId/render.png', async (req, res, next) => {
    try {
      if (!requireDb(req, res, deps.db)) return;
      const stored = await deps.getPortraitPng(deps.db, req.params.characterId);
      if (!stored?.png) return error(res, 404, 'No portrait has been painted yet.', 'not-found');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(stored.png);
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
      if (adventure.adventure.premium === true && !isEntitled({ premium: true, id: adventureId }, context.player?.entitlements ?? [])) {
        return error(res, 403, 'This is a premium adventure of the Second Age.', 'premium-required');
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
        // One expedition at a time: resume only when the request names the
        // SAME adventure (or names none — the legacy resume path). Silently
        // resuming a different adventure teleported players who clicked a
        // second Gate card back into their old run.
        if (req.body?.adventureId && existingRunRow.adventure_id !== adventureId) {
          const existingName = existingAdventure.adventure?.name ?? existingRunRow.adventure_id;
          return error(res, 409, `${character.name} is still mid-expedition in ${existingName}. Walk out alive to keep the haul — or type LEAVE inside it to abandon the run (treasures convert to gold) — before beginning another adventure.`, 'run-in-progress');
        }
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
      const startResponse = roomResponse({ adventure, run: rowRun(runRow), character, event: { type: 'start_adventure' }, intent: { type: 'start_adventure', source: 'rules' } });
      // The story setup: the original adventures opened with framing text
      // (Lil's botched heist, the throne room, the trap-door lever) before
      // room one. The client shows it as a full-screen prologue.
      if (adventure.adventure.intro) {
        startResponse.state.intro = {
          title: adventure.adventure.name,
          author: adventure.adventure.author ?? null,
          year: adventure.adventure.year ?? null,
          text: adventure.adventure.intro,
          cover: `scenes/${adventure.adventure.id}/cover.png?v=2`,
        };
      }
      return res.status(201).json(startResponse);
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

      // Magic words: speaking a carried item's word toggles its power. TrollsFire
      // kindles/douses its green flame; lighting it unwielded singes you. Accepts
      // the bare word ("trollsfire") or a button label ("Ignite/Douse TrollsFire").
      const rawWord = normalizeTarget(req.body.input ?? '');
      const strippedWord = rawWord.replace(/^(ignite|light|kindle|douse|extinguish|snuff|say|speak)\s+/, '');
      const magicItem = rawWord && (character.inventory ?? []).find((it) => it.magic_word && (
        normalizeTarget(it.magic_word) === rawWord
        || normalizeTarget(it.magic_word) === strippedWord
        || normalizeTarget(it.name) === strippedWord
      ));
      if (magicItem) {
        const nowLit = !run.flags?.litItems?.[magicItem.slug];
        run = { ...run, flags: { ...(run.flags ?? {}), litItems: { ...(run.flags?.litItems ?? {}), [magicItem.slug]: nowLit } } };
        const wielded = character.equipment?.weapon?.slug === magicItem.slug;
        let burn = 0;
        let line;
        if (nowLit && wielded) line = `You speak the word, and ${magicItem.name} blazes up with green fire!`;
        else if (nowLit) { burn = 3; line = `You speak the word, and ${magicItem.name} blazes with green fire — but it is not in your hand, and the flames sear you for ${burn}!`; }
        else line = `You speak the word, and the green flame of ${magicItem.name} gutters out.`;
        if (burn) {
          character.hd = Math.max(0, (character.hd ?? 0) - burn);
          if (character.hd <= 0) { character.isAlive = false; run = { ...run, status: 'dead' }; }
        }
        const [uc, ur] = await Promise.all([
          deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
          deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
        ]);
        const defeated = (character.hd ?? 0) <= 0;
        return res.json(canonicalResponse({
          intent: command,
          events: [{ type: 'magic_word', word: magicItem.magic_word, item: magicItem.slug, lit: nowLit }, ...(defeated ? [{ type: 'character_defeated', characterId: character.id }] : [])],
          text: defeated ? `${line}\nYou have been defeated.` : line,
          choices: defeated ? [] : choicesForRun(adventure, run),
          state: { character: rowCharacter(uc), adventureRun: rowRun(ur), combat: combatStateFor({ adventure, run, character }) },
        }));
      }

      if (command.type === 'look') {
        // Resolve any not-yet-rolled random encounters here (e.g. a resumed run).
        const encounter = resolveRoomEncounters(run, adventure, character, deps.rng);
        if (encounter.run !== run) {
          run = encounter.run;
          const saved = await deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run));
          run = rowRun(saved) ?? run;
        }
        return res.json(roomResponse({ adventure, run, character, prefix: encounter.note || null, event: { type: 'look', command }, intent: command }));
      }

      if (command.type === 'inventory' || command.type === 'stats') {
        return res.json(canonicalResponse({ intent: command, event: { type: command.type, command }, text: renderInventory(character), choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
      }

      if (command.type === 'help') {
        return res.json(canonicalResponse({ intent: command, event: { type: 'help', command }, text: 'Try: look, north, south, take gem, attack rat, inventory, or leave.\nNot every fight must end in blood: SAY something to an enemy in your own words, try what the room suggests (CALM, PARLEY, PRAY...), and SPARE a foe who yields.\nWhen an enemy winds up a big blow, answer with BRACE, DODGE, or INTERRUPT. Lost? Ask for a HINT.', choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
      }

      if (command.type === 'move') {
        const fromRoom = getCurrentRoom(run, adventure);
        const gate = gateMove({ adventure, run, character, room: fromRoom, direction: command.direction });
        if (!gate.ok) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'blocked', command, reason: 'mechanics' }, text: gate.text, choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
        }
        run = applyFlagPatch(run, gate.flagPatch);
        const revisiting = (run.visitedRooms ?? []).includes(getCurrentRoom(run, adventure)?.exits?.[command.direction]);
        const result = move(run, adventure, command.direction);
        if (!result.ok) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'blocked', command, reason: result.reason }, text: renderMoveBlocked(command.direction), choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        run = result.run;
        if (result.destination === 'main-hall') {
          const conversion = convertTreasuresOnReturn(character);
          character = conversion.character;
          // Escort companions (Cynthia) delivered alive pay their patron's reward.
          const escort = deliverEscorts(character, run, adventure);
          if (escort.gold > 0) character = { ...character, gold: (character.gold ?? 0) + escort.gold };
          // Wounds persist between adventures — the Healer in the Hall restores
          // HP for gold, so health is a real resource (not free on return).
          const firstClear = !(character.adventuresCompleted ?? []).includes(adventure.adventure.id);
          character.adventuresCompleted = Array.from(new Set([...(character.adventuresCompleted ?? []), adventure.adventure.id]));
          // The chronicle remembers the expedition; long logs fold into prose.
          character = recordDeeds(character, [
            { text: firstClear ? `Conquered ${adventure.adventure.name} for the first time.` : `Returned from ${adventure.adventure.name}.`, kind: 'complete' },
            conversion.goldGained > 0 ? { text: `Carried home plunder worth ${conversion.goldGained} gold.`, kind: 'other' } : null,
            ...escort.names.map((name) => ({ text: `Brought ${name} safely home through the dark.`, kind: 'rescue' })),
          ]);
          character = await deps.ai.maybeCompress(character);
          const [updatedCharacter, completedRun] = await Promise.all([
            deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
            deps.completeAdventureRun(deps.db, context.owner, run.id),
          ]);
          const hall = hallResponse({
            player: { id: run.playerId },
            characters: [updatedCharacter],
            adventures,
            character: rowCharacter(updatedCharacter),
            prefix: [renderReturnToHall({ ...conversion, completed: true }), escort.message].filter(Boolean).join(' '),
          });
          hall.intent = command;
          hall.events = escort.gold > 0
            ? [{ type: 'return_to_hall', command }, { type: 'escort_reward', gold: escort.gold }]
            : [{ type: 'return_to_hall', command }];
          hall.event = hall.events[0];
          hall.state.adventureRun = rowRun(completedRun);
          return res.json(hall);
        }
        const arrival = afterMove({ adventure, run, destination: getCurrentRoom(run, adventure).room_number });
        run = applyFlagPatch(run, arrival.flagPatch);
        if (arrival.deathText) {
          character = { ...character, isAlive: false, hd: 0 };
          character = recordDeed(character, `Died on the river in ${getCurrentRoom(run, adventure).name} (${adventure.adventure.name}).`, { kind: 'death', room: getCurrentRoom(run, adventure).room_number });
          run = { ...run, status: 'dead' };
          const [dc, dr] = await Promise.all([
            deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
            deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
          ]);
          return res.json(canonicalResponse({
            intent: command, event: { type: 'character_defeated', command }, events: [{ type: 'move', command }, { type: 'character_defeated', characterId: character.id }],
            text: arrival.deathText, choices: ['Return to Great Hall'],
            state: { character: rowCharacter(dc) ?? character, adventureRun: rowRun(dr) ?? run },
          }));
        }
        const mechNotes = [...(gate.notes ?? []), ...(arrival.notes ?? [])];
        // The world's clocks tick on movement: staged NPCs age (the drunk
        // giant slides toward sleep), and the attrition clock feeds.
        const ticked = tickStages(adventure, run);
        run = ticked.run;
        mechNotes.push(...ticked.notes);
        const bite = tickAttrition({ adventure, run, roomNumber: getCurrentRoom(run, adventure).room_number });
        if (bite) {
          run = bite.run;
          if (bite.victim) {
            const victim = adventure.characters.find((c) => c.slug === bite.victim);
            const aText = (mechanicsOf(adventure).attrition?.text ?? '{name} is taken.').replace('{name}', victim?.name ?? bite.victim);
            mechNotes.push(aText);
            character = recordDeed(character, `${victim?.name ?? bite.victim} was lost in ${getCurrentRoom(run, adventure).name} (${adventure.adventure.name}).`, { kind: 'companion_lost', room: getCurrentRoom(run, adventure).room_number });
          }
        }
        // Entering a room rolls friend-or-foe for any "random" NPCs there.
        const encounter = resolveRoomEncounters(run, adventure, character, deps.rng);
        run = encounter.run;
        const updatedRun = await deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run));
        const savedRun = rowRun(updatedRun) ?? run;
        // State-aware narration over the canonical room text (null → authored text).
        const narration = await deps.ai.narrateRoomEntry({
          adventure,
          room: getCurrentRoom(savedRun, adventure),
          character,
          entities: getVisibleRoomEntities(savedRun, adventure),
          visitCount: revisiting ? 2 : 1,
          note: encounter.note || null,
          reputation: reputationForPrompt(computeReputation(character?.chronicle), character?.name),
        });
        return res.json(roomResponse({
          adventure, run: savedRun, character,
          prefix: [...mechNotes, encounter.note].filter(Boolean).join('\n') || null,
          narration,
          event: { type: 'move', command }, events: encounter.events.length ? [{ type: 'move', command }, ...encounter.events] : null,
          intent: command,
        }));
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

        // A cursed book: reading it transforms the reader and kills them. The
        // book is readable on the ground OR once carried; the cove gets its own
        // (funnier) death text.
        const invMatch = (character.inventory ?? []).find((it) => normalizeTarget(it.slug) === normalizeTarget(command.target) || normalizeTarget(it.name) === normalizeTarget(command.target));
        const fatalItem = findVisibleItems(adventure, run, command.target).find((it) => it.read_effect === 'fatal_transform')
          ?? (invMatch?.read_effect === 'fatal_transform' ? invMatch : null);
        if (fatalItem) {
          const roomNo = String(getCurrentRoom(run, adventure).room_number);
          const deathText = fatalItem.read_effect_text_at?.[roomNo] ?? fatalItem.read_effect_text ?? 'The book’s curse takes you.';
          character = { ...character, isAlive: false, hd: 0 };
          character = recordDeed(character, `Read the ${fatalItem.name} in ${getCurrentRoom(run, adventure).name} — and paid the old price for curiosity.`, { kind: 'death', room: getCurrentRoom(run, adventure).room_number });
          run = { ...run, status: 'dead' };
          const [uc, ur] = await Promise.all([
            deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
            deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
          ]);
          return res.json(canonicalResponse({
            intent: command,
            events: [{ type: 'read_item', command, item: fatalItem.slug }, { type: 'character_defeated', characterId: character.id, cause: 'cursed-book' }],
            text: `${deathText}\n\nYou have died.`,
            choices: [],
            state: { character: rowCharacter(uc), adventureRun: rowRun(ur) },
          }));
        }

        const matches = findVisibleItems(adventure, run, command.target);
        if (matches.length === 0) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'read_failed', command, reason: 'missing-item' }, text: `There is no ${command.target} here to read.`, choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        // A wall may carry several inscriptions sharing one name — read them all.
        const text = matches
          .map((item) => item.text ?? item.description ?? `There is nothing written on ${item.name}.`)
          .join('\n\n');
        // Remember they've been read so the tile grays out (no endless re-reading).
        const alreadyAllRead = matches.every((item) => (run.flags?.readItems ?? []).includes(item.slug));
        for (const item of matches) run = markItemRead(run, item.slug);
        if (!alreadyAllRead) {
          const savedRun = await deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run));
          run = rowRun(savedRun) ?? run;
        }
        const readItems = withReadState(visibleItems(adventure, getVisibleRoomEntities(run, adventure)), run);
        return res.json(canonicalResponse({ intent: command, event: { type: 'read_item', command, item: matches[0], items: matches }, text, choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run, items: readItems } }));
      }

      if (command.type === 'note') {
        // The player's own marginalia — a function of OWNING A QUILL. Diegetic
        // gating: no quill, no ink. It's 50 in-game gold at the Archivist's,
        // and the refusal doubles as the signpost there.
        if (!hasQuill(character)) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'note_failed', command, reason: 'no-quill' }, text: 'You pat your pack for something to write with, and find nothing. The Archivist in the Hall of Records sells a fine grey quill — the kind that writes on journey-maps and remembers what it wrote.', choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
        }
        const roomNo = getCurrentRoom(run, adventure).room_number;
        const text = String(command.words ?? '').slice(0, 60);
        if (!text.trim()) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'note_failed', command, reason: 'empty' }, text: 'What should the note say? Try: NOTE boat is here — it pins your words to this room on the map.', choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
        }
        const all = run.flags?.playerNotes ?? {};
        const mine = [...(all[roomNo] ?? []), text].slice(-3); // 3 per room, newest kept
        run = applyFlagPatch(run, { playerNotes: { ...all, [roomNo]: mine } });
        const savedNote = await deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run));
        run = rowRun(savedNote) ?? run;
        return res.json(canonicalResponse({ intent: command, event: { type: 'note', command }, text: `✎ Noted, in your own hand: "${text}"\n(It will show on your map for this room. Up to three notes per room.)`, choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run, map: mapFor(adventure, run, character) } }));
      }

      if (command.type === 'give') {
        const item = (character.inventory ?? []).find((i) => normalizeTarget(i?.name ?? '') === normalizeTarget(command.target) || slugify(i?.slug ?? '') === slugify(command.target));
        if (!item) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'give_failed', command, reason: 'missing-item' }, text: `You are not carrying ${command.target}.`, choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
        }
        const recipient = findVisibleCharacter(adventure, run, command.recipient);
        if (!recipient) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'give_failed', command, reason: 'missing-recipient' }, text: `There is no ${command.recipient} here.`, choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
        }
        const transition = stageTransition({ adventure, run, slug: recipient.slug, on: { give: item.slug } });
        if (transition) {
          run = setStage(run, recipient.slug, transition.to);
          character = { ...character, inventory: (character.inventory ?? []).filter((i) => i !== item) };
          const [gc, gr] = await Promise.all([
            deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
            deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
          ]);
          character = rowCharacter(gc) ?? character;
          run = rowRun(gr) ?? run;
          return res.json(roomResponse({ adventure, run, character, prefix: transition.text, event: { type: 'give', command, stage: transition.to }, events: [{ type: 'give', item: item.slug, to: recipient.slug }, { type: 'stage_change', npc: recipient.slug, stage: transition.to }], intent: command }));
        }
        return res.json(canonicalResponse({ intent: command, event: { type: 'give_failed', command, reason: 'refused' }, text: `${recipient.name} has no use for ${item.name}.`, choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
      }

      if (command.type === 'hide') {
        const spots = mechanicsOf(adventure).hide_spots ?? [];
        const here = getCurrentRoom(run, adventure).room_number;
        const spot = spots.find((sp) => sp.room_number === here && (!command.target || normalizeTarget(sp.target).includes(normalizeTarget(command.target))));
        if (!spot) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'hide_failed', command }, text: 'There is nowhere here worth hiding.', choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
        }
        if (spot.requires_stage && stageOf(adventure, run, spot.requires_stage.npc) !== spot.requires_stage.stage) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'hide_failed', command, reason: 'not-yet' }, text: spot.not_yet_text ?? 'Not yet — the moment is wrong.', choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
        }
        run = applyFlagPatch(run, { hiddenAt: spot.target });
        const savedHide = await deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run));
        run = rowRun(savedHide) ?? run;
        return res.json(roomResponse({ adventure, run, character, prefix: spot.success_text, event: { type: 'hide', command }, intent: command }));
      }

      if (command.type === 'use_item') {
        // Feature-use triggers: using a visible room fixture (the tally
        // stones) sets an authored flag — the quiet half of a Myst puzzle.
        const useTriggers = mechanicsOf(adventure).use_triggers ?? [];
        const visibleHere = visibleItems(adventure, getVisibleRoomEntities(run, adventure));
        const ut = useTriggers.find((t) => t.room_number === getCurrentRoom(run, adventure).room_number
          && visibleHere.some((i) => i.slug === t.item)
          && (normalizeTarget(command.target).includes(normalizeTarget(t.match ?? t.item)) || slugify(command.target) === slugify(t.item)));
        if (ut) {
          if (ut.requires_stage && stageOf(adventure, run, ut.requires_stage.npc) !== ut.requires_stage.stage) {
            return res.json(canonicalResponse({ intent: command, event: { type: 'blocked', command }, text: ut.not_yet_text ?? 'Not while those eyes are open.', choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
          }
          if (run.flags?.[ut.sets_flag]) {
            return res.json(canonicalResponse({ intent: command, event: { type: 'search', command }, text: ut.already_text ?? 'It is already done.', choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
          }
          run = applyFlagPatch(run, { [ut.sets_flag]: true });
          character = recordDeed(character, ut.deed_text ?? `Worked a quiet subversion in ${getCurrentRoom(run, adventure).name}.`, { kind: ut.deed_kind ?? 'secret', room: getCurrentRoom(run, adventure).room_number });
          const [uc3, ur3] = await Promise.all([
            deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
            deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
          ]);
          character = rowCharacter(uc3) ?? character;
          run = rowRun(ur3) ?? run;
          return res.json(roomResponse({ adventure, run, character, prefix: `${ut.banner ?? '✦ SECRET ✦'}\n${ut.text}`, event: { type: 'secret_found', command }, events: [{ type: 'secret_found' }], intent: command }));
        }
        // A carried item used on/near a staged NPC may advance the stage
        // (the olive stake and the sleeping giant). Falls through to the
        // regular use handler when no transition applies.
        const usedItem = (character.inventory ?? []).find((i) => normalizeTarget(i?.name ?? '') === normalizeTarget(command.target) || slugify(i?.slug ?? '') === slugify(command.target));
        if (usedItem) {
          const present = (getVisibleRoomEntities(run, adventure).characters ?? []);
          for (const npc of present) {
            const t = stageTransition({ adventure, run, slug: npc.slug, on: { use: usedItem.slug } });
            if (t) {
              run = setStage(run, npc.slug, t.to);
              character = recordDeed(character, `${t.deed ?? `Turned the tide against the ${npc.name}`} in ${getCurrentRoom(run, adventure).name} (${adventure.adventure.name}).`, { kind: t.deed_kind ?? 'riddle', room: getCurrentRoom(run, adventure).room_number });
              const [uc2, ur2] = await Promise.all([
                deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
                deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
              ]);
              character = rowCharacter(uc2) ?? character;
              run = rowRun(ur2) ?? run;
              return res.json(roomResponse({ adventure, run, character, prefix: t.text, event: { type: 'stage_change', npc: npc.slug, stage: t.to }, events: [{ type: 'stage_change', npc: npc.slug, stage: t.to }], intent: command }));
            }
          }
        }
      }

      if (command.type === 'dig') {
        const dig = digResult({ adventure, run, character, roomNumber: getCurrentRoom(run, adventure).room_number });
        if (!dig) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'blocked', command }, text: 'There is nothing here worth digging for.', choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
        }
        if (!dig.ok) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'blocked', command }, text: dig.text, choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
        }
        if (!dig.site) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'search', command }, text: dig.text, choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
        }
        run = revealItem(run, dig.site.reveals);
        character = recordDeed(character, `Unearthed something long buried in ${getCurrentRoom(run, adventure).name} (${adventure.adventure.name}).`, { kind: 'secret', room: getCurrentRoom(run, adventure).room_number });
        const [digChar, savedDig] = await Promise.all([
          deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
          deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
        ]);
        character = rowCharacter(digChar) ?? character;
        run = rowRun(savedDig) ?? run;
        return res.json(roomResponse({ adventure, run, character, prefix: `✦ SECRET UNEARTHED ✦\n${dig.site.found_text}`, event: { type: 'secret_found', command }, events: [{ type: 'secret_found' }], intent: command }));
      }

      if (command.type === 'take') {
        const item = findVisibleItem(adventure, run, command.target);
        if (!item) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'take_failed', command, reason: 'missing-item' }, text: `There is no ${command.target} here to take.`, choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        if (!isCollectible(item)) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'take_failed', command, reason: 'not-collectible' }, text: `You cannot take ${item.name}.`, choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        const guard = guardedBy({ adventure, run, slug: item.slug, presentSlugs: (getVisibleRoomEntities(run, adventure).characters ?? []).map((c) => c.slug) });
        if (guard) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'take_failed', command, reason: 'guarded' }, text: guard.text, choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
        }
        const taken = takeTreasure(character, item, { allowDuplicate: true });
        if (!taken.ok) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'take_failed', command, reason: taken.reason }, text: `You cannot take ${item.name}.`, choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        character = taken.character;
        run = markItemCollected(run, item.slug);
        const curse = cursedItem(adventure, item.slug);
        let takeText = `You take ${item.name}.`;
        const takeEvents = [{ type: 'take', command, item }];
        if (curse) {
          const dmg = rollDice(curse.damage ?? '1d6', deps.rng);
          character = { ...character, hd: Math.max(0, (character.hd ?? 1) - dmg) };
          takeText = `${curse.text}\n(You take ${dmg} damage.)`;
          if (character.hd <= 0) {
            character = { ...character, isAlive: false };
            character = recordDeed(character, `Killed by the ${item.name} in ${getCurrentRoom(run, adventure).name}.`, { kind: 'death', room: getCurrentRoom(run, adventure).room_number });
            run = { ...run, status: 'dead' };
            takeEvents.push({ type: 'character_defeated', characterId: character.id });
            takeText += '\nThe shock stops your heart.';
          }
        }
        const [updatedCharacter, updatedRun] = await Promise.all([
          deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
          deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
        ]);
        return res.json(canonicalResponse({ intent: command, event: takeEvents[takeEvents.length - 1], events: takeEvents.length > 1 ? takeEvents : null, text: takeText, choices: choicesForRun(adventure, run), state: { character: rowCharacter(updatedCharacter), adventureRun: rowRun(updatedRun) } }));
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
        // (A yielded enemy keeps the truce while you drink.)
        const enemyTemplate = visibleEnemy(adventure, run);
        let enemyAttack = null;
        let characterDefeated = false;
        if (enemyTemplate && !hasYielded(run, enemyTemplate.slug)) {
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
        // A staged colossus in an invulnerable stage cannot be fought — only outwitted.
        const atkStage = stageData(adventure, run, enemyTemplate.slug);
        if (atkStage?.invulnerable) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'attack_failed', command, reason: 'invulnerable' }, text: atkStage.futile_text ?? `Your blow means nothing to the ${enemyTemplate.name}. Steel is not the answer here.`, choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
        }
        // Scatter creatures (the rats): the first strike fells the leader and the
        // rest break and flee to another room — no stand-up fight here.
        if (enemyTemplate.flees_to_room && combatRoundsFought(run, enemyTemplate.slug) === 0) {
          run = bumpCombatRound(run, enemyTemplate.slug).run;
          run = relocateCharacter(run, enemyTemplate.slug, enemyTemplate.flees_to_room);
          const destName = adventure.locations.find((l) => l.room_number === enemyTemplate.flees_to_room)?.name ?? 'the next chamber';
          const savedRun = await deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run));
          run = rowRun(savedRun) ?? run;
          return res.json(roomResponse({
            adventure, run, character,
            prefix: `You strike down the nearest ${(enemyTemplate.name ?? 'creature').toLowerCase()} as the pack lunges — the survivors break and flee toward ${destName}!`,
            event: { type: 'enemy_fled', command, enemy: enemyTemplate.slug, to: enemyTemplate.flees_to_room },
            events: [{ type: 'enemy_fled', enemy: enemyTemplate.slug, to: enemyTemplate.flees_to_room }],
            intent: command,
          }));
        }
        const enemy = { ...enemyTemplate, hp: run.enemyHp?.[enemyTemplate.slug] ?? enemyTemplate.hp };
        applyEquipmentToCombatant(character, run);
        const fighters = companionFighters(run, adventure);
        // Striking a yielded enemy shatters the truce: it will never yield again.
        let mercyBroken = false;
        if (hasYielded(run, enemyTemplate.slug)) {
          run = markMerciless(run, enemyTemplate.slug);
          mercyBroken = true;
        }
        // A pending wind-up: attacking straight through it means eating the
        // charged blow at full force.
        const pendingTelegraph = telegraphPending(run, enemyTemplate.slug) ? telegraphFor(enemyTemplate) : null;
        if (pendingTelegraph) run = setTelegraph(run, enemyTemplate.slug, false);
        // An enemy already in flight (flees_after_round) no longer turns to fight:
        // a one-sided pursuit. Otherwise the normal party/solo exchange.
        const pursuing = isFleeing(run, enemyTemplate.slug);
        let combat;
        if (pursuing) {
          const playerAttack = resolveAttack(character, enemy, deps.rng);
          const companionAttacks = [];
          for (const f of fighters) { if (isDead(enemy)) break; companionAttacks.push({ slug: f.slug, name: f.name, attack: resolveAttack(f, enemy, deps.rng) }); }
          combat = { playerAttack, companionAttacks, enemyAttack: null, enemyTarget: null, enemyDefeated: isDead(enemy), characterDefeated: isDead(character), fallen: [] };
        } else if (pendingTelegraph) {
          const playerAttack = resolveAttack(character, enemy, deps.rng);
          const companionAttacks = [];
          for (const f of fighters) { if (isDead(enemy)) break; companionAttacks.push({ slug: f.slug, name: f.name, attack: resolveAttack(f, enemy, deps.rng) }); }
          const enemyAttack = isDead(enemy) ? null : resolveAttack(enemy, character, deps.rng, { damageMultiplier: pendingTelegraph.multiplier });
          combat = { playerAttack, companionAttacks, enemyAttack, enemyTarget: enemyAttack ? 'player' : null, enemyDefeated: isDead(enemy), characterDefeated: isDead(character), fallen: [], chargedThrough: true };
        } else {
          combat = fighters.length
            ? resolvePartyRound({ character, fighters, enemy, rng: deps.rng })
            : resolveCombatRound(character, enemy, deps.rng);
        }
        character.hd = character.hp;
        run = { ...run, enemyHp: { ...(run.enemyHp ?? {}), [enemyTemplate.slug]: enemy.hp } };
        // Persist companion HP + cull any who fell this round.
        for (const f of fighters) run = setCompanionHp(run, f.slug, f.hp);
        const events = [{ type: 'combat', command, enemy: enemyTemplate.slug }];
        const extraText = [];
        if (mercyBroken) {
          extraText.push(`${enemyTemplate.name} had stopped fighting — your blow shatters the truce. It will never trust you again.`);
          events.push({ type: 'mercy_broken', enemy: enemyTemplate.slug });
        }
        if (combat.chargedThrough && combat.enemyAttack?.hit) {
          extraText.push(`You attack straight through the ${pendingTelegraph.name} — and pay for it.`);
        }
        for (const att of combat.companionAttacks ?? []) {
          extraText.push(att.attack.hit ? `${att.name} strikes ${enemyTemplate.name} for ${att.attack.damage}.` : `${att.name} swings at ${enemyTemplate.name} and misses.`);
        }
        for (const slug of combat.fallen ?? []) {
          run = removeCompanion(run, slug);
          const who = adventure.characters.find((c) => c.slug === slug)?.name ?? slug;
          extraText.push(`${who} falls in battle!`);
          events.push({ type: 'companion_fallen', character: slug });
        }
        // Track rounds; an enemy that survives past its nerve breaks and flees
        // (the pirate after his first swing). Thereafter combat is a pursuit.
        const bumped = bumpCombatRound(run, enemyTemplate.slug);
        run = bumped.run;
        // Brought to the brink, a yielding enemy stops fighting (HP threshold;
        // regard thresholds resolve in the act/say handlers).
        if (!combat.enemyDefeated && !hasYielded(run, enemyTemplate.slug) && checkYield(enemyTemplate, run, enemy.hp, yieldMods(computeReputation(character?.chronicle)))) {
          run = markYielded(run, enemyTemplate.slug);
          extraText.push(enemyTemplate.yield_text ?? `${enemyTemplate.name} falters, lowers its guard, and stops fighting. You could SPARE it — or finish this.`);
          events.push({ type: 'enemy_yielded', enemy: enemyTemplate.slug });
        } else if (!combat.enemyDefeated && enemyTemplate.flees_after_round
          && bumped.rounds >= enemyTemplate.flees_after_round && !isFleeing(run, enemyTemplate.slug)) {
          run = markFleeing(run, enemyTemplate.slug);
          extraText.push(`${enemyTemplate.name} turns and bolts — you give chase!`);
          events.push({ type: 'enemy_fleeing', enemy: enemyTemplate.slug });
        } else if (!combat.enemyDefeated && !hasYielded(run, enemyTemplate.slug)
          && !isFleeing(run, enemyTemplate.slug) && shouldTelegraph(enemyTemplate, bumped.rounds)) {
          // The wind-up: warn now, resolve on the player's answer next turn.
          const telegraph = telegraphFor(enemyTemplate);
          run = setTelegraph(run, enemyTemplate.slug, true);
          extraText.push(`${telegraph.warn_text ?? `${enemyTemplate.name} winds up for a ${telegraph.name}!`} (BRACE, DODGE, or INTERRUPT.)`);
          events.push({ type: 'telegraph', enemy: enemyTemplate.slug, name: telegraph.name });
        }
        if (combat.enemyDefeated) {
          run = markEnemyDefeated(run, enemyTemplate.slug);
          events.push({ type: 'enemy_defeated', enemy: enemyTemplate.slug });
          // Defeating a captor frees their prisoner, who joins your party.
          if (enemyTemplate.frees_on_defeat) {
            const captive = adventure.characters.find((c) => c.slug === enemyTemplate.frees_on_defeat);
            if (captive && !getCompanions(run).some((c) => c.slug === captive.slug)) {
              run = recruitCompanion(run, captive);
              extraText.push(`${captive.name ?? captive.slug} is free, and gratefully joins you.`);
              events.push({ type: 'recruit', character: captive.slug });
            }
          }
        }
        if (combat.characterDefeated) {
          character.isAlive = false;
          run = { ...run, status: 'dead' };
          events.push({ type: 'character_defeated', characterId: character.id });
        }
        // The chronicle records what verifiably happened this round.
        const battleRoom = getCurrentRoom(run, adventure);
        const deeds = [];
        if (combat.enemyDefeated) deeds.push({ text: `Slew the ${enemyTemplate.name} in ${battleRoom.name} (${adventure.adventure.name}).`, kind: 'slay' });
        if (mercyBroken) deeds.push({ text: `Broke a truce with the ${enemyTemplate.name}, who had yielded.`, kind: 'truce_broken' });
        for (const slug of combat.fallen ?? []) {
          deeds.push({ text: `${adventure.characters.find((c) => c.slug === slug)?.name ?? slug} fell in battle in ${battleRoom.name}.`, kind: 'companion_lost' });
        }
        if (combat.characterDefeated) deeds.push({ text: `Died fighting the ${enemyTemplate.name} in ${battleRoom.name} (${adventure.adventure.name}).`, kind: 'death' });
        character = recordDeeds(character, deeds, { room: battleRoom.room_number });
        // A turning point earns a line from the narrator (null → silence).
        const moment = (combat.enemyDefeated || combat.characterDefeated)
          ? await deps.ai.narrateMoment({
            kind: combat.characterDefeated ? 'the adventurer falls in battle' : 'the enemy is struck down',
            adventure, room: battleRoom, character, subject: enemyTemplate.name,
          })
          : null;
        const [updatedCharacter, updatedRun] = await Promise.all([
          deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
          deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
        ]);
        const combatState = combatStateFor({ adventure, run, character, enemyTemplate, result: combat });
        return res.json(canonicalResponse({
          intent: command,
          events,
          text: [renderCombatResult(combat), ...extraText, moment].filter(Boolean).join('\n'),
          choices: combat.characterDefeated ? [] : choicesForRun(adventure, run, character),
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
          // A disguised monster sprung by opening this "chest" ambushes you.
          const ambush = adventure.characters.find((c) => c.hidden_until_opened === container.slug
            && !run.defeatedEnemies.includes(c.slug));
          if (ambush) {
            const text = `You lift the lid of the ${container.name} — and it ERUPTS! ${ambush.first_encounter_text ?? ambush.description ?? `A ${ambush.name} springs out!`}`;
            return res.json(roomResponse({ adventure, run, character, text, event: { type: 'ambush', command, character: ambush.slug }, events: [{ type: 'open', command, container: container.slug }, { type: 'ambush', character: ambush.slug }], intent: command }));
          }
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
        // Blasting a yielded enemy shatters the truce, same as a sword would.
        let spellBrokeMercy = false;
        if (spellName === 'blast' && enemyTemplate && hasYielded(run, enemyTemplate.slug)) {
          run = markMerciless(run, enemyTemplate.slug);
          spellBrokeMercy = true;
        }
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
            // A spell-killed captor still frees their prisoner.
            if (enemyTemplate.frees_on_defeat) {
              const captive = adventure.characters.find((c) => c.slug === enemyTemplate.frees_on_defeat);
              if (captive && !getCompanions(run).some((c) => c.slug === captive.slug)) run = recruitCompanion(run, captive);
            }
          } else if (!hasYielded(run, enemyTemplate.slug)) {
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
        const text = [
          spellBrokeMercy ? `${enemyTemplate.name} had stopped fighting — your spell shatters the truce.` : null,
          cast.message, enemyText,
          enemyDefeated ? 'The enemy is defeated.' : null,
          characterDefeated ? 'You have been defeated.' : null,
        ].filter(Boolean).join('\n');
        const combat = enemyTemplate ? combatStateFor({ adventure, run, character, enemyTemplate, round }) : null;
        return res.json(canonicalResponse({
          intent: command,
          events: [{ type: 'cast', spell: spellName, success: cast.success }],
          text,
          choices: characterDefeated ? [] : choicesForRun(adventure, run),
          state: { character: rowCharacter(updatedCharacter), adventureRun: rowRun(updatedRun), combat },
        }));
      }

      // ── Stances: answering a telegraphed wind-up ─────────────────────────
      if (command.type === 'stance') {
        const enemyTemplate = visibleEnemy(adventure, run);
        const pending = enemyTemplate && telegraphPending(run, enemyTemplate.slug) ? telegraphFor(enemyTemplate) : null;
        if (!pending) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'stance_failed', command, reason: 'no-telegraph' }, text: 'You set yourself — but nothing is coming. Brace, dodge, and interrupt answer an enemy wind-up.', choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run, combat: combatStateFor({ adventure, run, character }) } }));
        }
        run = setTelegraph(run, enemyTemplate.slug, false);
        const enemy = { ...enemyTemplate, hp: run.enemyHp?.[enemyTemplate.slug] ?? enemyTemplate.hp };
        applyEquipmentToCombatant(character, run);
        const result = resolveTelegraphRound({ character, enemy, stance: command.stance, multiplier: pending.multiplier, rng: deps.rng });
        character.hd = character.hp;
        run = { ...run, enemyHp: { ...(run.enemyHp ?? {}), [enemyTemplate.slug]: enemy.hp } };
        run = bumpCombatRound(run, enemyTemplate.slug).run;
        const events = [{ type: 'stance', command, stance: command.stance, enemy: enemyTemplate.slug }];
        const lines = [];
        if (command.stance === 'dodge') {
          lines.push(`You hurl yourself aside as the ${pending.name} crashes past — untouched!`);
        } else if (command.stance === 'brace') {
          lines.push(result.enemyAttack?.hit
            ? `You plant your feet and take the ${pending.name} on your guard — ${result.enemyAttack.damage} damage, half what it might have been.`
            : `Braced and ready, you turn the ${pending.name} aside entirely.`);
        } else if (result.interrupted) {
          lines.push(`You lunge into the wind-up — your strike lands for ${result.playerAttack.damage} and stops the ${pending.name} cold!`);
        } else {
          lines.push(`Your strike goes wide — and the ${pending.name} hammers home for ${result.enemyAttack.damage}!`);
        }
        if (result.enemyDefeated) {
          run = markEnemyDefeated(run, enemyTemplate.slug);
          events.push({ type: 'enemy_defeated', enemy: enemyTemplate.slug });
          lines.push('The enemy is defeated.');
          character = recordDeed(character, `Slew the ${enemyTemplate.name} in ${getCurrentRoom(run, adventure).name} (${adventure.adventure.name}).`, { kind: 'slay', room: getCurrentRoom(run, adventure).room_number });
          if (enemyTemplate.frees_on_defeat) {
            const captive = adventure.characters.find((c) => c.slug === enemyTemplate.frees_on_defeat);
            if (captive && !getCompanions(run).some((c) => c.slug === captive.slug)) {
              run = recruitCompanion(run, captive);
              lines.push(`${captive.name ?? captive.slug} is free, and gratefully joins you.`);
              events.push({ type: 'recruit', character: captive.slug });
            }
          }
        }
        if (result.characterDefeated) {
          character.isAlive = false;
          run = { ...run, status: 'dead' };
          events.push({ type: 'character_defeated', characterId: character.id });
          lines.push('You have been defeated.');
          character = recordDeed(character, `Died to the ${enemyTemplate.name}'s ${pending.name} in ${getCurrentRoom(run, adventure).name}.`, { kind: 'death', room: getCurrentRoom(run, adventure).room_number });
        }
        const [uc, ur] = await Promise.all([
          deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
          deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
        ]);
        const round = {
          player: result.playerAttack ? combatSide(result.playerAttack) : null,
          enemy: result.enemyAttack ? combatSide(result.enemyAttack) : null,
          enemyDefeated: !!result.enemyDefeated,
          characterDefeated: !!result.characterDefeated,
        };
        return res.json(canonicalResponse({
          intent: command,
          events,
          text: lines.filter(Boolean).join('\n'),
          choices: result.characterDefeated ? [] : choicesForRun(adventure, run, character),
          state: { character: rowCharacter(uc), adventureRun: rowRun(ur), combat: combatStateFor({ adventure, run, character, enemyTemplate, round }) },
        }));
      }

      // ── Mercy: SPARE a yielded enemy ─────────────────────────────────────
      if (command.type === 'spare') {
        const visible = getVisibleRoomEntities(run, adventure).characters ?? [];
        const yieldedHere = visible.filter((c) => hasYielded(run, c.slug));
        const target = command.target
          ? findVisibleCharacter(adventure, run, command.target)
          : (yieldedHere.length === 1 ? yieldedHere[0] : null);
        if (!target) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'spare_failed', command, reason: 'no-target' }, text: command.target ? `There is no ${command.target} here.` : 'No one here awaits your mercy.', choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run, combat: combatStateFor({ adventure, run, character }) } }));
        }
        if (!hasYielded(run, target.slug)) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'spare_failed', command, reason: 'not-yielded' }, text: `${target.name} has not stopped fighting. Mercy must be offered to one who has yielded — words or wounds may bring them there.`, choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run, combat: combatStateFor({ adventure, run, character }) } }));
        }
        const room = getCurrentRoom(run, adventure);
        const events = [{ type: 'enemy_spared', command, enemy: target.slug }];
        const lines = [target.spare_text ?? `You lower your weapon. ${target.name} backs away, beaten but breathing, and troubles you no more.`];
        if (target.befriend_on_spare) {
          // Mercy completes the friend-or-foe arc: the foe becomes a companion.
          run = recordEncounter(run, target.slug, 'friend');
          run = recruitCompanion(run, target);
          events.push({ type: 'recruit', character: target.slug });
          character = recordDeed(character, `Made peace with ${target.name} in ${room.name}, who joined the party.`, { kind: 'befriend', room: room.room_number });
        } else {
          run = markEnemyDefeated(run, target.slug);
          run = markSpared(run, target.slug);
          if (Number.isFinite(target.spare_gold) && target.spare_gold > 0) {
            character = { ...character, gold: (character.gold ?? 0) + target.spare_gold };
            lines.push(`You receive ${target.spare_gold} gold.`);
            events.push({ type: 'spare_reward', gold: target.spare_gold });
          }
          character = recordDeed(character, `Showed mercy to the ${target.name} in ${room.name} (${adventure.adventure.name}).`, { kind: 'spare', room: room.room_number });
          // A spared captor releases their prisoner just as a slain one does.
          const released = freeDefeatedCaptives(run, adventure);
          run = released.run;
          for (const slug of released.freed) {
            const captive = adventure.characters.find((c) => c.slug === slug);
            lines.push(`${captive?.name ?? slug} is free, and gratefully joins you.`);
            events.push({ type: 'recruit', character: slug });
          }
        }
        const moment = await deps.ai.narrateMoment({ kind: 'the adventurer shows mercy', adventure, room, character, subject: target.name });
        if (moment) lines.push(moment);
        const [uc, ur] = await Promise.all([
          deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
          deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
        ]);
        run = rowRun(ur) ?? run;
        return res.json(roomResponse({
          adventure, run, character: rowCharacter(uc) ?? character,
          text: lines.filter(Boolean).join('\n'),
          event: events[0], events, intent: command,
        }));
      }

      // ── The Spirit of the Hall: a Socratic nudge from true game state ────
      if (command.type === 'hint') {
        const hint = await deps.ai.spiritHint(adventure, run, character);
        return res.json(canonicalResponse({
          intent: command,
          event: { type: 'hint', kind: hint.kind },
          text: `✶ The Spirit of the Hall whispers: ${hint.text}`,
          choices: choicesForRun(adventure, run, character),
          state: { character, adventureRun: run, combat: combatStateFor({ adventure, run, character }) },
        }));
      }

      // ── Freeform speech: the words are judged, the engine applies them ──
      // Shared by the explicit SAY/TELL commands and the implicit catch-all
      // below: any un-parsed sentence typed where someone can hear it is
      // simply spoken aloud — the AI layer's answer to "I did not understand".
      const speakWords = async (words, targetName) => {
        // Spoken-word mechanics (the mirror's "magic") fire before any parley.
        const roomEntitiesForSay = getVisibleRoomEntities(run, adventure);
        const trigger = sayTrigger({
          adventure, run, words,
          roomNumber: getCurrentRoom(run, adventure).room_number,
          visibleItemSlugs: (roomEntitiesForSay.placements ?? []).map((pl) => pl.item_slug),
          visibleNpcSlugs: (roomEntitiesForSay.characters ?? []).map((c) => c.slug),
        });
        if (trigger?.spent) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'say', command }, text: trigger.text, choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
        }
        if (trigger) {
          if (trigger.reveals) run = revealItem(run, trigger.reveals);
          if (trigger.once) run = markTriggerFired(run, trigger.word);
          // A solved riddle must LAND: banner, chime (client maps the event),
          // and a chronicle deed the Quill inks onto the map.
          character = recordDeed(character, trigger.deed_text ?? `Solved the riddle of the spoken word in ${getCurrentRoom(run, adventure).name} (${adventure.adventure.name}).`, { kind: trigger.deed_kind ?? 'riddle', room: getCurrentRoom(run, adventure).room_number });
          const [trigChar, savedTrig] = await Promise.all([
            deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
            deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
          ]);
          character = rowCharacter(trigChar) ?? character;
          run = rowRun(savedTrig) ?? run;
          return res.json(roomResponse({ adventure, run, character, prefix: `${trigger.banner ?? '✦ RIDDLE SOLVED ✦'}\n${trigger.text}`, event: { type: 'riddle_solved', word: trigger.word }, events: [{ type: 'riddle_solved', word: trigger.word }], intent: command }));
        }
        const visible = getVisibleRoomEntities(run, adventure).characters ?? [];
        // A disguised mimic: speaking to the chest (or into an "empty" room
        // that holds one) gets an answer no honest chest would give.
        const disguisedMimic = adventure.characters.find((c) => c.hidden_until_opened
          && !run.defeatedEnemies.includes(c.slug)
          && !(run.flags?.openedContainers ?? []).includes(c.hidden_until_opened)
          && (run.flags?.relocated?.[c.slug] ?? c.location_room) === getCurrentRoom(run, adventure).room_number);
        let listener = targetName ? findVisibleCharacter(adventure, run, targetName) : null;
        let disguised = false;
        // Whoever the words name (covers a punctuated/explicit target that didn't
        // resolve exactly, e.g. "tell cynthia, ..." → matches Cynthia in the room).
        if (!listener) {
          const hay = `${targetName ?? ''} ${words ?? ''}`.toLowerCase();
          listener = visible.find((c) => hay.includes(String(c.name ?? c.slug).toLowerCase())) ?? null;
        }
        // Bare speech with no one named: the enemy holds the floor, else the sole
        // bystander. An explicit-but-unmatched target speaks to a lone listener too.
        if (!listener && !targetName) {
          listener = visibleEnemy(adventure, run) ?? (visible.length === 1 ? visible[0] : null);
        }
        if (!listener && targetName && visible.length === 1) {
          listener = visible[0];
        }
        if (!listener && disguisedMimic) {
          const container = adventure.items.find((item) => item.slug === disguisedMimic.hidden_until_opened);
          if (!targetName || normalizeTarget(targetName) === normalizeTarget(container?.name ?? '')) {
            listener = disguisedMimic;
            disguised = true;
          }
        }
        if (!listener) {
          // Name given but not here → say so plainly; otherwise nudge to name someone.
          const here = visible.map((c) => c.name ?? c.slug);
          const text = targetName
            ? `There is no ${targetName} here to speak to.${here.length ? ` You could speak to ${here.join(' or ')}.` : ''}`
            : (visible.length > 1
              ? `Several here might listen — name who you mean. Try: TELL ${String(here[0] ?? 'NAME').toUpperCase()} your words.`
              : 'Your words echo off the stone. No one is here to hear them.');
          return res.json(canonicalResponse({ intent: command, event: { type: 'say_failed', command, reason: 'no-listener' }, text, choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
        }
        if (parleyCount(run, listener.slug) >= MAX_PARLEYS_PER_NPC) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'say_failed', command, reason: 'talked-out' }, text: `${disguised ? 'The chest' : listener.name} has heard enough of your words for one expedition.`, choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run, combat: combatStateFor({ adventure, run, character }) } }));
        }
        run = bumpParley(run, listener.slug);
        // Captivity and joinability: a captive (Cynthia) cannot leave while her
        // captor stands — the judge is told, so the reply matches the rules. A
        // free, non-hostile NPC who isn't already travelling with you can be
        // talked into joining ("action":"join"), which the engine validates.
        const captor = adventure.characters.find((c) => c.frees_on_defeat === listener.slug);
        const captorAlive = !!captor && !run.defeatedEnemies.includes(captor.slug);
        const alreadyCompanion = getCompanions(run).some((c) => c.slug === listener.slug);
        const listenerHostile = (listener.disposition ?? dispositionOf(listener, run)) === 'hostile';
        const joinable = !disguised && !listenerHostile && !alreadyCompanion && !captorAlive;
        const verdict = await deps.ai.judgeParley({
          npc: listener, character, run, words, disguised, joinable,
          heldBy: captorAlive ? (captor.name ?? captor.slug) : null,
          reputation: reputationForPrompt(computeReputation(character?.chronicle), character?.name),
        });
        // The engine — not the model — applies the shift: craft-scaled,
        // charisma-scaled, capped per NPC per run.
        let effective = craftScaledShift(verdict.shift, verdict.craft);
        const remaining = Math.max(0, MAX_PARLEY_SHIFT - parleyShiftUsed(run, listener.slug));
        effective = Math.max(-remaining, Math.min(remaining, effective));
        const shifted = shiftRegard(run, listener, effective, character.charisma);
        run = recordParleyShift(shifted.run, listener.slug, shifted.applied);
        const events = [{ type: 'parley', command, character: listener.slug, craft: verdict.craft, shift: shifted.applied, source: verdict.source }];
        const lines = [`${disguised ? 'The chest' : listener.name}: "${verdict.reply}"`];
        // A talked-to mimic gives itself away.
        if (disguised && verdict.action === 'reveal') {
          run = markContainerOpened(run, listener.hidden_until_opened);
          lines.push(`The chest's lid peels back along a seam no chest should have — it ERUPTS! ${listener.first_encounter_text ?? ''}`);
          events.push({ type: 'ambush', character: listener.slug });
        }
        // Persuaded to come along — the engine seats them in the party.
        if (verdict.action === 'join' && joinable) {
          run = recruitCompanion(run, listener);
          lines.push(`${listener.name} falls in beside you.`);
          events.push({ type: 'recruit', character: listener.slug });
          character = recordDeed(character, `Persuaded ${listener.name} to come along, in ${getCurrentRoom(run, adventure).name}.`, { kind: 'persuade', room: getCurrentRoom(run, adventure).room_number });
        } else if (captorAlive && !listenerHostile) {
          // Whatever was said, a captive stays a captive — say so plainly.
          lines.push(`${listener.name} glances fearfully toward the ${(captor.name ?? captor.slug).toLowerCase()} — no captive may leave while their captor stands.`);
        }
        // Words can finish what acts began: the yield check.
        const hostile = !disguised && (listener.disposition ?? dispositionOf(listener, run)) === 'hostile';
        if (hostile && !hasYielded(run, listener.slug) && checkYield(listener, run, run.enemyHp?.[listener.slug] ?? listener.hp, yieldMods(computeReputation(character?.chronicle)))) {
          run = markYielded(run, listener.slug);
          lines.push(listener.yield_text ?? `${listener.name} lowers their guard. The fight has gone out of them — you could SPARE them.`);
          events.push({ type: 'enemy_yielded', enemy: listener.slug });
        }
        // Talking to a still-hostile enemy costs your action.
        let reprisal = { enemyAttack: null, characterDefeated: false, text: null };
        if (hostile && !disguised) {
          reprisal = hostileReprisal({ run, character, npc: listener, rng: deps.rng });
          run = reprisal.run;
          character = reprisal.character;
          if (reprisal.text) lines.push(reprisal.text);
          if (reprisal.characterDefeated) {
            events.push({ type: 'character_defeated', characterId: character.id });
            lines.push('You have been defeated.');
            character = recordDeed(character, `Died mid-parley with the ${listener.name} in ${getCurrentRoom(run, adventure).name}.`, { kind: 'death', room: getCurrentRoom(run, adventure).room_number });
          }
        }
        // The writing-craft rubric, shown to the writer (the classroom heart).
        if (Number.isFinite(verdict.craft)) {
          lines.push(`✦ Craft ${verdict.craft}/5${verdict.craftNote ? ` — ${verdict.craftNote}` : ''}`);
        }
        const [uc, ur] = await Promise.all([
          deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
          deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
        ]);
        const round = reprisal.enemyAttack ? { player: null, enemy: combatSide(reprisal.enemyAttack), enemyDefeated: false, characterDefeated: reprisal.characterDefeated } : undefined;
        return res.json(canonicalResponse({
          intent: command,
          events,
          text: lines.filter(Boolean).join('\n'),
          choices: reprisal.characterDefeated ? [] : choicesForRun(adventure, run, character),
          state: { character: rowCharacter(uc), adventureRun: rowRun(ur), combat: combatStateFor({ adventure, run, character, round }), entities: getVisibleRoomEntities(rowRun(ur) ?? run, adventure) },
        }));
      };

      if (command.type === 'say') {
        return speakWords(command.words, command.target ?? null);
      }

      if (command.type === 'talk') {
        const target = findVisibleCharacter(adventure, run, command.target);
        if (!target) {
          return res.json(canonicalResponse({ intent: command, event: { type: 'talk_failed', command, reason: 'missing-character' }, text: `There is no ${command.target} here to talk to.`, choices: choicesForRun(adventure, run), state: { character, adventureRun: run } }));
        }
        const name = target.name ?? target.slug ?? 'They';
        // Hostile foes don't make small talk — but chosen words might reach them.
        if ((target.disposition ?? dispositionOf(target, run)) === 'hostile') {
          return res.json(canonicalResponse({ intent: command, event: { type: 'talk_failed', command, reason: 'hostile', character: target.slug ?? name }, text: `${name} answers only with a snarl. But the right words, well chosen, might yet reach them — SAY something.`, choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run, combat: combatStateFor({ adventure, run, character }) } }));
        }
        const dialogue = target.dialogue ?? target.text ?? `${name} gives you a quiet nod but has little to say.`;
        // A captive's invitation comes with the catch spelled out.
        const talkCaptor = adventure.characters.find((c) => c.frees_on_defeat === target.slug);
        const captiveNote = talkCaptor && !run.defeatedEnemies.includes(talkCaptor.slug)
          ? `\n(${name} cannot leave while the ${(talkCaptor.name ?? talkCaptor.slug).toLowerCase()} stands.)`
          : '';
        return res.json(canonicalResponse({ intent: command, event: { type: 'talk', command, character: target.slug ?? target.id ?? name }, text: dialogue + captiveNote, choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
      }

      if (command.type === 'leave') {
        const abandoned = await deps.abandonAdventureRun(deps.db, context.owner, run.id);
        // You walked out alive — your treasures still weigh into gold (only a
        // death forfeits the haul). Keeps loot from ever becoming dead weight.
        const conversion = convertTreasuresOnReturn(character);
        character = conversion.character;
        const escort = deliverEscorts(character, run, adventure);
        if (escort.gold > 0) character = { ...character, gold: (character.gold ?? 0) + escort.gold };
        character = recordDeeds(character, [
          conversion.goldGained > 0 ? { text: `Walked out of ${adventure.adventure.name} alive with plunder worth ${conversion.goldGained} gold.`, kind: 'complete' } : null,
          ...escort.names.map((name) => ({ text: `Brought ${name} safely home through the dark.`, kind: 'rescue' })),
        ]);
        const leftRow = await deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character));
        character = rowCharacter(leftRow) ?? character;
        const hall = hallResponse({
          player: { id: run.playerId },
          characters: leftRow ? [leftRow] : [],
          adventures,
          character,
          prefix: [
            conversion.goldGained > 0
              ? `You abandon the adventure and return to the Great Hall. Sam Slicker weighs your plunder: ${conversion.goldGained} gold.`
              : 'You abandon the adventure and return to the Great Hall.',
            escort.message,
          ].filter(Boolean).join(' '),
        });
        hall.intent = command;
        hall.events = [{ type: 'abandon', command }];
        hall.event = hall.events[0];
        hall.state.adventureRun = rowRun(abandoned);
        return res.json(hall);
      }

      // ── Data-driven ACT verbs: "calm gorilla", "parley with pirate" ──────
      // Unknown verbs are matched against the acts authored on whoever is in
      // the room, so each enemy brings its own vocabulary (the ACT menu).
      {
        const raw = normalizeTarget(req.body.input ?? '');
        const [verb, ...restWords] = raw.split(' ');
        const actTarget = restWords.join(' ').replace(/^(?:with|at|to)\s+/, '').replace(/^the\s+/, '');
        const visibleChars = getVisibleRoomEntities(run, adventure).characters ?? [];
        const subject = verb ? visibleChars.find((c) => findAct(c, verb) && (
          !actTarget || normalizeTarget(c.name) === normalizeTarget(actTarget) || normalizeTarget(c.slug) === normalizeTarget(actTarget)
        )) : null;
        if (subject) {
          if (isMerciless(run, subject.slug)) {
            return res.json(canonicalResponse({ intent: { type: 'act', verb, source: 'rules' }, event: { type: 'act_failed', reason: 'merciless', character: subject.slug }, text: `${subject.name} is past words and gestures now. You saw to that.`, choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run, combat: combatStateFor({ adventure, run, character }) } }));
          }
          const act = findAct(subject, verb);
          const acted = applyAct({ run, npc: subject, act, charisma: character.charisma });
          run = acted.run;
          const events = [{ type: 'act', verb, character: subject.slug, regard: acted.regard, shift: acted.applied }];
          const lines = [acted.text ?? `You ${verb} ${subject.name}.`];
          const hostile = (subject.disposition ?? dispositionOf(subject, run)) === 'hostile';
          if (hostile && !hasYielded(run, subject.slug) && checkYield(subject, run, run.enemyHp?.[subject.slug] ?? subject.hp, yieldMods(computeReputation(character?.chronicle)))) {
            run = markYielded(run, subject.slug);
            lines.push(subject.yield_text ?? `${subject.name} lowers their guard. The fight has gone out of them — you could SPARE them.`);
            events.push({ type: 'enemy_yielded', enemy: subject.slug });
          }
          // The gesture costs your action: an unmoved enemy answers in steel.
          let reprisal = { enemyAttack: null, characterDefeated: false, text: null };
          if (hostile) {
            reprisal = hostileReprisal({ run, character, npc: subject, rng: deps.rng });
            run = reprisal.run;
            character = reprisal.character;
            if (reprisal.text) lines.push(reprisal.text);
            if (reprisal.characterDefeated) {
              events.push({ type: 'character_defeated', characterId: character.id });
              lines.push('You have been defeated.');
              character = recordDeed(character, `Died reaching out to the ${subject.name} in ${getCurrentRoom(run, adventure).name}.`, { kind: 'death', room: getCurrentRoom(run, adventure).room_number });
            }
          }
          const [uc, ur] = await Promise.all([
            deps.updateCharacter(deps.db, context.owner, character.id, characterPatch(character)),
            deps.updateAdventureRun(deps.db, context.owner, run.id, dbRunPatch(run)),
          ]);
          const round = reprisal.enemyAttack ? { player: null, enemy: combatSide(reprisal.enemyAttack), enemyDefeated: false, characterDefeated: reprisal.characterDefeated } : undefined;
          return res.json(canonicalResponse({
            intent: { type: 'act', verb, target: subject.slug, source: 'rules' },
            events,
            text: lines.filter(Boolean).join('\n'),
            choices: reprisal.characterDefeated ? [] : choicesForRun(adventure, run, character),
            state: { character: rowCharacter(uc), adventureRun: rowRun(ur), combat: combatStateFor({ adventure, run, character, round }) },
          }));
        }
      }

      // ── Implicit speech: un-parsed sentences are spoken aloud ────────────
      // "yes, follow me and I'll get you home safely" shouldn't earn a parser
      // error when Cynthia is standing right there. Any unknown multi-word
      // input (or a single conversational word) with someone present to hear
      // it routes through the same judged-parley path as SAY.
      {
        const spoken = String(req.body.input ?? '').trim();
        const CONVERSATIONAL = new Set(['yes', 'no', 'hello', 'hi', 'hail', 'greetings', 'sorry', 'please', 'thanks', 'farewell', 'goodbye', 'why', 'who']);
        const looksLikeSpeech = /\s/.test(spoken) || CONVERSATIONAL.has(spoken.toLowerCase().replace(/[!?.,]+$/, ''));
        if (spoken && looksLikeSpeech) {
          const anyoneHere = (getVisibleRoomEntities(run, adventure).characters ?? []).length > 0
            || adventure.characters.some((c) => c.hidden_until_opened
              && !run.defeatedEnemies.includes(c.slug)
              && !(run.flags?.openedContainers ?? []).includes(c.hidden_until_opened)
              && (run.flags?.relocated?.[c.slug] ?? c.location_room) === getCurrentRoom(run, adventure).room_number);
          if (anyoneHere) {
            return speakWords(spoken, null);
          }
        }
      }

      return res.json(canonicalResponse({ intent: command, event: { type: 'unknown', command }, text: 'I did not understand that. Try a direction, look, inventory, take, attack, spare, say, hint, or leave — or simply speak to whoever is near you.', choices: choicesForRun(adventure, run, character), state: { character, adventureRun: run } }));
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
