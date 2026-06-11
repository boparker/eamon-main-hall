// input.js — Input box, skins, choice cards, send logic

export const inputEl = document.getElementById('player-input');
export const inputBox = document.getElementById('input-box');
const inputLabel = document.getElementById('input-label');
export const sendBtn = document.getElementById('send-btn');
const choicesArea = document.getElementById('choices-area');
const objectTiles = document.getElementById('object-tiles');

export let pendingChoices = [];

// The room's visible item objects (for tile icons), set each render from state.
let _roomItems = [];
export function setRoomItems(items) { _roomItems = Array.isArray(items) ? items : []; }

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

// Title-case a target ("gold key" → "Gold Key"); proper names stay as-is.
function titleCaseWords(value) {
  return String(value).replace(/\b\w/g, (c) => c.toUpperCase());
}

// Format a raw command choice for display while the original text is still sent
// as the command (the parser lowercases input). "talk Cynthia" → "Talk to
// Cynthia", "attack priest" → "Attack Priest", "north" → "North".
export function formatActionLabel(text) {
  const t = String(text ?? '').trim();
  let m;
  if ((m = /^talk\s+(?:to\s+)?(.+)$/i.exec(t))) return `Talk to ${titleCaseWords(m[1])}`;
  if ((m = /^attack\s+(.+)$/i.exec(t))) return `Attack ${titleCaseWords(m[1])}`;
  if ((m = /^spare\s+(.+)$/i.exec(t))) return `🕊 Spare ${titleCaseWords(m[1])}`;
  if (/^(brace|dodge|interrupt)$/i.test(t)) return `⚔ ${t.charAt(0).toUpperCase()}${t.slice(1).toLowerCase()}`;
  if ((m = /^take\s+(.+)$/i.exec(t))) return `Take ${titleCaseWords(m[1])}`;
  if ((m = /^inspect\s+(.+)$/i.exec(t))) return `Inspect ${titleCaseWords(m[1])}`;
  if ((m = /^(?:read|examine)\s+(.+)$/i.exec(t))) return `Read ${titleCaseWords(m[1])}`;
  if ((m = /^open\s+(.+)$/i.exec(t))) return `Open ${titleCaseWords(m[1])}`;
  if (/^(north|south|east|west|up|down)$/i.test(t)) return t.charAt(0).toUpperCase() + t.slice(1);
  return t; // already-formatted hall/shop labels pass through unchanged
}

const VERB_LABELS = { open: 'Open', take: 'Take', inspect: 'Inspect', read: 'Read' };

// An item-interaction choice ("open chest", "take axe", …) becomes a tile;
// everything else (move, talk, attack, hall/shop labels) stays a button.
function parseItemChoice(text) {
  const m = /^(open|take|inspect|read|examine)\s+(.+)$/i.exec(String(text ?? '').trim());
  if (!m) return null;
  const verb = m[1].toLowerCase() === 'examine' ? 'read' : m[1].toLowerCase();
  return { verb, object: m[2].trim() };
}

const norm = (v) => String(v ?? '').trim().toLowerCase();

// Placeholder glyph for an object tile — by item type when we can match it to a
// room item, else by name keywords. Swaps to real item art with the pipeline.
function objectGlyph(object, verb) {
  const item = _roomItems.find((i) => norm(i.name) === norm(object) || norm(i.slug) === norm(object));
  const type = item?.type;
  const n = norm(object);
  if (type === 'container' || /chest|crate|coffer|box|trunk/.test(n)) return '🧰';
  if (type === 'feature' || verb === 'inspect') return '🔍';
  if (type === 'potion' || /potion|flask|vial|elixir/.test(n)) return '🧪';
  if (type === 'scroll' || /scroll/.test(n)) return '📜';
  if (type === 'key' || /\bkey\b/.test(n)) return '🗝️';
  if (type === 'treasure' || /gold|silver|coin|gem|diamond|jewel|ruby|treasure|hoard/.test(n)) return '💎';
  if (/axe/.test(n)) return '🪓';
  if (/bow/.test(n)) return '🏹';
  if (/sword|blade|dagger|sabre|saber/.test(n)) return '⚔️';
  if (type === 'weapon') return '⚔️';
  if (type === 'armor' || type === 'shield' || /armou?r|mail|shield|helm/.test(n)) return '🛡️';
  if (verb === 'read' || /inscription|writing|sign|note|book|tome/.test(n)) return '📖';
  return '◆';
}

// Swap an object tile's emoji for painted item art when one exists for its slug.
// Resolves the slug from the matched room item, else slugifies the object name.
function applyObjectArt(iconEl, object) {
  const item = _roomItems.find((i) => norm(i.name) === norm(object) || norm(i.slug) === norm(object));
  const slug = item?.slug || norm(object).replace(/\s+/g, '-');
  if (!slug) return;
  const img = new Image();
  img.className = 'obj-art';
  img.alt = '';
  img.onload = () => { iconEl.textContent = ''; iconEl.appendChild(img); };
  img.src = `scenes/items/${slug}.png`;
}

function send(text) {
  choicesArea.classList.remove('visible');
  objectTiles.classList.remove('visible');
  pendingChoices = [];
  inputEl.value = text; // send the original command, not the formatted label
  if (_sendFn) _sendFn();
}

export function renderChoices() {
  choicesArea.innerHTML = '';
  objectTiles.innerHTML = '';

  const tiles = [];
  const actions = [];
  for (const text of pendingChoices) {
    const parsed = parseItemChoice(text);
    if (parsed) tiles.push({ text, ...parsed });
    else actions.push(text);
  }

  // Object tiles (the room's interactive things)
  for (const { text, verb, object } of tiles) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'obj-tile line-enter';
    const icon = document.createElement('div'); icon.className = 'obj-icon'; icon.textContent = objectGlyph(object, verb);
    applyObjectArt(icon, object);
    const name = document.createElement('div'); name.className = 'obj-name'; name.textContent = titleCaseWords(object);
    const tag = document.createElement('div'); tag.className = 'obj-verb'; tag.textContent = VERB_LABELS[verb] ?? verb;
    tile.append(icon, name, tag);
    tile.addEventListener('click', () => send(text));
    objectTiles.appendChild(tile);
  }
  objectTiles.classList.toggle('visible', tiles.length > 0);

  // Action buttons (move / talk / attack / hall / shop)
  for (const text of actions) {
    const card = document.createElement('div');
    card.className = 'choice-card';
    card.textContent = formatActionLabel(text);
    card.addEventListener('click', () => send(text));
    choicesArea.appendChild(card);
  }
  choicesArea.classList.toggle('visible', actions.length > 0);
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
