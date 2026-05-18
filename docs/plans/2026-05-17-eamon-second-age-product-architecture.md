# Eamon: The Second Age Product Architecture

> **For Hermes:** Use `subagent-driven-development` for implementation plans derived from this document. Keep original Eamon mechanics canonical; use AI only as a constrained experience layer.

**Goal:** Define the product direction for Eamon: The Second Age so development stops drifting into a one-for-one clone or generic RPG bot.

**Architecture:** The original Eamon web port (`https://github.com/kdechant/eamon`) is the mechanics baseline. The Second Age adds persistent accounts, multiple characters, AI-assisted narration, character memory, generated/cached visuals, and later multiplayer/payment systems without allowing AI to mutate canonical game state.

**Tech Stack:** Current Node/Express app, PostgreSQL persistence, browser client, deterministic server-authoritative engine, future auth/session system, future Stripe/payment integration, future AI narration/asset pipeline.

---

## Product Principle

**Eamon Classic is the engine. The Second Age is the living layer.**

Do not use AI to fake mechanics. Use AI to make the world remember, react, illustrate, narrate, and expand.

The original adventures stay intact. The constraints get wider around presentation, memory, player-specific narration, and optional side flavor, while the core adventure structure and rules remain deterministic.

---

## Canonical Baseline

The source-of-truth mechanics reference is the actual original web port:

```text
https://github.com/kdechant/eamon
```

Use it for:

- Main Hall structure
- adventurer creation
- stat rolls
- gold baseline
- gender/name/profile assumptions
- multiple adventurers
- shops
- bank
- spells/wizard/witch systems
- adventure list and selection
- deterministic room/item/monster/combat behavior
- persistence expectations

Current known canonical character creation rules:

```text
Create New Adventurer
→ name
→ gender
→ roll Hardiness / Agility / Charisma
→ roll uses 3d7 per stat
→ reroll until Hardiness >= 15, Agility >= 12, total >= 42
→ starting gold = 200
```

No warrior/rogue/mystic class choice exists in the original port. If we later introduce classes, that must be a deliberate Second Age design decision, not accidental drift.

---

## AI Boundaries

### AI May Do

- Rewrite canonical state into rich prose.
- Add mood, sensory detail, pacing, and voice.
- Generate room illustrations from canonical room metadata.
- Generate NPC portraits from canonical NPC metadata.
- Generate ambient sound/music prompts.
- Summarize prior sessions.
- Maintain a character chronicle.
- Reflect character history in narration.
- Generate rumors, hall flavor, and non-mechanical color.
- Suggest side hooks that do not alter core adventure state unless compiled into deterministic data.
- Help authors/admins build new adventure modules.

### AI Must Not Do

- Change gold.
- Change inventory.
- Invent or remove exits.
- Invent defeated enemies.
- Change HP/damage/combat results.
- Unlock adventures.
- Award treasure.
- Rewrite shop prices.
- Contradict canonical room/item/monster data.
- Freeform critical adventure state directly into the database.

All mechanical changes must go through server-authoritative commands and validated reducers.

---

## Core Player Experience

### Classic Structure

The player should feel the continuity of classic Eamon:

```text
Account / profile
→ Main Hall
→ create/select adventurer
→ buy/prepare
→ enter adventure
→ return changed
→ chronicle grows
```

### Second Age Enhancement

The same adventure may feel different for each player because the presentation adapts to:

- character history
- prior choices
- injuries/scars
- reputation
- equipment
- play style
- prior deaths/survivals
- discoveries
- user preference for tone/detail

The room and adventure rules remain the same, but the narrative wrapper becomes personal.

---

## Persistence Model

### Users

Real site registration is required before this becomes a real product.

```text
users
- id
- username
- email
- password_hash
- display_name
- created_at
- updated_at
- last_login_at
```

### Player Profiles

Profiles allow one account to maintain separate identities or family/player slots.

```text
player_profiles
- id
- user_id
- profile_name
- created_at
- updated_at
```

### Characters

Multiple adventurers per profile/account.

```text
characters
- id
- user_id
- profile_id
- name
- gender
- hardiness
- agility
- charisma
- hp
- max_hp
- gold
- bank_gold
- status
- current_adventure_id
- created_at
- updated_at
```

### Inventory / Equipment

```text
character_items
- id
- character_id
- item_id
- source_adventure_id
- equipped
- quantity
- metadata
```

### Adventure Runs

```text
adventure_runs
- id
- character_id
- adventure_id
- status
- current_room_id
- visited_rooms
- room_state
- monster_state
- collected_item_ids
- defeated_enemy_ids
- started_at
- saved_at
- completed_at
```

### Character Memory / Chronicle

```text
character_memories
- id
- character_id
- memory_type
- content
- structured_metadata
- source_run_id
- created_at
```

Use this for:

- scars
- achievements
- notable kills
- favorite weapons
- failures
- NPC reactions
- summarized adventure history
- player-authored notes later

---

## AI Experience Layer

### Narration Pipeline

Server produces canonical state:

```json
{
  "room": "dark_passage",
  "description": "A narrow dark passage runs north-south.",
  "exits": ["north", "south"],
  "visible_monsters": ["giant rat"],
  "visible_items": [],
  "character": { "hp": 12, "gold": 200 }
}
```

AI receives a constrained rendering prompt and returns presentation only:

```json
{
  "narration": "The passage narrows until your shoulders nearly brush both walls...",
  "atmosphere_tags": ["claustrophobic", "torchlit", "danger_near"],
  "voice_direction": "low suspense"
}
```

The AI response must not be used as source-of-truth state.

### Generated/Cached Visuals

Generate once, cache forever unless manually regenerated.

Entities that can have visuals:

- room
- region
- NPC
- monster
- item
- character portrait
- chronicle event

Cache keys should include:

```text
entity_type
entity_id
style_version
prompt_hash
model/provider
created_at
```

---

## Adventure Model

### Canonical Adventures

Imported or manually structured versions of classic adventures.

Rules:

- fixed rooms
- fixed exits
- fixed monsters/items
- deterministic mechanical outcomes
- AI presentation only

### Second Age Adventures

Future AI-assisted authored modules.

Rules:

- AI may draft the adventure
- system compiles it into a structured manifest
- validator checks graph connectivity, treasure balance, monster balance, win condition, item placement, and impossible states
- once published, adventure is deterministic during play

---

## Multiplayer — Future Track

Multiplayer is a long-roadmap idea, not near-term scope.

Possible modes:

1. **Shared Party Adventure**
   - multiple player characters in same run
   - turn/initiative system
   - shared room state

2. **Asynchronous Party Board**
   - players contribute turns when available
   - good for families/friends

3. **Hall Social Layer**
   - see other adventurers in the Main Hall
   - trade rumors
   - compare chronicles

4. **Co-op Legacy Adventures**
   - original modules adapted to party play with balance constraints

Multiplayer should wait until single-player persistence, deterministic runs, and AI presentation are stable.

---

## Monetization / Payments — Later

Payments are intentionally late-stage.

Future possibilities:

- account treasury gold purchases
- cosmetic portraits
- premium visual packs
- premium adventure modules
- custom AI-generated family adventure packages
- extra profile/character slots
- illustrated chronicle export
- founder/supporter badge

Gold purchases need guardrails so the game does not become cheap pay-to-win.

Possible guardrails:

- purchased gold goes into account treasury
- characters withdraw only from Main Hall
- challenge/leaderboard runs mark purchased-gold usage
- some adventures may enforce pure/classic mode

---

## Milestone Roadmap

### Milestone 1 — Canonical Foundation

Goal: stop breaking basic Eamon assumptions.

- Complete browser verification of current character creation flow.
- Align Main Hall options with original port.
- Implement real username/password registration.
- Support multiple profiles/characters per account.
- Persist selected character and progress server-side.
- Preserve original stat/gold/shop/adventure mechanics.

### Milestone 2 — Stable Beginner's Cave

Goal: one adventure playable end-to-end with persistent state.

- Structure Beginner's Cave as deterministic room/item/monster data.
- Add server-side reducers for movement, pickup/drop, combat, treasure, death, win condition.
- Save/resume adventure run.
- Return to Main Hall with updated character.
- Browser smoke test from account creation to adventure completion.

### Milestone 3 — Second Age Narration

Goal: make the same adventure feel richer and personal.

- Add constrained AI rendering service.
- Add canonical-state-to-narration prompt format.
- Store generated narration events as optional logs.
- Add character chronicle summaries.
- Add tone controls.
- Add fallback deterministic text when AI unavailable.

### Milestone 4 — Visual Layer

Goal: make the experience beautiful without burning repeat costs.

- Add generated/cached room images.
- Add generated/cached NPC/monster/item cards.
- Add character portrait generation.
- Add style-version locking.
- Add admin regenerate controls.

### Milestone 5 — Adventure Builder

Goal: turn Eamon into a platform.

- Admin adventure manifest editor.
- AI draft generator.
- Manifest validator.
- Balance checker.
- Publish/unpublish flow.
- Adventure catalog.

### Milestone 6 — Payments

Goal: monetize only after the game has a reason to exist.

- Stripe checkout.
- Account treasury.
- Gold/cosmetic/adventure purchases.
- Purchase ledger.
- Refund/reversal handling.

### Milestone 7 — Multiplayer

Goal: future expansion after single-player is stable.

- Party model.
- Shared run state.
- Turn orchestration.
- Co-op adventure constraints.

---

## Near-Term Implementation Recommendation

Before more gameplay feature work, complete these in order:

1. Finish production browser smoke test for current deployed character creation.
2. Create a real account/profile/character schema plan.
3. Implement auth before expanding more adventure logic.
4. Port Main Hall mechanics from `kdechant/eamon` in small TDD slices.
5. Build Beginner's Cave as deterministic data.
6. Add AI narration only after the deterministic adventure loop is stable.

---

## Non-Negotiables

- No made-up mechanics unless explicitly marked as Second Age extensions.
- No AI authority over mechanical state.
- No one-for-one clone as the end goal.
- No repeated asset generation when cached assets exist.
- No payment work until the core experience is worth paying for.
- Multiplayer is real but later.
