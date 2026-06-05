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

export function resolveAttack(attacker, defender, rng = Math.random) {
  const combatRng = safeRng(rng);
  const roll = rollDie(20, combatRng);
  // Magic weapons add their to-hit bonus (weaponOdds %, ~+1 per 5%).
  const attackTotal = roll + getAgility(attacker) + Math.round(getWeaponOdds(attacker) / 5);
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

  const rawDamage = Math.max(0, rollDice(getDamageDice(attacker), combatRng));
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
