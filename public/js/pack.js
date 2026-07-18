// pack.js — the adventurer's pack, made visible. The `inventory` text command
// still works, but a cursed jewel or a burning sword you FORGOT you were
// carrying deserves better than a wall of text. Toggled by the HUD pack
// button or the I key; refreshes from every response's state.character.

let _character = null;
let _send = null; // registered by main.js: pipes a command through the input

export function registerPackHandler(fn) { _send = fn; }

const TYPE_GLYPH = { weapon: '⚔', armor: '🛡', potion: '🧪', scroll: '📜', treasure: '💎', tool: '🪶', container: '🧰', misc: '◆' };
const GROUP_ORDER = ['weapon', 'armor', 'potion', 'scroll', 'tool', 'treasure', 'misc', 'container'];
const GROUP_LABEL = { weapon: 'Arms', armor: 'Armour', potion: 'Potions', scroll: 'Scrolls & Writings', tool: 'Tools', treasure: 'Treasure', misc: 'Sundries', container: 'Sundries' };

// Items come in two dialects: adventure loot ({type, damage_dice}) and shop
// gear ({category, equipmentSlot, stats.damage}). Normalize before judging.
function kindOf(item) {
  const t = item.type ?? item.category;
  if (GROUP_ORDER.includes(t)) return t;
  if (item.equipmentSlot === 'weapon') return 'weapon';
  if (item.equipmentSlot === 'armor' || item.equipmentSlot === 'shield') return 'armor';
  return 'misc';
}

function diceOf(item) {
  return item.damage_dice ?? item.stats?.damage ?? null;
}

// What clicking an item can DO. The confirmation is the second tap: the row
// reveals its action button, the button does the deed. No dialogs.
function actionFor(item, equippedTag) {
  if (equippedTag) return null; // already wielded/worn
  const kind = kindOf(item);
  if (kind === 'weapon') return { label: 'Wield', command: `wield ${item.name}` };
  if (kind === 'armor') return { label: item.equipmentSlot === 'shield' ? 'Ready' : 'Wear', command: `wear ${item.name}` };
  if (kind === 'potion') return { label: 'Drink', command: `drink ${item.name}` };
  return null;
}

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
  const dice = diceOf(item);
  if (dice) bits.push(dice + (item.magic ? ' ✦magic' : ''));
  if (item.stats?.defense) bits.push(`defense ${item.stats.defense}`);
  if (Number.isFinite(item.value) && item.value > 0) bits.push(`${item.value} gold`);
  if (!dice && !item.stats?.defense) bits.push(kindOf(item));
  detail.textContent = bits.join(' · ');
  body.append(name, detail);

  row.append(art, body);

  const action = actionFor(item, equippedTag);
  if (action && _send) {
    row.classList.add('actionable');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pack-act';
    btn.textContent = action.label;
    btn.hidden = true;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      close();
      _send(action.command);
    });
    row.appendChild(btn);
    row.addEventListener('click', () => {
      // First tap arms the row (and disarms siblings); the button is the confirm.
      const wasArmed = !btn.hidden;
      document.querySelectorAll('.pack-act').forEach((b) => { b.hidden = true; });
      document.querySelectorAll('.pack-row.armed').forEach((r) => r.classList.remove('armed'));
      if (!wasArmed) { btn.hidden = false; row.classList.add('armed'); }
    });
  }
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

  // Grouped by type: equipped gear leads its group; groups in fixed order.
  const inventory = Array.isArray(_character.inventory) ? _character.inventory : [];
  const shown = new Set([eq.weapon?.slug, eq.armor?.slug].filter(Boolean));
  const groups = new Map();
  const put = (groupKey, item, tag) => {
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)[tag ? 'unshift' : 'push']([item, tag]);
  };
  if (eq.weapon?.slug) put('weapon', eq.weapon, 'wielded');
  if (eq.armor?.slug) put('armor', eq.armor, 'worn');
  for (const item of inventory) {
    if (!item || shown.has(item.slug)) continue;
    put(kindOf(item), item, equippedSlugs.get(item.slug));
  }
  for (const key of GROUP_ORDER) {
    const entries = groups.get(key);
    if (!entries?.length) continue;
    const header = document.createElement('div');
    header.className = 'pack-group';
    header.textContent = GROUP_LABEL[key] ?? key;
    list.appendChild(header);
    for (const [item, tag] of entries) list.appendChild(itemRow(item, tag));
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
    if (e.target.id === 'pack-panel') { close(); return; }
    // A click on anything that is not an actionable row disarms armed rows.
    if (!e.target.closest?.('.pack-row.actionable')) {
      document.querySelectorAll('.pack-act').forEach((b) => { b.hidden = true; });
      document.querySelectorAll('.pack-row.armed').forEach((r) => r.classList.remove('armed'));
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { close(); return; }
    const typing = /^(input|textarea)$/i.test(document.activeElement?.tagName ?? '');
    if (typing) return;
    if (e.key === 'i' || e.key === 'I') togglePack();
  });
}
