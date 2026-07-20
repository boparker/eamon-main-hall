// scene.js — Background crossfade, portrait system, location management


// ── Location & Background ──
let lastBgLocation = '';
const bgCache = {};

export function getLastBgLocation() { return lastBgLocation; }
export function setLastBgLocation(loc) { lastBgLocation = loc; }

export function setLocation(name) {
  const el = document.getElementById('location-title');
  // The combat overlay carries its own copy of the room name (the main
  // heading is hidden while the duel fills the screen).
  const combatEl = document.getElementById('combat-location');
  if (combatEl) combatEl.textContent = String(name ?? '').split(/\s+[-–—|:]\s+/)[0].trim();

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

  // (Music/ambience is driven centrally by audio.updateAudioForResponse.)

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
    "Marcos Cavielli's Weapons & Armour Shoppe": 'scenes/weapon-shop.png',
    "Hokas Tokas' School of Magick": 'scenes/magic-shop.png',
    "The Witch's Shop": 'scenes/witch-shop.png',
    'Bank of Eamon Towne': 'scenes/bank.png',
    'The Chapel of the Open Hand': 'scenes/chapel.png',
    'The Adventure Gate': 'scenes/adventure-gate.png',
    'The Hall of Records': 'scenes/hall-of-records.png',
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

let currentBgUrl = '';
function crossfadeBg(url) {
  currentBgUrl = url;
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

// Living paintings: a muted seamless-loop <video> floats over the still (the
// still stays underneath as the loading/failure fallback and crossfade base).

// Muted autoplay can still be vetoed before the first user gesture (strict
// policies, embedded webviews). Retry every stalled loop on the next gesture.
const pendingPlays = new Set();
function ensurePlays(vid) {
  vid.play?.().catch(() => {});
  pendingPlays.add(vid);
}
for (const evt of ['pointerdown', 'keydown']) {
  document.addEventListener(evt, () => {
    for (const vid of pendingPlays) {
      if (!vid.isConnected) { pendingPlays.delete(vid); continue; }
      if (vid.paused) vid.play?.().catch(() => {});
      else pendingPlays.delete(vid);
    }
  }, { capture: true, passive: true });
}

let currentBgVideoUrl = '';
function setBackgroundVideo(videoUrl) {
  const host = document.getElementById('scene-bg');
  if (!host) return;
  let vid = document.getElementById('scene-bg-video');
  if (!videoUrl) {
    currentBgVideoUrl = '';
    if (vid) { vid.style.opacity = '0'; setTimeout(() => vid.remove(), 1600); }
    return;
  }
  if (videoUrl === currentBgVideoUrl) return;
  currentBgVideoUrl = videoUrl;
  if (vid) vid.remove();
  vid = document.createElement('video');
  vid.id = 'scene-bg-video';
  vid.muted = true;
  vid.loop = true;
  vid.autoplay = true;
  vid.playsInline = true;
  vid.setAttribute('playsinline', ''); // iOS needs the attribute, not just the property
  vid.src = videoUrl;
  vid.style.opacity = '0';
  // Fade in only once frames are actually flowing; if the file is missing or
  // stalls, the still beneath simply remains.
  vid.addEventListener('playing', () => { vid.style.opacity = '1'; });
  vid.addEventListener('error', () => vid.remove());
  host.appendChild(vid);
  ensurePlays(vid); // autoplay veto → still art now, retry on first gesture
}

// Set an explicit scene background by URL (e.g. an adventure room's painted art),
// independent of the name→sceneMap lookup. No-ops if already showing it.
// `videoUrl` (optional) layers a living-painting loop over the still.
export function setSceneBackground(url, videoUrl = null) {
  if (url && url !== currentBgUrl) crossfadeBg(url);
  setBackgroundVideo(videoUrl);
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

// Build one character card. Prefers painted portrait art (by explicit `image`
// path or cache); falls back to a monogram crest if none exists / fails to load.
function characterCard({ name, kind, image, video, following }) {
  const card = document.createElement('div');
  card.className = 'room-char-card' + (following ? ' following' : '');
  card.dataset.kind = kind === 'monster' ? 'monster' : (kind === 'neutral' ? 'neutral' : 'friendly');

  const art = document.createElement('div');
  art.className = 'rc-art';

  // A companion travelling with you gets a gold "Following" ribbon.
  if (following) {
    const badge = document.createElement('span');
    badge.className = 'rc-follow-badge';
    badge.textContent = '✦ Following';
    art.appendChild(badge);
  }

  const crest = () => {
    const c = document.createElement('span');
    c.className = 'rc-crest';
    c.textContent = (String(name || '?').trim().charAt(0) || '?').toUpperCase();
    return c;
  };

  const url = image || portraitCache[kind + ':' + name];
  if (video) {
    // A living portrait: muted seamless loop, the still as poster. Any
    // failure degrades to the still image path below, then to a monogram.
    const vid = document.createElement('video');
    vid.muted = true;
    vid.loop = true;
    vid.autoplay = true;
    vid.playsInline = true;
    vid.setAttribute('playsinline', '');
    if (url) vid.poster = url;
    vid.src = video;
    vid.onerror = () => {
      vid.remove();
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = name;
        img.onerror = () => { img.remove(); art.appendChild(crest()); };
        art.appendChild(img);
      } else {
        art.appendChild(crest());
      }
    };
    art.appendChild(vid);
    ensurePlays(vid);
  } else if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = name;
    // If the portrait 404s (not yet painted), gracefully degrade to a monogram.
    img.onerror = () => { img.remove(); art.appendChild(crest()); };
    art.appendChild(img);
  } else {
    art.appendChild(crest());
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
