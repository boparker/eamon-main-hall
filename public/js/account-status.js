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
  if (!session?.sessionToken && !session?.token && !name && !session?.profileId) {
    element.textContent = 'Guest mode';
    element.dataset.mode = 'guest';
    element.hidden = false;
    return;
  }

  const accountLabel = name ?? 'account';
  const profile = profileName(session);
  element.textContent = profile ? `Signed in as ${accountLabel} · ${profile}` : `Signed in as ${accountLabel}`;
  element.dataset.mode = 'account';
  element.hidden = false;
}
