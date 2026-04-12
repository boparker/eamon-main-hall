// input.js — Input box, skins, choice cards, send logic

export const inputEl = document.getElementById('player-input');
export const inputBox = document.getElementById('input-box');
const inputLabel = document.getElementById('input-label');
export const sendBtn = document.getElementById('send-btn');
const choicesArea = document.getElementById('choices-area');

export let pendingChoices = [];

export function clearChoices() {
  pendingChoices = [];
}

export function addChoice(text) {
  pendingChoices.push(text);
}

// Render choices — accepts a sendFn callback so choices can trigger sends
// without creating a circular dependency with main.js
let _sendFn = null;
export function registerSendFn(fn) { _sendFn = fn; }

export function renderChoices() {
  choicesArea.innerHTML = '';
  if (pendingChoices.length === 0) { choicesArea.classList.remove('visible'); return; }
  for (const text of pendingChoices) {
    const card = document.createElement('div');
    card.className = 'choice-card';
    card.textContent = text;
    card.addEventListener('click', () => {
      choicesArea.classList.remove('visible');
      pendingChoices = [];
      inputEl.value = text;
      if (_sendFn) _sendFn();
    });
    choicesArea.appendChild(card);
  }
  choicesArea.classList.add('visible');
}

// ── Input Skins ──
const INPUT_SKINS = {
  name:   { placeholder: 'Sign thy name here...', label: '\u270E SIGN THE BOOK', skin: 'skin-name', arrow: '\u270E' },
  choice: { placeholder: 'Choose your path...', label: 'YOUR CHOICE', skin: '', arrow: '\u203A' },
  action: { placeholder: 'What do you do?', label: '', skin: '', arrow: '\u203A' },
  shop:   { placeholder: 'What catches your eye?', label: '\u2696 BROWSE THE WARES', skin: 'skin-shop', arrow: '\u2696' },
};

export function setInputState(hint, enabled) {
  const cfg = INPUT_SKINS[hint] || INPUT_SKINS.action;
  inputEl.placeholder = cfg.placeholder;
  inputLabel.textContent = cfg.label;
  inputLabel.classList.toggle('visible', !!cfg.label);
  document.getElementById('prompt-arrow').textContent = cfg.arrow;
  inputBox.classList.remove('skin-name', 'skin-shop');
  if (cfg.skin) inputBox.classList.add(cfg.skin);
  inputEl.disabled = !enabled;
  sendBtn.disabled = !enabled;
  if (enabled) {
    inputBox.classList.add('glow', 'pulse');
    setTimeout(() => inputEl.focus(), 100);
  } else {
    inputBox.classList.remove('glow', 'pulse');
  }
}
