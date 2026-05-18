# Phase 1 Great Hall Correction Plan

> **For Hermes:** Use subagent-driven-development and strict TDD. Do not bypass the Great Hall. Do not route character creation directly into Beginner's Cave.

**Goal:** Restore the real Eamon Phase 1 flow: account/player identity -> Great Hall -> character creation/stat/class/equipment -> mandatory Beginner's Cave -> future adventure unlocks.

**Architecture:** The deterministic `/api/game` engine remains the authority for persistence and adventure commands, but the browser must not auto-create a default warrior or auto-start Beginner's Cave. The Great Hall is a first-class phase with server-backed account/character state. AI/media remain optional layers and cannot mutate stats, inventory, gold, class, or adventure availability.

**Critical correction:** Commit `46a4318` skipped Great Hall by automatically creating a default warrior and starting Beginner's Cave. It was reverted by `5fcd39c` to stop the bad Railway deployment. Rebuild Task 10 from the proper Great Hall flow.

---

## Correct Phase 1 Product Flow

1. User lands on title screen.
2. User enters/registers a player identity.
   - Phase 1 may allow anonymous local identity, but the architecture must support upgrade to email login.
   - Registration is required before future real-money gold purchases.
3. User enters the Great Hall / Main Hall.
4. If no character exists, Great Hall walks the player through:
   - name
   - class/type selection
   - stat roll/display/confirmation
   - starting gold display
   - equipment shopping: weapons/armor
5. Great Hall renders current character/account state:
   - player/account identity
   - name/class
   - HD/max HD
   - hardiness/agility/charisma
   - gold/bank gold
   - inventory/equipment
   - unlocked adventures
6. Beginner's Cave is mandatory first adventure.
7. Additional adventures remain locked until Beginner's Cave completion.
8. Starting an adventure is explicit player action from Great Hall, not automatic boot behavior.

---

## Task A: Add failing client tests for Great Hall boot behavior

**Objective:** Prove the bug: boot must not auto-create default warrior or auto-start Beginner's Cave.

**Files:**
- Create/modify: `test/client-game-ui.test.js`
- Create/modify: `public/js/game-client.js` only after RED

**Tests:**
- `startPhase1Game bootstraps player and renders Great Hall when no character exists`
  - `bootstrapGame` returns empty characters.
  - Assert `createGameCharacter` is not called.
  - Assert `startGameAdventure` is not called.
  - Assert rendered response text mentions Great Hall / create character.
- `startPhase1Game renders existing character in Great Hall without starting adventure`
  - `bootstrapGame` returns one character.
  - Assert no adventure auto-start.
  - Assert Great Hall state is rendered with stats/gold/inventory.

**Command:**
```bash
node --test test/client-game-ui.test.js
```

Expected RED: tests fail because current implementation path does not exist or old approach auto-starts.

---

## Task B: Model Great Hall response contract

**Objective:** Add a canonical client/server response shape for Great Hall that still matches `/api/game` contract.

**Expected response example:**
```js
{
  ok: true,
  intent: { type: 'hall' },
  events: [{ type: 'enter_hall' }],
  text: 'You stand in the Great Hall...',
  choices: ['Create Character', 'Visit Weapons Shop', 'Visit Armor Shop', 'Begin Beginner’s Cave'],
  state: {
    phase: 'great-hall',
    player,
    character,
    unlockedAdventures: ['beginners-cave'],
    lockedAdventures: []
  },
  media: { voice: null, background: null, portraits: [] }
}
```

**Rules:**
- `phase: 'great-hall'` for Hall/Main Hall, not `'adventure'`.
- `Begin Beginner's Cave` only available once character has required setup.
- Later adventures remain locked until required completion flags exist.

---

## Task C: Add server Great Hall endpoints/actions

**Objective:** Make Great Hall server-backed instead of client-only or AI-only.

**Files:**
- Modify: `server/routes/game.js`
- Test: `test/routes/game.test.js`

**Add or extend endpoints:**
- `POST /api/game/bootstrap` should return Great Hall state, not only raw lists.
- `POST /api/game/characters` remains explicit character creation.
- Add one of:
  - `POST /api/game/hall` for Great Hall commands, or
  - support Great Hall commands through `POST /api/game/command` with no active run.

**Required tests:**
- bootstrap returns `state.phase === 'great-hall'`.
- no character -> choices include Create Character and not Start Adventure.
- existing fresh character -> choices include shop and Beginner's Cave.
- later adventure is locked before Beginner's Cave complete.
- Beginner's Cave completion unlocks later adventure placeholder when available.

---

## Task D: Character creation flow

**Objective:** Replace default warrior auto-creation with explicit Great Hall onboarding.

**Files:**
- Modify: `public/js/main.js`
- Modify/create: `public/js/game-client.js`
- Tests: `test/client-game-ui.test.js`

**Behavior:**
- Ask name.
- Ask class/type.
- Show stats.
- Confirm character.
- Save through `POST /api/game/characters`.
- Return to Great Hall.

**Do not:**
- Auto-create warrior.
- Auto-start Beginner's Cave.

---

## Task E: Server-authoritative shop in Great Hall

**Objective:** Great Hall shopping must mutate equipment/gold server-side before adventure start.

**Files:**
- Modify: `server/routes/game.js`
- Modify: `public/js/shop.js`
- Tests: route + client tests

**Behavior:**
- Buy weapon/armor from Great Hall.
- Deduct gold server-side.
- Add item/equipment server-side.
- HUD updates from response state.
- Invalid purchase/insufficient gold blocked server-side.

---

## Task F: Registration/account path

**Objective:** Phase 1 should not paint us into a corner for paid gold/accounts.

**Minimum now:**
- Keep anonymous `localStorage` player ID.
- Add visible registration/account affordance in Great Hall.
- Persist player row in DB via bootstrap.
- Define future upgrade fields already supported: email/auth provider/auth subject.

**Not required yet:**
- Stripe/paid gold.
- Full password auth.

**Required plan before monetization:**
- email login/session model
- account recovery
- purchase ledger
- anti-tamper gold ledger

---

## Task G: Browser verification checklist update

**Objective:** Task 13 checklist must test Great Hall first, then Beginner's Cave.

**Checklist additions:**
- Great Hall is visible after title/registration.
- No auto-start into Beginner's Cave.
- Character name entry works.
- Class/type selection works.
- Stats display before adventure start.
- Buying weapon/armor works before adventure.
- Beginner's Cave is explicit and mandatory first adventure.
- Later adventures are locked before Beginner's Cave completion.

---

## Non-negotiables

- No Task 10 commit until Great Hall flow passes tests and review.
- No Railway push until local browser checklist passes.
- No AI parser/narration work until Great Hall + Beginner's Cave text-only loop is correct.
- No real-money gold implementation until account registration and purchase ledger design are explicit.
