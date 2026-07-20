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

// Pure corridor chooser — exported for unit tests. Returns a draw descriptor:
//   { kind: 'line' } | { kind: 'elbow', corner: 'vh'|'hv' } | { kind: 'bow' }
// Elbows that would slash through another room's cell, and spans of 3+ cells,
// become bowed solid curves so the ink never pretends to run through a chamber.
export function chooseCorridorPath(a, b, others = []) {
  const md = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  if (a.x === b.x || a.y === b.y) {
    if (md >= 3 && segmentHitsRoom(a.x, a.y, b.x, b.y, a, b, others)) return { kind: 'bow' };
    return { kind: 'line' };
  }
  if (md >= 3) return { kind: 'bow' };
  const vhClear = !elbowHitsRooms(a, b, 'vh', others);
  const hvClear = !elbowHitsRooms(a, b, 'hv', others);
  if (vhClear) return { kind: 'elbow', corner: 'vh' };
  if (hvClear) return { kind: 'elbow', corner: 'hv' };
  return { kind: 'bow' };
}

function cellOnSegment(x, y, x1, y1, x2, y2) {
  if (x1 === x2) {
    return x === x1 && y > Math.min(y1, y2) && y < Math.max(y1, y2);
  }
  if (y1 === y2) {
    return y === y1 && x > Math.min(x1, x2) && x < Math.max(x1, x2);
  }
  return false;
}

function segmentHitsRoom(x1, y1, x2, y2, a, b, others) {
  for (const o of others) {
    if (o.room === a.room || o.room === b.room) continue;
    if (o.z !== a.z) continue;
    if (cellOnSegment(o.x, o.y, x1, y1, x2, y2)) return true;
  }
  return false;
}

function elbowHitsRooms(a, b, corner, others) {
  // vh: vertical then horizontal through (a.x, b.y); hv: horizontal then vertical through (b.x, a.y)
  const cx = corner === 'vh' ? a.x : b.x;
  const cy = corner === 'vh' ? b.y : a.y;
  for (const o of others) {
    if (o.room === a.room || o.room === b.room) continue;
    if (o.z !== a.z) continue;
    if (o.x === cx && o.y === cy) return true;
    if (corner === 'vh') {
      if (cellOnSegment(o.x, o.y, a.x, a.y, a.x, b.y)) return true;
      if (cellOnSegment(o.x, o.y, a.x, b.y, b.x, b.y)) return true;
    } else {
      if (cellOnSegment(o.x, o.y, a.x, a.y, b.x, a.y)) return true;
      if (cellOnSegment(o.x, o.y, b.x, a.y, b.x, b.y)) return true;
    }
  }
  return false;
}

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
  if (el.hidden) { el.hidden = false; render(); } else { el.hidden = true; } // unhide BEFORE render: scroll-to-center needs layout
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

  // The frame is the FULL canonical map — constant from the first room to
  // the last. Unexplored space is parchment, not void.
  const minX = 0;
  const minY = 0;
  const width = (mapData.extent?.w ?? Math.max(...nodes.map((n) => n.x)) + 1) * CELL_W;
  const height = (mapData.extent?.h ?? Math.max(...nodes.map((n) => n.y)) + 1) * CELL_H;
  const PAD = 46;

  title.textContent = mapData.title;
  const explored = mapData.nodes?.length ?? 0;
  const frame = (mapData.extent?.w ?? 0) * (mapData.extent?.h ?? 0);
  legend.textContent = mapData.quill
    ? 'Inked by the Chronicler’s Quill'
    : 'Rooms appear as you walk them';
  if (levels.size > 1) legend.textContent += ` · depth ${currentZ}`;
  if (frame > explored) legend.textContent += ` · ${explored} rooms charted`;

  const help = document.getElementById('journal-map-help');
  if (help) {
    help.textContent = mapData.quill
      ? 'Blank parchment is unexplored ground — walk rooms to ink them. Dashed stubs mark untaken exits; violet dashes are true warps in the old maps. Your Quill pins deeds beside the rooms. Drag or use the arrows to survey. M or Esc closes the chart.'
      : 'Blank parchment is unexplored ground — walk rooms to ink them. Dashed stubs mark exits you have not taken. Drag or use the arrows to survey the chart. Press M or Esc to close.';
  }

  // Fixed scale: rooms stay readable no matter how large the map grows; the
  // panel scrolls both axes and centers on the current room instead of
  // shrinking 92 rooms into confetti.
  const svg = svgEl('svg', {
    viewBox: `${-PAD} ${-PAD} ${width + PAD * 2} ${height + PAD * 2}`,
    width: width + PAD * 2, height: height + PAD * 2,
    class: 'jm-svg', role: 'img', 'aria-label': 'Journal map of explored rooms',
  });
  // Parchment ground + faint survey grid: unexplored space reads as paper
  // waiting for ink, not as emptiness.
  svg.appendChild(svgEl('rect', { x: -PAD, y: -PAD, width: width + PAD * 2, height: height + PAD * 2, class: 'jm-parchment' }));
  for (let gx = 0; gx <= width; gx += CELL_W) {
    svg.appendChild(svgEl('line', { x1: gx, y1: -PAD, x2: gx, y2: height + PAD, class: 'jm-grid' }));
  }
  for (let gy = 0; gy <= height; gy += CELL_H) {
    svg.appendChild(svgEl('line', { x1: -PAD, y1: gy, x2: width + PAD, y2: gy, class: 'jm-grid' }));
  }

  // Corridors first (under the rooms). Short clear passages draw as straight
  // or elbow ink; spans that would slash through a chamber (or stretch across
  // 3+ cells) bow around. ONLY server-flagged warp edges use dashed violet.
  for (const edge of mapData.edges) {
    const a = byRoom.get(edge.from);
    const b = byRoom.get(edge.to);
    if (!a || !b) continue; // spans levels — drawn as stairs glyph via stubs
    const ca = center(a, minX, minY);
    const cb = center(b, minX, minY);
    if (edge.warp) {
      const mx = (ca.cx + cb.cx) / 2 + 30;
      const my = (ca.cy + cb.cy) / 2 - 30;
      svg.appendChild(svgEl('path', { d: `M ${ca.cx} ${ca.cy} Q ${mx} ${my} ${cb.cx} ${cb.cy}`, class: 'jm-warp', fill: 'none' }));
      continue;
    }
    const path = chooseCorridorPath(a, b, nodes);
    if (path.kind === 'line') {
      svg.appendChild(svgEl('line', { x1: ca.cx, y1: ca.cy, x2: cb.cx, y2: cb.cy, class: 'jm-corridor' }));
    } else if (path.kind === 'elbow' && path.corner === 'vh') {
      svg.appendChild(svgEl('path', { d: `M ${ca.cx} ${ca.cy} L ${ca.cx} ${cb.cy} L ${cb.cx} ${cb.cy}`, class: 'jm-corridor', fill: 'none' }));
    } else if (path.kind === 'elbow' && path.corner === 'hv') {
      svg.appendChild(svgEl('path', { d: `M ${ca.cx} ${ca.cy} L ${cb.cx} ${ca.cy} L ${cb.cx} ${cb.cy}`, class: 'jm-corridor', fill: 'none' }));
    } else {
      // Bow away from the axis-aligned midpoint so stretched passages read as
      // intentional ink, not as a hallway through someone else's room.
      const mx = (ca.cx + cb.cx) / 2 + Math.sign(cb.cy - ca.cy || 1) * 36;
      const my = (ca.cy + cb.cy) / 2 - Math.sign(cb.cx - ca.cx || 1) * 36;
      svg.appendChild(svgEl('path', { d: `M ${ca.cx} ${ca.cy} Q ${mx} ${my} ${cb.cx} ${cb.cy}`, class: 'jm-corridor', fill: 'none' }));
    }
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

  // Long names wrap to two measured lines inside the box (SVG text does not
  // wrap on its own); anything longer ellipsizes.
  const LINE_CHARS = 17; // ~6.2px/char at 11.5px in a 116px box with padding
  function wrapName(name) {
    const words = String(name).split(/\s+/);
    const lines = [''];
    for (const word of words) {
      const line = lines[lines.length - 1];
      if (line && (line + ' ' + word).length > LINE_CHARS) lines.push(word);
      else lines[lines.length - 1] = line ? line + ' ' + word : word;
    }
    if (lines.length > 2) {
      lines.length = 2;
      lines[1] = lines[1].slice(0, LINE_CHARS - 1).replace(/\s+\S*$/, '') + '…';
    }
    return lines.map((l) => (l.length > LINE_CHARS ? l.slice(0, LINE_CHARS - 1) + '…' : l));
  }

  // Rooms.
  for (const node of nodes) {
    const { cx, cy } = center(node, minX, minY);
    const g = svgEl('g', { class: node.current ? 'jm-room jm-current' : 'jm-room' });
    g.appendChild(svgEl('rect', {
      x: cx - ROOM_W / 2, y: cy - ROOM_H / 2, width: ROOM_W, height: ROOM_H, rx: 3,
    }));
    const quillNotes = mapData.quill && node.notes?.length ? node.notes : [];
    const own = node.playerNotes?.length ? node.playerNotes : [];
    const noteLine = [...own.map((n) => `✎ ${n}`), ...quillNotes].join(' · ');
    const hasNote = noteLine.length > 0;
    const lines = wrapName(node.name);
    const nameEl = svgEl('text', { x: cx, class: 'jm-name', 'text-anchor': 'middle' });
    // Vertical layout: center the block — 1 line sits mid-box; 2 lines split it;
    // a quill note pushes the name up a notch.
    const two = lines.length === 2;
    const baseY = hasNote ? (two ? cy - 10 : cy - 4) : (two ? cy - 4 : cy + 4);
    lines.forEach((line, i) => {
      nameEl.appendChild(svgEl('tspan', { x: cx, y: baseY + i * 12 }, line));
    });
    g.appendChild(nameEl);
    if (hasNote) {
      const trimmed = noteLine.length > 19 ? noteLine.slice(0, 18) + '…' : noteLine;
      g.appendChild(svgEl('text', {
        x: cx, y: cy + (two ? 17 : 14), class: 'jm-note', 'text-anchor': 'middle',
      }, trimmed));
    }
    svg.appendChild(g);
  }

  host.replaceChildren(svg);

  // Scroll the current room to the center of the visible survey pane.
  const pane = document.getElementById('journal-map-scroll') ?? host.closest('.jm-scroll') ?? host;
  const current = nodes.find((n) => n.current);
  if (current) {
    const { cx, cy } = center(current, minX, minY);
    pane.scrollLeft = cx + PAD - pane.clientWidth / 2;
    pane.scrollTop = cy + PAD - pane.clientHeight / 2;
  }
  updateScrollCues();
}

function updateScrollCues() {
  const pane = document.getElementById('journal-map-scroll');
  if (!pane) return;
  const edge = 8;
  const canL = pane.scrollLeft > edge;
  const canR = pane.scrollLeft + pane.clientWidth < pane.scrollWidth - edge;
  const canU = pane.scrollTop > edge;
  const canD = pane.scrollTop + pane.clientHeight < pane.scrollHeight - edge;
  const set = (dir, on) => {
    const el = document.querySelector(`.jm-cue-${dir}`);
    if (el) el.hidden = !on;
  };
  set('w', canL); set('e', canR); set('n', canU); set('s', canD);
}

function nudgeScroll(dir) {
  const pane = document.getElementById('journal-map-scroll');
  if (!pane) return;
  const stepX = Math.max(120, Math.floor(pane.clientWidth * 0.45));
  const stepY = Math.max(90, Math.floor(pane.clientHeight * 0.45));
  if (dir === 'n') pane.scrollBy({ top: -stepY, behavior: 'smooth' });
  if (dir === 's') pane.scrollBy({ top: stepY, behavior: 'smooth' });
  if (dir === 'w') pane.scrollBy({ left: -stepX, behavior: 'smooth' });
  if (dir === 'e') pane.scrollBy({ left: stepX, behavior: 'smooth' });
}

export function initJournalMap() {
  document.getElementById('hud-map-btn')?.addEventListener('click', toggleJournalMap);
  document.getElementById('journal-map-close')?.addEventListener('click', close);
  document.getElementById('journal-map')?.addEventListener('click', (e) => {
    if (e.target.id === 'journal-map') close(); // click the vellum margin to put it away
  });
  document.getElementById('journal-map-scroll')?.addEventListener('scroll', updateScrollCues, { passive: true });
  document.querySelectorAll('.jm-cue').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      nudgeScroll(btn.dataset.dir);
    });
  });
  window.addEventListener('resize', () => { if (isOpen()) updateScrollCues(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { close(); return; } // works even from the input
    const typing = /^(input|textarea)$/i.test(document.activeElement?.tagName ?? '');
    if (typing) return;
    if (e.key === 'm' || e.key === 'M') toggleJournalMap();
  });
}
