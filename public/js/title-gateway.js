export function createTitleGateway({
  elements,
  gameClient,
  authController,
  setInputState,
  setStreaming,
  rebuildGameClient = () => gameClient,
  onAuthenticated = null,
  renderError = () => {},
  hideDelayMs = 1200,
} = {}) {
  let currentGameClient = gameClient;

  function showGame(response) {
    elements.gameScreen.classList.add('active');
    elements.titleScreen.classList.add('fade-out');
    setTimeout(() => { elements.titleScreen.style.display = 'none'; }, hideDelayMs);
    setInputState(response?.state?.character ? 'action' : 'name', true);
  }

  async function start(identity = null) {
    if (elements.guestButton?.disabled) return null;
    elements.guestButton.disabled = true;
    setStreaming(true);
    setInputState('action', false);
    try {
      currentGameClient = rebuildGameClient(identity);
      const response = await currentGameClient.startPhase1Game();
      showGame(response);
      return response;
    } catch (err) {
      elements.guestButton.disabled = false;
      renderError(err);
      setInputState('action', true);
      return null;
    } finally {
      setStreaming(false);
    }
  }

  function showForm(kind) {
    if (elements.loginForm) elements.loginForm.hidden = kind !== 'login';
    if (elements.registerForm) elements.registerForm.hidden = kind !== 'register';
    if (elements.status) elements.status.textContent = '';
  }

  async function authenticate(kind) {
    const input = kind === 'login'
      ? {
          username: elements.loginUsername.value.trim(),
          password: elements.loginPassword.value,
        }
      : {
          username: elements.registerUsername.value.trim(),
          email: elements.registerEmail.value.trim(),
          password: elements.registerPassword.value,
        };
    if (kind === 'register') {
      const passwordConfirm = elements.registerPasswordConfirm?.value ?? input.password;
      if (!input.email) throw new Error('Email is required to create an account.');
      if (input.password !== passwordConfirm) throw new Error('Passwords do not match.');
    }
    const session = kind === 'login'
      ? await authController.login(input)
      : await authController.register(input);
    const identity = authController.gameIdentity?.() ?? (session ? { sessionToken: session.sessionToken, profileId: session.profileId } : null);
    if (onAuthenticated) {
      const response = await onAuthenticated({ kind, session, identity });
      if (response !== undefined) {
        showGame(response);
        return response;
      }
    }
    return start(identity);
  }

  function displayNameForSession(session) {
    const name = session?.user?.displayName ?? session?.user?.display_name ?? session?.user?.username ?? 'ACCOUNT';
    return String(name).trim().toUpperCase() || 'ACCOUNT';
  }

  function hideStoredSessionControls() {
    if (elements.existingSessionButton) elements.existingSessionButton.hidden = true;
    if (elements.switchAccountButton) elements.switchAccountButton.hidden = true;
  }

  async function switchAccount() {
    await authController.logout?.();
    hideStoredSessionControls();
    showForm('login');
    return null;
  }

  function showTitleGateway({ form = 'login' } = {}) {
    elements.gameScreen?.classList?.remove('active');
    elements.titleScreen?.classList?.remove('fade-out');
    if (elements.titleScreen?.style) elements.titleScreen.style.display = '';
    hideStoredSessionControls();
    if (elements.guestButton) elements.guestButton.disabled = false;
    showForm(form);
  }

  function mountStoredSession() {
    const session = authController.getSession?.();
    if (!elements.existingSessionButton) return;
    if (!session?.sessionToken || !session?.profileId) {
      hideStoredSessionControls();
      return;
    }
    elements.existingSessionButton.hidden = false;
    elements.existingSessionButton.textContent = `CONTINUE AS ${displayNameForSession(session)}`;
    elements.existingSessionButton.addEventListener('click', () => start(authController.gameIdentity()));
    if (elements.switchAccountButton) {
      elements.switchAccountButton.hidden = false;
      elements.switchAccountButton.addEventListener('click', () => switchAccount());
    }
  }

  function mount() {
    mountStoredSession();
    elements.guestButton?.addEventListener('click', () => start(null));
    elements.loginButton?.addEventListener('click', () => showForm('login'));
    elements.registerButton?.addEventListener('click', () => showForm('register'));
    elements.loginForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      return authenticate('login');
    });
    elements.registerForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      return authenticate('register');
    });
  }

  return { mount, start, authenticate, showForm, switchAccount, showTitleGateway };
}
