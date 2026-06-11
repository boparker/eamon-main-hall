// narrator.js — State-aware prose over the deterministic engine. The engine
// decides WHAT happened; the narrator decides only how it reads. Facts in,
// flavor out. Every function returns null on any failure and the caller falls
// back to the canonical authored text, so the game is never blocked on AI.

import { complete, cacheKey, isEnabled } from './llm.js';

const NARRATOR_SYSTEM = `You are the Narrator of "Eamon: The Second Age," a storybook fantasy adventure rendered in the painted style of an Eyvind Earle illustration — angular Gothic shapes, jewel-tone shadow, gold light.

Voice: second person, present tense. Vivid but spare, like a master storyteller reading aloud to a classroom. Warm, a little wry, never purple.

STRICT RULES:
- Use ONLY the facts given. NEVER invent items, exits, creatures, dangers, or numbers that are not in the facts.
- Never speak for the adventurer or decide what they do or feel beyond what the facts say.
- Never reveal hidden things, mechanics, or hints.
- Keep it G-rated and classroom-safe; peril yes, gore no.
- 2 to 3 short sentences. Plain prose only — no markdown, no headings, no quotation of the rules.`;

function hpWord(hp, maxHp) {
  const ratio = Math.max(0, hp) / Math.max(1, maxHp);
  if (ratio >= 0.95) return 'unhurt';
  if (ratio >= 0.6) return 'lightly wounded';
  if (ratio >= 0.3) return 'badly wounded';
  return 'on their last legs';
}

function chronicleEchoes(character) {
  const deeds = character?.chronicle?.deeds;
  if (!Array.isArray(deeds) || deeds.length === 0) return [];
  return deeds.slice(-3).map((deed) => deed?.text).filter(Boolean);
}

// Rewrite a room's description line with awareness of the run's state.
// Returns prose to use IN PLACE of room.narration_text, or null to fall back.
export async function narrateRoomEntry({ adventure, room, character, entities = {}, visitCount = 1, note = null }) {
  if (!isEnabled() || !room) return null;

  const present = (entities.characters ?? []).map((c) => ({
    name: c.name ?? c.slug,
    disposition: c.disposition ?? 'neutral',
    ...(c.companion ? { travelling_with_you: true } : {}),
    ...(c.state ? { state: c.state } : {}),
  }));
  const facts = {
    adventure: adventure?.adventure?.name,
    room: { name: room.name, canonical_description: room.narration_text, light: room.light_level },
    adventurer: {
      name: character?.name,
      class: character?.className,
      condition: hpWord(character?.hd ?? character?.hp ?? 1, character?.maxHd ?? character?.maxHp ?? 1),
    },
    present,
    visit: visitCount > 1 ? `this is visit number ${visitCount}` : 'first visit',
    just_happened: note || null,
    remembered_deeds: chronicleEchoes(character),
  };

  const key = cacheKey('room-entry', adventure?.adventure?.id, room.room_number, character?.name, facts.adventurer.condition, visitCount > 1, present.map((p) => `${p.name}:${p.disposition}`), note);
  return complete({
    system: NARRATOR_SYSTEM,
    prompt: `Retell this room's description for this adventurer, in your voice, honoring every fact:\n${JSON.stringify(facts, null, 2)}`,
    maxTokens: 160,
    temperature: 0.85,
    key,
  });
}

// One sentence for a turning point — a kill, a mercy, a yield, a death.
// Returns the sentence or null.
export async function narrateMoment({ kind, adventure, room, character, subject, detail = null }) {
  if (!isEnabled()) return null;
  const facts = {
    moment: kind,
    where: room?.name,
    adventure: adventure?.adventure?.name,
    adventurer: { name: character?.name, condition: hpWord(character?.hd ?? 1, character?.maxHd ?? 1) },
    who: subject ?? null,
    detail,
    remembered_deeds: chronicleEchoes(character),
  };
  return complete({
    system: NARRATOR_SYSTEM,
    prompt: `In ONE sentence, mark this turning point:\n${JSON.stringify(facts, null, 2)}`,
    maxTokens: 90,
    temperature: 0.9,
    key: null,
  });
}
