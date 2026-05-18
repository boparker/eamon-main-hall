// hud.js — HUD rendering and stat animations

import { state } from './state.js';

export function updateHUD(animate) {
  document.getElementById('hud-name').textContent = state.character.name || '—';
  const stats = {
    'stat-hd': state.character.hd,
    'stat-ag': state.character.ag,
    'stat-ch': state.character.ch,
    'stat-gold': state.character.gold,
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
    }
  }
}
