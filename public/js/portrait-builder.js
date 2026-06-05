// portrait-builder.js — the reward-gated custom portrait picker. The player
// chooses from a closed set of traits; the server composes the locked Earle-style
// prompt and generates the image. Account-only (uses the stored auth session).

import { state } from './state.js';
import { getPortraitOptions, generatePortrait } from './api.js';
import { getStoredAuthSession } from './auth-state.js';
import { updateHUD } from './hud.js';

const TRAIT_ORDER = [
  ['presentation', 'Presentation'],
  ['skin', 'Skin tone'],
  ['hairColor', 'Hair color'],
  ['hairStyle', 'Hair style'],
  ['facialHair', 'Facial hair'],
  ['mark', 'Mark'],
  ['expression', 'Expression'],
];

let optionsCache = null;
const picks = {};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function close() {
  document.getElementById('portrait-overlay')?.remove();
}

function renderPickers(options, body) {
  const grid = el('div', 'pb-grid');
  for (const [trait, label] of TRAIT_ORDER) {
    const list = options[trait];
    if (!list) continue;
    if (picks[trait] == null) picks[trait] = list[0].key;
    const group = el('div', 'pb-group');
    group.appendChild(el('div', 'pb-label', label));
    const chips = el('div', 'pb-chips');
    for (const opt of list) {
      const chip = el('button', 'pb-chip' + (picks[trait] === opt.key ? ' active' : ''), opt.label);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        picks[trait] = opt.key;
        chips.querySelectorAll('.pb-chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
      });
      chips.appendChild(chip);
    }
    group.appendChild(chips);
    grid.appendChild(group);
  }
  body.appendChild(grid);
}

async function doGenerate(previewImg, status, generateBtn) {
  const session = getStoredAuthSession();
  if (!session?.sessionToken) { status.textContent = 'Sign in to paint a portrait.'; return; }
  generateBtn.disabled = true;
  status.textContent = 'Painting your portrait…';
  previewImg.parentElement.classList.add('loading');
  try {
    const res = await generatePortrait({
      characterId: state.character?.id,
      traits: { ...picks },
      sessionToken: session.sessionToken,
      profileId: session.profileId,
    });
    const url = res.portraitUrl;
    state.character.portraitUrl = url;
    previewImg.src = url;
    previewImg.hidden = false;
    status.textContent = 'Looking good! Keep it, or tweak and repaint.';
    updateHUD(false);
  } catch (err) {
    status.textContent = err?.status === 403
      ? "Clear the Beginner's Cave first to unlock your portrait."
      : 'The portrait could not be painted right now. Try again shortly.';
  } finally {
    generateBtn.disabled = false;
    previewImg.parentElement.classList.remove('loading');
  }
}

export async function openPortraitBuilder() {
  if (document.getElementById('portrait-overlay')) return;
  if (!state.character?.id) return;

  const overlay = el('div');
  overlay.id = 'portrait-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const modal = el('div', 'pb-modal');
  const head = el('div', 'pb-head');
  head.appendChild(el('div', 'pb-title', 'Paint Your Portrait'));
  const x = el('button', 'pb-close', '✕');
  x.type = 'button';
  x.addEventListener('click', close);
  head.appendChild(x);
  modal.appendChild(head);

  const stage = el('div', 'pb-stage');
  const preview = el('div', 'pb-preview');
  const img = el('img', 'pb-preview-img');
  img.alt = 'Your portrait';
  if (state.character.portraitUrl) { img.src = state.character.portraitUrl; } else { img.hidden = true; }
  const placeholder = el('div', 'pb-preview-ph', '🎨');
  preview.append(placeholder, img);
  stage.appendChild(preview);

  const body = el('div', 'pb-body');
  modal.append(stage, body);

  const status = el('div', 'pb-status', state.character.portraitUrl ? 'Tweak your traits and repaint anytime.' : `Choose your ${state.character.className ?? 'hero'}’s look, then paint it.`);
  const actions = el('div', 'pb-actions');
  const generateBtn = el('button', 'enter-btn primary', '🎨 Paint Portrait');
  generateBtn.type = 'button';
  generateBtn.addEventListener('click', () => doGenerate(img, status, generateBtn));
  const doneBtn = el('button', 'enter-btn', 'Done');
  doneBtn.type = 'button';
  doneBtn.addEventListener('click', close);
  actions.append(generateBtn, doneBtn);

  modal.append(status, actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Load the trait vocabulary (cached) and render the pickers.
  try {
    if (!optionsCache) optionsCache = (await getPortraitOptions()).options;
    renderPickers(optionsCache, body);
  } catch {
    body.appendChild(el('div', 'pb-status', 'Could not load portrait options.'));
  }
}

// Whether this character has earned the portrait builder (cleared the cave).
export function canPaintPortrait(character) {
  return Array.isArray(character?.adventuresCompleted)
    && character.adventuresCompleted.includes('beginners-cave');
}
