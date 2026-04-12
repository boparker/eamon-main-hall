// main.js — Boot sequence, wires everything together
// This is the only file imported by index.html.

import { SESSION_ID, state } from './state.js';
import { updateHUD } from './hud.js';
import { addPlayerLine } from './narrative.js';
import { inputEl, sendBtn, setInputState, registerSendFn } from './input.js';
import { streamMessage } from './stream.js';
import { startMusic, initAudioControls } from './audio.js';
import { registerPurchaseHandler } from './shop.js';

// ── Send Message ──
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || state.isStreaming) return;
  inputEl.value = '';

  if (state.gamePhase === 'intro') {
    state.character.name = text.split(' ').slice(0, 3).join(' ');
    document.getElementById('hud-name').textContent = state.character.name;
    state.gamePhase = 'named';
  } else if (state.gamePhase === 'named') {
    state.gamePhase = 'classed';
  }
  if (state.gamePhase === 'classed') state.gamePhase = 'playing';

  addPlayerLine(text);
  await streamMessage('/api/chat', { sessionId: SESSION_ID, message: text });
}

// ── Wire up cross-module callbacks ──
// Choices and shop need to trigger sendMessage without circular imports
registerSendFn(sendMessage);
registerPurchaseHandler((text) => {
  inputEl.value = text;
  sendMessage();
});

// ── Audio controls ──
initAudioControls();

// ── Boot ──
document.getElementById('enter-btn').addEventListener('click', async () => {
  document.getElementById('game-screen').classList.add('active');
  startMusic();
  document.getElementById('title-screen').classList.add('fade-out');
  setTimeout(() => document.getElementById('title-screen').style.display = 'none', 1200);
  await streamMessage('/api/start', { sessionId: SESSION_ID });
});

sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
