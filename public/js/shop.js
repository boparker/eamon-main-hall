// shop.js — Shop scene: shopkeeper portrait + item tile grid (Buy/Sell tabs).
// Driven by the server's shop state ({ key, title, items }); replaces the old
// slide-out tray. Tile clicks submit "Buy <name>" / "Sell <name>" through the
// normal input path (registerPurchaseHandler), so the engine stays authoritative.

import { state } from './state.js';
import { confirmAction } from './confirm.js';

const VENDOR_INFO = {
  marcos: { name: 'Marcos Cavielli', glyph: '⚒', greeting: '"Well met! What do you need?"' },
  pack: { name: 'Your Pack', glyph: '🎒', greeting: 'Ready your finds, or sell loot for gold.' },
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
  if (s.damage) {
    const odds = Number(s.weaponOdds);
    const oddsStr = Number.isFinite(odds) && odds !== 0 ? ` · ${odds > 0 ? '+' : ''}${odds}%` : '';
    return `DMG ${String(s.damage).toUpperCase()}${oddsStr}`;
  }
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
  btn.className = 'shop-tile' + (afford ? '' : ' cant-afford') + (item.magic ? ' magic' : '');
  const icon = document.createElement('div'); icon.className = 'tile-icon'; icon.textContent = itemIcon(item);
  const name = document.createElement('div'); name.className = 'tile-name'; name.textContent = item.name;
  const stat = document.createElement('div'); stat.className = 'tile-stat'; stat.textContent = statText(item);
  const pr = document.createElement('div'); pr.className = 'tile-price'; pr.textContent = `${action === 'sell' ? '+' : ''}${price} g`;
  btn.append(icon, name, stat, pr);
  if (afford) {
    btn.addEventListener('click', () => {
      const verb = action === 'sell' ? 'Sell' : 'Buy';
      const msg = action === 'sell' ? `Sell ${item.name} for ${price} gold?` : `Buy ${item.name} for ${price} gold?`;
      confirmAction(msg, () => { if (_onPurchase) _onPurchase(`${verb} ${item.name}`); });
    });
  }
  return btn;
}

let currentShop = null;
let currentTab = 'buy';

// One tile in the pack view: equippable gear offers "Equip" (or shows "Equipped"),
// everything else offers "Sell" for half its value.
function packTile(item, isEquipped) {
  const value = item.price ?? item.value ?? 0;
  const slot = item.equipmentSlot ?? ({ weapon: 'weapon', armor: 'armor', shield: 'shield' }[item.type] ?? null);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'shop-tile' + (item.magic ? ' magic' : '');
  const icon = document.createElement('div'); icon.className = 'tile-icon'; icon.textContent = itemIcon(item);
  const name = document.createElement('div'); name.className = 'tile-name'; name.textContent = item.name;
  const stat = document.createElement('div'); stat.className = 'tile-stat'; stat.textContent = statText(item) || `worth ${value}g`;
  const action = document.createElement('div'); action.className = 'tile-price';
  btn.append(icon, name, stat, action);

  const heal = item.heal ?? item.heal_amount;
  if (isEquipped) {
    action.textContent = '✓ Equipped';
    btn.classList.add('cant-afford'); // dim, no action
  } else if (item.type === 'potion') {
    action.textContent = heal ? `Drink (+${heal})` : 'Drink';
    stat.textContent = 'healing draught';
    btn.addEventListener('click', () => {
      confirmAction(`Drink ${item.name}?`, () => { if (_onPurchase) _onPurchase(`drink ${item.name}`); });
    });
  } else if (slot) {
    action.textContent = 'Equip'; // harmless — no confirm
    btn.addEventListener('click', () => { if (_onPurchase) _onPurchase(`ready ${item.name}`); });
  } else {
    const sellFor = Math.floor(value / 2);
    action.textContent = `Sell +${sellFor}g`;
    btn.addEventListener('click', () => {
      confirmAction(`Sell ${item.name} for ${sellFor} gold?`, () => { if (_onPurchase) _onPurchase(`sell ${item.name}`); });
    });
  }
  return btn;
}

function renderPack(grid) {
  const inv = state.character?.inventory ?? [];
  const equipped = new Set(Object.values(state.character?.equipment ?? {}).map((e) => e?.slug).filter(Boolean));
  if (!inv.length) { grid.appendChild(catLabel('Your pack is empty.')); return; }
  const gear = inv.filter((i) => (i.equipmentSlot ?? ['weapon', 'armor', 'shield'].includes(i.type)) && true);
  const loot = inv.filter((i) => !gear.includes(i));
  if (gear.length) { grid.appendChild(catLabel('⚔ Arms & Armor — tap to ready')); gear.forEach((i) => grid.appendChild(packTile(i, equipped.has(i.slug)))); }
  if (loot.length) { grid.appendChild(catLabel('💎 Loot — tap to sell')); loot.forEach((i) => grid.appendChild(packTile(i, false))); }
}

function renderGrid() {
  const grid = document.getElementById('shop-grid');
  if (!grid) return;
  const tabs = document.getElementById('shop-tabs');
  const isPack = currentShop?.mode === 'pack';
  if (tabs) tabs.style.display = isPack ? 'none' : '';
  document.querySelectorAll('#shop-tabs .shop-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === currentTab));
  document.getElementById('shop-scene-gold').textContent = state.character?.gold ?? 0;
  grid.replaceChildren();

  if (isPack) { renderPack(grid); return; }

  if (currentTab === 'buy') {
    const items = currentShop?.items ?? [];
    const weapons = items.filter((i) => i.category === 'weapon' && !i.magic);
    const magic = items.filter((i) => i.magic);
    const armor = items.filter((i) => i.category !== 'weapon');
    if (weapons.length) { grid.appendChild(catLabel('⚔ Weapons')); weapons.forEach((i) => grid.appendChild(tile(i, 'buy'))); }
    if (magic.length) { grid.appendChild(catLabel('✦ Enchanted Arms')); magic.forEach((i) => grid.appendChild(tile(i, 'buy'))); }
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
