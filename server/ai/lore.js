// lore.js — Legends for Marcos's rotating magic weapons. The engine rolls the
// weapon (name, dice, odds — stats are never AI-touched); the model writes the
// legend Marcos tells you at the counter. Cached per weapon name; keyless play
// just skips the legend line.

import { complete, cacheKey, isEnabled } from './llm.js';

export async function weaponLegend(weapon) {
  if (!isEnabled() || !weapon?.magic) return null;
  return complete({
    system: 'You are Marcos Cavielli, weaponsmith of the Great Hall in a classroom-safe storybook fantasy. In 1-2 sentences, tell the legend of a named magic weapon you are selling — who bore it, what it did, why it ended up on your rack. Wry merchant\'s voice, G-rated, plain prose — no asterisks or stage directions. Never mention numbers or stats.',
    prompt: `The weapon: a ${weapon.stats?.type ?? 'weapon'} called "${weapon.name}".`,
    maxTokens: 110,
    temperature: 0.9,
    key: cacheKey('weapon-legend', weapon.name, weapon.stats?.type),
  });
}
