export function rollDie(sides, rng = Math.random) {
  if (!Number.isInteger(sides) || sides < 1) {
    return 0;
  }

  const roll = Math.floor(rng() * sides) + 1;
  return Math.min(Math.max(roll, 1), sides);
}

export function rollDice(notation, rng = Math.random) {
  if (typeof notation !== 'string') {
    return 0;
  }

  const match = notation.trim().match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!match) {
    return 0;
  }

  const count = Number.parseInt(match[1], 10);
  const sides = Number.parseInt(match[2], 10);
  const modifier = match[3] ? Number.parseInt(match[3], 10) : 0;

  if (count < 1 || sides < 1) {
    return 0;
  }

  let total = modifier;
  for (let i = 0; i < count; i += 1) {
    total += rollDie(sides, rng);
  }

  return total;
}
