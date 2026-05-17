// main.js — Boot sequence, wires everything together
// This is the only file imported by index.html.

import { PLAYER_ID, state } from './state.js';
import { updateHUD } from './hud.js';
import { addPlayerLine, startStreamLine, appendStreamToken, finishStreamLine } from './narrative.js';
import { inputEl, sendBtn, setInputState, registerSendFn, clearChoices, addChoice, renderChoices } from './input.js';
import { startMusic, initAudioControls } from './audio.js';
import { registerPurchaseHandler } from './shop.js';
import * as gameApi from './api.js';
import { applyGameResponse, isActiveGameResponse, sendPhase1Command, startPhase1Game } from './game-client.js';

function renderGameText(text) {
  startStreamLine();
  appendStreamToken(text);
  finishStreamLine();
}

function renderResponse(response) {
  applyGameResponse(response, {
    state,
    renderText: renderGameText,
    clearChoices,
    addChoice,
    renderChoices,
    updateHUD,
    setInputState,
    // Intentionally do not pass setLocation in Phase 1: deterministic room names
    // should not trigger scene-image generation.
  });
}

function showError(message, enableInput = false) {
  addPlayerLine(message || '[Connection error — try refreshing]');
  setInputState('action', enableInput);
}

// ── Send Message ──
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || state.isStreaming) return;
  inputEl.value = '';

  addPlayerLine(text);
  state.isStreaming = true;
  setInputState('action', false);
  clearChoices();
  renderChoices();
  document.getElementById('thinking').style.display = 'flex';

  try {
    await sendPhase1Command({
      playerId: PLAYER_ID,
      input: text,
      api: gameApi,
      state,
      renderResponse,
    });
  } catch (err) {
    showError(err.message, isActiveGameResponse({ state: { character: state.character, adventureRun: state.gameSession?.adventureRun } }));
  } finally {
    document.getElementById('thinking').style.display = 'none';
    state.isStreaming = false;
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
const enterBtn = document.getElementById('enter-btn');
enterBtn.addEventListener('click', async () => {
  if (state.isStreaming || state.gamePhase === 'playing') return;
  enterBtn.disabled = true;

  state.isStreaming = true;
  setInputState('name', false);
  document.getElementById('thinking').style.display = 'flex';

  try {
    await startPhase1Game({
      playerId: PLAYER_ID,
      promptName: () => window.prompt('What is your adventurer\'s name?', 'Adventurer'),
      api: gameApi,
      state,
      renderResponse,
    });

    document.getElementById('game-screen').classList.add('active');
    if (state.musicEnabled) startMusic();
    document.getElementById('title-screen').classList.add('fade-out');
    setTimeout(() => document.getElementById('title-screen').style.display = 'none', 1200);
    state.gamePhase = 'playing';
  } catch (err) {
    showError(err.message, false);
    enterBtn.disabled = false;
  } finally {
    document.getElementById('thinking').style.display = 'none';
    state.isStreaming = false;
  }
});

sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
