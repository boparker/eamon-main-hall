import test from 'node:test';
import assert from 'node:assert/strict';

import { createAccountMenu } from '../public/js/account-menu.js';

function element() {
  const listeners = new Map();
  const children = [];
  return {
    hidden: true,
    disabled: false,
    textContent: '',
    dataset: {},
    children,
    innerHTML: '',
    appendChild(child) { children.push(child); return child; },
    replaceChildren(...newChildren) { children.splice(0, children.length, ...newChildren); },
    classList: {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      contains(value) { return this.values.has(value); },
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    async click() { await listeners.get('click')?.({ preventDefault() {} }); },
    async submit() { await listeners.get('submit')?.({ preventDefault() {} }); },
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
    createProfileButton: element(),
    createProfileForm: element(),
    createProfileName: element(),
    switchCharacterButton: element(),
    profileList: element(),
    characterList: element(),
  };
  const authController = {
    getSession() { return session; },
    async logout() { calls.push({ type: 'logout' }); session = null; },
  };
  const document = {
    createElement(tagName) {
      const node = element();
      node.tagName = tagName.toUpperCase();
      return node;
    },
  };
  const menu = createAccountMenu({
    elements,
    authController,
    document,
    onLogout() { calls.push({ type: 'onLogout' }); },
    async onSwitchProfile(profileId) { calls.push({ type: 'onSwitchProfile', profileId }); },
    async onCreateProfile(name) { calls.push({ type: 'onCreateProfile', name }); },
    async onListCharacters() { calls.push({ type: 'onListCharacters' }); return session?.characters ?? []; },
    async onSwitchCharacter(characterId) { calls.push({ type: 'onSwitchCharacter', characterId }); },
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
  assert.equal(elements.createProfileButton.hidden, false);
  assert.equal(elements.switchCharacterButton.hidden, false);
});

test('account menu shows guest mode and hides account-only actions', async () => {
  const { menu, elements } = makeHarness();

  menu.mount();
  await elements.toggleButton.click();

  assert.equal(elements.panel.hidden, false);
  assert.equal(elements.summary.textContent, 'Playing as guest');
  assert.equal(elements.profile.textContent, 'You can create and equip an adventurer here. Preserve the adventurer with an account before the first expedition.');
  assert.equal(elements.logoutButton.hidden, true);
  assert.equal(elements.switchProfileButton.hidden, true);
  assert.equal(elements.createProfileButton.hidden, true);
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

test('switch profile renders account profiles and invokes profile switch callback', async () => {
  const session = {
    sessionToken: 'token',
    profileId: 'profile-1',
    user: { username: 'bo' },
    profiles: [
      { id: 'profile-1', name: 'Main Adventurers' },
      { id: 'profile-2', name: 'Testing Party' },
    ],
  };
  const { menu, elements, calls } = makeHarness({ session });

  menu.mount();
  await elements.toggleButton.click();
  await elements.switchProfileButton.click();

  assert.equal(elements.profileList.hidden, false);
  assert.equal(elements.profileList.children.length, 2);
  assert.equal(elements.profileList.children[0].textContent, '✓ Main Adventurers');
  assert.equal(elements.profileList.children[1].textContent, 'Testing Party');

  await elements.profileList.children[1].click();

  assert.deepEqual(calls.filter((call) => call.type === 'onSwitchProfile'), [{ type: 'onSwitchProfile', profileId: 'profile-2' }]);
});

test('create profile submits a profile name and hides the form after callback', async () => {
  const session = {
    sessionToken: 'token',
    profileId: 'profile-1',
    user: { username: 'bo' },
    profiles: [{ id: 'profile-1', name: 'Main Adventurers' }],
  };
  const { menu, elements, calls } = makeHarness({ session });

  menu.mount();
  await elements.toggleButton.click();
  await elements.createProfileButton.click();
  assert.equal(elements.createProfileForm.hidden, false);

  elements.createProfileName.value = 'New Party';
  await elements.createProfileForm.submit();

  assert.deepEqual(calls.filter((call) => call.type === 'onCreateProfile'), [{ type: 'onCreateProfile', name: 'New Party' }]);
  assert.equal(elements.createProfileForm.hidden, true);
  assert.equal(elements.createProfileName.value, '');
});

test('switch character renders current profile characters and invokes character switch callback', async () => {
  const session = {
    sessionToken: 'token',
    profileId: 'profile-1',
    user: { username: 'bo' },
    profiles: [{ id: 'profile-1', name: 'Main Adventurers', selected_character_id: 'char-2' }],
    characters: [
      { id: 'char-1', name: 'Mara' },
      { id: 'char-2', name: 'Talon' },
    ],
  };
  const { menu, elements, calls } = makeHarness({ session });

  menu.mount();
  await elements.toggleButton.click();
  await elements.switchCharacterButton.click();

  assert.equal(elements.characterList.hidden, false);
  assert.equal(elements.characterList.children.length, 2);
  assert.equal(elements.characterList.children[0].textContent, 'Mara');
  assert.equal(elements.characterList.children[1].textContent, '✓ Talon');

  await elements.characterList.children[0].click();

  assert.deepEqual(calls.filter((call) => call.type === 'onListCharacters'), [{ type: 'onListCharacters' }]);
  assert.deepEqual(calls.filter((call) => call.type === 'onSwitchCharacter'), [{ type: 'onSwitchCharacter', characterId: 'char-1' }]);
});
