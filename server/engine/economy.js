function inventoryOf(character) {
  return Array.isArray(character?.inventory) ? character.inventory : [];
}

function hasItem(character, slug) {
  return inventoryOf(character).some((item) => item?.slug === slug);
}

function itemPrice(item) {
  const price = item?.price ?? item?.value;
  return Number.isFinite(price) && price >= 0 ? price : null;
}

function validItem(item) {
  return item && typeof item.slug === 'string' && item.slug.length > 0;
}

function copyWithInventory(character, inventory, gold = undefined) {
  return {
    ...character,
    gold: gold ?? character?.gold,
    inventory,
  };
}

function hasValidGold(character) {
  return character && Number.isFinite(character.gold);
}

function treasureValue(item) {
  return Number.isFinite(item?.value) && item.value > 0 ? item.value : 0;
}

export function canAfford(character, price) {
  if (!character || !Number.isFinite(character.gold)) {
    return false;
  }

  if (!Number.isFinite(price) || price < 0) {
    return false;
  }

  return character.gold >= price;
}

export function buyItem(character, item) {
  if (!validItem(item)) {
    return { ok: false, character, reason: 'missing-item' };
  }

  const price = itemPrice(item);
  if (price === null) {
    return { ok: false, character, item, reason: 'invalid-price' };
  }

  if (hasItem(character, item.slug)) {
    return { ok: false, character, item, reason: 'already-owned' };
  }

  if (!hasValidGold(character)) {
    return { ok: false, character, item, reason: 'invalid-gold' };
  }

  if (!canAfford(character, price)) {
    return { ok: false, character, item, reason: 'insufficient-gold' };
  }

  return {
    ok: true,
    character: copyWithInventory(character, [...inventoryOf(character), item], character.gold - price),
    item,
    text: `Bought ${item.name ?? item.slug} for ${price} gold.`,
  };
}

export function sellItem(character, itemSlug) {
  if (typeof itemSlug !== 'string' || itemSlug.length === 0) {
    return { ok: false, character, goldGained: 0, reason: 'invalid-item-slug' };
  }

  const inventory = inventoryOf(character);
  const itemIndex = inventory.findIndex((item) => item?.slug === itemSlug);

  if (itemIndex === -1) {
    return { ok: false, character, goldGained: 0, reason: 'missing-item' };
  }

  if (!hasValidGold(character)) {
    return { ok: false, character, goldGained: 0, reason: 'invalid-gold' };
  }

  const item = inventory[itemIndex];
  if (item.type === 'treasure') {
    return { ok: false, character, goldGained: 0, item, reason: 'treasure-converts-on-return' };
  }

  const value = Number.isFinite(item?.value) ? item.value : 0;
  const goldGained = Math.max(0, Math.floor(value * 0.25));
  const nextInventory = [
    ...inventory.slice(0, itemIndex),
    ...inventory.slice(itemIndex + 1),
  ];

  return {
    ok: true,
    character: copyWithInventory(character, nextInventory, character.gold + goldGained),
    goldGained,
    item,
  };
}

export function takeTreasure(character, item, options = {}) {
  if (!character) {
    return { ok: false, character, reason: 'missing-character' };
  }

  if (!validItem(item)) {
    return { ok: false, character, reason: 'missing-item' };
  }

  // Adventure loot is a fresh instance each run — the cave regenerates its
  // chest, so a character who already carries one healing potion may take
  // another. Only callers that enforce uniqueness (shop purchases) keep the
  // already-owned guard. Pass { allowDuplicate: true } to take a duplicate.
  if (!options.allowDuplicate && hasItem(character, item.slug)) {
    return { ok: false, character, item, reason: 'already-owned' };
  }

  return {
    ok: true,
    character: copyWithInventory(character, [...inventoryOf(character), item]),
    item,
  };
}

export function convertTreasuresOnReturn(character) {
  if (!hasValidGold(character)) {
    return { ok: false, character, goldGained: 0, convertedItems: [], reason: 'invalid-gold' };
  }

  const inventory = inventoryOf(character);
  const convertedItems = inventory.filter((item) => item?.type === 'treasure');
  const keptItems = inventory.filter((item) => item?.type !== 'treasure');
  const goldGained = convertedItems.reduce((sum, item) => sum + treasureValue(item), 0);

  return {
    ok: true,
    character: copyWithInventory(character, keptItems, character.gold + goldGained),
    goldGained,
    convertedItems,
  };
}
