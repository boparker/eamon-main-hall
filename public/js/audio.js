// audio.js — Music crossfade, TTS (ElevenLabs + browser fallback)

import { state } from './state.js';

// ── Music ──
export const hallMusic = new Audio('concrete-omen.mp3');
hallMusic.loop = true;
hallMusic.volume = 0;

export const adventureMusic = new Audio('lead-drip-psalm.mp3'); // retired in caves; ambience replaces it
adventureMusic.loop = true;
adventureMusic.volume = 0;

let bgMusic = hallMusic;

// ── Ambience (the floor; music is punctuation) ──────────────────────────────
// One looping bed per room *type*, driven by the manifest's per-room
// `ambience: {track, volume}` (see beginners-cave.json). The temple chant
// gradient (rooms 16→18) and the sea at the cove (25→26) are the 1980 text's
// own sound design — finally audible.
const AMBIENCE_TRACKS = ['tunnel', 'cell', 'temple', 'cove', 'entrance'];
const ambienceEls = {};
for (const t of AMBIENCE_TRACKS) {
  const a = new Audio(`audio/ambience/amb-${t}.m4a`);
  a.loop = true;
  a.volume = 0;
  ambienceEls[t] = a;
}
let currentAmbience = null; // { track, target }
// Debug/verification handle (harmless in prod; lets tests confirm the right
// bed is audible at the right volume without ears).
if (typeof window !== 'undefined') {
  window.__eamonAudio = { ambienceEls, current: () => currentAmbience, sfx: (n) => playSfx(n, 0.5) };
}

function fadeTo(el, target, step = 0.02) {
  const iv = setInterval(() => {
    const d = target - el.volume;
    if (Math.abs(d) <= step) {
      el.volume = target;
      if (target <= 0) el.pause();
      clearInterval(iv);
      return;
    }
    el.volume += Math.sign(d) * step;
  }, 60);
}

export function setAmbience(track, volume = 0.3) {
  if (!state.musicEnabled) { currentAmbience = track ? { track, target: volume } : null; return; }
  // Fade out whatever else is playing
  for (const [name, el] of Object.entries(ambienceEls)) {
    if (name !== track && (el.volume > 0 || !el.paused)) fadeTo(el, 0);
  }
  if (!track || !ambienceEls[track]) { currentAmbience = null; return; }
  const el = ambienceEls[track];
  if (el.paused) { el.play().catch(() => {}); }
  fadeTo(el, volume); // also handles same-track volume gradients (temple 16→17→18)
  currentAmbience = { track, target: volume };
}

export function stopAmbience() { setAmbience(null); }

// ── Event SFX (keyed off the engine's typed events) ─────────────────────────
const SFX = ['hit', 'miss', 'telegraph', 'yield', 'spare', 'coin', 'chest', 'ignite', 'death', 'fanfare'];
const sfxCache = {};
function playSfx(name, volume = 0.5, delayMs = 0) {
  if (!state.musicEnabled) return;
  const fire = () => {
    let el = sfxCache[name];
    if (!el) { el = new Audio(`audio/sfx/sfx-${name}.m4a`); sfxCache[name] = el; }
    el.currentTime = 0;
    el.volume = volume;
    el.play().catch(() => {});
  };
  if (delayMs) setTimeout(fire, delayMs); else fire();
}

// One response → at most a couple of sounds, by priority (no cacophony).
export function playAudioForEvents(response) {
  const events = response?.events ?? [];
  const has = (t) => events.some((e) => e?.type === t);
  const round = response?.state?.combat?.round;

  if (has('character_defeated')) { playSfx('death', 0.55); return; }
  if (has('return_to_hall') || has('escort_reward') || has('abandon')) { playSfx('fanfare', 0.45); return; } // walking out alive is a homecoming too
  if (has('enemy_spared')) { playSfx('spare', 0.5); return; }

  // Combat exchange: player swing now, enemy answer on the animation beat.
  if (round?.player && !round.player.spell) playSfx(round.player.hit ? 'hit' : 'miss', 0.45);
  if (round?.enemy?.hit) playSfx('hit', 0.4, 700);

  if (has('enemy_yielded')) playSfx('yield', 0.5, 300);
  else if (has('telegraph')) playSfx('telegraph', 0.55, 300);
  else if (events.some((e) => e?.type === 'magic_word' && e.lit)) playSfx('ignite', 0.5);
  else if (has('take') || has('take_all') || has('spare_reward')) playSfx('coin', 0.45);
  else if (has('open') || has('ambush')) playSfx('chest', 0.5);
}

// ── The single audio driver: hall gets music, the cave gets its ambience ────
export function updateAudioForResponse(response) {
  const phase = response?.state?.phase;
  if (phase === 'adventure') {
    // Cave: retire music, breathe with the room.
    if (bgMusic && bgMusic.volume > 0) fadeTo(bgMusic, 0);
    const amb = response?.state?.room?.ambience;
    const fallback = /cell|chamber/i.test(response?.state?.room?.name ?? '') ? 'cell' : 'tunnel';
    setAmbience(amb?.track ?? fallback, amb?.volume ?? 0.3);
  } else if (phase) {
    // Hall & shops: music is home; ambience sleeps.
    stopAmbience();
    switchMusic(hallMusic);
  }
  playAudioForEvents(response);
}

export function switchMusic(track) {
  if (bgMusic === track) return;
  const oldMusic = bgMusic;
  bgMusic = track;
  // Crossfade
  const fadeOut = setInterval(() => {
    oldMusic.volume = Math.max(0, oldMusic.volume - 0.02);
    if (oldMusic.volume <= 0) { oldMusic.pause(); clearInterval(fadeOut); }
  }, 50);
  if (state.musicEnabled) {
    track.volume = 0;
    track.play().catch(() => {});
    let vol2 = 0;
    const fadeIn = setInterval(() => {
      vol2 = Math.min(vol2 + 0.008, 0.3);
      track.volume = vol2;
      if (vol2 >= 0.3) clearInterval(fadeIn);
    }, 50);
  }
}

export function startMusic() {
  if (!state.musicEnabled) return;
  bgMusic.play().catch(() => {});
  let vol = 0;
  const fade = setInterval(() => {
    vol = Math.min(vol + 0.008, 0.3);
    bgMusic.volume = vol;
    if (vol >= 0.3) clearInterval(fade);
  }, 50);
}

// ── Voice (ElevenLabs) ──
let ttsAudio = null;

function speakBrowserTTS(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.88;
  utter.pitch = 0.85;
  utter.volume = 0.9;
  const voices = window.speechSynthesis.getVoices();
  const pref = voices.find(v => /daniel|james|thomas|aaron/i.test(v.name) && /en/i.test(v.lang))
    || voices.find(v => /male/i.test(v.name) && /en/i.test(v.lang))
    || voices.find(v => /en-/i.test(v.lang));
  if (pref) utter.voice = pref;
  window.speechSynthesis.speak(utter);
}

// Preload voices
if ('speechSynthesis' in window) window.speechSynthesis.getVoices();

export async function speakElevenLabs(text, voiceId) {
  if (!state.voiceEnabled || !text) return;
  try {
    if (ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId }),
    });
    if (!res.ok) {
      console.warn('ElevenLabs failed, falling back to browser TTS');
      speakBrowserTTS(text);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    ttsAudio = new Audio(url);
    ttsAudio.volume = 0.9;
    ttsAudio.play().catch(() => {});
    ttsAudio.onended = () => { URL.revokeObjectURL(url); ttsAudio = null; };
  } catch (e) {
    console.warn('TTS error, falling back to browser:', e);
    speakBrowserTTS(text);
  }
}

// ── Control Buttons ──
export function initAudioControls() {
  document.getElementById('hud-music-btn').addEventListener('click', () => {
    state.musicEnabled = !state.musicEnabled;
    const btn = document.getElementById('hud-music-btn');
    btn.classList.toggle('active', state.musicEnabled);
    if (state.musicEnabled) {
      if (currentAmbience) setAmbience(currentAmbience.track, currentAmbience.target);
      else { bgMusic.play().catch(() => {}); bgMusic.volume = 0.3; }
    } else {
      hallMusic.pause();
      adventureMusic.pause();
      for (const el of Object.values(ambienceEls)) { el.pause(); el.volume = 0; }
    }
  });

  document.getElementById('hud-voice-btn').addEventListener('click', () => {
    state.voiceEnabled = !state.voiceEnabled;
    const btn = document.getElementById('hud-voice-btn');
    btn.classList.toggle('active', state.voiceEnabled);
    if (!state.voiceEnabled && ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
  });
}
