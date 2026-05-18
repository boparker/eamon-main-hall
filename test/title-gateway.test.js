import test from 'node:test';
import assert from 'node:assert/strict';

import { createTitleGateway } from '../public/js/title-gateway.js';

function element({ value = '' } = {}) {
  const listeners = new Map();
  const classes = new Set();
  return {
    value,
    textContent: '',
    disabled: false,
    hidden: false,
    style: {},
    dataset: {},
    addEventListener(type, fn) { listeners.set(type, fn); },
    async click() { await listeners.get('click')?.({ preventDefault() {} }); },
    async submit() { await listeners.get('submit')?.({ preventDefault() {} }); },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
  };
}

function makeHarness({ session = null } = {}) {
  const elements = {
    titleScreen: element(),
    gameScreen: element(),
    guestButton: element(),
    loginButton: element(),
    registerButton: element(),
    loginForm: element(),
    registerForm: element(),
    status: element(),
    existingSessionButton: element(),
    switchAccountButton: element(),
    loginUsername: element({ value: 'bo' }),
    loginPassword: element({ value: 'secret-pass' }),
    registerUsername: element({ value: 'newbo' }),
    registerEmail: element({ value: 'bo@example.com' }),
    registerPassword: element({ value: 'secret-pass' }),
  };
  const calls = [];
  const gameClient = {
    async startPhase1Game() {
      calls.push({ type: 'startPhase1Game' });
      return { state: { character: { id: 'char-1' } } };
    },
  };
  const authController = {
    getSession() { return session; },
    gameIdentity() { return session ? { sessionToken: session.sessionToken, profileId: session.profileId } : null; },
    async login(input) { calls.push({ type: 'login', input }); session = { sessionToken: 'login-token', profileId: 'profile-1' }; return session; },
    async register(input) { calls.push({ type: 'register', input }); session = { sessionToken: 'register-token', profileId: 'profile-1' }; return session; },
    async logout() { calls.push({ type: 'logout' }); session = null; },
  };
  const gateway = createTitleGateway({
    elements,
    gameClient,
    authController,
    setInputState(mode, enabled) { calls.push({ type: 'setInputState', mode, enabled }); },
    setStreaming(value) { calls.push({ type: 'setStreaming', value }); },
    rebuildGameClient(identity) { calls.push({ type: 'rebuildGameClient', identity }); return gameClient; },
    hideDelayMs: 0,
  });
  return { gateway, elements, calls };
}

test('guest path starts the existing game flow from the dragon title screen', async () => {
  const { gateway, elements, calls } = makeHarness();
  gateway.mount();

  await elements.guestButton.click();

  assert.deepEqual(calls.filter((call) => call.type === 'rebuildGameClient'), [{ type: 'rebuildGameClient', identity: null }]);
  assert.equal(calls.some((call) => call.type === 'startPhase1Game'), true);
  assert.equal(elements.gameScreen.classList.contains('active'), true);
  assert.equal(elements.titleScreen.classList.contains('fade-out'), true);
});

test('login path authenticates on the title screen and enters with account identity', async () => {
  const { gateway, elements, calls } = makeHarness();
  gateway.mount();

  await elements.loginForm.submit();

  assert.deepEqual(calls.filter((call) => call.type === 'login'), [{
    type: 'login',
    input: { username: 'bo', password: 'secret-pass' },
  }]);
  assert.deepEqual(calls.filter((call) => call.type === 'rebuildGameClient'), [{
    type: 'rebuildGameClient',
    identity: { sessionToken: 'login-token', profileId: 'profile-1' },
  }]);
  assert.equal(elements.gameScreen.classList.contains('active'), true);
});

test('register path creates an account on the title screen and enters with account identity', async () => {
  const { gateway, elements, calls } = makeHarness();
  gateway.mount();

  await elements.registerForm.submit();

  assert.deepEqual(calls.filter((call) => call.type === 'register'), [{
    type: 'register',
    input: { username: 'newbo', email: 'bo@example.com', password: 'secret-pass' },
  }]);
  assert.equal(elements.gameScreen.classList.contains('active'), true);
});

test('title screen toggles login and register forms in place', async () => {
  const { gateway, elements } = makeHarness();
  gateway.mount();

  await elements.loginButton.click();
  assert.equal(elements.loginForm.hidden, false);
  assert.equal(elements.registerForm.hidden, true);

  await elements.registerButton.click();
  assert.equal(elements.loginForm.hidden, true);
  assert.equal(elements.registerForm.hidden, false);
});

test('stored account session shows continue account choice and enters with account identity', async () => {
  const session = {
    sessionToken: 'stored-token',
    profileId: 'profile-1',
    user: { username: 'bo' },
  };
  const { gateway, elements, calls } = makeHarness({ session });
  gateway.mount();

  assert.equal(elements.existingSessionButton.hidden, false);
  assert.equal(elements.existingSessionButton.textContent, 'CONTINUE AS BO');

  await elements.existingSessionButton.click();

  assert.deepEqual(calls.filter((call) => call.type === 'rebuildGameClient'), [{
    type: 'rebuildGameClient',
    identity: { sessionToken: 'stored-token', profileId: 'profile-1' },
  }]);
  assert.equal(elements.gameScreen.classList.contains('active'), true);
});

test('switch account clears stored session and keeps player on title gateway', async () => {
  const session = {
    sessionToken: 'stored-token',
    profileId: 'profile-1',
    user: { username: 'bo' },
  };
  const { gateway, elements, calls } = makeHarness({ session });
  gateway.mount();

  assert.equal(elements.switchAccountButton.hidden, false);

  await elements.switchAccountButton.click();

  assert.deepEqual(calls.filter((call) => call.type === 'logout'), [{ type: 'logout' }]);
  assert.equal(elements.existingSessionButton.hidden, true);
  assert.equal(elements.switchAccountButton.hidden, true);
  assert.equal(elements.loginForm.hidden, false);
  assert.equal(elements.registerForm.hidden, true);
  assert.equal(elements.gameScreen.classList.contains('active'), false);
  assert.equal(calls.some((call) => call.type === 'startPhase1Game'), false);
});

test('title gateway can be restored after gameplay logout', async () => {
  const session = {
    sessionToken: 'stored-token',
    profileId: 'profile-1',
    user: { username: 'bo' },
    profiles: [{ id: 'profile-1', name: 'Main Adventurers' }],
  };
  const { gateway, elements } = makeHarness({ session });
  gateway.mount();
  await elements.existingSessionButton.click();

  gateway.showTitleGateway({ form: 'login' });

  assert.equal(elements.gameScreen.classList.contains('active'), false);
  assert.equal(elements.titleScreen.classList.contains('fade-out'), false);
  assert.equal(elements.titleScreen.style.display, '');
  assert.equal(elements.existingSessionButton.hidden, true);
  assert.equal(elements.switchAccountButton.hidden, true);
  assert.equal(elements.loginForm.hidden, false);
});
