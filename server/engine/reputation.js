// reputation.js — The world remembers. A character's reputation is a PURE
// function of their chronicle deed log: no AI, no new state, no drift. The
// chronicle already persists on the character, so reputation carries across
// runs (and across replays of the same adventure) for free.
//
// Design (agreed 2026-07): readable-but-subtle, cross-run, and Dread is a
// VIABLE path, not a punishment:
//   - Renown gates everything: a nobody is a nobody. Effects scale with how
//     widely you're known (tier 0/1/2), so early play is clean and fair.
//   - Merciful: strangers roll friendly more often, first sight starts warmer,
//     rescue rewards run richer. The party game — slower, richer, more voices.
//   - Dreaded: enemies have HEARD what you do to those who don't yield — they
//     break sooner and fear buys passage; but nobody joins you. Solo, brutal,
//     efficient.
//   - Epithets are the readable artifact: a title the world gives you, spoken
//     back in parley and written in the Guild's ledger.
//   - Redemption has inertia: leanings need a real margin (1.5×) to flip, so
//     the Butcher can become the Merciful — slowly, deed by deed.

// ── Deed classification ──────────────────────────────────────────────────────
// New deeds carry a structured `kind`; older deeds (free text) are classified
// by the fixed patterns our own engine wrote them with.
const TEXT_PATTERNS = [
  ['spare', /showed mercy/i],
  ['befriend', /made peace|joined the party/i],
  ['persuade', /^persuaded/i],
  ['rescue', /safely home/i],
  ['truce_broken', /broke a truce/i],
  ['slay', /^slew/i],
  ['companion_lost', /fell in battle/i],
  ['death', /^died|paid the old price/i],
  ['complete', /^conquered|^returned from|^walked out/i],
];

export function classifyDeed(deed) {
  if (deed?.kind) return deed.kind;
  const text = String(deed?.text ?? '');
  for (const [kind, re] of TEXT_PATTERNS) {
    if (re.test(text)) return kind;
  }
  return 'other';
}

// ── Scoring ──────────────────────────────────────────────────────────────────
const MERCY_WEIGHTS = { spare: 3, befriend: 3, persuade: 2, rescue: 3 };
const DREAD_WEIGHTS = { truce_broken: 5, slay: 1 };
const RENOWN_EXTRA = { complete: 5 }; // finishing expeditions spreads your name

const TIER_THRESHOLDS = [10, 30]; // renown → tier 1, tier 2

const EPITHETS = {
  merciful: [null, 'the Kind', 'the Merciful'],
  dreaded: [null, 'the Ruthless', 'the Butcher'],
  balanced: [null, 'the Bold', 'the Renowned'],
  unknown: [null, null, null],
};

export function computeReputation(chronicle = {}) {
  const deeds = Array.isArray(chronicle.deeds) ? chronicle.deeds : [];
  const counts = {};
  for (const deed of deeds) {
    const kind = classifyDeed(deed);
    counts[kind] = (counts[kind] ?? 0) + 1;
  }

  const mercy = Object.entries(MERCY_WEIGHTS).reduce((sum, [k, w]) => sum + (counts[k] ?? 0) * w, 0);
  const dread = Object.entries(DREAD_WEIGHTS).reduce((sum, [k, w]) => sum + (counts[k] ?? 0) * w, 0);
  const renown = mercy + dread
    + Object.entries(RENOWN_EXTRA).reduce((sum, [k, w]) => sum + (counts[k] ?? 0) * w, 0);

  const tier = renown >= TIER_THRESHOLDS[1] ? 2 : renown >= TIER_THRESHOLDS[0] ? 1 : 0;

  // Inertia: a leaning needs a real margin to hold (or flip), so identity is
  // earned deed by deed — the Butcher redeems slowly.
  let leaning = 'balanced';
  if (tier === 0) leaning = 'unknown';
  else if (mercy >= dread * 1.5) leaning = 'merciful';
  else if (dread >= mercy * 1.5) leaning = 'dreaded';

  const epithet = EPITHETS[leaning][tier] ?? null;

  return { mercy, dread, renown, tier, leaning, epithet, counts };
}

// One readable line for the Guild's ledger / Hall of Records.
export function reputationRead(rep, name = 'This adventurer') {
  if (!rep || rep.tier === 0) {
    return `${name} is not yet widely known. Deeds, kept or broken, will write the name.`;
  }
  const c = rep.counts ?? {};
  const spared = (c.spare ?? 0) + (c.befriend ?? 0);
  const parts = [];
  if (rep.leaning === 'merciful') {
    parts.push(`Known for mercy — ${spared} foe${spared === 1 ? '' : 's'} spared or won over`);
    if (c.rescue) parts.push(`${c.rescue} soul${c.rescue === 1 ? '' : 's'} brought safely home`);
    return `${parts.join(', ')}. The Guild speaks the name warmly${rep.epithet ? `: ${name} ${rep.epithet}` : ''}.`;
  }
  if (rep.leaning === 'dreaded') {
    parts.push(`Known for ruthlessness — ${c.slay ?? 0} slain`);
    if (c.truce_broken) parts.push(`${c.truce_broken} truce${c.truce_broken === 1 ? '' : 's'} broken`);
    return `${parts.join(', ')}. The name travels ahead like a cold wind${rep.epithet ? `: ${name} ${rep.epithet}` : ''}.`;
  }
  return `A name in many mouths, for deeds both kind and grim${rep.epithet ? `: ${name} ${rep.epithet}` : ''}.`;
}

// ── Deterministic world effects (all zero at tier 0) ─────────────────────────

// Percentage-point bonus to the friend-or-foe roll: the merciful attract
// company; nobody volunteers to walk beside the Butcher.
export function encounterBonus(rep) {
  if (!rep?.tier) return 0;
  if (rep.leaning === 'merciful') return 7 * rep.tier;
  if (rep.leaning === 'dreaded') return -7 * rep.tier;
  return 0;
}

// Regard shift applied once, when a character first lays eyes on you — your
// reputation walks into the room before you do.
export function firstSightRegard(rep) {
  if (!rep?.tier) return 0;
  if (rep.leaning === 'merciful') return 4 * rep.tier;
  if (rep.leaning === 'dreaded') return -4 * rep.tier;
  return 0;
}

// Yield-threshold easing for the dreaded: enemies who have heard the stories
// break sooner (yield at higher HP, need less regard). Fear is a weapon.
export function yieldMods(rep) {
  if (!rep?.tier || rep.leaning !== 'dreaded') return { regardEase: 0, hpEase: 0 };
  return { regardEase: 5 * rep.tier, hpEase: rep.tier };
}

// Rescue-reward multiplier: patrons pay a known-honorable escort more gladly.
export function escortMultiplier(rep) {
  if (!rep?.tier || rep.leaning !== 'merciful') return 1;
  return 1 + 0.25 * rep.tier;
}

// A short factual line for AI prompts (narrator/parley) — the model voices
// what the engine has already decided is true.
export function reputationForPrompt(rep, name) {
  if (!rep || rep.tier === 0) return null;
  const title = rep.epithet ? `${name} ${rep.epithet}` : name;
  if (rep.leaning === 'merciful') return `${title} — widely known for sparing foes and bringing captives safely home. Strangers have heard of this kindness.`;
  if (rep.leaning === 'dreaded') return `${title} — widely feared; stories travel of foes cut down and truces broken. Strangers are wary, and enemies afraid.`;
  return `${title} — a famous adventurer of deeds both kind and grim.`;
}
