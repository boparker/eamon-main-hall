// acts.js — The mercy layer: ACT verbs, the regard meter, yielding, behavior
// states, and telegraphed attacks. Pure functions over (run, npc) in the same
// style as adventures.js: callers persist, nothing here mutates its input.
//
// Design: every enemy carries a hidden "regard" meter (0..100) seeded from its
// base friendliness. ACT verbs (authored per enemy in the manifest) and parley
// shift it. Cross an enemy's yield threshold — by words, deeds, or beating it
// to the brink — and it stops fighting and can be SPAREd: the Undertale mercy
// loop, resolved entirely by deterministic rules.

import { baseFriendliness } from './companions.js';

// ── Regard ───────────────────────────────────────────────────────────────────

function clampRegard(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function getRegard(run, npc) {
  const stored = run?.flags?.regard?.[npc?.slug];
  return Number.isFinite(stored) ? stored : clampRegard(baseFriendliness(npc));
}

export function setRegard(run, slug, value) {
  const flags = run.flags ?? {};
  return { ...run, flags: { ...flags, regard: { ...(flags.regard ?? {}), [slug]: clampRegard(value) } } };
}

// Charisma scales goodwill the way it scales the friend-or-foe roll: each point
// above/below 10 is ±5% effect. Only positive shifts benefit — insults land at
// full force no matter how charming you are.
export function charismaScaled(shift, charisma) {
  if (!Number.isFinite(shift) || shift <= 0) return shift ?? 0;
  const cha = Number.isFinite(charisma) ? charisma : 10;
  return Math.round(shift * (1 + (cha - 10) * 0.05));
}

export function shiftRegard(run, npc, delta, charisma = 10) {
  const applied = charismaScaled(delta, charisma);
  const regard = clampRegard(getRegard(run, npc) + applied);
  return { run: setRegard(run, npc.slug, regard), regard, applied };
}

// ── ACT verbs ────────────────────────────────────────────────────────────────
// Manifest shape, per character:
//   "acts": [{ "verb": "calm", "label": "Calm", "shift": 30,
//              "success_text": "...", "repeat_text": "..." }]
// Repeating an act lands at half strength — persuasion has diminishing returns.

export function actsFor(npc) {
  return Array.isArray(npc?.acts) ? npc.acts : [];
}

export function findAct(npc, verb) {
  const wanted = String(verb ?? '').trim().toLowerCase();
  return actsFor(npc).find((act) => String(act.verb).toLowerCase() === wanted) ?? null;
}

export function timesActed(run, slug, verb) {
  return run?.flags?.actsUsed?.[slug]?.[verb] ?? 0;
}

function bumpActUsed(run, slug, verb) {
  const flags = run.flags ?? {};
  const used = flags.actsUsed ?? {};
  const forNpc = used[slug] ?? {};
  return {
    ...run,
    flags: { ...flags, actsUsed: { ...used, [slug]: { ...forNpc, [verb]: (forNpc[verb] ?? 0) + 1 } } },
  };
}

// Perform an ACT. Returns { run, regard, applied, text, repeated }.
export function applyAct({ run, npc, act, charisma = 10 }) {
  const repeated = timesActed(run, npc.slug, act.verb) > 0;
  const baseShift = Number.isFinite(act.shift) ? act.shift : 0;
  const shift = repeated ? Math.trunc(baseShift / 2) : baseShift;
  const shifted = shiftRegard(run, npc, shift, charisma);
  const next = bumpActUsed(shifted.run, npc.slug, act.verb);
  const text = repeated && act.repeat_text ? act.repeat_text : act.success_text;
  return { run: next, regard: shifted.regard, applied: shifted.applied, text: text ?? null, repeated };
}

// ── Yielding & mercy ─────────────────────────────────────────────────────────
// An enemy yields when its regard crosses yields_at_regard, or when its HP
// falls to yields_at_hp or below (it begs). Striking a yielded enemy is
// merciless: regard collapses and it will never yield to you again.

export function canYield(npc) {
  return Number.isFinite(npc?.yields_at_regard) || Number.isFinite(npc?.yields_at_hp);
}

export function hasYielded(run, slug) {
  return !!run?.flags?.yielded?.[slug];
}

export function isMerciless(run, slug) {
  return !!run?.flags?.merciless?.[slug];
}

export function checkYield(npc, run, hp) {
  if (!canYield(npc) || isMerciless(run, npc.slug)) return false;
  if (hasYielded(run, npc.slug)) return true;
  if (hp <= 0) return false;
  if (Number.isFinite(npc.yields_at_regard) && getRegard(run, npc) >= npc.yields_at_regard) return true;
  if (Number.isFinite(npc.yields_at_hp) && hp <= npc.yields_at_hp) return true;
  return false;
}

export function markYielded(run, slug) {
  const flags = run.flags ?? {};
  if (flags.yielded?.[slug]) return run;
  return { ...run, flags: { ...flags, yielded: { ...(flags.yielded ?? {}), [slug]: true } } };
}

// Striking a yielded enemy breaks the truce for good.
export function markMerciless(run, slug) {
  const flags = run.flags ?? {};
  const yielded = { ...(flags.yielded ?? {}) };
  delete yielded[slug];
  return {
    ...run,
    flags: { ...flags, yielded, merciless: { ...(flags.merciless ?? {}), [slug]: true }, regard: { ...(flags.regard ?? {}), [slug]: 0 } },
  };
}

export function markSpared(run, slug) {
  const flags = run.flags ?? {};
  return { ...run, flags: { ...flags, spared: { ...(flags.spared ?? {}), [slug]: true } } };
}

export function wasSpared(run, slug) {
  return !!run?.flags?.spared?.[slug];
}

// ── Behavior states ──────────────────────────────────────────────────────────
// A tiny deterministic state machine the narrator (and the combat HUD) can
// express: enemies read differently as the fight turns.

export function behaviorState(npc, { hp, maxHp, regard, yielded = false }) {
  if (yielded) return 'yielding';
  const max = Number.isFinite(maxHp) && maxHp > 0 ? maxHp : 1;
  const ratio = Math.max(0, hp) / max;
  if (ratio <= 0.25) return 'desperate';
  if (ratio <= 0.6 || (Number.isFinite(regard) && regard >= 40)) return 'wary';
  return 'aggressive';
}

// ── Telegraphed attacks ──────────────────────────────────────────────────────
// Manifest shape: "telegraph": { "every": 2, "name": "charge",
//   "warn_text": "...", "multiplier": 2 }
// After every Nth round the enemy winds up; the player answers with BRACE,
// DODGE, or INTERRUPT (or eats the full blow by attacking through it).

export function telegraphFor(npc) {
  const t = npc?.telegraph;
  if (!t || !Number.isFinite(t.every) || t.every < 1) return null;
  return { every: t.every, name: t.name ?? 'charge', warn_text: t.warn_text ?? null, multiplier: Number.isFinite(t.multiplier) ? t.multiplier : 2 };
}

export function telegraphPending(run, slug) {
  return !!run?.flags?.telegraph?.[slug];
}

export function setTelegraph(run, slug, pending) {
  const flags = run.flags ?? {};
  const telegraph = { ...(flags.telegraph ?? {}) };
  if (pending) telegraph[slug] = true;
  else delete telegraph[slug];
  return { ...run, flags: { ...flags, telegraph } };
}

// Should this round's end raise the wind-up warning?
export function shouldTelegraph(npc, rounds) {
  const t = telegraphFor(npc);
  return !!t && rounds > 0 && rounds % t.every === 0;
}

export const STANCES = ['brace', 'dodge', 'interrupt'];

export function isStance(value) {
  return STANCES.includes(String(value ?? '').trim().toLowerCase());
}
