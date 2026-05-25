import test from 'node:test';
import assert from 'node:assert/strict';

import { renderAccountStatus } from '../public/js/account-status.js';

function element() {
  return { textContent: '', hidden: false, dataset: {} };
}

test('renderAccountStatus shows signed-in user and profile in gameplay HUD', () => {
  const accountEl = element();
  const session = {
    user: { username: 'bo' },
    profileId: 'profile-1',
    profiles: [{ id: 'profile-1', name: 'Main Adventurers' }],
  };

  renderAccountStatus(accountEl, session);

  assert.equal(accountEl.hidden, false);
  assert.equal(accountEl.textContent, 'Signed in as bo · Main Adventurers');
  assert.equal(accountEl.dataset.mode, 'account');
});

test('renderAccountStatus suppresses duplicate account/profile names', () => {
  const accountEl = element();
  const session = {
    user: { username: 'Bo Parker' },
    profileId: 'profile-1',
    profiles: [{ id: 'profile-1', name: 'bo parker' }],
  };

  renderAccountStatus(accountEl, session);

  assert.equal(accountEl.hidden, false);
  assert.equal(accountEl.textContent, 'Signed in as Bo Parker');
  assert.equal(accountEl.dataset.mode, 'account');
});

test('renderAccountStatus shows guest mode when no account session exists', () => {
  const accountEl = element();

  renderAccountStatus(accountEl, null);

  assert.equal(accountEl.hidden, false);
  assert.equal(accountEl.textContent, 'Guest mode');
  assert.equal(accountEl.dataset.mode, 'guest');
});
