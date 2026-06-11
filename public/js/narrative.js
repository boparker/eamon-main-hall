// narrative.js — Text rendering, streaming tokens, scroll management
//
// Prose is grouped into "turns": one block per player action + its response.
// The newest turn stays bright and carries a gold "you are here" marker; older
// turns fade back, so the eye lands on where the story currently is. When a
// response opens on a room, that room's name is rendered as a header in the
// same display face as the scene's location title, making re-entry obvious.

const scroll = document.getElementById('narrative-scroll');
let activeStreamLine = null;
let activeTurn = null;

// Start a fresh turn block: dim whatever was bright, then open a new active one.
function newTurn() {
  for (const past of scroll.querySelectorAll('.narrative-turn.active')) {
    past.classList.remove('active');
    past.classList.add('past');
  }
  activeTurn = document.createElement('div');
  activeTurn.className = 'narrative-turn active';
  scroll.appendChild(activeTurn);
  return activeTurn;
}

function targetTurn() {
  return activeTurn ?? newTurn();
}

function toBottom() {
  scroll.scrollTop = scroll.scrollHeight;
}

const SECTION_LABEL = /^(You see|Items here|Exits|You can read|Equipped|Inventory|Gold|Bank)\s*:\s*(.*)$/;

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

// A prose line is the location header when it matches the scene's location
// title (or its primary segment before a " - " sub-location).
export function isLocationLine(line, locationTitle) {
  if (!locationTitle) return false;
  const main = String(locationTitle).split(/\s+[-–—|:]\s+/)[0];
  const l = normalize(line);
  return l === normalize(locationTitle) || l === normalize(main);
}

export function renderNarrative(text, opts = {}) {
  const locationTitle = opts.locationTitle ?? null;
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const turn = targetTurn();
  let locatedAlready = false;

  for (const line of lines) {
    const div = document.createElement('div');
    div.className = 'narrative-line line-enter';

    if (!locatedAlready && isLocationLine(line, locationTitle)) {
      div.classList.add('nl-location');
      div.textContent = line;
      locatedAlready = true;
      turn.appendChild(div);
      continue;
    }

    const match = SECTION_LABEL.exec(line);
    if (match) {
      const label = document.createElement('span');
      label.className = 'nl-label';
      label.textContent = match[1] + ':';
      div.append(label, document.createTextNode(match[2] ? ' ' + match[2] : ''));
    } else {
      div.textContent = line;
    }
    turn.appendChild(div);
  }
  toBottom();
}

export function addPlayerLine(text) {
  // A player action opens a new turn — the previous turn fades behind it.
  const turn = newTurn();
  const div = document.createElement('div');
  div.className = 'narrative-line player-line line-enter';
  div.textContent = text;
  turn.appendChild(div);
  toBottom();
}

export function startStreamLine() {
  activeStreamLine = document.createElement('div');
  activeStreamLine.className = 'narrative-line line-enter';
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  cursor.id = 'stream-cursor';
  activeStreamLine.appendChild(cursor);
  targetTurn().appendChild(activeStreamLine);
  toBottom();
}

export function appendStreamToken(token) {
  const cursor = document.getElementById('stream-cursor');
  if (cursor) cursor.before(document.createTextNode(token));
  toBottom();
}

export function appendActionText(text) {
  const cursor = document.getElementById('stream-cursor');
  if (!cursor) return;
  const span = document.createElement('span');
  span.className = 'action-highlight';
  span.textContent = text;
  cursor.before(span);
  toBottom();
}

export function finishStreamLine() {
  const cursor = document.getElementById('stream-cursor');
  if (cursor) cursor.remove();
  activeStreamLine = null;
}
