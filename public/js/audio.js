// audio.js — Music crossfade, TTS (ElevenLabs + browser fallback)

import { state } from './state.js';

// ── Music ──
// "Medieval Banquet" by Tabletop Audio (tabletopaudio.com), CC BY-NC-ND 4.0.
// Served unmodified (NoDerivatives); 10-min seamless loop via HTMLAudio —
// NOT the Web Audio bed path, which would decode ~200MB into RAM.
export const hallMusic = new Audio('audio/music/medieval-banquet.mp3');
hallMusic.loop = true;
hallMusic.volume = 0;

export const adventureMusic = new Audio('lead-drip-psalm.mp3'); // retired in caves; ambience replaces it
adventureMusic.loop = true;
adventureMusic.volume = 0;

let bgMusic = hallMusic;

// ── Ambience (the floor; music is punctuation) ──────────────────────────────
// One looping bed per room *type*, driven by the manifest's per-room
// `ambience: {track, volume}`. The temple chant gradient (rooms 16→18) and
// the sea at the cove (25→26) are the 1980 text's own sound design.
//
// Built on Web Audio, not <audio loop>: AAC files carry encoder padding at
// both ends, so HTMLAudioElement looping stutters at the seam. An
// AudioBufferSourceNode loops sample-accurately, and loopStart/loopEnd sit
// INSIDE the file, past the padding and the generator's edge fades.
const LOOP_TRIM_START = 0.6;  // seconds skipped at the head
const LOOP_TRIM_END = 1.2;    // seconds skipped at the tail

// Gentle volume ramp for HTMLAudio elements (hall music still uses these).
// One fade per element: a new fade cancels the old, or two intervals tug the
// volume in opposite directions forever (hall music audible in the cave).
function fadeTo(el, target, step = 0.02) {
  clearInterval(el._fadeIv);
  const iv = el._fadeIv = setInterval(() => {
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

let audioCtx = null;
let ambienceGain = null;      // master gain for the ambience channel
const ambienceBuffers = {};   // track -> AudioBuffer (decoded once)
let ambiencePlaying = null;   // { track, source, gain }
let currentAmbience = null;   // { track, target }

function ctx() {
  if (typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') return null;
  if (!audioCtx) {
    audioCtx = new (typeof AudioContext !== 'undefined' ? AudioContext : webkitAudioContext)();
    ambienceGain = audioCtx.createGain();
    ambienceGain.gain.value = 1;
    ambienceGain.connect(audioCtx.destination);
    // Autoplay policy: contexts start suspended until a user gesture.
    const unlock = () => { audioCtx.resume().catch(() => {}); };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
  }
  return audioCtx;
}

async function ambienceBuffer(track) {
  if (ambienceBuffers[track]) return ambienceBuffers[track];
  const c = ctx();
  if (!c) return null;
  // Version query busts the one-week media cache when a bed is re-authored.
  const res = await fetch(`audio/ambience/amb-${track}.m4a?v=6`);
  const buf = await c.decodeAudioData(await res.arrayBuffer());
  ambienceBuffers[track] = buf;
  return buf;
}

function stopPlaying(fadeSecs = 1.2) {
  if (!ambiencePlaying) return;
  const { source, gain } = ambiencePlaying;
  const c = ctx();
  try {
    gain.gain.cancelScheduledValues(c.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, c.currentTime);
    gain.gain.linearRampToValueAtTime(0, c.currentTime + fadeSecs);
    source.stop(c.currentTime + fadeSecs + 0.05);
  } catch { /* already stopped */ }
  ambiencePlaying = null;
}

let ambienceGen = 0; // supersession counter: only the latest call may start a source

export async function setAmbience(track, volume = 0.3) {
  currentAmbience = track ? { track, target: volume } : null;
  if (!state.musicEnabled) return;
  const c = ctx();
  if (!c) return;
  c.resume().catch(() => {});

  // Same bed, new volume (the temple gradient): just ramp the gain.
  if (track && ambiencePlaying?.track === track) {
    const g = ambiencePlaying.gain.gain;
    g.cancelScheduledValues(c.currentTime);
    g.setValueAtTime(g.value, c.currentTime);
    g.linearRampToValueAtTime(volume, c.currentTime + 1.2);
    return;
  }

  const gen = ++ambienceGen;
  stopPlaying();
  if (!track) return;

  const buffer = await ambienceBuffer(track);
  if (!buffer) return;
  // Superseded while decoding (even by a same-track call): bail, or two
  // sources start and the untracked one loops as an orphan forever.
  if (gen !== ambienceGen || currentAmbience?.track !== track) return;

  const source = c.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = Math.min(LOOP_TRIM_START, buffer.duration / 4);
  source.loopEnd = Math.max(source.loopStart + 1, buffer.duration - LOOP_TRIM_END);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(volume, c.currentTime + 1.5);
  source.connect(gain);
  gain.connect(ambienceGain);
  source.start(0, source.loopStart);
  ambiencePlaying = { track, source, gain };
}

export function stopAmbience() { setAmbience(null); }

// Debug/verification handle (harmless in prod; lets tests confirm the right
// bed is audible at the right volume — and gaplessly — without ears).
if (typeof window !== 'undefined') {
  window.__eamonAudio = {
    current: () => currentAmbience,
    playing: () => (ambiencePlaying ? { track: ambiencePlaying.track, gain: ambiencePlaying.gain.gain.value, loop: ambiencePlaying.source.loop, loopStart: ambiencePlaying.source.loopStart, loopEnd: ambiencePlaying.source.loopEnd, ctxState: audioCtx?.state } : null),
    sfx: (n) => playSfx(n, 0.5),
  };
}

// ── Event SFX (keyed off the engine's typed events) ─────────────────────────
// Frequent combat sounds ship as variant pools (sfx-hit-1..3 etc.); one sample
// on repeat reads as a video-game bleep within a minute.
const SFX_VARIANTS = { hit: 3, hurt: 3, miss: 3 };
const sfxCache = {};
function playSfx(name, volume = 0.5, delayMs = 0) {
  if (!state.musicEnabled) return;
  const n = SFX_VARIANTS[name] ? `${name}-${1 + Math.floor(Math.random() * SFX_VARIANTS[name])}` : name;
  const fire = () => {
    let el = sfxCache[n];
    if (!el) { el = new Audio(`audio/sfx/sfx-${n}.m4a`); sfxCache[n] = el; }
    el.currentTime = 0;
    el.volume = volume;
    // ±6% rate jitter — repeated impacts never sound machine-identical.
    el.preservesPitch = false;
    el.playbackRate = 0.94 + Math.random() * 0.12;
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
  // The kill: blow + body-fall + silence, in one sample. Heavy and hollow on
  // purpose — the spare harp's dark twin. Replaces the round's hit sound.
  if (has('enemy_defeated')) { playSfx('kill', 0.5); return; }

  // Combat exchange: player swing now, enemy answer on the animation beat.
  // Your hit rings bright steel; theirs lands as a dull close body-thud, so
  // the ear knows who is bleeding without reading.
  if (round?.player && !round.player.spell) playSfx(round.player.hit ? 'hit' : 'miss', 0.45);
  if (round?.enemy?.hit) playSfx('hurt', 0.45, 700);

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
    // Hall & shops: Tabletop Audio's "Medieval Banquet" — feast, fire and
    // crowd professionally mixed. Revive it explicitly: entering the cave
    // fades it out WITHOUT switching tracks, so switchMusic would no-op.
    stopAmbience();
    bgMusic = hallMusic;
    if (state.musicEnabled && (hallMusic.paused || hallMusic.volume < 0.29)) {
      hallMusic.play().catch(() => {});
      fadeTo(hallMusic, 0.3);
    }
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
      stopPlaying(0.2);
    }
  });

  document.getElementById('hud-voice-btn').addEventListener('click', () => {
    state.voiceEnabled = !state.voiceEnabled;
    const btn = document.getElementById('hud-voice-btn');
    btn.classList.toggle('active', state.voiceEnabled);
    if (!state.voiceEnabled && ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
  });
}
