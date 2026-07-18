// pack.js — the adventurer's pack, made visible. The `inventory` text command
// still works, but a cursed jewel or a burning sword you FORGOT you were
// carrying deserves better than a wall of text. Toggled by the HUD pack
// button or the I key; refreshes from every response's state.character.

let _character = null;

const TYPE_GLYPH = { weapon: '⚔', armor: '🛡', potion: '🧪', scroll: '📜', treasure: '💎', tool: '🪶', container: '🧰', misc: '◆' };

export function updatePack(state) {
  if (state && Object.prototype.hasOwnProperty.call(state, 'character')) {
    _character = state.character ?? _character;
  }
  const btn = document.getElementById('hud-pack-btn');
  if (btn) btn.hidden = !_character;
  if (isOpen()) render();
}

function isOpen() {
  return !document.getElementById('pack-panel')?.hidden;
}

export function togglePack() {
  const el = document.getElementById('pack-panel');
  if (!el || !_character) return;
  if (el.hidden) { el.hidden = false; render(); } else { el.hidden = true; }
}

function close() {
  const el = document.getElementById('pack-panel');
  if (el) el.hidden = true;
}

function itemRow(item, equippedTag) {
  const row = document.createElement('div');
  row.className = 'pack-row';

  const art = document.createElement('div');
  art.className = 'pack-art';
  const img = document.createElement('img');
  img.src = `scenes/items/${item.slug}.png`;
  img.alt = '';
  img.onerror = () => { img.remove(); art.textContent = TYPE_GLYPH[item.type] ?? '◆'; };
  art.appendChild(img);

  const body = document.createElement('div');
  body.className = 'pack-body';
  const name = document.createElement('div');
  name.className = 'pack-name';
  name.textContent = item.name ?? item.slug;
  if (equippedTag) {
    const tag = document.createElement('span');
    tag.className = 'pack-tag';
    tag.textContent = equippedTag;
    name.appendChild(tag);
  }
  const detail = document.createElement('div');
  detail.className = 'pack-detail';
  const bits = [];
  if (item.damage_dice) bits.push(item.damage_dice + (item.magic ? ' ✦magic' : ''));
  if (Number.isFinite(item.value) && item.value > 0) bits.push(`${item.value} gold`);
  if (item.type && !item.damage_dice) bits.push(item.type);
  detail.textContent = bits.join(' · ');
  body.append(name, detail);

  row.append(art, body);
  return row;
}

function render() {
  const list = document.getElementById('pack-list');
  const goldEl = document.getElementById('pack-gold');
  if (!list || !_character) return;
  list.replaceChildren();

  const eq = _character.equipment ?? {};
  const equippedSlugs = new Map();
  if (eq.weapon?.slug) equippedSlugs.set(eq.weapon.slug, 'wielded');
  if (eq.armor?.slug) equippedSlugs.set(eq.armor.slug, 'worn');

  // Equipped first (even if not duplicated in inventory), then the pack.
  for (const [slot, tag] of [['weapon', 'wielded'], ['armor', 'worn']]) {
    if (eq[slot]?.slug) list.appendChild(itemRow(eq[slot], tag));
  }
  const inventory = Array.isArray(_character.inventory) ? _character.inventory : [];
  const shown = new Set([eq.weapon?.slug, eq.armor?.slug].filter(Boolean));
  for (const item of inventory) {
    if (shown.has(item?.slug)) continue;
    list.appendChild(itemRow(item, equippedSlugs.get(item?.slug)));
  }
  if (!list.children.length) {
    const empty = document.createElement('div');
    empty.className = 'pack-empty';
    empty.textContent = 'Your pack is empty.';
    list.appendChild(empty);
  }
  if (goldEl) goldEl.textContent = `${_character.gold ?? 0} gold in hand`;
}

export function initPack() {
  document.getElementById('hud-pack-btn')?.addEventListener('click', togglePack);
  document.getElementById('pack-close')?.addEventListener('click', close);
  document.getElementById('pack-panel')?.addEventListener('click', (e) => {
    if (e.target.id === 'pack-panel') close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { close(); return; }
    const typing = /^(input|textarea)$/i.test(document.activeElement?.tagName ?? '');
    if (typing) return;
    if (e.key === 'i' || e.key === 'I') togglePack();
  });
}
