function userName(session) {
  return session?.user?.displayName
    ?? session?.user?.display_name
    ?? session?.user?.username
    ?? null;
}

function activeProfileName(session) {
  const profiles = Array.isArray(session?.profiles) ? session.profiles : [];
  return profiles.find((profile) => profile?.id === session?.profileId)?.name ?? null;
}

function activeProfile(session) {
  const profiles = Array.isArray(session?.profiles) ? session.profiles : [];
  return profiles.find((profile) => profile?.id === session?.profileId) ?? null;
}

export function createAccountMenu({
  elements,
  authController,
  document = globalThis.document,
  onLogout = () => {},
  onSwitchProfile = () => {},
  onListCharacters = () => [],
  onSwitchCharacter = () => {},
}) {
  function render() {
    const session = authController.getSession?.();
    const isAccount = Boolean(session?.sessionToken && session?.profileId);

    if (isAccount) {
      elements.summary.textContent = `Signed in as ${userName(session) ?? 'account'}`;
      elements.profile.textContent = `Profile: ${activeProfileName(session) ?? session.profileId}`;
    } else {
      elements.summary.textContent = 'Playing as guest';
      elements.profile.textContent = 'Progress is saved to this browser only.';
    }

    if (elements.logoutButton) elements.logoutButton.hidden = !isAccount;
    if (elements.switchProfileButton) elements.switchProfileButton.hidden = !isAccount;
    if (elements.switchCharacterButton) elements.switchCharacterButton.hidden = !isAccount;
  }

  function renderProfileList() {
    const session = authController.getSession?.();
    const profiles = Array.isArray(session?.profiles) ? session.profiles : [];
    if (!elements.profileList) return;
    elements.profileList.replaceChildren();
    for (const profile of profiles) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'account-menu-action';
      button.dataset.profileId = profile.id;
      button.textContent = `${profile.id === session.profileId ? '✓ ' : ''}${profile.name ?? profile.id}`;
      button.addEventListener('click', async () => {
        await onSwitchProfile(profile.id);
        closeProfileList();
        render();
      });
      elements.profileList.appendChild(button);
    }
    elements.profileList.hidden = false;
  }

  async function renderCharacterList() {
    const session = authController.getSession?.();
    const selectedCharacterId = activeProfile(session)?.selected_character_id ?? activeProfile(session)?.selectedCharacterId ?? null;
    const characters = await onListCharacters();
    if (!elements.characterList) return;
    elements.characterList.replaceChildren();
    for (const character of characters) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'account-menu-action';
      button.dataset.characterId = character.id;
      button.textContent = `${character.id === selectedCharacterId ? '✓ ' : ''}${character.name ?? character.id}`;
      button.addEventListener('click', async () => {
        await onSwitchCharacter(character.id);
        closeCharacterList();
        render();
      });
      elements.characterList.appendChild(button);
    }
    elements.characterList.hidden = false;
  }

  function closeProfileList() {
    if (elements.profileList) elements.profileList.hidden = true;
  }

  function closeCharacterList() {
    if (elements.characterList) elements.characterList.hidden = true;
  }

  function open() {
    render();
    elements.panel.hidden = false;
    elements.toggleButton?.classList?.add('active');
  }

  function close() {
    elements.panel.hidden = true;
    closeProfileList();
    closeCharacterList();
    elements.toggleButton?.classList?.remove('active');
  }

  function toggle() {
    if (elements.panel.hidden) open();
    else close();
  }

  async function logout() {
    if (elements.logoutButton) elements.logoutButton.disabled = true;
    try {
      await authController.logout?.();
      close();
      await onLogout();
    } finally {
      if (elements.logoutButton) elements.logoutButton.disabled = false;
      if (elements.toggleButton) elements.toggleButton.disabled = false;
    }
  }

  function mount() {
    close();
    elements.toggleButton?.addEventListener('click', toggle);
    elements.switchProfileButton?.addEventListener('click', renderProfileList);
    elements.switchCharacterButton?.addEventListener('click', renderCharacterList);
    elements.logoutButton?.addEventListener('click', logout);
  }

  return { mount, render, open, close, toggle, logout, renderProfileList, renderCharacterList };
}
