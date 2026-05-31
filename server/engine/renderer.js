function plain(value, fallback = '') {
  const text = value === null || value === undefined ? fallback : String(value);
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[[A-Za-z_-]+(?::[^\]]*)?\]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,;:!?]|$)/g, '$1$2')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|[.,;:!?]|$)/g, '$1$2')
    .replace(/\*\*|__|[*_]/g, '')
    .replace(/[{}]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function sentence(value, fallback = '') {
  return plain(value, fallback).replace(/\s+/g, ' ');
}

function listName(value) {
  if (typeof value === 'string') {
    return sentence(value);
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  return sentence(
    value.name
      ?? value.display_name
      ?? value.title
      ?? value.item_name
      ?? value.item?.name
      ?? value.item?.display_name
      ?? value.item_slug
      ?? value.slug
      ?? '',
  );
}

function namesFrom(value) {
  if (Array.isArray(value)) {
    return value.map(listName).filter(Boolean);
  }
  return [];
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}

function visibleCharacters(entities) {
  if (Array.isArray(entities)) {
    return namesFrom(entities);
  }
  return namesFrom(entities?.characters ?? entities?.entities ?? []);
}

function visibleItems(entities, items) {
  const sources = [];

  if (Array.isArray(items)) {
    sources.push(...items);
  } else if (items && typeof items === 'object') {
    sources.push(...arrayFrom(items.items), ...arrayFrom(items.placements));
  }

  if (entities && typeof entities === 'object' && !Array.isArray(entities)) {
    sources.push(...arrayFrom(entities.items), ...arrayFrom(entities.placements));
  }

  const seen = new Set();
  return namesFrom(sources).filter((name) => {
    const key = sentence(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validExitNames(exits) {
  if (!exits || typeof exits !== 'object') {
    return [];
  }

  return Object.entries(exits)
    .filter(([, destination]) => destination !== null && destination !== undefined)
    .map(([direction]) => sentence(direction))
    .filter(Boolean)
    .sort();
}

function attackDamage(attack) {
  return Number.isFinite(attack?.damage) ? attack.damage : 0;
}

function defenderHp(attack) {
  return Number.isFinite(attack?.defenderHp) ? attack.defenderHp : 0;
}

function renderPlayerAttack(attack) {
  if (attack?.hit) {
    return `You hit for ${attackDamage(attack)} damage. Enemy HP is now ${defenderHp(attack)}.`;
  }
  return `You miss. Enemy HP remains ${defenderHp(attack)}.`;
}

function renderEnemyAttack(attack) {
  if (!attack) {
    return null;
  }

  if (attack.hit) {
    return `The enemy hits you for ${attackDamage(attack)} damage. Your HP is now ${defenderHp(attack)}.`;
  }
  return `The enemy misses. Your HP remains ${defenderHp(attack)}.`;
}

function inventoryItems(character) {
  const inventory = character?.inventory;
  if (Array.isArray(inventory)) {
    return namesFrom(inventory);
  }
  if (inventory && typeof inventory === 'object') {
    return namesFrom(Object.values(inventory));
  }
  return [];
}

function treasureName(treasure) {
  const name = listName(treasure);
  if (treasure && typeof treasure === 'object' && Number.isFinite(treasure.value)) {
    return `${name} (${treasure.value} gold)`;
  }
  return name;
}

// "Items here:" should list only takeable loot — not immovable scenery like
// inscriptions (collectible:false / weight:-999) — and never the same item
// twice. When given the full item objects (live flow), filter + dedupe by name.
function collectibleNames(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    // Containers (chests) and features (inspectable scenery) are listed even
    // though they're not takeable loot.
    if (item.type !== 'container' && item.type !== 'feature' && (item.collectible === false || item.weight === -999)) continue;
    const name = sentence(item.name ?? item.canonical_name ?? item.slug);
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function isItemObjectList(items) {
  return Array.isArray(items) && items.some((i) => i && typeof i === 'object' && ('collectible' in i || 'weight' in i || 'slug' in i));
}

export function renderRoom(room, entities = {}, items = {}, exits = undefined) {
  const title = sentence(room?.name ?? room?.title, 'Unknown Room');
  const description = sentence(room?.description ?? room?.narration_text ?? room?.text, 'There is nothing notable here.');
  const characters = visibleCharacters(entities);
  const itemNames = isItemObjectList(items) ? collectibleNames(items) : visibleItems(entities, items);
  const exitNames = validExitNames(exits ?? room?.exits);

  return [
    title,
    description,
    characters.length > 0 ? `You see: ${characters.join(', ')}.` : 'You see no one else here.',
    itemNames.length > 0 ? `Items here: ${itemNames.join(', ')}.` : 'Items here: none.',
    exitNames.length > 0 ? `Exits: ${exitNames.join(', ')}.` : 'Exits: none.',
  ].join('\n');
}

export function renderCombatResult(result = {}) {
  const lines = [renderPlayerAttack(result?.playerAttack)];
  if (result?.enemyDefeated) {
    lines.push('The enemy is defeated.');
  }

  const enemyAttack = renderEnemyAttack(result?.enemyAttack);
  if (enemyAttack) {
    lines.push(enemyAttack);
  }

  if (result?.characterDefeated) {
    lines.push('You have been defeated.');
  }

  return lines.join('\n');
}

export function renderMoveBlocked(direction) {
  const safeDirection = sentence(direction, 'that way');
  return `You cannot go ${safeDirection} from here.`;
}

export function renderInventory(character = {}) {
  const characterName = sentence(character?.name ?? character?.display_name, 'You');
  const items = inventoryItems(character);
  const gold = Number.isFinite(character?.gold) ? character.gold : null;

  if (items.length === 0) {
    return `${characterName} is carrying nothing.`;
  }

  const goldText = gold !== null ? ` Gold: ${gold}.` : '';
  return `${characterName} is carrying: ${items.join(', ')}.${goldText}`;
}

export function renderDeath(character = {}) {
  const characterName = sentence(character?.name ?? character?.display_name, 'You');
  return `${characterName} has died. The adventure is over.`;
}

export function renderReturnToHall(summary = {}) {
  const characterName = sentence(
    summary?.characterName ?? summary?.name ?? summary?.character?.name ?? summary?.character?.display_name,
    'You',
  );
  const gold = Number.isFinite(summary?.gold)
    ? summary.gold
    : Number.isFinite(summary?.goldGained)
      ? summary.goldGained
      : 0;
  const treasureSource = Array.isArray(summary?.treasures)
    ? summary.treasures
    : Array.isArray(summary?.convertedItems)
      ? summary.convertedItems
      : [];
  const treasures = namesFrom(treasureSource.map((treasure) => treasureName(treasure)));

  return [
    `${characterName} returns to the Main Hall.`,
    summary?.completed ? 'Adventure completed.' : 'Adventure ended.',
    `Gold recovered: ${gold}.`,
    treasures.length > 0 ? `Treasures recovered: ${treasures.join(', ')}.` : 'Treasures recovered: none.',
  ].join('\n');
}
