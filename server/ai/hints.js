// hints.js — The Spirit of the Hall: an in-world hint-giver that knows the
// true run state (it asks the engine, not the model) and nudges Socratically.
// The hint CONTENT is chosen deterministically from the real game state; the
// model only rephrases it in the spirit's voice. Keyless play gets the plain
// deterministic hint. It nudges, it never solves.

import { complete, cacheKey, isEnabled } from './llm.js';
import { getCurrentRoom, getVisibleRoomEntities, dispositionOf } from '../engine/adventures.js';
import { actsFor, hasYielded, isMerciless, canYield } from '../engine/acts.js';

// Pick the most useful true fact to nudge toward. Ordered by urgency.
export function pickHint(adventure, run, character) {
  const room = getCurrentRoom(run, adventure);
  const entities = getVisibleRoomEntities(run, adventure);
  const hostiles = (entities.characters ?? []).filter((c) => (c.disposition ?? dispositionOf(c, run)) === 'hostile');

  for (const enemy of hostiles) {
    if (hasYielded(run, enemy.slug)) {
      return { kind: 'spare', subject: enemy.name, text: `${enemy.name} has stopped fighting. The choice of how this ends is yours now — SPARE, or steel.` };
    }
    if (actsFor(enemy).length > 0 && canYield(enemy) && !isMerciless(run, enemy.slug)) {
      const verbs = actsFor(enemy).map((a) => a.verb.toUpperCase()).join(', ');
      return { kind: 'mercy', subject: enemy.name, text: `Not every fight must end in blood. Watch ${enemy.name} closely — what does it want? You might ${verbs}, or simply SAY something it needs to hear.` };
    }
  }

  const opened = new Set(run.flags?.openedContainers ?? []);
  const inspected = new Set(run.flags?.inspectedFeatures ?? []);
  const visibleSlugs = new Set((entities.placements ?? []).map((p) => p.item_slug));
  const here = (adventure.items ?? []).filter((item) => visibleSlugs.has(item.slug));
  const container = here.find((item) => item.type === 'container' && !opened.has(item.slug));
  if (container) {
    return { kind: 'container', subject: container.name, text: `That ${container.name} is shut. Shut things in this cave hold treasure — or teeth. An old hermit could say which, if one were friendly to you.` };
  }
  const feature = here.find((item) => item.type === 'feature' && !inspected.has(item.slug));
  if (feature) {
    return { kind: 'feature', subject: feature.name, text: `Close readers are rewarded here. Something about the ${feature.name} asks to be INSPECTed.` };
  }

  const wounded = (character?.hd ?? 1) <= Math.ceil((character?.maxHd ?? 1) / 3);
  const treasures = (character?.inventory ?? []).filter((item) => item?.type === 'treasure').length;
  if (wounded && treasures > 0) {
    return { kind: 'retreat', subject: null, text: 'Your wounds are deep and your pack is heavy with treasure. There is no shame in carrying a story home alive — the entrance lies north of where you began.' };
  }

  const unexplored = Object.entries(room.exits ?? {})
    .filter(([, dest]) => Number.isFinite(dest) && !(run.visitedRooms ?? []).includes(dest))
    .map(([dir]) => dir.toUpperCase());
  if (unexplored.length > 0) {
    return { kind: 'explore', subject: null, text: `You have not yet walked ${unexplored.join(' or ')} from this place. The cave keeps its best secrets where boots have not been.` };
  }

  return { kind: 'look', subject: null, text: 'When the way is unclear, LOOK again — rooms tell more to those who ask twice. And remember: words open doors that swords cannot.' };
}

const SPIRIT_SYSTEM = `You are the Spirit of the Guild Hall in "Eamon: The Second Age" — an ancient, kindly presence that drifts beside new adventurers. You speak in 1-2 short sentences, warm and a little riddling, like a good teacher: you ask the question that makes the student see, you never hand over the answer. Classroom-safe. Plain prose, no markdown.`;

// Rephrase the deterministic hint in the spirit's voice (or return it plain).
export async function spiritHint(adventure, run, character) {
  const hint = pickHint(adventure, run, character);
  if (!isEnabled()) return { ...hint, source: 'rules' };

  const text = await complete({
    system: SPIRIT_SYSTEM,
    prompt: `The true nudge the adventurer needs (do not contradict it, do not add new facts, keep any UPPERCASE command words intact): "${hint.text}"\n\nSay it your way.`,
    maxTokens: 110,
    temperature: 0.9,
    key: cacheKey('hint', hint.kind, hint.subject, hint.text),
  });
  return text ? { ...hint, text, source: 'ai' } : { ...hint, source: 'rules' };
}
