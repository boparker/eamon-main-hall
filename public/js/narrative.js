// narrative.js — Text rendering, streaming tokens, scroll management

const scroll = document.getElementById('narrative-scroll');
let activeStreamLine = null;

// Render deterministic response text as separate lines, styling section labels
// ("You see", "Items here", "Exits", equipment labels) so they stand out from
// the prose.
const SECTION_LABEL = /^(You see|Items here|Exits|You can read|Equipped|Inventory|Gold|Bank)\s*:\s*(.*)$/;

export function renderNarrative(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const div = document.createElement('div');
    div.className = 'narrative-line line-enter';
    const match = SECTION_LABEL.exec(line);
    if (match) {
      const label = document.createElement('span');
      label.className = 'nl-label';
      label.textContent = match[1] + ':';
      div.append(label, document.createTextNode(match[2] ? ' ' + match[2] : ''));
    } else {
      div.textContent = line;
    }
    scroll.appendChild(div);
  }
  scroll.scrollTop = scroll.scrollHeight;
}

export function addPlayerLine(text) {
  const div = document.createElement('div');
  div.className = 'narrative-line player-line line-enter';
  div.textContent = text;
  scroll.appendChild(div);
  scroll.scrollTop = scroll.scrollHeight;
}

export function startStreamLine() {
  activeStreamLine = document.createElement('div');
  activeStreamLine.className = 'narrative-line line-enter';
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  cursor.id = 'stream-cursor';
  activeStreamLine.appendChild(cursor);
  scroll.appendChild(activeStreamLine);
  scroll.scrollTop = scroll.scrollHeight;
}

export function appendStreamToken(token) {
  const cursor = document.getElementById('stream-cursor');
  if (cursor) cursor.before(document.createTextNode(token));
  scroll.scrollTop = scroll.scrollHeight;
}

export function appendActionText(text) {
  const cursor = document.getElementById('stream-cursor');
  if (!cursor) return;
  const span = document.createElement('span');
  span.className = 'action-highlight';
  span.textContent = text;
  cursor.before(span);
  scroll.scrollTop = scroll.scrollHeight;
}

export function finishStreamLine() {
  const cursor = document.getElementById('stream-cursor');
  if (cursor) cursor.remove();
  activeStreamLine = null;
}
