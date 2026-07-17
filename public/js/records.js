// records.js — The Hall of Records: the Archivist's browsable codex + a tribute
// to the originals. A full-screen overlay (like the Adventure Gate), opened when
// the server sends state.records. The mechanics codex reuses STAT_META and the
// bands from stat-info.js, so the "library" is the SAME truth as the inline
// tooltips — inline first, library second, one source. The tribute text is
// grounded in verified history (eamon.wiki): Donald Brown created Eamon around
// 1979 for the Apple II; John Nelson and Tom Zuchowski expanded it; the open
// framework grew to 283+ community-authored adventures.

import { STAT_META } from './stat-info.js';

let _onLeave = null;
export function registerRecordsHandler(fn) { _onLeave = fn; }

// ── Codex content (guidance = the permanent form of the inline teaching) ─────
// Attributes come straight from STAT_META so they never drift from the tooltips.
const CODEX = [
  {
    id: 'attributes', icon: '❖', title: 'An Adventurer\'s Mettle',
    blurb: 'Three numbers, rolled at birth, decide who you are. Here is what each truly governs in these halls.',
    entries: [
      { term: 'Hardiness', desc: STAT_META.hardiness.effect },
      { term: 'Agility', desc: STAT_META.agility.effect },
      { term: 'Charisma', desc: STAT_META.charisma.effect },
    ],
    footer: 'Bands: Poor (3–8) · Below Average (9–11) · Average (12–14) · Good (15–17) · Excellent (18–19) · Exceptional (20–21). Adventurers are hardy and quick by nature — Hardiness is never below 15, Agility never below 12 — but Charisma runs wild, which is why some are born silver-tongued and others gruff.',
  },
  {
    id: 'arms', icon: '⚔', title: 'Arms & Armour',
    blurb: 'The Guild\'s smiths deal plainly. No blade here is heavier to swing than another; steel is simply steel.',
    entries: [
      { term: 'Weapons', desc: 'A weapon\'s worth is its damage dice — a Club (1d4) bites less than a Sword (1d8) or a Halberd (1d10). There is no weapon skill: how often you land a blow is your Agility, not your practice with a given arm.' },
      { term: 'Enchanted Arms', desc: 'Marcos\' rarer, named blades add a to-hit bonus on top of their damage — a magic weapon strikes truer as well as harder.' },
      { term: 'Armour & Shields', desc: 'Armour and shields reduce every hit you take by a flat amount, and a shield stacks atop your armour. There is no burden or penalty for wearing them — heavier protection is strictly better.' },
    ],
  },
  {
    id: 'mercy', icon: '☙', title: 'The Art of Mercy',
    blurb: 'Not every foe must fall. The Guild honours the sword, but it honours the word more.',
    entries: [
      { term: 'Speak your mind', desc: 'You may simply talk to any creature — type what you wish to say. Well-chosen words that show you understand who they are can turn an enemy aside, and the Archivists judge your craft as you speak.' },
      { term: 'Acts & gestures', desc: 'Many foes can be reached without steel — calm a frightened beast, reason with the mad, parley with a pirate. Watch what each one wants.' },
      { term: 'Yield & Spare', desc: 'Press a foe hard enough, in wounds or in words, and they may yield. A yielded enemy can be SPAREd — often for a truer reward than a kill, and the chronicle remembers your mercy. Strike one who has yielded, and they will never trust you again.' },
      { term: 'Read the blow', desc: 'When a foe winds up a great attack, you are warned. Brace, dodge, or interrupt — a fight is a conversation of timing as much as force.' },
    ],
  },
  {
    id: 'magic', icon: '✦', title: 'The Learned Arts',
    blurb: 'Hokas Tokas teaches four workings. Each is an ability you roll against; study raises the odds.',
    entries: [
      { term: 'Blast', desc: 'Searing light that damages a single foe.' },
      { term: 'Heal', desc: 'Knits your own wounds closed.' },
      { term: 'Speed', desc: 'Doubles your Agility for a time — and Agility, as you now know, wins fights.' },
      { term: 'Power', desc: 'An unpredictable working, different in every telling.' },
    ],
  },
  {
    id: 'home', icon: '⌂', title: 'The Long Walk Home',
    blurb: 'An expedition is not won until you are home to tell of it.',
    entries: [
      { term: 'Treasure', desc: 'Loot is dead weight in the dark — it becomes gold only when Sam Slicker weighs it on your return.' },
      { term: 'Wounds persist', desc: 'You do not heal by leaving. Wounds carry between expeditions; the Chapel mends them for coin, so health is a real resource.' },
      { term: 'Death forfeits all', desc: 'Fall in the deep and the loot of that run is lost — though your banked gold, your gear, and the spells you learned endure. Carry a story home alive.' },
    ],
  },
];

// ── The tribute (verified) ───────────────────────────────────────────────────
const TRIBUTE = {
  title: 'In Tribute to the First Adventurers',
  lines: [
    'This game stands on the shoulders of a small miracle. Around 1979, a young programmer named <strong>Donald Brown</strong> built the very first <em>Eamon</em> for the Apple II — a Main Hall and a single dungeon, the Beginner\'s Cave, the same one you may have just walked out of.',
    'Its quiet genius was not the dungeon but the <em>doorway</em>: Brown gave Eamon away and left it open, so that anyone could author a new adventure and send their character through it. Others did — <strong>John Nelson</strong>, <strong>Tom Zuchowski</strong>, and hundreds of unnamed dreamers over four decades — until the world of Eamon held more than <strong>283 adventures</strong>, one of the first great communities of player-authors in all of gaming.',
    '<em>Eamon: The Second Age</em> is a love letter to that openness — the Guild of Free Adventurers, still keeping its rolls. The old adventures are lovingly archived to this day at <span class="rec-link">eamon.wiki</span>. If you loved this, go and meet the originals.',
  ],
};

function section({ id, icon, title, blurb, entries, footer }) {
  const sec = document.createElement('section');
  sec.className = 'rec-section';
  sec.dataset.id = id;
  const h = document.createElement('h3');
  h.className = 'rec-h';
  h.innerHTML = `<span class="rec-icon">${icon}</span> ${title}`;
  sec.appendChild(h);
  if (blurb) { const p = document.createElement('p'); p.className = 'rec-blurb'; p.textContent = blurb; sec.appendChild(p); }
  const dl = document.createElement('dl'); dl.className = 'rec-entries';
  for (const e of entries) {
    const dt = document.createElement('dt'); dt.textContent = e.term;
    const dd = document.createElement('dd'); dd.textContent = e.desc;
    dl.append(dt, dd);
  }
  sec.appendChild(dl);
  if (footer) { const f = document.createElement('p'); f.className = 'rec-footer'; f.textContent = footer; sec.appendChild(f); }
  return sec;
}

let _built = false;
function build() {
  const body = document.getElementById('records-body');
  if (!body || _built) return;
  _built = true;

  for (const sec of CODEX) body.appendChild(section(sec));

  const tribute = document.createElement('section');
  tribute.className = 'rec-section rec-tribute';
  const h = document.createElement('h3'); h.className = 'rec-h'; h.innerHTML = `<span class="rec-icon">✧</span> ${TRIBUTE.title}`;
  tribute.appendChild(h);
  for (const line of TRIBUTE.lines) {
    const p = document.createElement('p'); p.className = 'rec-tribute-line'; p.innerHTML = line;
    tribute.appendChild(p);
  }
  body.appendChild(tribute);
}

export function openRecords(records) {
  if (!records) return;
  build();
  // The Guild's Ledger: the world's current read of this adventurer —
  // reputation made legible, straight from the server's deterministic derivation.
  let ledger = document.getElementById('records-ledger');
  if (!ledger) {
    ledger = document.createElement('section');
    ledger.className = 'rec-section rec-ledger';
    ledger.id = 'records-ledger';
    const h = document.createElement('h3'); h.className = 'rec-h';
    h.innerHTML = '<span class="rec-icon">✒</span> The Guild\u2019s Ledger';
    const p = document.createElement('p'); p.className = 'rec-blurb'; p.id = 'records-ledger-line';
    ledger.append(h, p);
    document.getElementById('records-body')?.prepend(ledger);
  }
  const line = document.getElementById('records-ledger-line');
  if (line) line.textContent = records.ledger ?? '';
  ledger.hidden = !records.ledger;

  // The Archivist's Counter: the Chronicler's Quill (journal-map marginalia).
  // Rendered in the overlay because the response's choice buttons live behind it.
  let counter = document.getElementById('records-counter');
  if (!counter) {
    counter = document.createElement('section');
    counter.className = 'rec-section';
    counter.id = 'records-counter';
    const h = document.createElement('h3'); h.className = 'rec-h';
    h.innerHTML = '<span class="rec-icon">🪶</span> The Archivist’s Counter';
    const p = document.createElement('p'); p.className = 'rec-blurb'; p.id = 'records-counter-line';
    const btn = document.createElement('button');
    btn.id = 'records-quill-btn'; btn.type = 'button'; btn.className = 'account-menu-action';
    btn.addEventListener('click', () => { if (_onLeave) _onLeave(btn.dataset.command); });
    counter.append(h, p, btn);
    ledger.after(counter);
  }
  const q = records.quill;
  counter.hidden = !q;
  if (q) {
    const noteEl = document.getElementById('records-counter-line');
    const btn = document.getElementById('records-quill-btn');
    noteEl.textContent = records.note
      ?? (q.owned
        ? 'Your grey quill rests in your pack, inking each deed onto your journal’s map as it happens.'
        : `A long grey quill rests in a case of worn leather. "It remembers where you have been," says the Archivist. "Every deed already done, and every one to come, will ink itself into your journal's map." — ${q.price} gold.`);
    btn.hidden = !!q.owned;
    btn.textContent = `Buy the Chronicler's Quill — ${q.price} gold`;
    btn.dataset.command = `The Chronicler's Quill (${q.price} gold)`;
  }
  const panel = document.getElementById('hall-of-records');
  if (!panel) return;
  const gs = document.getElementById('game-screen');
  panel.hidden = false;
  gs?.classList.add('reading');
  const scroll = document.getElementById('records-body');
  if (scroll) scroll.scrollTop = 0;
}

export function closeRecords() {
  const panel = document.getElementById('hall-of-records');
  if (panel) panel.hidden = true;
  document.getElementById('game-screen')?.classList.remove('reading');
}

const leave = () => { if (_onLeave) _onLeave('Return to Great Hall'); };
document.getElementById('records-leave-btn')?.addEventListener('click', leave);
document.getElementById('records-close-corner')?.addEventListener('click', leave);
