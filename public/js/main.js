// main.js — Boot sequence, wires deterministic Great Hall-first browser flow.
// This is the only file imported by index.html.

import { PLAYER_ID, state } from './state.js';
import { updateHUD } from './hud.js';
import { addPlayerLine, renderNarrative } from './narrative.js';
import { inputEl, sendBtn, setInputState, registerSendFn, clearChoices, addChoice, renderChoices, setRoomItems } from './input.js';
import { initAudioControls, updateAudioForResponse } from './audio.js';
import { registerPurchaseHandler, openShop, closeShop } from './shop.js';
import { registerGateHandler, openGate, closeGate } from './gate.js';
import { registerRecordsHandler, openRecords, closeRecords } from './records.js';
import { setLocation, setSceneBackground, renderRoomCharacters, clearRoomCharacters } from './scene.js';
import { createPhase1GameClient } from './game-client.js';
import { createAuthController } from './auth-controller.js';
import { createTitleGateway } from './title-gateway.js';
import { renderAccountStatus } from './account-status.js';
import { createAccountMenu } from './account-menu.js';
import { listGameCharacters } from './api.js';
import { createProfile, selectProfileCharacter, claimGuestCharacter } from './profile-api.js';
import { initHelpMenu } from './help-menu.js';
import { createCreationCard } from './creation-card.js';
import { renderCombat, hideCombat, dismissCombatWithOutcome, registerCombatAction, registerCombatReturnToHall } from './combat-scene.js';
import { updateJournalMap, initJournalMap } from './journal-map.js';

const creationCard = createCreationCard({
  submit: (text) => { inputEl.value = text; sendMessage(); },
  onCancel: () => cancelCharacterCreation(),
});

function renderGameResponse(response = {}) {
  if (response.state && Object.prototype.hasOwnProperty.call(response.state, 'character')) state.character = response.state.character ?? {};
  if (response.state?.phase) state.gamePhase = response.state.phase;
  if (response.state?.locationTitle) setLocation(response.state.locationTitle);
  if (response.state?.background) setSceneBackground(response.state.background);
  if (response.state?.shop) openShop(response.state.shop);
  else closeShop();
  if (response.state?.gate) openGate(response.state.gate);
  else closeGate();
  if (response.state?.records) openRecords(response.state.records);
  else closeRecords();
  updateJournalMap(response.state);
  updateHUD(true);

  // Help text follows the player: shop → vendor tips, in a cave → dungeon
  // commands, otherwise Great Hall guidance.
  const helpContext = response.state?.shop ? 'shop' : (response.state?.phase === 'adventure' ? 'adventure' : 'hall');
  helpMenu?.setContext?.(helpContext);

  updateAudioForResponse(response);

  renderNarrative(response.text ?? '', { locationTitle: response.state?.locationTitle });
  clearChoices();
  setRoomItems(response.state?.items);
  for (const choice of response.choices ?? []) addChoice(choice);
  renderChoices();

  creationCard.sync(gameClient?.getState?.().creation);

  if (response.state?.combat) renderCombat(response.state.combat, response.choices, response.text);
  else if ((response.events ?? [response.event]).filter(Boolean).some((e) => e.type === 'enemy_fled')) dismissCombatWithOutcome(response.text);
  else hideCombat();

  updateRoomRail(response);
}

// The Room rail: a portrait card for every character present (up top) plus the
// item tiles (below). Cleared in shops, combat, or back at the Hall. The rail
// is shown whenever there's anyone or anything in the room.
function updateRoomRail(response) {
  const rail = document.getElementById('room-rail');
  if (response.state?.shop || response.state?.combat) {
    clearRoomCharacters();
    if (rail) rail.hidden = true;
    return;
  }

  // A Hall vendor (healer/bank) shows its portrait in the rail beside the text.
  if (response.state?.vendor) {
    const v = response.state.vendor;
    const vslug = v.slug || (/aldous|chapel|healer|hand/i.test(v.name) ? 'aldous'
      : /seamus|bank|fenney/i.test(v.name) ? 'seamus' : null);
    renderRoomCharacters([{
      name: v.name,
      kind: v.kind ?? 'neutral',
      image: vslug ? `scenes/portraits/${vslug}.png` : undefined,
    }]);
    const itemsSection = document.getElementById('room-items-section');
    if (itemsSection) itemsSection.hidden = true;
    if (rail) rail.hidden = false;
    positionRoomRail();
    return;
  }

  const characters = response.state?.entities?.characters;
  if (Array.isArray(characters)) {
    // Prefer the server's resolved disposition (handles charisma friend-or-foe
    // rolls); fall back to the static fields for older payloads.
    const kindOf = (c) => {
      const d = c.disposition
        ?? (c.type === 'enemy' || c.type === 'boss' || c.friendliness === 'hostile' ? 'hostile'
          : c.friendliness === 'friendly' ? 'friendly' : 'neutral');
      return d === 'hostile' ? 'monster' : d === 'friendly' ? 'friendly' : 'neutral';
    };
    // Painted portraits live beside the room art: scenes/<adventure>/portraits/<slug>.png
    // Resolve from the run's adventure id — present on every response — and only
    // fall back to parsing the background path (absent on e.g. parley responses,
    // which used to monogram every rail card after speaking).
    const advId = response.state?.adventureRun?.adventureId ?? response.state?.run?.adventureId;
    const portraitDir = advId
      ? `scenes/${advId}/portraits/`
      : (response.state?.background || '').replace(/room-\d+\.png.*$/, 'portraits/');
    const people = characters
      .filter((c) => c.type !== 'merchant')
      .map((c) => ({
        name: c.name ?? c.slug,
        kind: kindOf(c),
        following: c.following === true,
        image: portraitDir && c.slug ? `${portraitDir}${c.slug}.png` : undefined,
      }));
    renderRoomCharacters(people);
  } else if (response.state?.phase && response.state.phase !== 'adventure') {
    clearRoomCharacters();
  }
  // (When entities are absent mid-adventure — e.g. a take action — leave the
  // character cards as they are; the item tiles below them still refresh.)

  // The "Items in the Room" section appears only when there are tiles.
  const tiles = document.getElementById('object-tiles');
  const itemsSection = document.getElementById('room-items-section');
  const hasItems = !!tiles && tiles.children.length > 0;
  if (itemsSection) itemsSection.hidden = !hasItems;

  const hasChars = document.getElementById('room-characters')?.children.length > 0;
  if (rail) rail.hidden = !(hasChars || hasItems);
  positionRoomRail();
}

// On wide screens the rail is pinned to the right; align its top with the top of
// the narrative field (just below the room title) so cards never sit behind the
// room name. On narrow screens the rail flows in normal order, so clear the top.
function positionRoomRail() {
  const rail = document.getElementById('room-rail');
  const area = document.getElementById('narrative-area');
  if (!rail || !area) return;
  if (window.innerWidth >= 1000) {
    const scroll = document.getElementById('narrative-scroll');
    const title = document.getElementById('location-title');
    const titleBottom = title ? title.getBoundingClientRect().bottom : 0;
    const proseTop = scroll ? scroll.getBoundingClientRect().top : area.getBoundingClientRect().top;
    // Line the first card's top up with the narrative box's top edge, but never
    // let it ride up behind the room title.
    rail.style.top = `${Math.round(Math.max(proseTop, titleBottom + 12))}px`;
  } else {
    rail.style.top = '';
  }
}
window.addEventListener('resize', positionRoomRail);

function buildGameClient(identity = null) {
  return createPhase1GameClient({
    playerId: PLAYER_ID,
    ...(identity ?? {}),
    render: renderGameResponse,
    renderPlayer: addPlayerLine,
    updateHUD: () => updateHUD(true),
    onAccountRequired: handleAccountRequired,
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

async function createAndSwitchToProfile(name) {
  const identity = authController.gameIdentity();
  const payload = await createProfile({ sessionToken: identity?.sessionToken, name });
  authController.addProfile(payload.profile);
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

let gameClient;
let titleGateway;
let pendingGuestClaim = null;

function handleAccountRequired(context) {
  if (context?.playerId && context?.character?.id) {
    pendingGuestClaim = {
      guestPlayerId: context.playerId,
      characterId: context.character.id,
      adventureId: context.adventureId,
    };
  }
  titleGateway?.showTitleGateway({ form: 'register' });
}

async function preservePendingGuestClaim(identity) {
  if (!pendingGuestClaim || !identity?.sessionToken || !identity?.profileId) return undefined;
  const claim = pendingGuestClaim;
  pendingGuestClaim = null;
  const payload = await claimGuestCharacter({
    sessionToken: identity.sessionToken,
    profileId: identity.profileId,
    guestPlayerId: claim.guestPlayerId,
    characterId: claim.characterId,
  });
  authController.selectCharacter(payload.character.id);
  resetGameplayState();
  gameClient = buildGameClient(authController.gameIdentity());
  renderCurrentAccountStatus();
  setInputState('action', false);
  const response = await gameClient.startPhase1Game();
  setInputState(response?.state?.character ? 'action' : 'name', true);
  return response;
}

gameClient = buildGameClient();
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

// Abandon the character-creation card and return to the Great Hall.
async function cancelCharacterCreation() {
  if (state.isStreaming) return;
  creationCard.hide();
  state.isStreaming = true;
  setInputState('action', false);
  try {
    await gameClient.cancelCreation();
  } catch (err) {
    renderGameResponse({ text: err.message || 'The Great Hall is unavailable right now.', choices: [], state: { phase: 'great-hall' } });
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
registerGateHandler((text) => {
  inputEl.value = text;
  sendMessage();
});
registerRecordsHandler((text) => {
  inputEl.value = text;
  sendMessage();
});
registerCombatAction((text) => {
  inputEl.value = text;
  sendMessage();
});
// On death, the combat scene's "Return to the Guild Hall" re-bootstraps the hall.
registerCombatReturnToHall(async () => {
  if (state.isStreaming) return;
  hideCombat();
  state.isStreaming = true;
  setInputState('action', false);
  try {
    const response = await gameClient.startPhase1Game();
    setInputState(response?.state?.character ? 'action' : 'name', true);
  } catch (err) {
    renderGameResponse({ text: err.message || 'The Guild Hall is unavailable right now.', choices: [], state: { phase: 'great-hall' } });
  } finally {
    state.isStreaming = false;
  }
});

// ── Audio controls ──
initAudioControls();
initJournalMap();
const helpMenu = initHelpMenu();

// ── Boot / Title gateway ──
titleGateway = createTitleGateway({
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
    registerPasswordConfirm: document.getElementById('register-password-confirm'),
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
  onAuthenticated({ identity }) {
    return preservePendingGuestClaim(identity);
  },
  renderError(err) {
    renderGameResponse({ text: err.message || 'The Great Hall is unavailable right now.', choices: [], state: { phase: 'great-hall' } });
  },
});
titleGateway.mount();

// Back links inside the auth forms return to the entry choices
document.querySelectorAll('[data-auth-back]').forEach((btn) => {
  btn.addEventListener('click', () => titleGateway.showForm(null));
});

const accountMenu = createAccountMenu({
  elements: {
    toggleButton: document.getElementById('hud-account-btn'),
    panel: document.getElementById('account-menu-panel'),
    summary: document.getElementById('account-menu-summary'),
    profile: document.getElementById('account-menu-profile'),
    logoutButton: document.getElementById('account-logout-btn'),
    switchProfileButton: document.getElementById('account-switch-profile-btn'),
    createProfileButton: document.getElementById('account-create-profile-btn'),
    createProfileForm: document.getElementById('account-create-profile-form'),
    createProfileName: document.getElementById('account-create-profile-name'),
    switchCharacterButton: document.getElementById('account-switch-character-btn'),
    profileList: document.getElementById('account-profile-list'),
    characterList: document.getElementById('account-character-list'),
  },
  authController,
  onSwitchProfile: switchToProfile,
  onCreateProfile: createAndSwitchToProfile,
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
