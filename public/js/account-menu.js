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

export function createAccountMenu({
  elements,
  authController,
  onLogout = () => {},
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

  function open() {
    render();
    elements.panel.hidden = false;
    elements.toggleButton?.classList?.add('active');
  }

  function close() {
    elements.panel.hidden = true;
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
    elements.logoutButton?.addEventListener('click', logout);
  }

  return { mount, render, open, close, toggle, logout };
}
