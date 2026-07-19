// narrator.js — State-aware prose over the deterministic engine. The engine
// decides WHAT happened; the narrator decides only how it reads. Facts in,
// flavor out. Every function returns null on any failure and the caller falls
// back to the canonical authored text, so the game is never blocked on AI.

import { complete, cacheKey, isEnabled } from './llm.js';

const NARRATOR_SYSTEM = `You are the Narrator of "Eamon: The Second Age," a storybook fantasy adventure rendered in the painted style of an Eyvind Earle illustration — angular Gothic shapes, jewel-tone shadow, gold light.

Voice: second person, present tense. Vivid but spare, like a master storyteller reading aloud to a classroom. Warm, a little wry, never purple.

STRICT RULES:
- Use ONLY the facts given. NEVER invent items, exits, creatures, dangers, or numbers that are not in the facts.
- Mention EVERY person or creature listed in "present" — each by name, with their bearing toward the adventurer (a hostile one must read as a clear threat). Never leave someone in the room unaccounted for.
- Text under "already_shown_to_player" is printed verbatim above your prose: do NOT restate or paraphrase it — write what comes next.
- Your prose REPLACES "canonical_description" on the player's screen. Convey its facts in fresh words. NEVER quote, repeat, or lightly reword the canonical description — the player must never read the same sentence twice. One cohesive description, not the original plus an expansion.
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
export async function narrateRoomEntry({ adventure, room, character, entities = {}, visitCount = 1, note = null, reputation = null }) {
  if (!isEnabled() || !room) return null;

  const present = (entities.characters ?? []).map((c) => ({
    name: c.name ?? c.slug,
    disposition: c.disposition ?? 'neutral',
    appearance: c.description ?? null,
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
      ...(reputation ? { reputation } : {}),
    },
    present,
    visit: visitCount > 1 ? `this is visit number ${visitCount}` : 'first visit',
    already_shown_to_player: note || null,
    remembered_deeds: chronicleEchoes(character),
  };

  const key = cacheKey('room-entry', adventure?.adventure?.id, room.room_number, character?.name, facts.adventurer.condition, visitCount > 1, present.map((p) => `${p.name}:${p.disposition}`), note);
  const out = await complete({
    system: NARRATOR_SYSTEM,
    prompt: `Retell this room's description for this adventurer, in your voice, honoring every fact:\n${JSON.stringify(facts, null, 2)}`,
    maxTokens: 160,
    temperature: 0.85,
    key,
  });
  return stripCanonicalEcho(out, room.narration_text);
}

// Belt to the prompt's suspenders: if the model echoed the canonical
// description verbatim (or near enough after whitespace normalization),
// remove the echo; if nothing substantial remains, fall back to authored.
export function stripCanonicalEcho(narration, canonical) {
  if (!narration) return null;
  const canon = String(canonical ?? '').trim();
  if (canon.length < 20) return narration;
  const squash = (t) => t.replace(/\s+/g, ' ').trim();
  const squashedCanon = squash(canon);
  const squashedOut = squash(narration);
  const idx = squashedOut.indexOf(squashedCanon);
  if (idx === -1) return narration;
  const remainder = squash(squashedOut.slice(0, idx) + ' ' + squashedOut.slice(idx + squashedCanon.length));
  // If the model was ONLY an echo (plus scraps), use the authored text instead.
  return remainder.length >= 40 ? remainder : null;
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
