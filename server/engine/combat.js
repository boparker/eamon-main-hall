import { rollDie, rollDice } from './dice.js';

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function getAgility(entity) {
  if (!entity || typeof entity !== 'object') {
    return 0;
  }

  return finiteNumber(entity.agility, finiteNumber(entity.ag, 0));
}

function getDefense(entity) {
  if (!entity || typeof entity !== 'object') {
    return 0;
  }

  return Math.max(0, finiteNumber(entity.defense, finiteNumber(entity.armor, 0)));
}

function getWeaponOdds(entity) {
  return Number.isFinite(entity?.weaponOdds) ? entity.weaponOdds : 0;
}

function getDamageDice(entity) {
  if (!entity || typeof entity !== 'object') {
    return null;
  }

  return entity.damage_dice
    ?? entity.damageDice
    ?? entity.equippedWeapon?.damage_dice
    ?? entity.equippedWeapon?.damageDice
    ?? entity.equippedWeapon?.damage
    ?? entity.weapon?.damage_dice
    ?? entity.weapon?.damageDice
    ?? entity.weapon?.damage
    ?? '1d2';
}

function safeRng(rng) {
  return typeof rng === 'function' ? rng : () => 0;
}

function getHpField(entity) {
  if (!entity || typeof entity !== 'object') {
    return null;
  }

  if (Object.hasOwn(entity, 'currentHp')) {
    return 'currentHp';
  }
  if (Object.hasOwn(entity, 'current_hp')) {
    return 'current_hp';
  }
  if (Object.hasOwn(entity, 'hp')) {
    return 'hp';
  }

  return null;
}

function getHp(entity) {
  const field = getHpField(entity);
  if (!field) {
    return 0;
  }

  return Math.max(0, finiteNumber(entity[field], 0));
}

function setHp(entity, hp) {
  if (!entity || typeof entity !== 'object') {
    return 0;
  }

  const field = getHpField(entity) ?? 'hp';
  const clampedHp = Math.max(0, finiteNumber(hp, 0));
  entity[field] = clampedHp;
  return clampedHp;
}

export function isDead(entity) {
  return getHp(entity) <= 0;
}

export function resolveAttack(attacker, defender, rng = Math.random, opts = {}) {
  const combatRng = safeRng(rng);
  const roll = rollDie(20, combatRng);
  const bonus = Number.isFinite(opts.bonus) ? opts.bonus : 0;
  // Magic weapons add their to-hit bonus (weaponOdds %, ~+1 per 5%).
  const attackTotal = roll + getAgility(attacker) + Math.round(getWeaponOdds(attacker) / 5) + bonus;
  const targetNumber = 10 + getAgility(defender);
  const defenderHpBefore = getHp(defender);

  if (attackTotal < targetNumber) {
    return {
      hit: false,
      roll,
      attackTotal,
      targetNumber,
      rawDamage: 0,
      damage: 0,
      defenderHp: defenderHpBefore,
    };
  }

  const multiplier = Number.isFinite(opts.damageMultiplier) && opts.damageMultiplier > 0 ? opts.damageMultiplier : 1;
  const rawDamage = Math.max(0, Math.round(rollDice(getDamageDice(attacker), combatRng) * multiplier));
  const damage = Math.max(0, rawDamage - getDefense(defender));
  const defenderHp = setHp(defender, defenderHpBefore - damage);

  return {
    hit: true,
    roll,
    attackTotal,
    targetNumber,
    rawDamage,
    damage,
    defenderHp,
  };
}

// A full combat round for the player AND any fighting companions against one
// enemy. Companions strike after the player; then the enemy strikes back at a
// randomly chosen party member (player or a living companion). Escort companions
// (e.g. Cynthia) are NOT passed in here — they flee and cannot be targeted.
//
// `fighters` are transient combat entities (see companions.buildFighter); their
// hp is mutated in place so the caller can persist it. Returns a payload shaped
// like resolveCombatRound plus companion detail.
export function resolvePartyRound({ character, fighters = [], enemy, rng = Math.random }) {
  const combatRng = safeRng(rng);
  const playerAttack = resolveAttack(character, enemy, combatRng);

  const companionAttacks = [];
  for (const fighter of fighters) {
    if (isDead(enemy)) break;
    if (isDead(fighter)) continue;
    companionAttacks.push({ slug: fighter.slug, name: fighter.name, attack: resolveAttack(fighter, enemy, combatRng) });
  }

  const enemyDefeated = isDead(enemy);
  let enemyAttack = null;
  let enemyTarget = null;
  const fallen = [];

  if (!enemyDefeated) {
    // The enemy lashes out at one random member of the party still standing.
    const party = [{ key: 'player', ent: character }, ...fighters.filter((f) => !isDead(f)).map((f) => ({ key: f.slug, ent: f }))];
    const pick = party[Math.floor(combatRng() * party.length)] ?? party[0];
    enemyTarget = pick.key;
    enemyAttack = resolveAttack(enemy, pick.ent, combatRng);
    if (pick.key !== 'player' && isDead(pick.ent)) fallen.push(pick.key);
  }

  return {
    playerAttack,
    companionAttacks,
    enemyAttack,
    enemyTarget,
    enemyDefeated: isDead(enemy),
    characterDefeated: isDead(character),
    fallen,
  };
}

// Resolve a telegraphed wind-up (e.g. the gorilla's charge) against the
// player's chosen answer. The stance decides the whole exchange:
//   brace     — you plant your feet: no attack, the blow lands at half force.
//   dodge     — you throw yourself aside: no attack, the blow misses outright.
//   interrupt — you strike into the wind-up at +4: a hit cancels the blow; a
//               miss leaves you wide open and the blow lands automatically.
//   (none)    — attacking through it: your normal attack, then the blow lands
//               at full multiplier (resolved by the caller passing stance null).
export function resolveTelegraphRound({ character, enemy, stance, multiplier = 2, rng = Math.random }) {
  const combatRng = safeRng(rng);

  if (stance === 'dodge') {
    return {
      stance,
      playerAttack: null,
      enemyAttack: { hit: false, roll: null, attackTotal: null, targetNumber: null, rawDamage: 0, damage: 0, defenderHp: getHp(character), telegraph: true, evaded: true },
      enemyDefeated: isDead(enemy),
      characterDefeated: isDead(character),
    };
  }

  if (stance === 'brace') {
    const blow = resolveAttack(enemy, character, combatRng, { damageMultiplier: multiplier / 2 });
    return { stance, playerAttack: null, enemyAttack: { ...blow, telegraph: true, braced: true }, enemyDefeated: isDead(enemy), characterDefeated: isDead(character) };
  }

  // interrupt
  const playerAttack = resolveAttack(character, enemy, combatRng, { bonus: 4 });
  if (playerAttack.hit || isDead(enemy)) {
    return { stance, playerAttack, enemyAttack: null, interrupted: true, enemyDefeated: isDead(enemy), characterDefeated: isDead(character) };
  }
  // A missed interrupt leaves you open: the blow lands automatically.
  const rawDamage = Math.max(0, Math.round(rollDice(getDamageDice(enemy), combatRng) * multiplier));
  const damage = Math.max(0, rawDamage - getDefense(character));
  const defenderHp = setHp(character, getHp(character) - damage);
  return {
    stance,
    playerAttack,
    enemyAttack: { hit: true, roll: null, attackTotal: null, targetNumber: null, rawDamage, damage, defenderHp, telegraph: true, exposed: true },
    enemyDefeated: isDead(enemy),
    characterDefeated: isDead(character),
  };
}

export function resolveCombatRound(character, enemy, rng = Math.random) {
  const playerAttack = resolveAttack(character, enemy, rng);
  const enemyDefeated = isDead(enemy);

  if (enemyDefeated) {
    return {
      playerAttack,
      enemyAttack: null,
      enemyDefeated: true,
      characterDefeated: isDead(character),
    };
  }

  const enemyAttack = resolveAttack(enemy, character, rng);

  return {
    playerAttack,
    enemyAttack,
    enemyDefeated: isDead(enemy),
    characterDefeated: isDead(character),
  };
}
