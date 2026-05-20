// hud.js — HUD rendering and stat animations

import { state } from './state.js';

export function updateHUD(animate) {
  const hasCharacter = Boolean(state.character?.id || state.character?.name);
  document.getElementById('hud-name').textContent = hasCharacter ? state.character.name : '—';
  const stats = {
    'stat-hd': hasCharacter ? state.character.hd : null,
    'stat-ag': hasCharacter ? (state.character.agility ?? state.character.ag) : null,
    'stat-ch': hasCharacter ? (state.character.charisma ?? state.character.ch) : null,
    'stat-gold': hasCharacter ? (state.character.gold ?? 0) : 200,
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
