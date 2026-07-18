// prologue.js — the story setup screen. The 1980 adventures opened with
// framing text before room one (Lil's heist, the sneering lord, the lever);
// this restores that beat as a full-screen prologue over the first room,
// shown when a start-adventure response carries state.intro.

let _dismissed = false;

export function showPrologue(intro) {
  if (!intro?.text) return;
  const overlay = document.getElementById('prologue');
  if (!overlay) return;
  _dismissed = false;

  const cover = document.getElementById('prologue-cover');
  if (cover) {
    cover.style.backgroundImage = intro.cover ? `url('${intro.cover}')` : 'none';
  }
  const title = document.getElementById('prologue-title');
  if (title) title.textContent = intro.title ?? 'The Adventure Begins';
  const byline = document.getElementById('prologue-byline');
  if (byline) {
    byline.textContent = intro.author ? `by ${intro.author}${intro.year ? `, ${intro.year}` : ''}` : '';
    byline.hidden = !intro.author;
  }
  const body = document.getElementById('prologue-text');
  if (body) {
    body.replaceChildren();
    for (const para of String(intro.text).split(/\n\s*\n/)) {
      const p = document.createElement('p');
      p.textContent = para.trim();
      if (p.textContent) body.appendChild(p);
    }
  }
  overlay.hidden = false;
  document.getElementById('prologue-begin')?.focus();
}

export function closePrologue() {
  const overlay = document.getElementById('prologue');
  if (overlay) overlay.hidden = true;
  _dismissed = true;
}

export function initPrologue() {
  document.getElementById('prologue-begin')?.addEventListener('click', closePrologue);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('prologue')?.hidden) closePrologue();
  });
}
