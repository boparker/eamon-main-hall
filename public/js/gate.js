// gate.js — The Adventure Gate: a card grid of expeditions (unlocked + locked).
// Card clicks submit "Begin <Name>" through the normal input path so the engine
// stays authoritative; locked cards are inert and show their unlock requirement.
// Each card's cover is a monogram placeholder today, ready to swap to cover art.

let _onSelect = null;
export function registerGateHandler(fn) { _onSelect = fn; }

function monogram(name) {
  return (String(name || '?').replace(/^The\s+/i, '').trim().charAt(0) || '?').toUpperCase();
}

function card(adventure) {
  const unlocked = adventure.unlocked !== false;
  const el = document.createElement(unlocked ? 'button' : 'div');
  if (unlocked) el.type = 'button';
  el.className = 'gate-card ' + (unlocked ? 'unlocked' : 'locked');

  const cover = document.createElement('div');
  cover.className = 'gate-cover';
  if (unlocked) {
    cover.textContent = monogram(adventure.name);
    // Swap the monogram for painted cover art when one exists for this realm.
    if (adventure.id) {
      const img = document.createElement('img');
      img.className = 'gate-cover-img';
      img.src = `scenes/${adventure.id}/cover.png?v=2`; // bump when a cover is re-authored (week-long media cache)
      img.alt = adventure.name ?? '';
      img.onload = () => { cover.textContent = ''; cover.appendChild(img); };
      img.onerror = () => {};
    }
  } else {
    const glyph = document.createElement('span');
    glyph.className = 'lock-glyph';
    glyph.textContent = '🔒';
    cover.appendChild(glyph);
  }

  const body = document.createElement('div');
  body.className = 'gate-body';

  const name = document.createElement('div');
  name.className = 'gate-name';
  name.textContent = String(adventure.name ?? 'Unknown Realm');
  body.appendChild(name);

  if (adventure.premium) {
    const ribbon = document.createElement('div');
    ribbon.className = 'gate-premium';
    ribbon.textContent = '✦ Premium';
    card.appendChild(ribbon);
  }

  // Every realm names its maker — these are real authors' works, 1979 onward.
  if (adventure.author) {
    const byline = document.createElement('div');
    byline.className = 'gate-byline';
    byline.textContent = `by ${adventure.author}${adventure.year ? `, ${adventure.year}` : ''}`;
    body.appendChild(byline);
  }

  const difficulty = Number(adventure.difficulty);
  if (Number.isFinite(difficulty) && difficulty > 0) {
    const diff = document.createElement('div');
    diff.className = 'gate-diff';
    const pips = document.createElement('span');
    pips.className = 'pip';
    pips.textContent = '◆'.repeat(Math.min(5, difficulty));
    diff.append('Difficulty ', pips);
    body.appendChild(diff);
  }

  if (adventure.description) {
    const desc = document.createElement('div');
    desc.className = 'gate-desc';
    desc.textContent = adventure.description;
    body.appendChild(desc);
  }

  if (unlocked) {
    const go = document.createElement('div');
    go.className = 'gate-go';
    go.textContent = 'Begin →';
    body.appendChild(go);
    el.addEventListener('click', () => {
      if (_onSelect) _onSelect(`Begin ${String(adventure.name).replace(/^The\s+/i, '')}`);
    });
  } else if (adventure.lockedReason) {
    const note = document.createElement('div');
    note.className = 'gate-lock-note';
    note.textContent = adventure.lockedReason;
    body.appendChild(note);
  }

  el.append(cover, body);
  return el;
}

export function openGate(gate) {
  const adventures = Array.isArray(gate?.adventures) ? gate.adventures : [];
  const grid = document.getElementById('gate-cards');
  if (!grid) return;
  grid.replaceChildren(...adventures.map(card));
  document.getElementById('adventure-gate').hidden = false;
  document.getElementById('game-screen')?.classList.add('at-gate');
}

export function closeGate() {
  const scene = document.getElementById('adventure-gate');
  if (scene) scene.hidden = true;
  document.getElementById('game-screen')?.classList.remove('at-gate');
}

const leaveGate = () => { if (_onSelect) _onSelect('Return to Great Hall'); };
document.getElementById('gate-leave-btn')?.addEventListener('click', leaveGate);
document.getElementById('gate-close-corner')?.addEventListener('click', leaveGate);
