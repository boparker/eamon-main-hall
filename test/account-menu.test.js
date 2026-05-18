import test from 'node:test';
import assert from 'node:assert/strict';

import { createAccountMenu } from '../public/js/account-menu.js';

function element() {
  const listeners = new Map();
  return {
    hidden: true,
    disabled: false,
    textContent: '',
    dataset: {},
    classList: {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      contains(value) { return this.values.has(value); },
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    async click() { await listeners.get('click')?.({ preventDefault() {} }); },
  };
}

function makeHarness({ session = null } = {}) {
  const calls = [];
  const elements = {
    toggleButton: element(),
    panel: element(),
    summary: element(),
    profile: element(),
    logoutButton: element(),
    switchProfileButton: element(),
    switchCharacterButton: element(),
  };
  const authController = {
    getSession() { return session; },
    async logout() { calls.push({ type: 'logout' }); session = null; },
  };
  const menu = createAccountMenu({
    elements,
    authController,
    onLogout() { calls.push({ type: 'onLogout' }); },
  });
  return { menu, elements, calls };
}

test('account menu opens with signed-in user and profile actions', async () => {
  const session = {
    sessionToken: 'token',
    profileId: 'profile-1',
    user: { username: 'bo' },
    profiles: [{ id: 'profile-1', name: 'Main Adventurers' }],
  };
  const { menu, elements } = makeHarness({ session });

  menu.mount();
  await elements.toggleButton.click();

  assert.equal(elements.panel.hidden, false);
  assert.equal(elements.summary.textContent, 'Signed in as bo');
  assert.equal(elements.profile.textContent, 'Profile: Main Adventurers');
  assert.equal(elements.logoutButton.hidden, false);
  assert.equal(elements.switchProfileButton.hidden, false);
  assert.equal(elements.switchCharacterButton.hidden, false);
});

test('account menu shows guest mode and hides account-only actions', async () => {
  const { menu, elements } = makeHarness();

  menu.mount();
  await elements.toggleButton.click();

  assert.equal(elements.panel.hidden, false);
  assert.equal(elements.summary.textContent, 'Playing as guest');
  assert.equal(elements.profile.textContent, 'Progress is saved to this browser only.');
  assert.equal(elements.logoutButton.hidden, true);
  assert.equal(elements.switchProfileButton.hidden, true);
  assert.equal(elements.switchCharacterButton.hidden, true);
});

test('gameplay logout clears session and returns to title gateway', async () => {
  const session = {
    sessionToken: 'token',
    profileId: 'profile-1',
    user: { username: 'bo' },
    profiles: [{ id: 'profile-1', name: 'Main Adventurers' }],
  };
  const { menu, elements, calls } = makeHarness({ session });

  menu.mount();
  await elements.toggleButton.click();
  await elements.logoutButton.click();

  assert.deepEqual(calls, [{ type: 'logout' }, { type: 'onLogout' }]);
  assert.equal(elements.panel.hidden, true);
  assert.equal(elements.toggleButton.disabled, false);
});
