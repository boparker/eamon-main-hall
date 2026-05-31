// scene.js — Background crossfade, portrait system, location management

import { switchMusic, hallMusic, adventureMusic } from './audio.js';

// ── Location & Background ──
let lastBgLocation = '';
const bgCache = {};

export function getLastBgLocation() { return lastBgLocation; }
export function setLastBgLocation(loc) { lastBgLocation = loc; }

export function setLocation(name) {
  const el = document.getElementById('location-title');

  // Split "Main - Sub" (–, —, |, :) into a primary title + flanked sub-location.
  const parts = String(name ?? '').split(/\s+[-–—|:]\s+/);
  const main = (parts[0] ?? '').trim();
  const sub = parts.slice(1).join(' — ').trim();

  el.replaceChildren();
  const mainEl = document.createElement('div');
  mainEl.className = 'location-main';
  mainEl.textContent = main;
  el.appendChild(mainEl);
  if (sub) {
    const subEl = document.createElement('div');
    subEl.className = 'location-sub';
    const rule = () => { const s = document.createElement('span'); s.className = 'rule'; return s; };
    subEl.append(rule(), document.createTextNode(sub), rule());
    el.appendChild(subEl);
  }

  el.classList.remove('visible', 'reveal');
  void el.offsetWidth;
  el.classList.add('visible', 'reveal');

  // Switch music based on location
  const lowerName = name.toLowerCase();
  const isHall = lowerName.includes('hall') || lowerName.includes('shop') || lowerName.includes('emporium') || lowerName.includes('bank') || lowerName.includes('pawn') || lowerName.includes('chapel') || lowerName.includes('healer') || lowerName.includes('temple') || lowerName.includes('school') || lowerName.includes('gate');
  switchMusic(isHall ? hallMusic : adventureMusic);

  // Generate background image for new locations
  if (name !== lastBgLocation) {
    lastBgLocation = name;
    generateSceneBg(name);
  }
}

export async function generateSceneBg(location) {
  // Map location names to local scene images
  const sceneMap = {
    'The Great Hall': 'scenes/great-hall.png',
    "Marcos Cavielli's Weapons & Armour Shoppe": 'scenes/weapon-shop.jpg',
    "Hokas Tokas' School of Magick": 'scenes/magic-shop.jpg',
    "The Witch's Shop": 'scenes/witch-shop.jpg',
    'Bank of Eamon Towne': 'scenes/bank.jpg',
    'The Chapel of the Open Hand': 'scenes/chapel.jpg',
  };

  if (sceneMap[location]) {
    crossfadeBg(sceneMap[location]);
    return;
  }

  // Check local cache
  if (bgCache[location]) {
    crossfadeBg(bgCache[location]);
    return;
  }

  if (typeof window === 'undefined' || window.EAMON_ENABLE_IMAGE_GENERATION !== true) {
    return;
  }

  const indicator = document.getElementById('img-generating');
  indicator.classList.add('active');
  try {
    const res = await fetch('/api/scene-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location }),
    });
    const data = await res.json();
    if (data.url) {
      bgCache[location] = data.url;
      crossfadeBg(data.url);
    }
  } catch (e) {
    console.error('Scene image error:', e);
  } finally {
    indicator.classList.remove('active');
  }
}

function crossfadeBg(url) {
  const current = document.getElementById('scene-bg');
  const next = document.getElementById('scene-bg-next');
  const img = new Image();
  img.onload = () => {
    next.style.backgroundImage = `url('${url}')`;
    next.style.opacity = '1';
    setTimeout(() => {
      current.style.backgroundImage = `url('${url}')`;
      next.style.opacity = '0';
    }, 1600);
  };
  img.src = url;
}

// ── Portrait System ──
const portraitCache = {};

export async function showPortrait(name, desc, kind) {
  const frame = document.getElementById('portrait-frame');
  if (!frame) return; // legacy single-frame path; room rail handles portraits now
  const cacheKey = kind + ':' + name;
  let url = portraitCache[cacheKey];
  if (!url) {
    if (typeof window === 'undefined' || window.EAMON_ENABLE_IMAGE_GENERATION !== true) return;
    try {
      const res = await fetch('/api/portrait', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: desc, type: kind }),
      });
      const data = await res.json();
      if (data.url) { url = data.url; portraitCache[cacheKey] = url; }
    } catch (e) {
      console.error('Portrait error:', e);
    }
  }
  if (url) {
    document.getElementById('portrait-img').src = url;
    document.getElementById('portrait-name').textContent = name;
    document.getElementById('portrait-stats').textContent = kind === 'monster' ? '\u2694 Hostile' : '\u2726 Friendly';
    frame.classList.add('visible');
    clearTimeout(frame._hideTimer);
    frame._hideTimer = setTimeout(() => frame.classList.remove('visible'), 20000);
  }
}

const DISPOSITION_LABEL = { monster: '⚔ Hostile', friendly: '✦ Friendly', neutral: '◆ Neutral' };

// Build one character card (monogram placeholder, swaps to portrait art later).
function characterCard({ name, kind }) {
  const card = document.createElement('div');
  card.className = 'room-char-card';
  card.dataset.kind = kind === 'monster' ? 'monster' : (kind === 'neutral' ? 'neutral' : 'friendly');

  const art = document.createElement('div');
  art.className = 'rc-art';
  const url = portraitCache[kind + ':' + name];
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = name;
    art.appendChild(img);
  } else {
    const crest = document.createElement('span');
    crest.className = 'rc-crest';
    crest.textContent = (String(name || '?').trim().charAt(0) || '?').toUpperCase();
    art.appendChild(crest);
  }

  const nameEl = document.createElement('div');
  nameEl.className = 'rc-name';
  nameEl.textContent = name;

  const disp = document.createElement('div');
  disp.className = 'rc-disp';
  disp.textContent = DISPOSITION_LABEL[kind] ?? '◆ Neutral';

  card.append(art, nameEl, disp);
  return card;
}

// Render every character in the room as a portrait card in the right rail.
// `people` is [{ name, kind }] (kind: monster | friendly | neutral).
export function renderRoomCharacters(people = []) {
  const container = document.getElementById('room-characters');
  if (!container) return;
  container.replaceChildren(...people.map(characterCard));
}

export function clearRoomCharacters() {
  const container = document.getElementById('room-characters');
  if (container) container.replaceChildren();
}
