// narrative.js — Text rendering, streaming tokens, scroll management

const scroll = document.getElementById('narrative-scroll');
let activeStreamLine = null;

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
