// Companion / NPC-friendliness logic for the faithful Eamon encounter model.
// Pure functions — no DB, no rng baked in (callers pass rng for determinism).
//
// In classic Eamon every non-fixed NPC rolls friend-or-foe when you first meet
// them, modified by your Charisma. The two "encounter_behavior: random" NPCs in
// the Beginner's Cave (the hermit and Heinrich) use this; a friendly roll makes
// them a companion who fights at your side, a hostile roll makes them attack.

const DEFAULT_BASE = 50;

// Base friendliness % for an NPC before Charisma. An explicit base_friendliness
// wins; otherwise derive from the disposition word.
export function baseFriendliness(npc) {
  if (Number.isFinite(npc?.base_friendliness)) return npc.base_friendliness;
  switch (npc?.friendliness) {
    case 'friendly': return 80;
    case 'hostile': return 10;
    default: return DEFAULT_BASE;
  }
}

// Charisma nudges the odds: each point above/below 10 shifts friendliness by 5%,
// clamped so there is always a little uncertainty either way.
export function friendlyChance(charisma, base = DEFAULT_BASE) {
  const cha = Number.isFinite(charisma) ? charisma : 10;
  return Math.max(5, Math.min(95, base + (cha - 10) * 5));
}

// Roll the encounter. Returns 'friend' or 'foe'.
export function resolveEncounter(npc, charisma, rng = Math.random) {
  const chance = friendlyChance(charisma, baseFriendliness(npc));
  const roll = (typeof rng === 'function' ? rng() : 0) * 100;
  return roll < chance ? 'friend' : 'foe';
}

// An escort companion (e.g. Cynthia) never fights — she flees to safety in any
// melee and cannot be harmed. Flagged in the manifest, or inferred from a NPC
// who has no real attack.
export function isEscort(npc) {
  return npc?.escort === true || npc?.damage_dice === '0d0' || npc?.damage_dice == null;
}

// Build a transient combat entity for a fighting companion from its manifest
// record + its current HP. resolveAttack reads damage_dice / agility off this.
export function buildFighter(npc, hp) {
  return {
    slug: npc.slug,
    name: npc.name ?? npc.slug,
    hp,
    agility: npc.agility ?? 0,
    damage_dice: npc.damage_dice ?? '1d4',
    defense: 0,
  };
}
