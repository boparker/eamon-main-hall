// shop.js — Shop scene: shopkeeper portrait + item tile grid (Buy/Sell tabs).
// Driven by the server's shop state ({ key, title, items }); replaces the old
// slide-out tray. Tile clicks submit "Buy <name>" / "Sell <name>" through the
// normal input path (registerPurchaseHandler), so the engine stays authoritative.

import { state } from './state.js';

const VENDOR_INFO = {
  marcos: { name: 'Marcos Cavielli', glyph: '⚒', greeting: '"Well met! What do you need?"' },
};

let _onPurchase = null;
export function registerPurchaseHandler(fn) { _onPurchase = fn; }

function normalizeShopPayload(shopOrKey) {
  if (typeof shopOrKey === 'string') return { key: shopOrKey, title: shopOrKey, items: [] };
  if (!shopOrKey || !Array.isArray(shopOrKey.items)) return null;
  return shopOrKey;
}

function itemIcon(item) {
  const t = String(item.stats?.type ?? item.category ?? '').toLowerCase();
  if (/shield/.test(t) || item.equipmentSlot === 'shield') return '🛡';
  if (/armor/.test(t) || item.equipmentSlot === 'armor') return '🥋';
  if (/spell|scroll|potion/.test(t)) return '✦';
  if (/axe/.test(t)) return '🪓';
  if (/bow/.test(t)) return '🏹';
  if (/mace|hammer|club/.test(t)) return '🔨';
  if (/spear|halberd/.test(t)) return '🔱';
  return '⚔';
}

function statText(item) {
  const s = item.stats ?? {};
  if (s.damage) return `DMG ${String(s.damage).toUpperCase()}`;
  if (s.armorClass != null) return `AC ${s.armorClass}`;
  if (s.defense) return `DEF ${s.defense}`;
  return s.type ?? item.category ?? '';
}

function catLabel(text) {
  const el = document.createElement('div');
  el.className = 'shop-cat-label';
  el.textContent = text;
  return el;
}

function tile(item, action) {
  const base = item.price ?? item.value ?? 0;
  const price = action === 'sell' ? Math.floor(base / 2) : base;
  const gold = state.character?.gold ?? 0;
  const afford = action === 'sell' || gold >= price;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'shop-tile' + (afford ? '' : ' cant-afford');
  const icon = document.createElement('div'); icon.className = 'tile-icon'; icon.textContent = itemIcon(item);
  const name = document.createElement('div'); name.className = 'tile-name'; name.textContent = item.name;
  const stat = document.createElement('div'); stat.className = 'tile-stat'; stat.textContent = statText(item);
  const pr = document.createElement('div'); pr.className = 'tile-price'; pr.textContent = `${action === 'sell' ? '+' : ''}${price} g`;
  btn.append(icon, name, stat, pr);
  if (afford) {
    btn.addEventListener('click', () => { if (_onPurchase) _onPurchase(`${action === 'sell' ? 'Sell' : 'Buy'} ${item.name}`); });
  }
  return btn;
}

let currentShop = null;
let currentTab = 'buy';

function renderGrid() {
  const grid = document.getElementById('shop-grid');
  if (!grid) return;
  document.querySelectorAll('#shop-tabs .shop-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === currentTab));
  document.getElementById('shop-scene-gold').textContent = state.character?.gold ?? 0;
  grid.replaceChildren();

  if (currentTab === 'buy') {
    const items = currentShop?.items ?? [];
    const weapons = items.filter((i) => i.category === 'weapon');
    const armor = items.filter((i) => i.category !== 'weapon');
    if (weapons.length) { grid.appendChild(catLabel('⚔ Weapons')); weapons.forEach((i) => grid.appendChild(tile(i, 'buy'))); }
    if (armor.length) { grid.appendChild(catLabel('🛡 Armor & Shields')); armor.forEach((i) => grid.appendChild(tile(i, 'buy'))); }
  } else {
    const inv = (state.character?.inventory ?? []).filter((i) => i?.type !== 'treasure' && Number.isFinite(i?.price ?? i?.value));
    if (inv.length) inv.forEach((i) => grid.appendChild(tile(i, 'sell')));
    else grid.appendChild(catLabel('Your pack is empty.'));
  }
}

export function openShop(shopOrKey) {
  const shop = normalizeShopPayload(shopOrKey);
  if (!shop) return;
  const gs = document.getElementById('game-screen');
  const wasShopping = gs?.classList.contains('shopping');
  currentShop = shop;
  if (!wasShopping) currentTab = 'buy'; // reset to Buy only on first entry, not re-renders

  const info = VENDOR_INFO[shop.key] ?? { name: shop.title ?? 'Shopkeeper', glyph: '⚒', greeting: '' };
  document.getElementById('shopkeeper-name').textContent = info.name;
  document.getElementById('shopkeeper-line').textContent = info.greeting;
  const ph = document.querySelector('#shopkeeper-portrait .portrait-placeholder');
  if (ph) ph.textContent = info.glyph;

  renderGrid();
  document.getElementById('shop-scene').hidden = false;
  gs?.classList.add('shopping');
}

export function closeShop() {
  const scene = document.getElementById('shop-scene');
  if (scene) scene.hidden = true;
  document.getElementById('game-screen')?.classList.remove('shopping');
}

// Tabs + leave — wired once at load (elements are static in index.html).
document.getElementById('shop-tabs')?.addEventListener('click', (event) => {
  const tab = event.target.closest('.shop-tab');
  if (tab && tab.dataset.tab !== currentTab) { currentTab = tab.dataset.tab; renderGrid(); }
});
document.getElementById('shop-leave-btn')?.addEventListener('click', () => { if (_onPurchase) _onPurchase('Return to Great Hall'); });
