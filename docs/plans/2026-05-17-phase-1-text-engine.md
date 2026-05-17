# Eamon Phase 1 Text Engine Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Rebuild Eamon: The Second Age around a stable text-only, server-authoritative Eamon RPG loop before adding voice, images, character graphics, combat graphics, music, or monetization.

**Architecture:** The server owns game reality: account identity, reusable characters, character stats, inventory, gold, current location, room state, monsters, combat, treasure, and adventure completion. The client renders state and sends player commands. AI is used only after deterministic rules resolve an action: first as optional natural-language intent parsing fallback, then as narration enhancement. The game must remain playable if AI/media services fail.

**Tech Stack:** Node.js ES modules, Express, PostgreSQL on Railway, browser ES modules, JSON adventure manifests, Node test runner (`node --test`) unless later replaced by Vitest.

---

## Product Direction Lock

Build in layers:

1. Playable text game.
2. Reusable accounts/characters.
3. Adventure progress persistence.
4. Shop/economy.
5. Natural-language parser with AI fallback.
6. AI narration.
7. Voice.
8. Background/images.
9. Character graphics.
10. Combat graphics.
11. Music/ambience.
12. Purchased gold/monetization.

Phase 1 covers items 1-4 and only the safest parts of item 5. Media systems stay disabled or non-critical.

## Non-Negotiable Stability Rules

1. Server is authoritative.
2. The AI may never directly mutate HP, gold, inventory, monster HP, room state, or adventure completion.
3. Exact commands must work without AI.
4. If AI parsing fails, deterministic parser/fallback prompts continue gameplay.
5. If AI narration fails, deterministic text responses continue gameplay.
6. If TTS/image/music fails, game remains fully playable.
7. Beginner's Cave must be playable start-to-finish text-only before any media layer resumes.
8. Every engine module must have tests before integration into `/api/chat`.

## Current Repo Findings

Verified repo:

```text
/Users/jarvisai/.openclaw/workspace/projects/eamon-ai
```

Current important files:

```text
server.js
ARCHITECTURE.md
DATABASE_SCHEMA.md
data/adventures/beginners-cave.json
public/index.html
public/js/main.js
public/js/state.js
public/js/stream.js
public/js/shop.js
public/js/audio.js
public/js/scene.js
public/js/hud.js
public/js/input.js
public/js/narrative.js
```

Observed problems:

- `server.js` is still monolithic: Express, DB init, AI provider selection, prompt rules, shop logic, session store, SSE parsing, stat mutation, ElevenLabs, and Fal image generation all live together.
- Current stat state still depends partly on AI-emitted tags (`[GOLD]`, `[DAMAGE]`, `[HEAL]`). This is the wrong authority boundary.
- `data/adventures/beginners-cave.json` has rooms, NPCs, enemies, items, and art metadata, but does not yet define exits/room graph or deterministic room treasure placement strongly enough for engine-only play.
- `package.json` has no test script beyond `start`.
- Frontend has been split into ES modules, but `state.js` still has loose global-like mutable state and a random session id, not reusable account/character state.

## Audit Findings Integrated 2026-05-17

Three focused audits were run before implementation planning moved forward.

### Original Eamon mechanics audit

Local original Apple II `.bas` / `.dsk` source files were not found in the workspace. The best local reference material is the older project at:

```text
/Users/jarvisai/.openclaw/workspace/projects/eamon
```

Key files:

```text
/Users/jarvisai/.openclaw/workspace/projects/eamon/main-hall-spec.md
/Users/jarvisai/.openclaw/workspace/projects/eamon/game/data/main-hall.json
/Users/jarvisai/.openclaw/workspace/projects/eamon/game/data/character-classes.json
/Users/jarvisai/.openclaw/workspace/projects/eamon/game/data/beginners-cave.json
```

Important mechanics to preserve:

- Persistent reusable character loop: Main Hall → shop/bank/pawn → adventure → return alive with loot → repeat.
- Core stats: Hardiness, Agility, Charisma.
- Main Hall NPCs/areas: Burly Irishman, Marcos Cavielli, Hokas Tokas, Shylock McFenney, Sam Slicker, Adventure Gate.
- Weapons use odds/hit modifiers plus damage dice.
- Armor reduces incoming damage.
- Banked gold persists and is safer than carried gold.
- Text parser supports abbreviations and verbs like `GO`, `LOOK`, `ATTACK`, `GET`, `OPEN`, `INVENTORY`, `STATS`, `CAST`, `QUIT`, `HELP`.
- Beginner's Cave is a tutorial adventure and should teach command usage.

Important modernization decisions:

- Use server-authoritative JSON/manifests rather than original disk/source formats.
- AI parser/narrator can assist, but never own state.
- Local anonymous player IDs are acceptable for Phase 1, upgradeable to login later.
- Death can be softened for onboarding, but must be explicit and deterministic.

### Current repo audit

High-risk current behavior:

- `server.js` still asks AI to emit `[GOLD]`, `[DAMAGE]`, and `[HEAL]` tags and then mutates game state from those tags.
- AI can still invent positive gold or healing unless the new `/api/game/*` engine bypasses this path.
- Client creates a random session ID per load, blocking reusable accounts and refresh resume.
- Client mutates gold/inventory optimistically through `applyLocalPurchase()` before server confirmation.
- TTS, scene images, portraits, and music are enabled by default and automatically triggered from gameplay events.
- `data/adventures/beginners-cave.json` has only 8 rooms; the better local reference has 26 rooms.
- Existing DB docs/schema/server init conflict on adventure table shape and do not support migrations safely.

Immediate implication: Phase 1 gameplay must move to new `/api/game/*` endpoints and not rely on `/api/chat`/SSE AI tags.

### Persistence/schema audit

Additive migration only for Phase 1:

- Do not destructively modify existing Railway content tables yet.
- Add `schema_migrations`.
- Add gameplay ownership/state tables: `players`, `player_characters`, `adventure_runs`.
- Treat `adventure_runs.adventure_id` as JSON manifest slug, not DB FK, until content schema is normalized.
- Enforce one active adventure run per character in Phase 1.
- Command processing should eventually use DB transactions and row locks to prevent double-buy/double-loot bugs.

## Phase 1 Acceptance Test

A player can:

1. Open the app.
2. Create or resume an account identity.
3. Create or select a reusable character.
4. Enter the Main Hall.
5. View stats, gold, inventory.
6. Visit shop, buy valid equipment, and be blocked from invalid purchases.
7. Enter Beginner's Cave.
8. Use exact commands and common natural variants:
   - `look`, `search`, `inventory`, `stats`
   - `north`, `go north`, `walk north`
   - `attack goblin`, `hit goblin with sword`
   - `take dagger`, `get coins`
   - `use potion`, `talk to cynthia`
   - `leave`, `return`, `back`
9. Move through actual room graph only.
10. Fight deterministic monsters.
11. Collect deterministic treasure.
12. Save room state and character state.
13. Return to Main Hall alive with loot/gold, or die with explicit state handling.
14. Refresh browser and resume current character/adventure state.
15. Complete the flow with no AI/media dependency.

## Deferred Until Later Phases

Do not implement in Phase 1:

- Stripe/purchased gold.
- New image generation.
- Character portrait generation.
- Combat animations.
- Music composition/ambience system.
- Complex class system beyond Warrior/Rogue/Mystic baseline.
- Community adventure editor.
- Full password auth if a simpler local/session account bootstrap is sufficient for the vertical slice.

---

## Target File Structure

Create server modules without requiring a framework/build-step migration:

```text
server/
  app.js                    # Express app factory and route mounting
  routes/
    health.js
    game.js                 # /api/game/* endpoints
    media.js                # existing TTS/image endpoints, disabled/non-critical in Phase 1
  db/
    pool.js
    schema.js
    players.js
    characters.js
    adventureRuns.js
  engine/
    dice.js
    commands.js
    economy.js
    combat.js
    adventures.js
    stateMachine.js
    renderer.js             # deterministic text fallback responses
  ai/
    parserFallback.js       # optional AI intent parser only after deterministic parse fails
    narrator.js             # optional AI narration only after engine result exists
  content/
    loadAdventure.js
```

Keep `server.js` initially as a thin compatibility entrypoint:

```js
import { createApp } from './server/app.js';

const port = process.env.PORT || 3000;
const app = await createApp();
app.listen(port, () => console.log(`Eamon listening on ${port}`));
```

Frontend stays no-build ES modules:

```text
public/js/api.js            # game API calls
public/js/state.js          # client display state only
public/js/main.js           # boot and UI orchestration
```

---

## Engine Contract

All player actions should follow this flow:

```text
raw input
→ parseCommand(raw input, context)
→ resolveIntent(intent, authoritative state)
→ persist state changes
→ build deterministic response
→ optional AI narration pass
→ response payload to client
```

Canonical response shape:

```js
{
  ok: true,
  intent: {
    type: 'move',
    direction: 'north',
    confidence: 1,
    source: 'rules'
  },
  events: [
    { type: 'location_changed', fromRoom: 1, toRoom: 2 },
    { type: 'room_described', roomNumber: 2 }
  ],
  state: {
    phase: 'adventure',
    character: { id: '...', name: '...', hd: 22, gold: 170, inventory: [] },
    adventureRun: { id: '...', adventureId: 'beginners-cave', currentRoom: 2 }
  },
  text: 'You move north into the damp corridor...',
  choices: ['look', 'go east', 'go west', 'inventory'],
  media: {
    voice: null,
    background: null,
    portraits: []
  }
}
```

No response should require parsing hidden AI tags on the client.

---

# Implementation Tasks

## Task 1: Add test foundation

**Objective:** Add a zero-build test foundation for engine modules.

**Files:**
- Modify: `package.json`
- Create: `test/engine/dice.test.js`
- Create: `server/engine/dice.js`

**Steps:**
1. Add script:
   ```json
   "test": "node --test"
   ```
2. Create `server/engine/dice.js` with `rollDie`, `rollDice`, and injectable RNG support.
3. Create deterministic tests for `1d6`, `2d4+1`, invalid notation.
4. Run `npm test`.
5. Expected: tests pass.

**Verification:**
```bash
npm test
```

---

## Task 2: Create command parser module

**Objective:** Parse exact and common natural commands without AI.

**Files:**
- Create: `server/engine/commands.js`
- Create: `test/engine/commands.test.js`

**Supported intents:**

```js
look, search, inventory, stats, move, attack, take, use_item, talk, shop, buy, leave, help, unknown
```

**Examples:**

```js
parseCommand('north') → { type: 'move', direction: 'north', source: 'rules' }
parseCommand('go north') → { type: 'move', direction: 'north', source: 'rules' }
parseCommand('attack goblin') → { type: 'attack', target: 'goblin', source: 'rules' }
parseCommand('hit goblin with sword') → { type: 'attack', target: 'goblin', weapon: 'sword', source: 'rules' }
parseCommand('take rusty dagger') → { type: 'take', target: 'rusty dagger', source: 'rules' }
parseCommand('talk to cynthia') → { type: 'talk', target: 'cynthia', source: 'rules' }
```

**Verification:**
```bash
node --test test/engine/commands.test.js
```

---

## Task 3: Normalize Beginner's Cave manifest for deterministic play

**Objective:** Replace/normalize the incomplete 8-room `eamon-ai` Beginner's Cave data with a deterministic 26-room manifest derived from the stronger local reference at `/Users/jarvisai/.openclaw/workspace/projects/eamon/game/data/beginners-cave.json`.

**Files:**
- Read reference: `/Users/jarvisai/.openclaw/workspace/projects/eamon/game/data/beginners-cave.json`
- Modify: `data/adventures/beginners-cave.json`
- Create: `server/content/loadAdventure.js`
- Create: `test/content/loadAdventure.test.js`

**Required manifest additions:**

Each location gets:

```json
"exits": { "north": 2 },
"treasure": [],
"requires": null
```

Each character placement must be machine-readable:

```json
"location_room": 3,
"current_hp_from": "hp"
```

Add item placements separately from item definitions:

```json
"placements": [
  { "room_number": 5, "item_slug": "diamonds", "hidden": false },
  { "room_number": 3, "item_slug": "goblin-dagger", "after_defeating": "goblin" }
]
```

**Verification:**
- Loader validates every exit destination exists.
- Loader validates every character `location_room` exists.
- Loader validates every placement `item_slug` exists.

---

## Task 4: Create in-memory adventure run state

**Objective:** Build a deterministic session/adventure run model before DB integration.

**Files:**
- Create: `server/engine/adventures.js`
- Create: `test/engine/adventures.test.js`

**Functions:**

```js
createAdventureRun(adventure, characterId)
getCurrentRoom(run, adventure)
move(run, adventure, direction)
getVisibleRoomEntities(run, adventure)
markItemCollected(run, itemSlug)
markEnemyDefeated(run, enemySlug)
```

**Rules:**
- Cannot move through nonexistent exits.
- Current room updates only on valid move.
- Dead enemies do not reappear.
- Collected items do not reappear.

---

## Task 5: Create deterministic economy module

**Objective:** Server validates all gold/item transactions.

**Files:**
- Create: `server/engine/economy.js`
- Create: `test/engine/economy.test.js`

**Functions:**

```js
canAfford(character, price)
buyItem(character, item)
sellItem(character, itemSlug)
takeTreasure(character, item)
```

**Rules:**
- Gold cannot go negative.
- Item must exist.
- Purchased/taken items enter inventory once.
- Treasure value can be converted to gold only through explicit rule: either immediate gold or return-to-hall conversion. Pick one for Phase 1 and document it.

**Phase 1 recommendation:** Treasure items stay in inventory during adventure and convert to gold only when the character safely returns to Main Hall.

---

## Task 6: Create deterministic combat module

**Objective:** Resolve combat without AI tags.

**Files:**
- Create: `server/engine/combat.js`
- Create: `test/engine/combat.test.js`

**Functions:**

```js
resolveAttack(attacker, defender, rng)
resolveCombatRound(character, enemy, rng)
isDead(entity)
```

**Rules:**
- Uses agility and weapon/monster dice.
- Applies armor/defense reduction.
- Player and enemy HP cannot drop below zero.
- If enemy dies, enemy counterattack should not occur unless we intentionally choose simultaneous rounds. Pick one rule and test it.

**Phase 1 recommendation:** Player attack resolves first. If enemy dies, no counterattack.

---

## Task 7: Create deterministic text renderer

**Objective:** Produce playable fallback text from engine events.

**Files:**
- Create: `server/engine/renderer.js`
- Create: `test/engine/renderer.test.js`

**Functions:**

```js
renderRoom(room, entities, items, exits)
renderCombatResult(result)
renderMoveBlocked(direction)
renderInventory(character)
renderDeath(character)
renderReturnToHall(summary)
```

**Rule:** Renderer output must be plain text and never require markdown or hidden tags.

---

## Task 8: Create account/character persistence schema

**Objective:** Add persistent users/characters/adventure runs without building full paid auth yet.

**Files:**
- Create: `server/db/schema.js`
- Create: `server/db/players.js`
- Create: `server/db/characters.js`
- Create: `server/db/adventureRuns.js`
- Modify: existing DB init path or replace in new `server/app.js`

**Minimal tables:**

Use app-generated text UUIDs and `TIMESTAMPTZ`. Keep this migration additive; do not rewrite existing content tables in Railway during Phase 1.

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  auth_provider TEXT,
  auth_subject TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS players_auth_identity_idx
  ON players(auth_provider, auth_subject)
  WHERE auth_provider IS NOT NULL AND auth_subject IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS players_email_idx
  ON players(lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS player_characters (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('warrior', 'rogue', 'mystic')),
  hardiness INTEGER NOT NULL CHECK (hardiness > 0),
  agility INTEGER NOT NULL CHECK (agility > 0),
  charisma INTEGER NOT NULL CHECK (charisma > 0),
  hd INTEGER NOT NULL CHECK (hd >= 0),
  max_hd INTEGER NOT NULL CHECK (max_hd > 0),
  gold INTEGER NOT NULL DEFAULT 0 CHECK (gold >= 0),
  bank_gold INTEGER NOT NULL DEFAULT 0 CHECK (bank_gold >= 0),
  inventory JSONB NOT NULL DEFAULT '[]'::jsonb,
  equipment JSONB NOT NULL DEFAULT '{}'::jsonb,
  adventures_completed JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_alive BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_played_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS player_characters_player_id_idx
  ON player_characters(player_id);

CREATE TABLE IF NOT EXISTS adventure_runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES player_characters(id) ON DELETE CASCADE,
  adventure_id TEXT NOT NULL,
  current_room INTEGER NOT NULL,
  room_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  enemy_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  collected_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  discovered_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'dead', 'abandoned')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS adventure_runs_player_id_idx
  ON adventure_runs(player_id);

CREATE INDEX IF NOT EXISTS adventure_runs_character_id_idx
  ON adventure_runs(character_id);

CREATE UNIQUE INDEX IF NOT EXISTS adventure_runs_one_active_per_character_idx
  ON adventure_runs(character_id)
  WHERE status = 'active';
```

**Migration safety:**
- Do not use the current `server.js` pattern that skips schema work when `adventures` exists.
- Existing `adventures.id` may be integer in Railway while docs expect text. Do not FK `adventure_runs.adventure_id` to content tables in Phase 1; validate against JSON slug instead.
- If an incompatible legacy `player_characters` table already exists, fail loudly and require manual backup/rename rather than silently mutating it.

**Phase 1 auth approach:** local anonymous player id stored in browser localStorage. Later replace/upgrade to email login without breaking character ownership.

---

## Task 9: Build `/api/game` endpoints

**Objective:** Stop routing core gameplay through open-ended `/api/chat`.

**Files:**
- Create: `server/routes/game.js`
- Modify: `server/app.js` or `server.js`
- Create/modify: `public/js/api.js`

**Endpoints:**

```text
POST /api/game/bootstrap
POST /api/game/characters
GET  /api/game/characters?playerId=...
POST /api/game/start-adventure
POST /api/game/command
```

**Command endpoint body:**

```json
{
  "playerId": "local-player-id",
  "characterId": "character-id",
  "adventureRunId": "run-id",
  "input": "go north"
}
```

**Response:** engine contract shape above.

---

## Task 10: Wire frontend to text engine

**Objective:** Make the browser use `/api/game/*` for Phase 1 gameplay.

**Files:**
- Modify: `public/js/main.js`
- Modify: `public/js/state.js`
- Modify: `public/js/stream.js` or bypass for non-streaming Phase 1 responses
- Create: `public/js/api.js`

**Rules:**
- Client displays `response.text` and `response.choices`.
- Client updates HUD from `response.state.character` only.
- Client no longer depends on hidden `[GOLD]`, `[DAMAGE]`, `[HEAL]` tags for game state.
- Existing TTS/audio/image calls are disabled by default in Phase 1 mode.

---

## Task 11: Add optional AI parser fallback behind a flag

**Objective:** Preserve organic language without giving AI authority.

**Files:**
- Create: `server/ai/parserFallback.js`
- Modify: `server/routes/game.js`

**Rules:**
- Only called when deterministic parser returns `unknown`.
- AI returns JSON intent only.
- Intent is validated against current state before execution.
- If invalid or malformed, return deterministic help text.
- Feature flag: `ENABLE_AI_PARSER=true`.

---

## Task 12: Add optional AI narration behind a flag

**Objective:** Let AI improve prose after engine resolution.

**Files:**
- Create: `server/ai/narrator.js`
- Modify: `server/routes/game.js`

**Rules:**
- AI receives engine events and current room facts.
- AI returns prose only.
- AI output cannot change state.
- If AI fails/times out, use deterministic renderer output.
- Feature flag: `ENABLE_AI_NARRATION=true`.

---

## Task 13: Browser verification checklist

**Objective:** Verify user-facing behavior before deploy.

**Files:**
- Create: `docs/checklists/phase-1-browser-test.md`

**Checklist:**

1. Title screen loads.
2. New local player identity is created.
3. Character creation persists after refresh.
4. Main Hall renders stats/gold/inventory.
5. Shop purchase deducts gold server-side.
6. Invalid purchase is blocked.
7. Beginner's Cave starts at correct room.
8. Movement works only through valid exits.
9. `look` shows current room facts.
10. Combat changes HP deterministically.
11. Dead monsters stay dead after refresh.
12. Collected treasure stays collected after refresh.
13. Return to Main Hall converts treasure if applicable.
14. Death state is explicit and does not corrupt account.
15. Voice/image failures do not block gameplay.

---

## Task 14: Deploy only after local checks pass

**Objective:** Deploy stable Phase 1 vertical slice to Railway.

**Commands:**

```bash
npm test
npm start
```

Then verify locally and deploy using existing Railway setup.

**Production verification:**

```text
/api/health returns ok
/api/game/bootstrap returns player/session bootstrap
Browser can complete text-only Beginner's Cave flow
```

---

## Review Gates

### Gate 1: Plan Approval

Before implementation, verify:

- Product direction matches Bo's layered approach.
- No media/monetization creep in Phase 1.
- Beginner's Cave text-only acceptance criteria are complete.

### Gate 2: Engine Unit Tests

Before wiring frontend:

- dice, parser, adventure movement, economy, combat, renderer tests pass.

### Gate 3: Persistence Tests

Before browser work:

- player, character, adventure run CRUD works locally or with test DB/mocked repo.

### Gate 4: Browser Manual Test

Before deploy:

- complete browser checklist locally.

### Gate 5: Railway Production Smoke Test

After deploy:

- health passes.
- game bootstrap passes.
- character persists.
- one movement, one purchase, and one combat action work.

---

## Subagent Operating Model

Use subagents for scoped work only:

1. Original Eamon mechanics audit.
2. Current repo coupling/bug audit.
3. Persistence/schema audit.
4. Test harness implementation.
5. Individual engine modules.
6. Spec review.
7. Code quality review.

Do not let multiple implementers touch the same files in parallel.

Controller/orchestrator retains:

- product architecture
- task sequencing
- merge decisions
- deployment decisions
- final verification

---

## Immediate Next Actions

1. Run three parallel audits:
   - Original Eamon mechanics/reference audit.
   - Current repo coupling/state bug audit.
   - Account/character/adventure-run persistence audit.
2. Update this plan with audit findings.
3. Start Task 1: test foundation.
4. Proceed task-by-task with spec and code quality reviews.
