// main.js — Boot sequence, wires deterministic Great Hall-first browser flow.
// This is the only file imported by index.html.

import { PLAYER_ID, state } from './state.js';
import { updateHUD } from './hud.js';
import { addPlayerLine, startStreamLine, appendStreamToken, finishStreamLine } from './narrative.js';
import { inputEl, sendBtn, setInputState, registerSendFn, clearChoices, addChoice, renderChoices } from './input.js';
import { startMusic, initAudioControls } from './audio.js';
import { registerPurchaseHandler } from './shop.js';
import { createPhase1GameClient } from './game-client.js';

function renderGameResponse(response = {}) {
  if (response.state?.character) state.character = response.state.character;
  if (response.state?.phase) state.gamePhase = response.state.phase;
  updateHUD(true);

  startStreamLine();
  appendStreamToken(response.text ?? '');
  finishStreamLine();
  clearChoices();
  for (const choice of response.choices ?? []) addChoice(choice);
  renderChoices();
}

const gameClient = createPhase1GameClient({
  playerId: PLAYER_ID,
  render: renderGameResponse,
  renderPlayer: addPlayerLine,
  updateHUD: () => updateHUD(true),
});

// ── Send Message ──
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || state.isStreaming) return;
  inputEl.value = '';
  state.isStreaming = true;
  setInputState('action', false);
  try {
    await gameClient.handleInput(text);
  } catch (err) {
    renderGameResponse({ text: err.message || 'The Great Hall clerk cannot process that right now.', choices: [], state: { phase: 'great-hall' } });
  } finally {
    state.isStreaming = false;
    setInputState('action', true);
  }
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
  const enterBtn = document.getElementById('enter-btn');
  if (state.isStreaming) return;
  enterBtn.disabled = true;
  state.isStreaming = true;
  setInputState('action', false);
  try {
    const response = await gameClient.startPhase1Game();
    document.getElementById('game-screen').classList.add('active');
    startMusic();
    document.getElementById('title-screen').classList.add('fade-out');
    setTimeout(() => { document.getElementById('title-screen').style.display = 'none'; }, 1200);
    setInputState(response?.state?.character ? 'action' : 'name', true);
  } catch (err) {
    enterBtn.disabled = false;
    renderGameResponse({ text: err.message || 'The Great Hall is unavailable right now.', choices: [], state: { phase: 'great-hall' } });
    setInputState('action', true);
  } finally {
    state.isStreaming = false;
  }
});

sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
