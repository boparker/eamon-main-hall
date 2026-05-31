// help-menu.js — the "?" panel below the input. Its contents follow the
// player: Great Hall guidance in town, shop guidance at a vendor, and dungeon
// commands once an expedition begins.

const HELP = {
  hall: {
    title: 'Great Hall',
    items: [
      'Create a character: enter a name, choose a gender, then confirm the roll.',
      'Visit a vendor with the buttons, or type “visit weapons shop”, “view equipment”, or “bank”.',
      'Begin an expedition with the adventure button or “begin beginner’s cave”.',
      'Accounts preserve characters between expeditions; guest play is a Main Hall preview only.',
    ],
  },
  shop: {
    title: 'At the Shop',
    items: [
      'Click an item tile to buy it. Weapons and armour you purchase are readied automatically.',
      'Type “sell <item>” to sell something back at half its value.',
      'Your readied gear shows in the top bar. Use “leave” or the back button to return to the Hall.',
    ],
  },
  adventure: {
    title: 'In the Dungeon',
    items: [
      'Move with the direction buttons or by typing “north”, “south”, “east”, “west”.',
      '“look” surveys the room. “take <item>” picks something up. “open <chest>” reveals what’s inside.',
      '“attack <foe>” to fight. In combat you can cast a learned spell or “flee <direction>”.',
      '“read <inscription>” studies writing on walls or objects.',
      'Return to the Guild by heading “north” at the entrance (or typing “leave”) — your loot comes back only if you make it out alive.',
    ],
  },
};

export function initHelpMenu({
  button = globalThis.document?.getElementById('help-toggle-btn'),
  panel = globalThis.document?.getElementById('help-panel'),
} = {}) {
  if (!button || !panel) return { open() {}, close() {}, toggle() {}, setContext() {} };

  let context = 'hall';

  function render() {
    const content = HELP[context] ?? HELP.hall;
    const heading = document.createElement('h2');
    heading.textContent = `${content.title} Help`;
    const list = document.createElement('ul');
    for (const item of content.items) {
      const li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    }
    panel.replaceChildren(heading, list);
  }

  function setContext(next) {
    if (next && next !== context && HELP[next]) {
      context = next;
      render();
    }
  }

  function open() {
    panel.hidden = false;
    button.classList.add('active');
    button.setAttribute('aria-expanded', 'true');
  }

  function close() {
    panel.hidden = true;
    button.classList.remove('active');
    button.setAttribute('aria-expanded', 'false');
  }

  function toggle() {
    if (panel.hidden) open();
    else close();
  }

  render();
  button.addEventListener('click', toggle);
  button.setAttribute('aria-expanded', 'false');
  close();

  return { open, close, toggle, setContext };
}
