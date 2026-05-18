// hud.js — HUD rendering and stat animations

import { state } from './state.js';

export function updateHUD(animate) {
  document.getElementById('hud-name').textContent = state.character.name || '—';
  const stats = {
    'stat-hd': state.character.hd,
    'stat-ag': state.character.agility ?? state.character.ag,
    'stat-ch': state.character.charisma ?? state.character.ch,
    'stat-gold': state.character.name ? (state.character.gold ?? 0) : null,
  };
  for (const [id, val] of Object.entries(stats)) {
    const el = document.getElementById(id);
    if (val != null) {
      el.textContent = val;
      if (animate) {
        el.classList.remove('stat-reveal');
        void el.offsetWidth;
        el.classList.add('stat-reveal');
      }
    } else {
      el.textContent = '—';
      el.classList.remove('stat-reveal');
    }
  }

  const shopGold = document.getElementById('shop-gold');
  if (shopGold) {
    shopGold.textContent = `Your gold: ${stats['stat-gold'] ?? '—'}`;
  }
}
