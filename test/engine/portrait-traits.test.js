import test from 'node:test';
import assert from 'node:assert/strict';

import {
  portraitOptions, sanitizeTraits, composePortraitPrompt, isValidClass, TRAIT_KEYS,
} from '../../server/engine/portraitTraits.js';

test('portraitOptions exposes every trait as {key,label} lists', () => {
  const opts = portraitOptions();
  assert.deepEqual(Object.keys(opts).sort(), [...TRAIT_KEYS].sort());
  for (const list of Object.values(opts)) {
    assert.ok(Array.isArray(list) && list.length > 0);
    for (const o of list) assert.deepEqual(Object.keys(o).sort(), ['key', 'label']);
  }
});

test('sanitizeTraits fills defaults and drops anything outside the vocabulary', () => {
  const safe = sanitizeTraits({ skin: 'chartreuse', hairColor: 'red', evil: 'true' });
  assert.equal(safe.hairColor, 'red'); // valid kept
  assert.equal(safe.skin, 'fair'); // invalid -> default (first option)
  assert.equal(safe.expression, 'brave'); // missing -> default
  assert.equal(safe.evil, undefined); // unknown trait not carried through
  assert.deepEqual(Object.keys(safe).sort(), [...TRAIT_KEYS].sort());
});

test('composePortraitPrompt weaves picked phrases + class base + the locked style', () => {
  const prompt = composePortraitPrompt(
    { presentation: 'feminine', skin: 'deep', hairColor: 'red', hairStyle: 'braided', mark: 'scar', expression: 'fierce' },
    'warrior',
  );
  assert.match(prompt, /fierce feminine warrior/);
  assert.match(prompt, /deep ebony skin/);
  assert.match(prompt, /braided fiery red hair/);
  assert.match(prompt, /a scar across one cheek/);
  assert.match(prompt, /plate armor/); // class base
  assert.match(prompt, /Eyvind Earle/); // locked style
  assert.match(prompt, /NOT photorealistic/);
});

test('composePortraitPrompt falls back to adventurer for an unknown class', () => {
  assert.equal(isValidClass('necromancer'), false);
  const prompt = composePortraitPrompt({}, 'necromancer');
  assert.match(prompt, /adventurer hero/);
});

test('composePortraitPrompt omits empty traits cleanly (no dangling commas)', () => {
  const prompt = composePortraitPrompt({ facialHair: 'none', mark: 'none' }, 'rogue');
  assert.ok(!/, ,/.test(prompt));
  assert.ok(!/hair,\s*,/.test(prompt));
});
