const DIRECTIONS = new Map([
  ['north', 'north'],
  ['south', 'south'],
  ['east', 'east'],
  ['west', 'west'],
  ['up', 'up'],
  ['down', 'down'],
  ['n', 'north'],
  ['s', 'south'],
  ['e', 'east'],
  ['w', 'west'],
  ['u', 'up'],
  ['d', 'down'],
]);

const MOVEMENT_VERBS = new Set(['go', 'move', 'walk', 'head']);
const ATTACK_VERBS = new Set(['attack', 'fight', 'kill', 'hit', 'smack']);
const TAKE_VERBS = new Set(['get', 'take', 'grab']);
const USE_VERBS = new Set(['use', 'cast', 'open']);
const READ_VERBS = new Set(['read', 'examine', 'inspect']);
const LEAVE_COMMANDS = new Set(['leave', 'quit', 'exit', 'back', 'return']);

function normalizeInput(input) {
  if (typeof input !== 'string') {
    return '';
  }

  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

function unknown(raw) {
  return { type: 'unknown', raw, source: 'rules' };
}

function parseTargetWithOptionalWeapon(text) {
  const [target, weapon] = text.split(' with ', 2).map((part) => part.trim());

  if (!target) {
    return null;
  }

  const parsed = { target };
  if (weapon) {
    parsed.weapon = weapon;
  }

  return parsed;
}

export function parseCommand(input) {
  const command = normalizeInput(input);

  if (!command) {
    return unknown(command);
  }

  if (DIRECTIONS.has(command)) {
    return { type: 'move', direction: DIRECTIONS.get(command), source: 'rules' };
  }

  if (command === 'look' || command === 'l') {
    return { type: 'look', source: 'rules' };
  }

  if (command === 'search') {
    return { type: 'search', source: 'rules' };
  }

  if (command === 'inventory' || command === 'inv' || command === 'i') {
    return { type: 'inventory', source: 'rules' };
  }

  if (command === 'stats' || command === 'status') {
    return { type: 'stats', source: 'rules' };
  }

  if (command === 'help' || command === '?') {
    return { type: 'help', source: 'rules' };
  }

  if (command === 'shop') {
    return { type: 'shop', source: 'rules' };
  }

  if (LEAVE_COMMANDS.has(command)) {
    return { type: 'leave', source: 'rules' };
  }

  if (command.startsWith('look at ')) {
    const target = command.slice('look at '.length).trim();
    if (target) {
      return { type: 'read_item', target, source: 'rules' };
    }
  }

  const [verb, ...rest] = command.split(' ');
  const objectText = rest.join(' ').trim();

  if (MOVEMENT_VERBS.has(verb) && DIRECTIONS.has(objectText)) {
    return { type: 'move', direction: DIRECTIONS.get(objectText), source: 'rules' };
  }

  if (ATTACK_VERBS.has(verb)) {
    const parsed = parseTargetWithOptionalWeapon(objectText);
    if (parsed) {
      return { type: 'attack', ...parsed, source: 'rules' };
    }
  }

  if (TAKE_VERBS.has(verb) && objectText) {
    return { type: 'take', target: objectText, source: 'rules' };
  }

  if (USE_VERBS.has(verb) && objectText) {
    return { type: 'use_item', target: objectText, source: 'rules' };
  }

  if (READ_VERBS.has(verb) && objectText) {
    return { type: 'read_item', target: objectText, source: 'rules' };
  }

  if (verb === 'talk' && objectText) {
    const target = objectText.startsWith('to ') ? objectText.slice(3).trim() : objectText;
    if (target) {
      return { type: 'talk', target, source: 'rules' };
    }
  }

  if (verb === 'buy' && objectText) {
    return { type: 'buy', target: objectText, source: 'rules' };
  }

  return unknown(command);
}
