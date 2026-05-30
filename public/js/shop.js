// shop.js — Shop panel, inventory display, purchase flow

import { state } from './state.js';
import { generateSceneBg, getLastBgLocation, setLastBgLocation } from './scene.js';

// ── Shop Data ──
export const SHOP_DATA = {
  marcos: {
    title: "MARCOS CAVIELLI'S WEAPONS",
    items: [
      { name: 'Short Sword', desc: 'Reliable and light', price: 30, stats: { dmg: '1d6', odds: '25%', type: 'Sword' } },
      { name: 'Broadsword', desc: "Standard warrior's blade", price: 60, stats: { dmg: '2d6', odds: '30%', type: 'Sword' } },
      { name: 'Battle Axe', desc: 'Heavy, devastating swings', price: 80, stats: { dmg: '2d8', odds: '20%', type: 'Axe' } },
      { name: 'Mace', desc: 'Crushes armor and bone', price: 50, stats: { dmg: '2d4', odds: '30%', type: 'Mace' } },
      { name: 'Spear', desc: 'Reach advantage in combat', price: 40, stats: { dmg: '1d8', odds: '25%', type: 'Spear' } },
      { name: 'War Hammer', desc: 'Slow but lethal', price: 90, stats: { dmg: '3d6', odds: '15%', type: 'Hammer' } },
      { name: 'Leather Armor', desc: 'Basic protection', price: 50, stats: { def: '+2', weight: 'Light', type: 'Armor' } },
      { name: 'Chain Mail', desc: 'Solid defense, some weight', price: 120, stats: { def: '+5', weight: 'Medium', ag: '-1', type: 'Armor' } },
      { name: 'Plate Armor', desc: 'Heavy but near-impervious', price: 200, stats: { def: '+8', weight: 'Heavy', ag: '-3', type: 'Armor' } },
      { name: 'Shield', desc: 'Blocks incoming strikes', price: 40, stats: { def: '+2', block: '15%', type: 'Shield' } },
    ],
  },
  hokas: {
    title: "HOKAS TOKAS' MAGIC EMPORIUM",
    items: [
      { name: 'Blast Spell', desc: 'Deals magical damage', price: 100, stats: { dmg: '2d8', range: 'Ranged', type: 'Spell' } },
      { name: 'Heal Spell', desc: 'Restore lost Hardiness', price: 80, stats: { heal: '2d6', uses: '3/adventure', type: 'Spell' } },
      { name: 'Speed Spell', desc: 'Boost Agility in combat', price: 120, stats: { buff: 'AG +5', dur: '3 rounds', type: 'Spell' } },
      { name: 'Power Spell', desc: 'Random powerful effect', price: 150, stats: { effect: 'Random', power: 'High', type: 'Spell' } },
      { name: 'Healing Potion', desc: 'One-use, restores 10 HD', price: 25, stats: { heal: '+10 HD', uses: '1 (consumed)', type: 'Potion' } },
      { name: 'Scroll of Protection', desc: 'Reduces damage taken', price: 60, stats: { def: '+3', dur: '5 rounds', uses: '1 (consumed)', type: 'Scroll' } },
    ],
  },
  bank: {
    title: 'BANK OF EAMON TOWNE',
    items: [
      { name: 'Deposit 50 Gold', desc: 'Safe keeping', price: 0 },
      { name: 'Deposit 100 Gold', desc: 'Safe keeping', price: 0 },
      { name: 'Withdraw 50 Gold', desc: 'From your account', price: 0 },
      { name: 'Withdraw 100 Gold', desc: 'From your account', price: 0 },
    ],
  },
  pawn: {
    title: "SAM SLICKER'S PAWN SHOP",
    items: [
      { name: 'Sell your loot here', desc: 'Prices vary by item', price: 0 },
    ],
  },
};

// Shop-to-location mapping for background generation
const SHOP_LOCATIONS = {
  marcos: "Marcos Cavielli's Weapon Shop — racks of swords and axes on stone walls, anvil, forge glow",
  hokas: "Hokas Tokas' Magic Emporium — shelves of potions, glowing crystals, arcane tomes, purple mist",
  bank: 'Bank of Eamon Towne — gold stacks, iron vault doors, counting tables, candlelight',
  pawn: "Sam Slicker's Pawn Shop — cluttered shelves of adventuring gear, dusty treasures, dim lanterns",
};

function normalizeShopPayload(shopOrKey) {
  if (typeof shopOrKey === 'string') {
    const legacy = SHOP_DATA[shopOrKey];
    return legacy ? { key: shopOrKey, title: legacy.title, items: legacy.items } : null;
  }
  if (!shopOrKey || !Array.isArray(shopOrKey.items)) return null;
  return shopOrKey;
}

function itemIcon(item = {}) {
  const type = String(item.stats?.type ?? item.category ?? '').toLowerCase();
  if (/shield/.test(type) || item.equipmentSlot === 'shield') return '▣';
  if (/armor/.test(type) || item.equipmentSlot === 'armor') return '◈';
  if (/spell|scroll|potion/.test(type)) return '✦';
  return '⚔';
}

function statLabel(key) {
  return ({
    damage: 'DMG', dmg: 'DMG', defense: 'DEF', def: 'DEF', odds: 'HIT', heal: 'HEAL', buff: 'BUFF',
    block: 'BLOCK', dur: 'DUR', uses: 'USES', range: 'RNG', effect: 'FX', power: 'PWR', weight: 'WT',
    agility: 'AG', ag: 'AG', type: 'TYPE',
  })[key] ?? String(key).toUpperCase();
}

// Purchase callback — set by main.js to avoid circular dependency
let _onPurchase = null;
export function registerPurchaseHandler(fn) { _onPurchase = fn; }

export function openShop(shopOrKey) {
  const shop = normalizeShopPayload(shopOrKey);
  if (!shop) return;
  const shopKey = shop.key ?? 'marcos';

  // Generate shop-specific background
  const shopLocation = shop.title ?? SHOP_LOCATIONS[shopKey];
  if (shopLocation && shopLocation !== getLastBgLocation()) {
    setLastBgLocation(shopLocation);
    generateSceneBg(shopLocation);
  }

  const panel = document.getElementById('shop-panel');
  document.getElementById('shop-title').textContent = shop.section ? `${shop.title}: ${shop.section}` : shop.title;
  document.getElementById('shop-title').dataset.shopKey = shopKey;
  document.getElementById('shop-gold').textContent = `Your gold: ${state.character.gold || 0}`;
  const container = document.getElementById('shop-items');
  container.innerHTML = '';

  // Group items by category
  const groups = {};
  for (const item of shop.items) {
    const cat = (item.stats && item.stats.type) || item.category || 'General';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  }

  const categoryOrder = ['Sword', 'Axe', 'Mace', 'Spear', 'Hammer', 'Bow', 'Club', 'Halberd', 'Armor', 'Shield', 'Spell', 'Potion', 'Scroll', 'General'];
  const sortedCats = Object.keys(groups).sort((a, b) => {
    const ai = categoryOrder.indexOf(a), bi = categoryOrder.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const showHeaders = sortedCats.length > 1;
  let lastHeaderLabel = '';

  for (const cat of sortedCats) {
    if (showHeaders) {
      const weaponTypes = ['Sword', 'Axe', 'Mace', 'Spear', 'Hammer', 'Bow', 'Club', 'Halberd'];
      const armorTypes = ['Armor', 'Shield'];
      const headerLabel = weaponTypes.includes(cat) ? '⚔ WEAPONS'
        : armorTypes.includes(cat) ? '▣ ARMOR & SHIELDS'
        : cat === 'Spell' ? '✦ SPELLS'
        : cat === 'Potion' ? 'POTIONS'
        : cat === 'Scroll' ? 'SCROLLS'
        : cat;

      if (headerLabel !== lastHeaderLabel) {
        const hdr = document.createElement('div');
        hdr.className = 'shop-category';
        hdr.textContent = headerLabel;
        container.appendChild(hdr);
        lastHeaderLabel = headerLabel;
      }
    }

    for (const item of groups[cat]) {
      const canAfford = item.price === 0 || (state.character.gold || 0) >= item.price;
      const div = document.createElement('div');
      div.className = 'shop-item' + (canAfford ? '' : ' cant-afford');

      let statsHtml = '';
      if (item.stats) {
        const statEntries = Object.entries(item.stats).filter(([k]) => k !== 'type');
        statsHtml = '<div class="shop-item-stats">' + statEntries.map(([k, v]) => {
          const label = statLabel(k);
          const cls = String(v).startsWith('+') ? 'stat-positive' : String(v).startsWith('-') ? 'stat-negative' : '';
          return `<span class="shop-stat ${cls}">${label} <span class="shop-stat-val">${v}</span></span>`;
        }).join('') + '</div>';
        statsHtml = `<div class="shop-item-type" style="font-size:0.7rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em;margin-top:2px;">${item.stats.type || item.category || ''}</div>` + statsHtml;
      }

      div.innerHTML = `
        <div class="shop-item-icon" aria-hidden="true">${itemIcon(item)}</div>
        <div class="shop-item-info">
          <div class="shop-item-name">${item.name}</div>
          <div class="shop-item-desc">${item.desc ?? item.category ?? ''}</div>
          ${statsHtml}
        </div>
        <div class="shop-item-price">${item.price > 0 ? item.price + ' gold' : '—'}</div>
      `;

      if (canAfford && item.price > 0) {
        div.addEventListener('click', () => {
          if (_onPurchase) _onPurchase(`Buy ${item.name}`);
        });
      }

      container.appendChild(div);
    }
  }

  panel.classList.add('open');
}

export function closeShop() {
  document.getElementById('shop-panel')?.classList.remove('open');
}

// Wire up close button
document.getElementById('shop-close-btn')?.addEventListener('click', closeShop);
