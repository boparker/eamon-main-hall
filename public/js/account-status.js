function profileName(session) {
  const profiles = Array.isArray(session?.profiles) ? session.profiles : [];
  return profiles.find((profile) => profile?.id === session?.profileId)?.name ?? null;
}

function userName(session) {
  return session?.user?.displayName
    ?? session?.user?.display_name
    ?? session?.user?.username
    ?? null;
}

export function renderAccountStatus(element, session) {
  if (!element) return;

  const name = userName(session);
  if (!session?.sessionToken && !name) {
    element.textContent = 'Guest mode';
    element.dataset.mode = 'guest';
    element.hidden = false;
    return;
  }

  const profile = profileName(session);
  element.textContent = profile ? `Signed in as ${name} · ${profile}` : `Signed in as ${name}`;
  element.dataset.mode = 'account';
  element.hidden = false;
}
