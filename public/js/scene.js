// scene.js — Background crossfade, portrait system, location management

import { switchMusic, hallMusic, adventureMusic } from './audio.js';
import { state } from './state.js';

// ── Location & Background ──
let lastBgLocation = '';
const bgCache = {};

export function getLastBgLocation() { return lastBgLocation; }
export function setLastBgLocation(loc) { lastBgLocation = loc; }

export function setLocation(name) {
  const el = document.getElementById('location-title');
  el.textContent = name;
  el.classList.remove('visible', 'reveal');
  void el.offsetWidth;
  el.classList.add('visible', 'reveal');

  // Switch music based on location
  const lowerName = name.toLowerCase();
  const isHall = lowerName.includes('hall') || lowerName.includes('shop') || lowerName.includes('emporium') || lowerName.includes('bank') || lowerName.includes('pawn');
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
    "Marcos Cavielli's Weapon Shop": 'scenes/weapon-shop.jpg',
    "Hokas Tokas' Magic Emporium": 'scenes/magic-shop.jpg',
    "Shylock McFenney's Bank": 'scenes/bank.jpg',
    "Sam Slicker's Pawn Shop": 'scenes/pawn-shop.jpg',
  };

  if (sceneMap[location]) {
    crossfadeBg(sceneMap[location]);
    return;
  }

  // Phase 1 deterministic gameplay should not call image-generation endpoints.
  if (state.phase1Mode) return;

  // Check local cache
  if (bgCache[location]) {
    crossfadeBg(bgCache[location]);
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
  // Phase 1 deterministic gameplay should not call portrait-generation endpoints.
  if (state.phase1Mode) return;

  const frame = document.getElementById('portrait-frame');
  const cacheKey = kind + ':' + name;
  let url = portraitCache[cacheKey];
  if (!url) {
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

export function hidePortrait() {
  document.getElementById('portrait-frame').classList.remove('visible');
}
