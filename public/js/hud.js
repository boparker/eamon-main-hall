// hud.js — HUD rendering and stat animations

import { state } from './state.js';
import { openPortraitBuilder, canPaintPortrait } from './portrait-builder.js';
import { statBand, describeStat } from './stat-info.js';

// The value that drives each stat's band/tooltip. Hardiness = max HP (not the
// current, wounded hd), so the band reflects the underlying stat.
function statValue(character, stat) {
  if (stat === 'hardiness') return character?.hardiness ?? character?.maxHd ?? character?.maxHp ?? 0;
  return character?.[stat] ?? 0;
}

function openStatPopover(el) {
  const pop = document.getElementById('stat-popover');
  if (!pop || !state.character) return;
  const stat = el.dataset.stat;
  const d = describeStat(stat, statValue(state.character, stat));
  if (!d) return;
  pop.replaceChildren();
  const title = document.createElement('div'); title.className = 'sp-title'; title.textContent = `${d.label} ${d.value}`;
  const band = document.createElement('div'); band.className = 'sp-band'; band.textContent = d.band;
  const eff = document.createElement('div'); eff.className = 'sp-effect'; eff.textContent = d.effect;
  pop.append(title, band, eff);
  pop.hidden = false;
  // Position under the clicked stat, clamped to the viewport.
  const r = el.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
}

function wireStatPopovers() {
  const stats = document.getElementById('hud-stats');
  if (!stats || stats.dataset.popWired) return;
  stats.dataset.popWired = '1';
  const pop = document.getElementById('stat-popover');
  stats.querySelectorAll('.info-stat').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!pop.hidden && pop.dataset.for === el.dataset.stat) { pop.hidden = true; return; }
      pop.dataset.for = el.dataset.stat;
      openStatPopover(el);
    });
  });
  document.addEventListener('click', (e) => { if (pop && !pop.hidden && !e.target.closest('#stat-popover')) pop.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop) pop.hidden = true; });
}

export function updateHUD(animate) {
  const hasCharacter = Boolean(state.character?.id || state.character?.name);
  document.getElementById('hud-name').textContent = hasCharacter ? state.character.name : '—';
  // The earned epithet — the world's one-word memory of you.
  const epithetEl = document.getElementById('hud-epithet');
  if (epithetEl) {
    const epithet = hasCharacter ? state.character.reputation?.epithet : null;
    epithetEl.textContent = epithet ?? '';
    epithetEl.hidden = !epithet;
  }

  // Custom portrait avatar + the reward-gated "Paint Portrait" entry point.
  const avatar = document.getElementById('hud-avatar');
  if (avatar) {
    if (hasCharacter && state.character.portraitUrl) { avatar.src = state.character.portraitUrl; avatar.hidden = false; }
    else avatar.hidden = true;
  }
  const pbBtn = document.getElementById('hud-portrait-btn');
  if (pbBtn) {
    pbBtn.hidden = !(hasCharacter && canPaintPortrait(state.character));
    if (!pbBtn.dataset.wired) { pbBtn.dataset.wired = '1'; pbBtn.addEventListener('click', () => openPortraitBuilder()); }
  }
  const stats = {
    'stat-hd': hasCharacter ? state.character.hd : null,
    'stat-ag': hasCharacter ? (state.character.agility ?? state.character.ag) : null,
    'stat-ch': hasCharacter ? (state.character.charisma ?? state.character.ch) : null,
    'stat-gold': hasCharacter ? (state.character.gold ?? 0) : 200,
    'stat-bank': hasCharacter ? (state.character.bankGold ?? 0) : null,
  };
  // Qualitative band under each interactive stat (Poor…Exceptional).
  for (const [bandId, stat] of [['band-hd', 'hardiness'], ['band-ag', 'agility'], ['band-ch', 'charisma']]) {
    const b = document.getElementById(bandId);
    if (b) b.textContent = hasCharacter ? statBand(statValue(state.character, stat)).label : '';
  }
  wireStatPopovers();
  for (const [id, val] of Object.entries(stats)) {
    const el = document.getElementById(id);
    if (!el) continue;
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
  const wrap = document.getElementById('readied-bar');
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
