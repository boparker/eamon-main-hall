# Eamon: The Second Age — Architecture Plan

## Where We Are Now

The current codebase works as a proof of concept: one 633-line server.js handles AI streaming, image generation, TTS, database, and all endpoints. One 877-line index.html contains the entire frontend — CSS, HTML, and all game logic in a single `<script>` block. State lives in a handful of loose variables (`character`, `gamePhase`, `pendingState`) with no clear ownership boundaries.

This got the game running. But the problems we keep hitting (gold not syncing, HP not deducting, shop state overwriting server state) are symptoms of the real issue: there's no separation between display logic, game rules, and network communication. Everything touches everything.

The goal of this refactor is to create a codebase that can support multiple adventures, persistent characters, structured combat, and eventually community-contributed content — without rewriting what already works.

---

## Guiding Principles

**Stay on the web.** HTML/JS is the right platform for a text-driven AI dungeon crawler. No framework needed — ES modules give us clean separation without build tools.

**Server is authoritative.** The server owns all game state: gold, HP, inventory, position. The client displays it. Local mutations (like instant gold deduction in the shop) are optimistic updates that get reconciled on the next server response.

**The AI narrates, the engine enforces.** The AI describes what happens ("the goblin slashes your arm"). The game engine decides the mechanical result (roll 1d4, subtract from HP, emit a stat change). Right now the AI is responsible for both — that's why stats don't track.

**No build step.** ES modules with `<script type="module">` in the browser. No webpack, no bundler. The game should stay deployable with `node server.js`.

---

## Frontend: Module Structure

Split index.html into a thin shell that loads modules from `/public/js/`:

```
public/
  index.html          ← HTML + CSS only (no game logic)
  js/
    main.js           ← Boot sequence, wires everything together
    state.js          ← GameState class (single source of truth)
    stream.js         ← SSE streaming, tag parsing, event dispatch
    hud.js            ← HUD rendering, stat animations
    narrative.js      ← Text rendering, streaming tokens, scroll management
    input.js          ← Input box, skins, choice cards, send logic
    shop.js           ← Shop panel, inventory display, purchase flow
    combat.js         ← Combat UI, turn display, dice roll visuals
    scene.js          ← Background crossfade, portrait system
    audio.js          ← Music crossfade, TTS (ElevenLabs + browser fallback)
    adventure.js      ← Adventure loader, room transitions, map state
```

### state.js — The Core

This is the single module every other module reads from. It replaces the loose `character`, `gamePhase`, and `pendingState` variables.

```javascript
// state.js — Central game state with event bus
class GameState extends EventTarget {
  #character = null;
  #phase = 'title';        // title → intro → named → classed → playing
  #location = null;
  #adventure = null;
  #inventory = [];
  #combatState = null;      // null when not in combat

  get character() { return this.#character ? { ...this.#character } : null; }
  get phase() { return this.#phase; }
  get gold() { return this.#character?.gold ?? 0; }
  get hp() { return this.#character?.hd ?? 0; }
  get location() { return this.#location; }
  get inCombat() { return this.#combatState !== null; }

  // Called when server sends authoritative state
  syncFromServer(serverCharacter) {
    const changed = {};
    if (serverCharacter.gold !== this.#character?.gold) changed.gold = serverCharacter.gold;
    if (serverCharacter.hd !== this.#character?.hd) changed.hd = serverCharacter.hd;

    this.#character = { ...this.#character, ...serverCharacter };
    this.dispatchEvent(new CustomEvent('state:changed', { detail: changed }));
  }

  // Optimistic local update (shop purchase before server confirms)
  applyOptimistic(stat, delta) {
    if (!this.#character) return;
    const old = this.#character[stat] || 0;
    this.#character[stat] = Math.max(0, old + delta);
    this.dispatchEvent(new CustomEvent('state:changed', {
      detail: { [stat]: this.#character[stat], optimistic: true }
    }));
  }

  setPhase(phase) {
    this.#phase = phase;
    this.dispatchEvent(new CustomEvent('phase:changed', { detail: { phase } }));
  }

  setLocation(name) {
    this.#location = name;
    this.dispatchEvent(new CustomEvent('location:changed', { detail: { name } }));
  }

  setCharacter(data) {
    this.#character = { ...this.#character, ...data };
    this.dispatchEvent(new CustomEvent('state:changed', { detail: data }));
  }
}

export const gameState = new GameState();
```

Every other module subscribes to the events it cares about:

- **hud.js** listens for `state:changed` → updates stat displays with animations
- **scene.js** listens for `location:changed` → triggers background crossfade
- **audio.js** listens for `location:changed` → switches music tracks
- **shop.js** listens for `state:changed` → updates gold display, refreshes affordability
- **combat.js** listens for `state:changed` → updates HP bar during fights

### stream.js — Tag Parser

Extracts all structured tags from the AI stream and dispatches them as events on `gameState`. This is the bridge between the AI's text output and the game engine.

The key change: **stat tags get dispatched as events, not applied directly.** This lets any module react (HUD animates, shop refreshes, combat log updates).

```javascript
// stream.js — handles SSE connection and tag dispatch
import { gameState } from './state.js';

export async function streamMessage(endpoint, body, callbacks) {
  // ... SSE setup ...

  // When parsing events from the stream:
  if (evt.type === 'stat_change') {
    gameState.syncFromServer({ [evt.stat]: evt.value });
  }
  if (evt.type === 'location') {
    gameState.setLocation(evt.text);
  }
  if (evt.type === 'done' && evt.characterState) {
    gameState.syncFromServer(evt.characterState);
  }
  // ... token rendering via callbacks ...
}
```

### shop.js — Purchase Flow

The shop becomes self-contained. When a player clicks "Buy":

1. `gameState.applyOptimistic('gold', -price)` → HUD updates instantly
2. Shop re-renders affordability
3. Message "Buy Short Sword" is sent to AI
4. AI responds with `[GOLD: -30]`
5. Server updates authoritative gold
6. `stat_change` event arrives → `gameState.syncFromServer()` reconciles

```javascript
// shop.js
import { gameState } from './state.js';

export function openShop(shopKey) { /* ... render shop panel ... */ }
export function closeShop() { /* ... */ }

function handlePurchase(item) {
  gameState.applyOptimistic('gold', -(item.price || 0));
  // inventory add is local until server confirms
  return `Buy ${item.name}`;  // returns message for stream.js to send
}

// React to state changes
gameState.addEventListener('state:changed', (e) => {
  if ('gold' in e.detail) refreshShopAffordability();
});
```

---

## Backend: Server-Side Game Engine

The bigger shift is moving game rules out of the AI and onto the server. Right now the AI is judge, jury, and executor — it decides damage, gold amounts, whether a hit lands. That's why stats don't track reliably.

### Current Flow (broken)
```
Player: "I attack the goblin"
  → AI: "You swing your sword and hit! The goblin takes heavy damage."
  → No stat change. No HP tracked. Pure narrative.
```

### Target Flow
```
Player: "I attack the goblin"
  → Server: resolve combat round (dice rolls, modifiers, hit/miss)
  → Server: inject result into AI context as system message
  → AI: narrates the result cinematically
  → Server: emits stat_change events from the mechanical outcome
  → Client: HUD updates, combat log shows rolls
```

### server.js Refactor

Split server.js into modules too:

```
server/
  index.js            ← Express app setup, route mounting
  routes/
    game.js           ← /api/start, /api/chat (session management)
    media.js          ← /api/tts, /api/scene-image, /api/portrait
    admin.js          ← /api/admin/seed, future admin endpoints
  engine/
    combat.js         ← Dice rolls, hit resolution, damage calc
    economy.js        ← Gold transactions, shop validation, bank
    characters.js     ← Character creation, stat management
    adventures.js     ← Adventure loading, room transitions, exits
  ai/
    stream.js         ← AI streaming, tag parsing
    prompts.js        ← System prompt builder (per-adventure)
  db/
    pool.js           ← Database connection
    schema.js         ← Table creation
    seed.js           ← Seed data loading
```

### Combat Engine (server/engine/combat.js)

This is the most important new piece. Instead of trusting the AI to track combat, the server runs actual game mechanics:

```javascript
// combat.js — Server-side combat resolution
function rollDice(notation) {
  // Parse "2d6+3" → roll 2 six-sided dice, add 3
  const match = notation.match(/(\d+)d(\d+)([+-]\d+)?/);
  if (!match) return 0;
  const [, count, sides, mod] = match;
  let total = parseInt(mod || 0);
  for (let i = 0; i < parseInt(count); i++) {
    total += Math.floor(Math.random() * parseInt(sides)) + 1;
  }
  return total;
}

function resolveAttack(attacker, defender) {
  // Eamon-style combat: compare agility for hit chance
  const hitChance = 50 + (attacker.ag - defender.ag) * 2;
  const roll = Math.floor(Math.random() * 100) + 1;
  const hit = roll <= hitChance;

  let damage = 0;
  if (hit && attacker.weapon?.damage_dice) {
    damage = rollDice(attacker.weapon.damage_dice);
    // Apply armor reduction
    damage = Math.max(1, damage - (defender.armor_class || 0));
  }

  return { hit, roll, hitChance, damage, attackerName: attacker.name, defenderName: defender.name };
}

export function resolveCombatRound(player, enemy) {
  const playerAttack = resolveAttack(player, enemy);
  const enemyAttack = resolveAttack(enemy, player);

  return {
    playerAttack,
    enemyAttack,
    playerHpAfter: Math.max(0, player.hd - enemyAttack.damage),
    enemyHpAfter: Math.max(0, enemy.hp - playerAttack.damage),
    combatLog: buildCombatContext(playerAttack, enemyAttack),
  };
}

function buildCombatContext(pa, ea) {
  // This gets injected into the AI prompt so it narrates the mechanical result
  return `[COMBAT RESULT: ${pa.attackerName} ${pa.hit ? 'hit' : 'missed'} ${pa.defenderName}${pa.hit ? ` for ${pa.damage} damage` : ''}. ` +
    `${ea.attackerName} ${ea.hit ? 'hit' : 'missed'} ${ea.defenderName}${ea.hit ? ` for ${ea.damage} damage` : ''}. ` +
    `Player HP: ${pa.hit ? '' : ''}${ea.damage > 0 ? `took ${ea.damage} damage` : 'unharmed'}. ` +
    `Enemy HP remaining: ${Math.max(0, ea.defenderName === pa.defenderName ? 0 : 0)}]`;
}
```

The key insight: the server injects `[COMBAT RESULT: ...]` as a system message before calling the AI. The AI then narrates that result with flavor, and the server emits the stat changes. The AI doesn't decide the numbers — it just tells the story.

### Economy Engine (server/engine/economy.js)

Validates shop purchases server-side instead of trusting the client:

```javascript
export function processPurchase(session, itemName, shopData) {
  const item = findItem(shopData, itemName);
  if (!item) return { success: false, reason: 'Item not found' };
  if (session.character.gold < item.price) return { success: false, reason: 'Not enough gold' };

  session.character.gold -= item.price;
  session.character.inventory.push({ name: item.name, stats: item.stats });

  return {
    success: true,
    goldDelta: -item.price,
    newGold: session.character.gold,
    item: item.name,
  };
}
```

---

## Adventure System

You already have the right schema in `DATABASE_SCHEMA.md` and `beginners-cave.json`. The gap is that the current server doesn't use any of it — room data, character placement, and loot tables are all left to the AI's imagination.

### Adventure Loader

When a player enters an adventure, the server loads the adventure JSON (or DB rows) and uses it to:

1. **Feed room descriptions to the AI** as context — so the AI narrates from authored content, not hallucination
2. **Place enemies in rooms** — when the player enters room 3, the server knows a Goblin with 6 HP and 1d4 damage is there
3. **Manage room state** — track which rooms have been visited, which enemies are dead, which treasure has been picked up
4. **Control exits** — the AI presents movement choices based on actual map data

```javascript
// Session structure with adventure state
session = {
  id: 'abc123',
  phase: 'playing',
  character: { name: 'Theron', class: 'warrior', hd: 22, ag: 14, ch: 10, gold: 200, inventory: [] },
  adventure: {
    id: 'beginners-cave',
    currentRoom: 1,
    roomState: {
      3: { visited: false, enemies: [{ ...goblinData, currentHp: 6 }] },
      7: { visited: false, enemies: [{ ...mimicData, currentHp: 20 }] },
    },
    defeatedEnemies: [],
    collectedItems: [],
  },
  history: [...],
};
```

### Dynamic AI Context

Instead of one massive system prompt, build prompts per-adventure:

```javascript
function buildAdventureContext(session) {
  const room = getRoom(session.adventure, session.adventure.currentRoom);
  const enemies = getRoomEnemies(session.adventure, room.room_number);
  const npcs = getRoomNPCs(session.adventure, room.room_number);

  return `You are in: ${room.name}. ${room.narration_text}
    ${enemies.length ? `Enemies present: ${enemies.map(e => `${e.name} (${e.currentHp} HP)`).join(', ')}` : 'No threats here.'}
    ${npcs.length ? `NPCs present: ${npcs.map(n => n.name).join(', ')}` : ''}
    Player stats: HD ${session.character.hd}, AG ${session.character.ag}, Gold ${session.character.gold}
    Inventory: ${session.character.inventory.map(i => i.name).join(', ') || 'empty'}`;
}
```

---

## Persistent Characters (Save/Load)

For the platform vision, players need to keep their characters between sessions:

```sql
CREATE TABLE players (
  id TEXT PRIMARY KEY,           -- auth ID or generated
  display_name TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE player_characters (
  id SERIAL PRIMARY KEY,
  player_id TEXT REFERENCES players(id),
  name TEXT NOT NULL,
  class TEXT NOT NULL,
  hardiness INTEGER,
  agility INTEGER,
  charisma INTEGER,
  gold INTEGER DEFAULT 0,
  bank_gold INTEGER DEFAULT 0,
  inventory JSONB DEFAULT '[]',
  adventures_completed TEXT[] DEFAULT '{}',
  is_alive BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

The bank in the Great Hall becomes real — gold deposited there persists. Characters who survive an adventure come home with their loot. Characters who die... stay dead (or optionally can be rescued, Eamon-style).

---

## Migration Path

This doesn't need to happen all at once. Here's the order that gives the most value at each step:

### Phase 1: Frontend Modules (smallest risk, biggest quality-of-life win)
Split index.html into modules. No new features — just move existing code into separate files with clean imports. The game works exactly the same but the code is navigable.

**Files to create:** `state.js`, `stream.js`, `hud.js`, `narrative.js`, `input.js`, `shop.js`, `scene.js`, `audio.js`, `main.js`
**Files to modify:** `index.html` (strip `<script>` block, add `<script type="module" src="js/main.js">`)

### Phase 2: Server-Side Combat Engine
Build the combat resolver. Inject combat results into AI context. Emit stat changes from mechanical outcomes. This is what makes HP tracking actually work.

**Files to create:** `server/engine/combat.js`
**Files to modify:** `server.js` (detect combat actions, resolve before AI call, inject context)

### Phase 3: Adventure Loader
Load adventures from JSON/DB instead of relying on the AI to know the map. Feed room data into AI context. Track room state per session.

**Files to create:** `server/engine/adventures.js`
**Files to modify:** `server.js` (adventure state in session, room context in prompts)

### Phase 4: Server Economy
Server-side purchase validation. Bank system. Loot drops from defeated enemies. Pawn shop selling.

### Phase 5: Persistent Characters
Player accounts (even just a simple token). Save/load characters. Cross-adventure progression. Leaderboards.

### Phase 6: Adventure Creator
Admin tools or community tools for authoring new adventures — rooms, enemies, items, art styles. This is where the platform becomes what the original Eamon was: a framework for anyone to create dungeon adventures.

---

## What We Don't Need

- **React/Vue/Svelte** — The UI is text-focused. DOM manipulation is minimal. A framework would add complexity without solving real problems.
- **WebSocket** — SSE (server-sent events) works perfectly for one-way streaming. The client only sends on explicit actions.
- **Canvas/WebGL** — Unless you want animated combat sprites later. For now, the CSS-based visuals (crossfade backgrounds, portrait frames, stat animations) are elegant and performant.
- **Build tools** — ES modules work natively in all modern browsers. No webpack, no Vite, no transpilation needed.
