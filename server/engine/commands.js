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
const TAKE_ALL_OBJECTS = new Set(['all', 'everything']);
const EQUIP_VERBS = new Set(['ready', 'wear', 'wield', 'equip', 'don']);
const UNEQUIP_VERBS = new Set(['remove', 'unequip', 'unready', 'doff', 'sheathe']);
const DRINK_VERBS = new Set(['drink', 'quaff', 'sip']);
const USE_VERBS = new Set(['use', 'cast', 'open']);
const READ_VERBS = new Set(['read', 'examine', 'inspect']);
const LEAVE_COMMANDS = new Set(['leave', 'quit', 'exit', 'back', 'return']);
const SPARE_VERBS = new Set(['spare', 'pardon', 'forgive']);
const SAY_VERBS = new Set(['say', 'shout', 'whisper']);
const STANCES = new Set(['brace', 'dodge', 'interrupt']);
const HINT_COMMANDS = new Set(['hint', 'hints']);

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

  if (command === 'dig' || /^dig\b/.test(command)) {
    return { type: 'dig', source: 'rules' };
  }

  // GIVE <item> TO <someone> — the wine and the giant.
  const giveMatch = /^(?:give|offer|hand)\s+(?:the\s+)?(.+?)\s+to\s+(?:the\s+)?(.+)$/.exec(command);
  if (giveMatch) {
    return { type: 'give', target: giveMatch[1].trim(), recipient: giveMatch[2].trim(), source: 'rules' };
  }

  // NOTE <text> — the player's own hand on the map (jot also works).
  const noteMatch = /^(?:note|jot)[:,]?\s+(.+)$/.exec(command);
  if (noteMatch) {
    return { type: 'note', words: noteMatch[1].trim(), source: 'rules' };
  }

  if (command === 'hide' || /^hide\b/.test(command)) {
    return { type: 'hide', target: command.replace(/^hide\s*(under|beneath|behind|in)?\s*/, '').trim() || null, source: 'rules' };
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

  if (HINT_COMMANDS.has(command) || command === 'ask the spirit' || command === 'ask spirit') {
    return { type: 'hint', source: 'rules' };
  }

  // Answering a telegraphed wind-up: a bare stance word.
  if (STANCES.has(command)) {
    return { type: 'stance', stance: command, source: 'rules' };
  }

  // Freeform speech: say <words>, or a leading quote mark. The route decides
  // who hears it (the one NPC or enemy sharing the room).
  if (command.startsWith('"') || command.startsWith('“')) {
    const words = command.replace(/^["“]+/, '').replace(/["”]+$/, '').trim();
    if (words) {
      return { type: 'say', words, source: 'rules' };
    }
  }

  if (command === 'mercy' || command === 'show mercy') {
    return { type: 'spare', target: null, source: 'rules' };
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

  if (command.startsWith('pick up ')) {
    const target = command.slice('pick up '.length).trim();
    if (target) {
      return { type: 'take', target, source: 'rules' };
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
    if (TAKE_ALL_OBJECTS.has(objectText)) {
      return { type: 'take_all', source: 'rules' };
    }
    if (verb === 'take' && objectText.startsWith('off ')) {
      return { type: 'unequip', target: objectText.slice(4).trim(), source: 'rules' };
    }
    return { type: 'take', target: objectText, source: 'rules' };
  }

  if (EQUIP_VERBS.has(verb) && objectText) {
    return { type: 'equip', target: objectText, source: 'rules' };
  }

  if (UNEQUIP_VERBS.has(verb) && objectText) {
    return { type: 'unequip', target: objectText, source: 'rules' };
  }

  if (DRINK_VERBS.has(verb) && objectText) {
    return { type: 'drink', target: objectText, source: 'rules' };
  }

  if (USE_VERBS.has(verb) && objectText) {
    return { type: 'use_item', target: objectText, source: 'rules' };
  }

  if (READ_VERBS.has(verb) && objectText) {
    return { type: 'read_item', target: objectText, source: 'rules' };
  }

  if (SPARE_VERBS.has(verb) && objectText) {
    const target = objectText.startsWith('the ') ? objectText.slice(4).trim() : objectText;
    return { type: 'spare', target, source: 'rules' };
  }

  if (SAY_VERBS.has(verb) && objectText) {
    const words = objectText.replace(/^["“]+/, '').replace(/["”]+$/, '').trim();
    if (words) {
      return { type: 'say', words, source: 'rules' };
    }
  }

  // tell <name> <words> — speech aimed at a named listener. Strip punctuation
  // off the name so "tell cynthia, follow me" still targets Cynthia.
  if (verb === 'tell' && rest.length >= 2) {
    const [listener, ...words] = rest;
    const target = listener.replace(/[^a-z0-9'-]/gi, '');
    return { type: 'say', target, words: words.join(' ').replace(/^["“]+/, '').replace(/["”]+$/, '').trim(), source: 'rules' };
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
