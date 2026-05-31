// vendors.js — Faithful Main Hall vendor mechanics, ported from the original
// Eamon (via the Eamon Remastered reference). Pure functions: given a character
// and an action, return the resulting character + outcome. The route layer
// persists. Nothing here mutates its input.

import { rollDie } from './dice.js';

// ── Marcos Cavielli's Weapons & Armour Shoppe ────────────────────────────────
// One combined shop. Buy at value, sell at half value. Faithful catalog and
// prices from the reference's standard (non-magic) stock.
const STANDARD_CATALOG = [
  { slug: 'axe', name: 'Axe', price: 25, category: 'weapon', equipmentSlot: 'weapon', stats: { damage: '1d6', type: 'Axe' } },
  { slug: 'bow', name: 'Bow', price: 40, category: 'weapon', equipmentSlot: 'weapon', stats: { damage: '1d6', type: 'Bow', hands: 2 } },
  { slug: 'club', name: 'Club', price: 15, category: 'weapon', equipmentSlot: 'weapon', stats: { damage: '1d4', type: 'Club' } },
  { slug: 'mace', name: 'Mace', price: 40, category: 'weapon', equipmentSlot: 'weapon', stats: { damage: '1d5', type: 'Mace' } },
  { slug: 'spear', name: 'Spear', price: 25, category: 'weapon', equipmentSlot: 'weapon', stats: { damage: '1d5', type: 'Spear' } },
  { slug: 'halberd', name: 'Halberd', price: 120, category: 'weapon', equipmentSlot: 'weapon', stats: { damage: '1d10', type: 'Halberd', hands: 2 } },
  { slug: 'short-sword', name: 'Short Sword', price: 30, category: 'weapon', equipmentSlot: 'weapon', stats: { damage: '1d6', type: 'Sword' } },
  { slug: 'sword', name: 'Sword', price: 75, category: 'weapon', equipmentSlot: 'weapon', stats: { damage: '1d8', type: 'Sword' } },
  { slug: 'two-handed-sword', name: 'Two-Handed Sword', price: 150, category: 'weapon', equipmentSlot: 'weapon', stats: { damage: '1d10', type: 'Sword', hands: 2 } },
  { slug: 'leather-armor', name: 'Leather Armor', price: 100, category: 'armor', equipmentSlot: 'armor', stats: { defense: '+1', armorClass: 1, type: 'Armor' } },
  { slug: 'chain-mail', name: 'Chain Mail', price: 250, category: 'armor', equipmentSlot: 'armor', stats: { defense: '+3', armorClass: 3, type: 'Armor' } },
  { slug: 'scale-armor', name: 'Scale Armor', price: 350, category: 'armor', equipmentSlot: 'armor', stats: { defense: '+4', armorClass: 4, type: 'Armor' } },
  { slug: 'plate-armor', name: 'Plate Armor', price: 500, category: 'armor', equipmentSlot: 'armor', stats: { defense: '+5', armorClass: 5, type: 'Armor' } },
  { slug: 'shield', name: 'Shield', price: 50, category: 'armor', equipmentSlot: 'shield', stats: { defense: '+1', armorClass: 1, type: 'Shield' } },
];

// ── Marcos's rotating stock of randomly-generated named magic weapons ─────────
// Faithful to the reference: a random weapon type + unique name, a to-hit bonus
// (weaponOdds, consumed by combat), scaling damage dice, and a premium price.
const MAGIC_WEAPON_NAMES = {
  1: ['Slaymor', 'Falcoor', 'Ironheart', 'Blood Claw', 'Orenmir', 'Shadowfury', 'Mooncleaver'],
  2: ['Stinger', 'Meteor', 'Featherdraw', 'Heartpiercer', 'Quintain', 'Ashwood', 'Arrowsong'],
  3: ['Scrunch', 'Warmace', 'Earthshatter', 'Spinefall', 'Justifier', 'Haunted Hammer', 'Guiding Star'],
  4: ['Centuri', 'Shiverspine', 'Twisted Spike', 'Mithril Lance', 'Blinkstrike', 'Nightbane', 'Ebon Halberd'],
  5: ['Slasher', 'Freedom', 'Ghost Reaver', 'Doombringer', 'Malevolent Crusader', 'Swiftblade', 'Oathkeeper'],
};
const WEAPON_TYPE_LABEL = { 1: 'Axe', 2: 'Bow', 3: 'Mace', 4: 'Spear', 5: 'Sword' };

function slugifyName(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function generateMagicWeapons(count = 3, rng = Math.random) {
  const pool = {};
  for (const [type, names] of Object.entries(MAGIC_WEAPON_NAMES)) pool[type] = [...names];
  const weapons = [];
  for (let i = 0; i < count; i += 1) {
    const type = rollDie(5, rng);
    const names = pool[type];
    const name = names.length ? names.splice(rollDie(names.length, rng) - 1, 1)[0] : `Relic ${i + 1}`;
    let dice = 2;
    if (i <= count * 0.33) dice = 1;
    if (i >= count * 0.66) dice = 3;
    const sides = 8 - dice * 2 + rollDie(4, rng) * 2;
    const odds = rollDie(7, rng) * 5 - 10; // -5 … +25 to-hit
    const maxDamage = dice * sides;
    const price = Math.max(1, Math.floor(Math.pow(maxDamage, 1.5) + odds) * 5);
    weapons.push({
      slug: slugifyName(name),
      name,
      price,
      category: 'weapon',
      equipmentSlot: 'weapon',
      magic: true,
      stats: { damage: `${dice}d${sides}`, type: WEAPON_TYPE_LABEL[type], weaponOdds: odds },
    });
  }
  return weapons.sort((a, b) => a.price - b.price);
}

export const SHOP_CATALOG = [...STANDARD_CATALOG, ...generateMagicWeapons()];

export function findCatalogItem(input) {
  const normalized = String(input ?? '').trim().toLowerCase().replace(/^buy\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return SHOP_CATALOG.find((item) => item.slug === normalized || item.name.toLowerCase() === String(input ?? '').trim().toLowerCase().replace(/^buy\s+/, '')) ?? null;
}

function inventoryOf(character) {
  return Array.isArray(character?.inventory) ? character.inventory : [];
}

export function buyFromShop(character, item) {
  if (!item || !Number.isFinite(item.price)) return { ok: false, character, reason: 'missing-item' };
  if (!Number.isFinite(character?.gold)) return { ok: false, character, reason: 'invalid-gold' };
  if (character.gold < item.price) return { ok: false, character, item, reason: 'insufficient-gold' };

  const owned = { slug: item.slug, name: item.name, price: item.price, category: item.category, equipmentSlot: item.equipmentSlot, stats: item.stats };
  const inventory = [...inventoryOf(character), owned];
  const equipment = item.equipmentSlot ? { ...(character.equipment ?? {}), [item.equipmentSlot]: owned } : (character.equipment ?? {});
  return {
    ok: true,
    item: owned,
    character: { ...character, inventory, equipment, gold: character.gold - item.price },
  };
}

// Marcos buys items back at half their value.
export function sellToShop(character, itemSlug) {
  if (typeof itemSlug !== 'string' || !itemSlug) return { ok: false, character, reason: 'invalid-item' };
  const inventory = inventoryOf(character);
  const index = inventory.findIndex((owned) => owned?.slug === itemSlug);
  if (index === -1) return { ok: false, character, reason: 'missing-item' };
  const item = inventory[index];
  if (item.type === 'treasure') return { ok: false, character, item, reason: 'treasure-converts-on-return' };

  const goldGained = Math.max(0, Math.floor((item.price ?? item.value ?? 0) / 2));
  const nextInventory = [...inventory.slice(0, index), ...inventory.slice(index + 1)];
  const equipment = { ...(character.equipment ?? {}) };
  for (const slot of Object.keys(equipment)) {
    if (equipment[slot]?.slug === itemSlug) delete equipment[slot];
  }
  return {
    ok: true,
    item,
    goldGained,
    character: { ...character, inventory: nextInventory, equipment, gold: (character.gold ?? 0) + goldGained },
  };
}

// ── Hokas Tokas' School of Magick ────────────────────────────────────────────
// Buy/upgrade the four spell abilities. Each is a percentage; buying raises it
// by a random fraction of the remaining gap to 100%, at a flat per-spell price.
// Capped at >90%.
export const SPELLS = [
  { name: 'power', price: 100, description: 'An unpredictable effect, different in every adventure.' },
  { name: 'heal', price: 500, description: 'Heals you or a friend.' },
  { name: 'blast', price: 1000, description: 'Damages one enemy.' },
  { name: 'speed', price: 4000, description: 'Doubles your agility for a time, making you a better fighter.' },
];

export const SPELL_MAX = 90; // ability above this is "maxed out"

export function spellAbility(character, spellName) {
  const spells = character?.spells ?? {};
  const value = spells[spellName];
  return Number.isFinite(value) ? value : 0;
}

export function learnSpell(character, spellName, rng = Math.random) {
  const spell = SPELLS.find((entry) => entry.name === spellName);
  if (!spell) return { ok: false, character, reason: 'unknown-spell' };
  if (!Number.isFinite(character?.gold)) return { ok: false, character, reason: 'invalid-gold' };

  const current = spellAbility(character, spellName);
  if (current > SPELL_MAX) return { ok: false, character, spell, reason: 'maxed-out' };
  if (character.gold < spell.price) return { ok: false, character, spell, reason: 'insufficient-gold' };

  const gap = 100 - current;
  const increase = Math.floor(gap / 4 + rollDie(Math.max(1, Math.floor(gap / 2)), rng));
  const ability = Math.min(100, current + increase);
  return {
    ok: true,
    spell,
    learned: current === 0,
    increase: ability - current,
    ability,
    character: {
      ...character,
      spells: { ...(character.spells ?? {}), [spellName]: ability },
      gold: character.gold - spell.price,
    },
  };
}

// ── The Witch's Shop ─────────────────────────────────────────────────────────
// Raise an attribute by +1. Price escalates with the cube of the current value.
export const ATTRIBUTES = ['hardiness', 'agility', 'charisma'];

export function attributePrice(current) {
  return Math.round(current ** 3 / 100) * 100;
}

export function raiseAttribute(character, attribute) {
  if (!ATTRIBUTES.includes(attribute)) return { ok: false, character, reason: 'unknown-attribute' };
  if (!Number.isFinite(character?.gold)) return { ok: false, character, reason: 'invalid-gold' };

  const current = character[attribute];
  if (!Number.isFinite(current)) return { ok: false, character, reason: 'invalid-attribute' };
  const price = attributePrice(current);
  if (character.gold < price) return { ok: false, character, attribute, price, reason: 'insufficient-gold' };

  const next = { ...character, [attribute]: current + 1, gold: character.gold - price };
  // Hardiness is hit points: raising it raises max and current HD too.
  if (attribute === 'hardiness') {
    next.maxHd = (character.maxHd ?? current) + 1;
    next.hd = (character.hd ?? current) + 1;
  }
  return { ok: true, attribute, price, value: current + 1, character: next };
}

// ── Bank of Eamon Towne ──────────────────────────────────────────────────────
function parseAmount(amount) {
  const value = typeof amount === 'number' ? amount : parseInt(String(amount ?? '').trim(), 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function bankDeposit(character, amount) {
  const value = parseAmount(amount);
  if (value === null) return { ok: false, character, reason: 'invalid-amount' };
  if (value > (character?.gold ?? 0)) return { ok: false, character, reason: 'insufficient-gold' };
  return {
    ok: true,
    amount: value,
    character: { ...character, gold: character.gold - value, bankGold: (character.bankGold ?? 0) + value },
  };
}

export function bankWithdraw(character, amount) {
  const value = parseAmount(amount);
  if (value === null) return { ok: false, character, reason: 'invalid-amount' };
  if (value > (character?.bankGold ?? 0)) return { ok: false, character, reason: 'insufficient-funds' };
  return {
    ok: true,
    amount: value,
    character: { ...character, gold: (character.gold ?? 0) + value, bankGold: character.bankGold - value },
  };
}

// The Healer restores HP for gold. Heals as much as the adventurer can afford
// (partial when short on coin), so a wounded-and-broke character is never gated
// out of a heal entirely. Returns the cost and HP restored.
export const HEAL_COST_PER_HP = 3;

export function healCost(character, perHp = HEAL_COST_PER_HP) {
  const missing = Math.max(0, (character?.maxHd ?? character?.hd ?? 0) - (character?.hd ?? 0));
  return missing * perHp;
}

export function healAtTemple(character, perHp = HEAL_COST_PER_HP) {
  const max = character?.maxHd ?? character?.hd ?? 0;
  const current = character?.hd ?? 0;
  const missing = Math.max(0, max - current);
  if (missing === 0) return { ok: false, character, reason: 'already-full' };
  const gold = character?.gold ?? 0;
  const healable = Math.min(missing, Math.floor(gold / perHp));
  if (healable <= 0) return { ok: false, character, reason: 'insufficient-gold' };
  const cost = healable * perHp;
  return {
    ok: true,
    healed: healable,
    cost,
    character: { ...character, hd: current + healable, gold: gold - cost },
  };
}
