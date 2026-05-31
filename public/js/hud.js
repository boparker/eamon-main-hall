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

  renderLoadout(hasCharacter ? state.character : null);
}

// Set a gear chip's label + faint stat (e.g. "Sword" · "1d8").
function setGear(nameId, name, stat) {
  const nameEl = document.getElementById(nameId);
  if (!nameEl) return;
  nameEl.replaceChildren(document.createTextNode(name));
  if (stat) {
    const s = document.createElement('span');
    s.className = 'gear-stat';
    s.textContent = ` ${stat}`;
    nameEl.appendChild(s);
  }
}

// Show the readied weapon and worn armour/shield straight from the character's
// equipment, so "what do I have readied?" is answered at a glance.
export function renderLoadout(character) {
  const wrap = document.getElementById('hud-loadout');
  if (!wrap) return;
  if (!character) { wrap.hidden = true; return; }
  wrap.hidden = false;

  const eq = character.equipment ?? {};

  const weapon = eq.weapon;
  if (weapon) {
    const odds = Number(weapon.stats?.weaponOdds) || 0;
    const oddsText = odds ? `${odds > 0 ? '+' : ''}${odds}` : '';
    setGear('gear-weapon-name', weapon.name, [weapon.stats?.damage, oddsText].filter(Boolean).join(' '));
  } else {
    setGear('gear-weapon-name', 'Bare hands', '');
  }

  const armor = eq.armor;
  const shield = eq.shield;
  const ac = (Number(armor?.stats?.armorClass) || 0) + (Number(shield?.stats?.armorClass) || 0);
  if (armor || shield) {
    const name = armor ? (shield ? `${armor.name} + Shield` : armor.name) : 'Shield';
    setGear('gear-armor-name', name, `AC ${ac}`);
  } else {
    setGear('gear-armor-name', 'Unarmored', '');
  }
}
