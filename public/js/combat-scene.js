// combat-scene.js — Head-to-head combat presentation, driven by the server's
// combat state ({ enemy, player, round }). Purely presentational: action
// buttons submit the matching command through registerCombatAction.

import { state } from './state.js';

let _onAction = null;
export function registerCombatAction(fn) { _onAction = fn; }

let _onReturnToHall = null;
export function registerCombatReturnToHall(fn) { _onReturnToHall = fn; }

function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }

function pct(hp, maxHp) {
  if (!Number.isFinite(maxHp) || maxHp <= 0) return 0;
  return Math.max(0, Math.min(100, (hp / maxHp) * 100));
}

function setHp(side, hp, maxHp) {
  const fill = document.getElementById(side === 'enemy' ? 'combat-enemy-hp' : 'combat-player-hp');
  const text = document.getElementById(side === 'enemy' ? 'combat-enemy-hptext' : 'combat-player-hptext');
  if (fill) fill.style.width = pct(hp, maxHp) + '%';
  if (text) text.textContent = `${Math.max(0, hp)} / ${maxHp}`;
}

function playHit(side, damage) {
  const el = document.getElementById(side === 'enemy' ? 'combatant-enemy' : 'combatant-player');
  if (!el) return;
  const portrait = el.querySelector('.combat-portrait');
  const df = el.querySelector('.dmg-float');
  el.classList.remove('shake'); portrait.classList.remove('flash'); df.classList.remove('show');
  void el.offsetWidth; // restart the animations
  df.textContent = `-${damage}`;
  el.classList.add('shake'); portrait.classList.add('flash');
  if (damage > 0) df.classList.add('show');
}

function setRollReadout(round) {
  const rollEl = document.getElementById('combat-roll');
  const p = round?.player;
  if (!p || p.roll == null) { rollEl.style.visibility = 'hidden'; return; }
  rollEl.style.visibility = 'visible';
  document.getElementById('roll-die').textContent = p.roll;
  const ag = (p.total != null && p.roll != null) ? p.total - p.roll : null;
  document.getElementById('roll-calc').textContent = ag != null
    ? `${p.roll} + AG ${ag} = ${p.total} vs ${p.target}`
    : `${p.roll} vs ${p.target}`;
  const rr = document.getElementById('roll-result');
  rr.textContent = p.hit ? 'HIT' : 'MISS';
  rr.className = 'roll-result ' + (p.hit ? 'hit' : 'miss');
}

function renderLog(text) {
  const log = document.getElementById('combat-log');
  log.replaceChildren();
  for (const line of String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    const div = document.createElement('div');
    div.className = 'combat-log-line';
    div.textContent = line;
    log.appendChild(div);
  }
}

function singleAction(label, handler, variant = 'primary') {
  const el = document.getElementById('combat-actions');
  el.replaceChildren();
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'enter-btn ' + variant;
  b.textContent = label;
  b.addEventListener('click', handler);
  el.appendChild(b);
}

function renderActions(choices) {
  const el = document.getElementById('combat-actions');
  el.replaceChildren();
  for (const choice of choices ?? []) {
    const text = String(choice).trim();
    const isMove = /^(north|south|east|west|up|down)$/i.test(text);
    const isAttack = /^attack/i.test(text);
    const b = document.createElement('button');
    b.type = 'button';
    // movement = visible "Flee <dir>" secondary button (not a dim link)
    b.className = 'enter-btn' + (isAttack ? ' primary' : isMove ? ' flee' : '');
    b.textContent = isMove ? `Flee ${cap(text)}` : cap(text);
    b.addEventListener('click', () => { if (_onAction) _onAction(choice); });
    el.appendChild(b);
  }
}

function bannerHead(text) { const d = document.createElement('div'); d.className = 'combat-banner-head'; d.textContent = text; return d; }
function bannerSub(text) { const s = document.createElement('small'); s.textContent = text; return s; }

export function renderCombat(combat, choices, text) {
  if (!combat || !combat.enemy) { hideCombat(); return; }
  const gs = document.getElementById('game-screen');
  gs.classList.add('in-combat');
  document.getElementById('combat-scene').hidden = false;

  document.getElementById('combat-player-name').textContent = combat.player?.name ?? state.character?.name ?? 'You';
  document.getElementById('combat-enemy-name').textContent = combat.enemy.name;

  setRollReadout(combat.round);
  setHp('player', combat.player?.hp ?? 0, combat.player?.maxHp ?? 0);
  setHp('enemy', combat.enemy.hp ?? 0, combat.enemy.maxHp ?? 0);

  const round = combat.round;
  if (round?.player?.hit && round.player.damage > 0) playHit('enemy', round.player.damage);
  if (round?.enemy?.hit && round.enemy.damage > 0) setTimeout(() => playHit('player', round.enemy.damage), 700);

  renderLog(text);

  const banner = document.getElementById('combat-banner');
  const enemyDefeated = !!round?.enemyDefeated;
  const playerDefeated = !!round?.characterDefeated;
  document.getElementById('combatant-enemy').classList.toggle('defeated', enemyDefeated);
  document.getElementById('combatant-player').classList.toggle('defeated', playerDefeated);

  if (enemyDefeated) {
    banner.hidden = false;
    banner.className = 'combat-banner victory';
    banner.replaceChildren(bannerHead('Victory!'), bannerSub(`${combat.enemy.name} is defeated.`));
    singleAction('Continue ▸', () => { if (_onAction) _onAction('look'); });
  } else if (playerDefeated) {
    banner.hidden = false;
    banner.className = 'combat-banner defeat';
    banner.replaceChildren(bannerHead('Defeated'), bannerSub(`${combat.player.name} has fallen.`));
    singleAction('Return to the Guild Hall', () => { if (_onReturnToHall) _onReturnToHall(); });
  } else {
    banner.hidden = true;
    renderActions(choices);
  }
}

export function hideCombat() {
  const scene = document.getElementById('combat-scene');
  if (scene) scene.hidden = true;
  document.getElementById('game-screen')?.classList.remove('in-combat');
  const banner = document.getElementById('combat-banner');
  if (banner) banner.hidden = true;
  document.getElementById('combatant-enemy')?.classList.remove('defeated');
  document.getElementById('combatant-player')?.classList.remove('defeated');
}
