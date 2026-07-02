// stat-info.js — single source of truth for making the game's numbers legible.
// Pure (no DOM), so it's unit-tested and reused by the HUD, the shop, and the
// character roll screen. Every claim here is grounded in the actual engine:
//   - Hardiness IS your hit points (hd = hardiness).
//   - Agility drives BOTH to-hit (d20 + agility) AND dodge (enemy target = 10 + agility).
//   - Charisma is social only: friend-or-foe recruiting + reward size. Not combat,
//     not shop prices.
//   - Armor = flat damage reduction, no encumbrance/burden in our engine.
//   - Weapons = damage dice; magic weapons add a to-hit bonus (weaponOdds).

export const STAT_META = {
  hardiness: {
    label: 'Hardiness',
    effect: 'Your hit points — how much damage you can take before falling. Higher Hardiness means you survive longer.',
  },
  agility: {
    label: 'Agility',
    effect: 'The most valuable stat: it decides how often you hit AND how often enemies miss you. High Agility wins fights.',
  },
  charisma: {
    label: 'Charisma',
    effect: 'How readily other characters befriend and join you, and the size of rescue rewards. It has no effect on combat or prices.',
  },
};

// Stats are rolled 3d7 (range 3–21, average ~12). Bands make a raw number legible.
const BANDS = [
  { max: 8, key: 'poor', label: 'Poor' },
  { max: 11, key: 'below', label: 'Below Average' },
  { max: 14, key: 'average', label: 'Average' },
  { max: 17, key: 'good', label: 'Good' },
  { max: 19, key: 'excellent', label: 'Excellent' },
  { max: Infinity, key: 'exceptional', label: 'Exceptional' },
];

export function statBand(value) {
  const v = Number(value) || 0;
  return BANDS.find((b) => v <= b.max) ?? BANDS[BANDS.length - 1];
}

// Band tier index 0..5 (Poor..Exceptional), for ranking a character's strengths.
function tier(value) {
  return BANDS.indexOf(statBand(value));
}

// { band, effect } for a stat + value — the material for a tooltip.
export function describeStat(statKey, value) {
  const meta = STAT_META[statKey];
  if (!meta) return null;
  return { label: meta.label, band: statBand(value).label, value: Number(value) || 0, effect: meta.effect };
}

const HIGH = {
  hardiness: { adj: 'tough', impl: 'soaks up punishment' },
  agility: { adj: 'quick', impl: 'strikes true and is hard to hit' },
  charisma: { adj: 'charming', impl: 'wins allies with ease' },
};
const LOW = {
  hardiness: { adj: 'frail', impl: 'wounds add up quickly' },
  agility: { adj: 'not especially quick', impl: 'combat is less reliable' },
  charisma: { adj: 'a touch gruff', impl: 'allies are harder to win over' },
};

function joinNatural(list) {
  if (list.length <= 1) return list.join('');
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

// A one/two-sentence "character identity" read for a rolled adventurer, so a
// random roll feels like a person, not a spreadsheet.
export function rollRead(stats = {}) {
  const keys = ['hardiness', 'agility', 'charisma'];
  const ranked = keys.map((k) => ({ k, t: tier(stats[k]) })).sort((a, b) => b.t - a.t);
  const highs = ranked.filter((s) => s.t >= 4);
  const strongKeys = (highs.length ? highs : [ranked[0]]).map((s) => s.k);
  const lows = ranked.filter((s) => s.t <= 1).map((s) => s.k);

  const strongAdj = joinNatural(strongKeys.map((k) => HIGH[k].adj));
  const strongImpl = joinNatural(strongKeys.map((k) => HIGH[k].impl));
  let read = `This adventurer is ${strongAdj} — ${strongImpl}.`;
  if (lows.length) {
    read += ` But ${joinNatural(lows.map((k) => LOW[k].adj))}: ${joinNatural(lows.map((k) => LOW[k].impl))}.`;
  }
  return read;
}

// ── Gear comparison (shop "impact" cards) ────────────────────────────────────

// Average roll of dice notation like "1d8" or "2d6+1".
export function avgDamage(dice) {
  const m = String(dice ?? '').trim().match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!m) return 0;
  const [, count, sides, mod] = m;
  return (Number(count) * (Number(sides) + 1)) / 2 + (mod ? Number(mod) : 0);
}

function slotOf(item) {
  return item?.equipmentSlot
    ?? ({ weapon: 'weapon', armor: 'armor', shield: 'shield' }[item?.category ?? item?.type] ?? null);
}

const VERDICTS = {
  new: { key: 'new', label: 'New gear' },
  upgrade: { key: 'upgrade', label: 'Upgrade' },
  sidegrade: { key: 'sidegrade', label: 'Sidegrade' },
  downgrade: { key: 'downgrade', label: 'Downgrade' },
};

// Compare a shop item to what the character currently has in that slot.
// Returns { slot, verdict:{key,label}, detail } or null for non-gear.
export function compareGear(item, equipment = {}) {
  const slot = slotOf(item);
  if (!slot) return null;
  const equipped = equipment[slot];
  const nameOf = (e) => e?.name ?? 'nothing';

  if (slot === 'weapon') {
    const cand = avgDamage(item.stats?.damage) + (Number(item.stats?.weaponOdds) || 0) / 10;
    if (!equipped) return { slot, verdict: VERDICTS.new, detail: `Your first real weapon (avg ${avgDamage(item.stats?.damage)} damage).` };
    const cur = avgDamage(equipped.stats?.damage) + (Number(equipped.stats?.weaponOdds) || 0) / 10;
    const verdict = cand > cur ? VERDICTS.upgrade : cand < cur ? VERDICTS.downgrade : VERDICTS.sidegrade;
    return { slot, verdict, detail: `${verdict.label} over your ${nameOf(equipped)} (${item.stats?.damage} vs ${equipped.stats?.damage}).` };
  }

  // armor / shield → armorClass (flat damage reduction, pure upside)
  const cand = Number(item.stats?.armorClass) || 0;
  if (!equipped) return { slot, verdict: VERDICTS.new, detail: `Reduces every hit by ${cand}. You have no ${slot} yet.` };
  const cur = Number(equipped.stats?.armorClass) || 0;
  const verdict = cand > cur ? VERDICTS.upgrade : cand < cur ? VERDICTS.downgrade : VERDICTS.sidegrade;
  return { slot, verdict, detail: `${verdict.label} over your ${nameOf(equipped)} (AC ${cand} vs ${cur}).` };
}
