// journal-map.js — the adventurer's hand-drawn map. Fog-of-war data arrives
// from the server (visited rooms only; unexplored exits are nameless stubs);
// this module just inks it. Toggled by the HUD compass or the M key, only
// while on an adventure. With the Chronicler's Quill, rooms carry marginalia
// pulled from the character's own chronicle.

let mapData = null;

const CELL_W = 148;
const CELL_H = 96;
const ROOM_W = 116;
const ROOM_H = 46;
const STUB_LEN = 26;

const DIR_VEC = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

export function updateJournalMap(state) {
  const btn = document.getElementById('hud-map-btn');
  if (state?.phase === 'adventure' && state?.map) {
    mapData = state.map;
    if (btn) btn.hidden = false;
    if (isOpen()) render(); // live-refresh if the player walks with it open
  } else if (state?.phase && state.phase !== 'adventure') {
    mapData = null;
    if (btn) btn.hidden = true;
    close();
  }
}

function isOpen() {
  return !document.getElementById('journal-map')?.hidden;
}

export function toggleJournalMap() {
  if (!mapData) return;
  const el = document.getElementById('journal-map');
  if (!el) return;
  if (el.hidden) { render(); el.hidden = false; } else { el.hidden = true; }
}

function close() {
  const el = document.getElementById('journal-map');
  if (el) el.hidden = true;
}

function svgEl(tag, attrs = {}, text = null) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}

function center(node, minX, minY) {
  return {
    cx: (node.x - minX) * CELL_W + CELL_W / 2,
    cy: (node.y - minY) * CELL_H + CELL_H / 2,
  };
}

function render() {
  const host = document.getElementById('journal-map-canvas');
  const title = document.getElementById('journal-map-title');
  const legend = document.getElementById('journal-map-legend');
  if (!host || !mapData) return;

  // Draw the level the adventurer is standing on.
  const currentZ = mapData.nodes.find((n) => n.current)?.z ?? 0;
  const nodes = mapData.nodes.filter((n) => n.z === currentZ);
  const levels = new Set(mapData.nodes.map((n) => n.z));
  const byRoom = new Map(nodes.map((n) => [n.room, n]));

  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x));
  const maxY = Math.max(...nodes.map((n) => n.y));
  const width = (maxX - minX + 1) * CELL_W;
  const height = (maxY - minY + 1) * CELL_H;
  const PAD = 46;

  title.textContent = mapData.title;
  legend.textContent = mapData.quill
    ? 'Inked by the Chronicler’s Quill'
    : 'Rooms appear as you walk them';
  if (levels.size > 1) legend.textContent += ` · depth ${currentZ}`;

  const svg = svgEl('svg', {
    viewBox: `${-PAD} ${-PAD} ${width + PAD * 2} ${height + PAD * 2}`,
    class: 'jm-svg', role: 'img', 'aria-label': 'Journal map of explored rooms',
  });

  // Corridors first (under the rooms).
  for (const edge of mapData.edges) {
    const a = byRoom.get(edge.from);
    const b = byRoom.get(edge.to);
    if (!a || !b) continue; // spans levels — drawn as stairs glyph via stubs
    const ca = center(a, minX, minY);
    const cb = center(b, minX, minY);
    svg.appendChild(svgEl('line', { x1: ca.cx, y1: ca.cy, x2: cb.cx, y2: cb.cy, class: 'jm-corridor' }));
  }

  // Unexplored stubs: a short fading dash out of the room's edge.
  for (const stub of mapData.stubs) {
    const node = byRoom.get(stub.room);
    const vec = DIR_VEC[stub.direction];
    if (!node) continue;
    const { cx, cy } = center(node, minX, minY);
    if (vec) {
      const x1 = cx + vec[0] * (ROOM_W / 2);
      const y1 = cy + vec[1] * (ROOM_H / 2);
      const x2 = x1 + vec[0] * STUB_LEN;
      const y2 = y1 + vec[1] * STUB_LEN;
      svg.appendChild(svgEl('line', { x1, y1, x2, y2, class: stub.out ? 'jm-stub jm-out' : 'jm-stub' }));
      if (stub.out) {
        svg.appendChild(svgEl('text', { x: x2 + vec[0] * 8, y: y2 + vec[1] * 10, class: 'jm-out-label', 'text-anchor': 'middle' }, 'way out'));
      }
    } else if (stub.direction === 'up' || stub.direction === 'down') {
      svg.appendChild(svgEl('text', { x: cx + ROOM_W / 2 - 8, y: cy - ROOM_H / 2 + 12, class: 'jm-stairs' }, stub.direction === 'up' ? '▴' : '▾'));
    }
  }

  // Rooms.
  for (const node of nodes) {
    const { cx, cy } = center(node, minX, minY);
    const g = svgEl('g', { class: node.current ? 'jm-room jm-current' : 'jm-room' });
    g.appendChild(svgEl('rect', {
      x: cx - ROOM_W / 2, y: cy - ROOM_H / 2, width: ROOM_W, height: ROOM_H, rx: 3,
    }));
    const hasNote = mapData.quill && node.notes?.length;
    g.appendChild(svgEl('text', {
      x: cx, y: hasNote ? cy - 1 : cy + 4, class: 'jm-name', 'text-anchor': 'middle',
    }, node.name));
    if (hasNote) {
      g.appendChild(svgEl('text', {
        x: cx, y: cy + 14, class: 'jm-note', 'text-anchor': 'middle',
      }, node.notes.join(' · ')));
    }
    svg.appendChild(g);
  }

  host.replaceChildren(svg);
}

export function initJournalMap() {
  document.getElementById('hud-map-btn')?.addEventListener('click', toggleJournalMap);
  document.getElementById('journal-map-close')?.addEventListener('click', close);
  document.getElementById('journal-map')?.addEventListener('click', (e) => {
    if (e.target.id === 'journal-map') close(); // click the vellum margin to put it away
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { close(); return; } // works even from the input
    const typing = /^(input|textarea)$/i.test(document.activeElement?.tagName ?? '');
    if (typing) return;
    if (e.key === 'm' || e.key === 'M') toggleJournalMap();
  });
}
