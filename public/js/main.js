// main.js — Boot sequence, wires deterministic Great Hall-first browser flow.
// This is the only file imported by index.html.

import { PLAYER_ID, state } from './state.js';
import { updateHUD } from './hud.js';
import { addPlayerLine, startStreamLine, appendStreamToken, finishStreamLine } from './narrative.js';
import { inputEl, sendBtn, setInputState, registerSendFn, clearChoices, addChoice, renderChoices } from './input.js';
import { initAudioControls } from './audio.js';
import { registerPurchaseHandler } from './shop.js';
import { createPhase1GameClient } from './game-client.js';
import { createAuthController } from './auth-controller.js';
import { createTitleGateway } from './title-gateway.js';
import { renderAccountStatus } from './account-status.js';
import { createAccountMenu } from './account-menu.js';
import { listGameCharacters } from './api.js';
import { selectProfileCharacter } from './profile-api.js';

function renderGameResponse(response = {}) {
  if (response.state && Object.prototype.hasOwnProperty.call(response.state, 'character')) state.character = response.state.character ?? {};
  if (response.state?.phase) state.gamePhase = response.state.phase;
  updateHUD(true);

  startStreamLine();
  appendStreamToken(response.text ?? '');
  finishStreamLine();
  clearChoices();
  for (const choice of response.choices ?? []) addChoice(choice);
  renderChoices();
}

function buildGameClient(identity = null) {
  return createPhase1GameClient({
    playerId: PLAYER_ID,
    ...(identity ?? {}),
    render: renderGameResponse,
    renderPlayer: addPlayerLine,
    updateHUD: () => updateHUD(true),
  });
}

function renderCurrentAccountStatus() {
  renderAccountStatus(document.getElementById('account-status'), authController.getSession?.());
}

function resetGameplayState() {
  state.character = {};
  state.gamePhase = 'title';
  clearChoices();
  renderChoices();
}

async function switchToProfile(profileId) {
  authController.selectProfile(profileId);
  resetGameplayState();
  gameClient = buildGameClient(authController.gameIdentity());
  renderCurrentAccountStatus();
  setInputState('action', false);
  const response = await gameClient.startPhase1Game();
  setInputState(response?.state?.character ? 'action' : 'name', true);
}

async function listActiveProfileCharacters() {
  const identity = authController.gameIdentity();
  const response = await listGameCharacters(identity);
  return response.characters ?? [];
}

async function switchToCharacter(characterId) {
  const identity = authController.gameIdentity();
  await selectProfileCharacter({ ...identity, characterId });
  authController.selectCharacter(characterId);
  resetGameplayState();
  gameClient = buildGameClient(identity);
  renderCurrentAccountStatus();
  setInputState('action', false);
  const response = await gameClient.startPhase1Game();
  setInputState(response?.state?.character ? 'action' : 'name', true);
}

let gameClient = buildGameClient();
const authController = createAuthController();
renderCurrentAccountStatus();

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

// ── Boot / Title gateway ──
const titleGateway = createTitleGateway({
  elements: {
    titleScreen: document.getElementById('title-screen'),
    gameScreen: document.getElementById('game-screen'),
    existingSessionButton: document.getElementById('existing-session-btn'),
    switchAccountButton: document.getElementById('switch-account-btn'),
    guestButton: document.getElementById('enter-btn'),
    loginButton: document.getElementById('login-toggle-btn'),
    registerButton: document.getElementById('register-toggle-btn'),
    loginForm: document.getElementById('login-form'),
    registerForm: document.getElementById('register-form'),
    status: document.getElementById('title-auth-status'),
    loginUsername: document.getElementById('login-username'),
    loginPassword: document.getElementById('login-password'),
    registerUsername: document.getElementById('register-username'),
    registerEmail: document.getElementById('register-email'),
    registerPassword: document.getElementById('register-password'),
  },
  gameClient,
  authController,
  rebuildGameClient(identity) {
    gameClient = buildGameClient(identity);
    renderCurrentAccountStatus();
    return gameClient;
  },
  setStreaming(value) { state.isStreaming = value; },
  setInputState,
  renderError(err) {
    renderGameResponse({ text: err.message || 'The Great Hall is unavailable right now.', choices: [], state: { phase: 'great-hall' } });
  },
});
titleGateway.mount();

const accountMenu = createAccountMenu({
  elements: {
    toggleButton: document.getElementById('hud-account-btn'),
    panel: document.getElementById('account-menu-panel'),
    summary: document.getElementById('account-menu-summary'),
    profile: document.getElementById('account-menu-profile'),
    logoutButton: document.getElementById('account-logout-btn'),
    switchProfileButton: document.getElementById('account-switch-profile-btn'),
    switchCharacterButton: document.getElementById('account-switch-character-btn'),
    profileList: document.getElementById('account-profile-list'),
    characterList: document.getElementById('account-character-list'),
  },
  authController,
  onSwitchProfile: switchToProfile,
  onListCharacters: listActiveProfileCharacters,
  onSwitchCharacter: switchToCharacter,
  onLogout() {
    resetGameplayState();
    gameClient = buildGameClient();
    renderCurrentAccountStatus();
    updateHUD(false);
    setInputState('action', false);
    titleGateway.showTitleGateway({ form: 'login' });
  },
});
accountMenu.mount();

sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
