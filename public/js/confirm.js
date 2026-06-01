// confirm.js — a small reusable confirmation dialog so a stray tap can't
// errantly buy, sell, or drink something. confirmAction(message, onConfirm).

let overlay = null;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'confirm-overlay';
  overlay.hidden = true;
  const card = document.createElement('div');
  card.className = 'confirm-card';
  const msg = document.createElement('div');
  msg.className = 'confirm-msg';
  msg.id = 'confirm-msg';
  const actions = document.createElement('div');
  actions.className = 'confirm-actions';
  const yes = document.createElement('button');
  yes.id = 'confirm-yes'; yes.className = 'confirm-yes'; yes.type = 'button'; yes.textContent = 'Confirm';
  const no = document.createElement('button');
  no.id = 'confirm-no'; no.className = 'confirm-no'; no.type = 'button'; no.textContent = 'Cancel';
  actions.append(no, yes);
  card.append(msg, actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  return overlay;
}

export function confirmAction(message, onConfirm) {
  const el = ensureOverlay();
  el.querySelector('#confirm-msg').textContent = message;
  el.hidden = false;

  const yes = el.querySelector('#confirm-yes');
  const no = el.querySelector('#confirm-no');
  const cleanup = () => {
    el.hidden = true;
    yes.onclick = null;
    no.onclick = null;
    el.onclick = null;
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') cleanup();
    else if (e.key === 'Enter') { cleanup(); onConfirm(); }
  };
  yes.onclick = () => { cleanup(); onConfirm(); };
  no.onclick = cleanup;
  el.onclick = (e) => { if (e.target === el) cleanup(); };
  document.addEventListener('keydown', onKey);
  setTimeout(() => yes.focus(), 0);
}
