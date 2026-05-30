// spells.js — Combat spell casting, faithful to the original Eamon: each spell
// is a percentage ability (bought at Hokas Tokas); casting rolls d100 against
// it. On success the effect fires; on failure it fizzles. Pure-ish: mutates the
// passed character/enemy HP and returns the outcome.

import { rollDie, rollDice } from './dice.js';

export const COMBAT_SPELLS = ['blast', 'heal', 'speed', 'power'];

export function isSpell(name) {
  return COMBAT_SPELLS.includes(String(name ?? '').toLowerCase());
}

export function spellAbility(character, name) {
  const value = Number(character?.spells?.[String(name).toLowerCase()]);
  return Number.isFinite(value) ? value : 0;
}

export function castSpell(character, spellName, { enemy = null, rng = Math.random } = {}) {
  const name = String(spellName ?? '').toLowerCase();
  if (!COMBAT_SPELLS.includes(name)) return { ok: false, reason: 'unknown-spell' };

  const ability = spellAbility(character, name);
  if (ability <= 0) return { ok: false, reason: 'not-learned', spell: name };
  if (name === 'blast' && !enemy) return { ok: false, reason: 'no-target', spell: name };

  const roll = rollDie(100, rng);
  const success = roll <= ability;
  const result = { ok: true, spell: name, roll, ability, success, damage: 0, heal: 0, haste: false };

  if (!success) {
    result.message = `Your ${name} spell flickers and dies, unformed.`;
    return result;
  }

  if (name === 'blast') {
    const dmg = rollDice('2d6', rng); // magical damage, ignores armour
    enemy.hp = Math.max(0, (enemy.hp ?? 0) - dmg);
    result.damage = dmg;
    result.message = `Searing light erupts from your hand — the blast strikes for ${dmg}!`;
  } else if (name === 'heal') {
    result.heal = applyHeal(character, rollDice('2d6', rng));
    result.message = `Warmth floods your limbs; you recover ${result.heal} hardiness.`;
  } else if (name === 'speed') {
    result.haste = true;
    result.message = 'The world slows around you — your agility surges!';
  } else if (name === 'power') {
    const r = rollDie(4, rng);
    if (r === 1 && enemy) {
      const dmg = rollDice('3d6', rng);
      enemy.hp = Math.max(0, (enemy.hp ?? 0) - dmg);
      result.damage = dmg;
      result.message = `Raw chaos detonates — the enemy is torn for ${dmg}!`;
    } else if (r === 2) {
      result.heal = applyHeal(character, rollDice('3d6', rng));
      result.message = `Power knits your wounds — ${result.heal} hardiness restored.`;
    } else if (r === 3) {
      result.haste = true;
      result.message = 'Power quickens your blood — you feel impossibly fast!';
    } else {
      result.message = 'The power spell fizzes into a harmless cascade of sparks.';
    }
  }
  return result;
}

function applyHeal(character, amount) {
  const max = character.maxHd ?? character.hd ?? 0;
  const before = character.hd ?? 0;
  character.hd = Math.min(max, before + amount);
  if (Object.hasOwn(character, 'hp')) character.hp = character.hd;
  return character.hd - before;
}
