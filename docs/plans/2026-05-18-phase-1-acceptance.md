# Eamon: The Second Age Phase I Acceptance Checklist

Date: 2026-05-18
Status: Ready for Railway smoke testing after local test suite passes

## Purpose

Phase I is the deterministic foundation before AI narration, memory, graphics-generation, or richer Second Age presentation layers are added.

Phase I is complete when the browser, API, and database prove this loop works without AI deciding mechanics:

```text
Title gateway
→ guest or account identity
→ Great Hall
→ create/select adventurer
→ shop/equip
→ preserve guest before first expedition
→ enter Beginner's Cave as an account character
→ deterministic movement/combat/treasure/death/return behavior
→ persistent account/profile/character state
```

## Non-negotiable boundaries

- Server remains authoritative for stats, gold, inventory, equipment, unlocks, adventure runs, and room state.
- AI must not mutate mechanical state.
- Great Hall narration must not dump raw character-sheet stats or JSON.
- Guest mode is a limited Great Hall preview, not a full anonymous progression system.
- Guests must preserve an adventurer into an account/profile before the first expedition.
- Preserve Adventurer changes ownership/selection only; it must not change stats, equipment, inventory, gold, HP, or adventure state.

## Railway smoke test script

### 1. Fresh guest path

Use an incognito/private window or clear site data.

Expected:

1. Title screen appears.
2. Choose guest entry.
3. Great Hall loads.
4. If no character exists, character creation prompt appears.
5. Create/roll an adventurer.
6. Great Hall returns after creation.
7. Account menu says guest mode is limited and preservation is required before the first expedition.

Pass if the guest can create/equip in Great Hall without registering.

### 2. Guest expedition gate

From the guest Great Hall with a character:

1. Choose or type `begin beginner's cave`.
2. The game must not enter the cave.
3. The title/account gateway should become available with register/login visible.
4. The narration should explain that the adventurer must be preserved before leaving the Guild Hall.

Pass if Beginner's Cave does **not** start for a guest.

### 3. Preserve Adventurer via registration

From the preserve gate:

1. Register a new account.
2. The guest character should be claimed into the new account's active profile.
3. The game should return to the Great Hall under the account identity.
4. The HUD/account status should show the signed-in account.
5. The preserved character should remain selected.

Pass if the same guest adventurer appears under the new account without stat/equipment/gold changes.

### 4. Account expedition start

After preserving or after creating an account character:

1. Begin Beginner's Cave.
2. The cave entrance should render.
3. Try movement such as `south` and `north`.
4. Try deterministic commands such as `look`, `inventory`, `take <item>` where available.

Pass if account-owned characters can enter and interact with Beginner's Cave.

### 5. Account persistence

1. Reload the page.
2. Continue as stored account.
3. Confirm the active profile and selected character are still available.
4. Open the account menu.
5. Switch profile/character if test data exists.

Pass if account/profile/character selection survives reload.

### 6. Great Hall copy check

Enter the Great Hall with an existing character.

Pass if the main room narration does **not** contain inline character-sheet dumps such as:

```text
HD 12/12
Hardiness 12
Agility 9
Charisma 8
Equipment: {}
```

Mechanical stats may appear in HUD/equipment/status surfaces, not the room prose.

## Local verification required before Railway smoke

Run:

```bash
node --check public/js/main.js
node --check public/js/game-client.js
node --check public/js/title-gateway.js
node --check public/js/account-menu.js
node --test test/client-game-ui.test.js
node --test test/title-gateway.test.js
node --test test/account-menu.test.js
npm test
```

Expected:

```text
all tests pass
no syntax errors
```

## Phase I done criteria

- [ ] Registration works.
- [ ] Login/logout works.
- [ ] Stored session continue works.
- [ ] Profiles can be created/switched.
- [ ] Characters can be created/switched.
- [ ] Guest characters can be preserved into account profiles.
- [ ] Guest expeditions are blocked before account preservation.
- [ ] Account characters can enter Beginner's Cave.
- [ ] Beginner's Cave deterministic movement/commands work.
- [ ] Mechanical state remains server-authoritative.
- [ ] Great Hall entry copy does not expose raw stats/JSON.
- [ ] Full automated suite passes.
- [ ] Railway smoke test passes.

## What should wait until after Phase I

These are important, but they should not block the Phase I smoke test:

- AI-enhanced narration.
- Character memory/chronicles.
- Generated/adaptive room art.
- Portraits, richer scene cards, maps, combat presentation.
- Bank/spells/full Main Hall classic parity.
- Payments.
- Multiplayer.
- Adventure builder.

## Layering after Phase I

Recommended order after this checklist passes:

```text
Phase I: deterministic account/profile/character/adventure foundation
→ Visual presentation layer: room scene system, portraits, maps, equipment/combat visual surfaces
→ AI experience layer: constrained narration, memory, chronicles, generated/cached assets
```

Graphics should come before or alongside AI because the AI layer needs stable visual slots and asset metadata to target. Do not let AI generate mechanics; let it enrich canonical state into prose, prompts, and cacheable visual/audio assets.
