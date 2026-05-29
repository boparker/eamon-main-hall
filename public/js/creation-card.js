// creation-card.js — Intentional, card-based character creation.
//
// This is purely a presentation layer over the deterministic creation state
// machine in game-client.js. It reads the structured `creation` state
// (step → name → gender → stats) and renders a card matching the title
// screen's entry-card language. Every action submits back through the normal
// input path (submit(text)), so the engine and its tests are untouched.

const STEPS = ['name', 'gender', 'confirm'];
const HEADINGS = {
  name: 'Name Your Adventurer',
  gender: 'Choose a Gender',
  confirm: 'Your Attributes',
};

export function createCreationCard({
  overlay = document.getElementById('creation-overlay'),
  gameScreen = document.getElementById('game-screen'),
  progressEl = document.getElementById('creation-progress'),
  headingEl = document.getElementById('creation-heading'),
  bodyEl = document.getElementById('creation-body'),
  submit = () => {},
} = {}) {
  function hide() {
    if (overlay) overlay.hidden = true;
    gameScreen?.classList.remove('creating');
  }

  function show() {
    if (overlay) overlay.hidden = false;
    gameScreen?.classList.add('creating');
  }

  function button(label, variant, onClick) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'enter-btn' + (variant ? ' ' + variant : '');
    el.textContent = label;
    el.addEventListener('click', onClick);
    return el;
  }

  function renderProgress(step) {
    if (!progressEl) return;
    const idx = STEPS.indexOf(step);
    progressEl.replaceChildren(...STEPS.map((_, i) => {
      const dot = document.createElement('span');
      dot.className = 'step-dot' + (i === idx ? ' active' : i < idx ? ' done' : '');
      return dot;
    }));
  }

  function renderName(creation) {
    const form = document.createElement('form');
    form.className = 'creation-form';

    const field = document.createElement('label');
    field.className = 'auth-field';
    const span = document.createElement('span');
    span.textContent = 'Name';
    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.maxLength = 40;
    input.placeholder = 'Sign thy name';
    input.value = creation.name ?? '';
    field.append(span, input);

    const continueBtn = button('Continue', 'primary', () => {});
    continueBtn.type = 'submit';

    form.append(field, continueBtn);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      submit(name);
    });

    bodyEl.replaceChildren(form);
    setTimeout(() => input.focus(), 60);
  }

  function renderGender(creation) {
    const wrap = document.createElement('div');

    const subhead = document.createElement('p');
    subhead.className = 'creation-subhead';
    subhead.textContent = creation.name ? `Well met, ${creation.name}.` : '';

    const row = document.createElement('div');
    row.className = 'creation-option-row';
    for (const gender of ['Male', 'Female']) {
      row.appendChild(button(gender, 'option', () => submit(gender)));
    }

    wrap.append(subhead, row);
    bodyEl.replaceChildren(wrap);
  }

  function renderConfirm(creation) {
    const stats = creation.stats ?? {};
    const wrap = document.createElement('div');

    const subhead = document.createElement('p');
    subhead.className = 'creation-subhead';
    const genderLabel = creation.gender === 'f' ? 'Female' : 'Male';
    subhead.textContent = `${creation.name ?? 'Adventurer'} · ${genderLabel}`;

    const grid = document.createElement('div');
    grid.className = 'creation-stats';
    const cells = [
      ['Hardiness', stats.hardiness],
      ['Agility', stats.agility],
      ['Charisma', stats.charisma],
      ['Gold', stats.gold],
    ];
    for (const [label, value] of cells) {
      const cell = document.createElement('div');
      cell.className = 'creation-stat';
      const val = document.createElement('span');
      val.className = 'creation-stat-val';
      val.textContent = value ?? '—';
      const lab = document.createElement('span');
      lab.className = 'creation-stat-label';
      lab.textContent = label;
      cell.append(val, lab);
      grid.appendChild(cell);
    }

    const actions = document.createElement('div');
    actions.className = 'creation-actions';
    actions.append(
      button('Confirm', 'primary', () => submit('Confirm')),
      button('Reroll', '', () => submit('Reroll')),
    );

    wrap.append(subhead, grid, actions, button('Start over', 'link', () => submit('Create Character')));
    bodyEl.replaceChildren(wrap);
  }

  function sync(creation) {
    if (!creation || !creation.step) { hide(); return; }
    show();
    renderProgress(creation.step);
    if (headingEl) headingEl.textContent = HEADINGS[creation.step] ?? 'Create Your Adventurer';
    if (creation.step === 'name') renderName(creation);
    else if (creation.step === 'gender') renderGender(creation);
    else if (creation.step === 'confirm') renderConfirm(creation);
  }

  return { sync, hide, show };
}
