// parley.js — Freeform speech with NPCs and enemies, judged for craft.
// The player types what they actually say; the model roleplays the character
// within hard rails and returns a STRUCTURED verdict the engine validates and
// applies through the same deterministic regard machinery as ACT verbs. Dice
// resolve swords; words resolve hearts — but the engine resolves both.
//
// Craft scoring is the writing-course heart of the game: the verdict includes
// a 0–5 rubric score (specificity to this listener, persuasive appeal, voice)
// that scales how far good words move the meter. Better writing literally
// works better.

import { completeJSON, isEnabled } from './llm.js';
import { getRegard } from '../engine/acts.js';

export const MAX_WORDS_LENGTH = 280;
export const MAX_PARLEYS_PER_NPC = 5;
export const MAX_PARLEY_SHIFT = 40; // cumulative cap per NPC per run

export function parleyCount(run, slug) {
  return run?.flags?.parleyCount?.[slug] ?? 0;
}

export function bumpParley(run, slug) {
  const flags = run.flags ?? {};
  return { ...run, flags: { ...flags, parleyCount: { ...(flags.parleyCount ?? {}), [slug]: parleyCount(run, slug) + 1 } } };
}

export function parleyShiftUsed(run, slug) {
  return run?.flags?.parleyShift?.[slug] ?? 0;
}

export function recordParleyShift(run, slug, applied) {
  const flags = run.flags ?? {};
  return { ...run, flags: { ...flags, parleyShift: { ...(flags.parleyShift ?? {}), [slug]: parleyShiftUsed(run, slug) + Math.abs(applied) } } };
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function validVerdict(v) {
  return v && typeof v === 'object'
    && typeof v.reply === 'string' && v.reply.trim().length > 0 && v.reply.length <= 600
    && Number.isFinite(v.shift) && v.shift >= -20 && v.shift <= 20
    && Number.isFinite(v.craft) && v.craft >= 0 && v.craft <= 5
    && (v.action === undefined || v.action === 'none' || v.action === 'reveal');
}

function systemPrompt(npc, { disguised = false } = {}) {
  return `You are roleplaying ${npc.name}, a character in "Eamon: The Second Age," a classroom-safe storybook fantasy game, AND judging the player's words as a writing coach.

WHO ${String(npc.name ?? '').toUpperCase()} IS:
${npc.persona ?? npc.description ?? 'A character of few words.'}
${disguised ? 'They are currently DISGUISED and pretending to be an ordinary object. If the player sees through the disguise or provokes them, you may set "action":"reveal".' : ''}

THE PLAYER SPEAKS TO THEM. Reply with ONLY a JSON object:
{
  "reply": "what the character says/does in response, 1-3 sentences, in their voice — plain prose, fold any action into the sentence, no asterisks or stage directions",
  "shift": <integer -20..20, how much these exact words move this character's regard for the speaker>,
  "craft": <integer 0..5, writing-craft score for the player's words>,
  "craft_note": "<=12 words of coaching, e.g. 'Naming his lost ship made it land.'"${disguised ? ',\n  "action": "none" | "reveal"' : ''}
}

JUDGING shift: this character's own wants and fears decide it. Generic flattery moves little. Words that show the speaker LISTENED — naming what this character cares about, offering what they actually want — move a lot. Threats and insults move it negative.
JUDGING craft (the rubric): specificity to THIS listener (0-2), persuasive appeal — reason, emotion, or credibility (0-2), voice and vividness (0-1).

HARD RULES:
- Stay in character. The character knows ONLY what their description says they know — no game mechanics, no spoilers, no facts about the world they wouldn't know.
- Classroom-safe: G-rated. If the player's words are cruel or profane, the character reacts in-character with disappointment or anger (negative shift); NEVER repeat or escalate the language.
- The reply must never state numbers, scores, or rules.
- ONLY the JSON object. No other text.`;
}

// Ask the model for a verdict on the player's words. Returns
// { reply, shift, craft, craftNote, action, source } — or a deterministic
// fallback verdict when AI is unavailable (the game must work keyless).
export async function judgeParley({ npc, character, run, words, disguised = false }) {
  const trimmed = String(words ?? '').slice(0, MAX_WORDS_LENGTH).trim();

  if (!isEnabled()) {
    // Rules-only fallback: charm carries a little weight even without a judge.
    const cha = Number.isFinite(character?.charisma) ? character.charisma : 10;
    const shift = cha >= 13 ? 3 : cha >= 8 ? 1 : 0;
    return {
      reply: npc.dialogue ?? `${npc.name ?? 'They'} hears you out in silence, weighing your words.`,
      shift,
      craft: null,
      craftNote: null,
      action: 'none',
      source: 'rules',
    };
  }

  const facts = {
    speaker: { name: character?.name, class: character?.className },
    listener_current_mood: getRegard(run, npc) >= 50 ? 'warming to the speaker' : getRegard(run, npc) >= 25 ? 'guarded' : 'hostile',
    in_combat: !!run?.flags?.combatRounds?.[npc.slug],
    the_words: trimmed,
  };

  const verdict = await completeJSON({
    system: systemPrompt(npc, { disguised }),
    prompt: JSON.stringify(facts, null, 2),
    validate: validVerdict,
    maxTokens: 300,
    temperature: 0.7,
    key: null, // every utterance is unique; don't cache verdicts
  });

  if (!verdict) {
    return {
      reply: `${npc.name ?? 'They'} listens, but gives nothing away.`,
      shift: 0,
      craft: null,
      craftNote: null,
      action: 'none',
      source: 'rules',
    };
  }

  return {
    reply: verdict.reply.trim(),
    shift: clamp(Math.round(verdict.shift), -20, 20),
    craft: clamp(Math.round(verdict.craft), 0, 5),
    craftNote: typeof verdict.craft_note === 'string' ? verdict.craft_note.slice(0, 120) : null,
    action: verdict.action === 'reveal' ? 'reveal' : 'none',
    source: 'ai',
  };
}

// Craft scales persuasion: a 5/5 plea lands at full force, a lazy one at 60%.
export function craftScaledShift(shift, craft) {
  if (!Number.isFinite(shift) || shift === 0) return 0;
  if (!Number.isFinite(craft)) return Math.round(shift * 0.8); // rules fallback
  const factor = 0.6 + craft * 0.08; // 0.6 .. 1.0
  return Math.round(shift * factor);
}
