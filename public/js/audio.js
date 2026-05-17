// audio.js — Music crossfade, TTS (ElevenLabs + browser fallback)

import { state } from './state.js';

// ── Music ──
export const hallMusic = new Audio('concrete-omen.mp3');
hallMusic.loop = true;
hallMusic.volume = 0;

export const adventureMusic = new Audio('lead-drip-psalm.mp3');
adventureMusic.loop = true;
adventureMusic.volume = 0;

let bgMusic = hallMusic;

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
  const musicBtn = document.getElementById('hud-music-btn');
  const voiceBtn = document.getElementById('hud-voice-btn');
  musicBtn.classList.toggle('active', state.musicEnabled);
  musicBtn.textContent = state.musicEnabled ? '\u{1F3B5}' : '\u{1F507}';
  voiceBtn.classList.toggle('active', state.voiceEnabled);
  voiceBtn.textContent = state.voiceEnabled ? '\u{1F50A}' : '\u{1F507}';

  document.getElementById('hud-music-btn').addEventListener('click', () => {
    state.musicEnabled = !state.musicEnabled;
    const btn = document.getElementById('hud-music-btn');
    btn.classList.toggle('active', state.musicEnabled);
    btn.textContent = state.musicEnabled ? '\u{1F3B5}' : '\u{1F507}';
    if (state.musicEnabled) {
      bgMusic.play().catch(() => {});
      bgMusic.volume = 0.3;
    } else {
      hallMusic.pause();
      adventureMusic.pause();
    }
  });

  document.getElementById('hud-voice-btn').addEventListener('click', () => {
    state.voiceEnabled = !state.voiceEnabled;
    const btn = document.getElementById('hud-voice-btn');
    btn.classList.toggle('active', state.voiceEnabled);
    btn.textContent = state.voiceEnabled ? '\u{1F50A}' : '\u{1F507}';
    if (!state.voiceEnabled && ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
  });
}
