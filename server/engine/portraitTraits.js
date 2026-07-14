// Portrait builder — a CLOSED vocabulary of traits. The player only ever picks
// from these enumerated options, so the prompt is 100% server-composed (no
// free text to moderate) and every result stays in the locked Earle style.

const LOCKED_STYLE = "FLAT 2D cel illustration in the style of Walt Disney's Sleeping Beauty designed by Eyvind Earle: flat hard-edged shapes of solid color, bold clean outlines, elegant angular Earle linework, ornate decorative costume detail, rich jewel-tone colors, dramatic theatrical lighting, a single heroic character centered and facing the viewer with slender adult proportions, simple dark vignette background. ABSOLUTELY NOT photorealistic, NOT painterly, NOT a painting, NOT rendered, NOT a 3d render, NOT chibi, NOT a child. No text, no words, no signature, no watermark.";

const CLASS_BASE = {
  adventurer: 'clad in light leather armor and a green traveling cloak, holding a steel sword',
  warrior: 'clad in gleaming gold-trimmed steel plate armor and a crimson cloak, holding a great sword',
  rogue: 'clad in dark supple leather and a hooded cloak, holding a dagger',
  mystic: 'clad in deep-blue star-flecked mage robes, holding a glowing wooden staff',
};

// Each trait: ordered list of { key, label, phrase }. `label` is shown in the UI;
// `phrase` is woven into the prompt. The FIRST entry is the default.
const TRAITS = {
  presentation: [
    { key: 'feminine', label: 'Feminine', phrase: 'feminine' },
    { key: 'masculine', label: 'Masculine', phrase: 'masculine' },
  ],
  age: [
    { key: 'adult', label: 'Adult', phrase: '' },
    { key: 'young', label: 'Young', phrase: 'youthful' },
    { key: 'middleAged', label: 'Middle-aged', phrase: 'weathered middle-aged' },
    { key: 'elder', label: 'Elder', phrase: 'elderly age-lined' },
  ],
  skin: [
    { key: 'fair', label: 'Fair', phrase: 'fair' },
    { key: 'porcelain', label: 'Porcelain', phrase: 'porcelain' },
    { key: 'tan', label: 'Tan', phrase: 'tan' },
    { key: 'brown', label: 'Brown', phrase: 'warm brown' },
    { key: 'deep', label: 'Deep', phrase: 'deep ebony' },
  ],
  hairColor: [
    { key: 'brown', label: 'Brown', phrase: 'brown' },
    { key: 'black', label: 'Black', phrase: 'black' },
    { key: 'auburn', label: 'Auburn', phrase: 'auburn' },
    { key: 'blond', label: 'Blond', phrase: 'golden blond' },
    { key: 'red', label: 'Red', phrase: 'fiery red' },
    { key: 'grey', label: 'Grey', phrase: 'silver-grey' },
  ],
  hairStyle: [
    { key: 'short', label: 'Short', phrase: 'short' },
    { key: 'long', label: 'Long', phrase: 'long flowing' },
    { key: 'braided', label: 'Braided', phrase: 'braided' },
    { key: 'curly', label: 'Curly', phrase: 'curly' },
    { key: 'ponytail', label: 'Ponytail', phrase: 'tied-back ponytail' },
    { key: 'shaved', label: 'Shaved', phrase: 'shaved' },
  ],
  facialHair: [
    { key: 'none', label: 'None', phrase: '' },
    { key: 'stubble', label: 'Stubble', phrase: 'light stubble' },
    { key: 'beard', label: 'Beard', phrase: 'a full beard' },
    { key: 'mustache', label: 'Mustache', phrase: 'a mustache' },
  ],
  mark: [
    { key: 'none', label: 'None', phrase: '' },
    { key: 'scar', label: 'Scar', phrase: 'a scar across one cheek' },
    { key: 'eyepatch', label: 'Eyepatch', phrase: 'an eyepatch' },
    { key: 'freckles', label: 'Freckles', phrase: 'freckles' },
  ],
  expression: [
    { key: 'brave', label: 'Brave', phrase: 'brave' },
    { key: 'fierce', label: 'Fierce', phrase: 'fierce' },
    { key: 'kind', label: 'Kind', phrase: 'kind' },
    { key: 'mischievous', label: 'Mischievous', phrase: 'mischievous' },
  ],
};

export const TRAIT_KEYS = Object.keys(TRAITS);

// UI-facing vocabulary: { trait: [{ key, label }] }.
export function portraitOptions() {
  const out = {};
  for (const [trait, list] of Object.entries(TRAITS)) out[trait] = list.map(({ key, label }) => ({ key, label }));
  return out;
}

// Coerce arbitrary input to a safe, fully-populated trait set (defaults for any
// missing/invalid value). Guarantees the composed prompt can never contain
// anything outside the vocabulary.
export function sanitizeTraits(input = {}) {
  const safe = {};
  for (const [trait, list] of Object.entries(TRAITS)) {
    const picked = list.find((o) => o.key === input?.[trait]);
    safe[trait] = (picked ?? list[0]).key;
  }
  return safe;
}

function phrase(trait, key) {
  return (TRAITS[trait].find((o) => o.key === key) ?? TRAITS[trait][0]).phrase;
}

export function isValidClass(className) {
  return Object.prototype.hasOwnProperty.call(CLASS_BASE, className);
}

// Compose the locked prompt from a sanitized trait set + class.
export function composePortraitPrompt(traits, className) {
  const t = sanitizeTraits(traits);
  const cls = isValidClass(className) ? className : 'adventurer';
  const extras = [phrase('facialHair', t.facialHair), phrase('mark', t.mark)].filter(Boolean);
  const lead = [phrase('expression', t.expression), phrase('age', t.age), phrase('presentation', t.presentation)].filter(Boolean).join(' ');
  const descriptor = `A ${lead} ${cls} hero with ${phrase('skin', t.skin)} skin and ${phrase('hairStyle', t.hairStyle)} ${phrase('hairColor', t.hairColor)} hair${extras.length ? ', ' + extras.join(', ') : ''}, ${CLASS_BASE[cls]}.`;
  return `${descriptor} ${LOCKED_STYLE}`;
}
