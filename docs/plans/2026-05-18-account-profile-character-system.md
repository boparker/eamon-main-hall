# Eamon Account/Profile/Character System Implementation Plan

> **For Hermes:** Use `subagent-driven-development` skill to implement this plan task-by-task. Enforce strict TDD from `test-driven-development`: write failing tests first, run them red, then implement minimal green code.

**Goal:** Replace temporary local browser player identity with real site registration, login, profiles, multiple characters, and durable selected-character persistence.

**Architecture:** Add authentication and account tables alongside the existing Phase 1 game tables. Keep anonymous/local players temporarily as guest mode, but make registered users the durable owner of profiles, characters, adventure runs, and future AI chronicle state. Do not implement payments in this phase.

**Tech Stack:** Current Node/Express app, PostgreSQL, native `node:test`, existing server/db modules, browser ES modules. Use built-in Node `crypto` for password hashing/session tokens unless/until a dedicated auth library is introduced.

---

## Scope

This phase builds the foundation needed for Eamon: The Second Age:

- Username/password registration.
- Login/logout.
- Server sessions via secure random tokens.
- User-owned profiles.
- Multiple characters per profile/user.
- Selected active character persisted server-side.
- Guest/local player flow preserved as temporary fallback.
- No Stripe/payment work yet.
- No multiplayer yet.

---

## Existing Context

Relevant current files:

```text
server/db/schema.js
server/db/players.js
server/db/characters.js
server/db/adventure-runs.js
server/routes/game.js
public/js/player-id.js
public/js/game-client.js
public/js/api.js
test/db/*.test.js
test/routes/game.test.js
test/client-game-ui.test.js
```

Current state:

- Browser creates/persists a local anonymous `playerId`.
- `player_characters` are scoped to that `playerId`.
- Multiple characters exist at DB level, but browser flow effectively treats selected character as bootstrap state.
- Registration choice exists in UI text/choices but is not a real auth system.

---

## Data Model

### users

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);
```

Rules:

- `username` is required and unique.
- `email` optional initially, but unique if provided.
- Store password hash only, never raw password.
- Normalize username lowercase for uniqueness unless product later wants case-preserved display.

### user_sessions

```sql
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Rules:

- Raw token returned once to browser.
- DB stores hash of token.
- Expiration can start at 30 days.

### player_profiles

```sql
CREATE TABLE IF NOT EXISTS player_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  selected_character_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Rules:

- Default profile created on registration.
- Multiple profiles can support family/player slots later.
- `selected_character_id` is the durable replacement for browser-only selected character state.

### player_characters changes

Current table should be migrated to support registered ownership while preserving guest mode.

Add nullable columns:

```sql
ALTER TABLE player_characters ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE player_characters ADD COLUMN IF NOT EXISTS profile_id TEXT REFERENCES player_profiles(id) ON DELETE SET NULL;
```

Rules:

- Guest characters continue using existing `player_id`.
- Registered characters use `user_id` and `profile_id`.
- During transition, endpoints may accept either authenticated user or guest `playerId`.
- New registered character creation should require auth once auth UI exists.

### adventure_runs changes

Add nullable ownership columns:

```sql
ALTER TABLE adventure_runs ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE adventure_runs ADD COLUMN IF NOT EXISTS profile_id TEXT REFERENCES player_profiles(id) ON DELETE SET NULL;
```

Rules:

- Runs are scoped by authenticated user/profile/character where present.
- Guest runs continue to work via `player_id` until guest mode is retired.

---

## API Design

### POST /api/auth/register

Request:

```json
{
  "username": "bo",
  "email": "bo@example.com",
  "password": "long-password",
  "displayName": "Bo"
}
```

Response:

```json
{
  "ok": true,
  "user": { "id": "user-...", "username": "bo", "displayName": "Bo" },
  "profile": { "id": "profile-...", "name": "Bo" },
  "sessionToken": "raw-token-returned-once"
}
```

Validation:

- username min 3 chars, allowed `[a-z0-9_-]`
- password min 10 chars initially
- duplicate username returns 409
- email must be valid format if present

### POST /api/auth/login

Request:

```json
{
  "username": "bo",
  "password": "long-password"
}
```

Response:

```json
{
  "ok": true,
  "user": { "id": "user-...", "username": "bo" },
  "profiles": [{ "id": "profile-...", "name": "Bo" }],
  "activeProfile": { "id": "profile-...", "name": "Bo", "selectedCharacterId": null },
  "sessionToken": "raw-token-returned-once"
}
```

### POST /api/auth/logout

Invalidates current session token.

### GET /api/auth/me

Uses `Authorization: Bearer <sessionToken>`.

Response:

```json
{
  "ok": true,
  "user": {...},
  "profiles": [...],
  "activeProfile": {...}
}
```

### POST /api/profiles

Create additional profile.

### POST /api/profiles/:profileId/select-character

Request:

```json
{ "characterId": "char-..." }
```

Response:

```json
{ "ok": true, "profile": { "selectedCharacterId": "char-..." } }
```

### Game API changes

Existing game endpoints should support auth context:

- If bearer session token is present, scope by `user_id/profile_id`.
- Else fallback to guest `playerId` for current behavior.

Bootstrap should return:

```json
{
  "state": {
    "auth": { "mode": "guest" | "registered" },
    "user": null | {...},
    "profile": null | {...},
    "characters": [...],
    "character": null | selectedCharacter
  }
}
```

---

## Task Breakdown

### Task 1: Add auth schema tests

**Objective:** Prove schema creates `users`, `user_sessions`, and `player_profiles`.

**Files:**

- Modify test: `test/db/schema.test.js`
- Modify implementation later: `server/db/schema.js`

**Step 1: Write failing test**

Add assertions in schema mock query list for:

- `CREATE TABLE IF NOT EXISTS users`
- `CREATE TABLE IF NOT EXISTS user_sessions`
- `CREATE TABLE IF NOT EXISTS player_profiles`
- `ALTER TABLE player_characters ADD COLUMN IF NOT EXISTS user_id`
- `ALTER TABLE adventure_runs ADD COLUMN IF NOT EXISTS user_id`

**Step 2: Run red**

```bash
node --test test/db/schema.test.js
```

Expected: FAIL because schema does not create these tables/columns yet.

**Step 3: Implement schema**

Modify `server/db/schema.js` with tables/columns above.

**Step 4: Run green**

```bash
node --test test/db/schema.test.js && npm test
```

**Step 5: Commit**

```bash
git add server/db/schema.js test/db/schema.test.js
git commit -m "feat: add auth account schema"
```

---

### Task 2: Add password hashing utility

**Objective:** Store password hashes safely with built-in crypto.

**Files:**

- Create: `server/auth/passwords.js`
- Create test: `test/auth/passwords.test.js`

**API:**

```js
export async function hashPassword(password) {}
export async function verifyPassword(password, storedHash) {}
```

Implementation recommendation:

- Use `crypto.scrypt` via `promisify`.
- Store format: `scrypt$<salt>$<key>`.
- Use `crypto.timingSafeEqual` for verification.

**Tests:**

- hash does not equal raw password.
- same password verifies true.
- wrong password verifies false.
- malformed stored hash verifies false.

**Commands:**

```bash
node --test test/auth/passwords.test.js
npm test
```

**Commit:**

```bash
git add server/auth/passwords.js test/auth/passwords.test.js
git commit -m "feat: add password hashing utilities"
```

---

### Task 3: Add session token utility

**Objective:** Generate raw session tokens and store only hashes.

**Files:**

- Create: `server/auth/sessions.js`
- Create test: `test/auth/sessions.test.js`

**API:**

```js
export function createSessionToken() {}
export function hashSessionToken(token) {}
export function sessionExpiry(days = 30) {}
```

**Tests:**

- generated token length is sufficient.
- tokens are unique across multiple calls.
- hash is deterministic for same token.
- hash does not equal raw token.
- expiry is in future.

---

### Task 4: Add user repository

**Objective:** Create/read users and sessions with injected DB pool.

**Files:**

- Create: `server/db/users.js`
- Create test: `test/db/users.test.js`

**API:**

```js
export async function createUser(pool, input) {}
export async function getUserByUsername(pool, username) {}
export async function createUserSession(pool, userId, tokenHash, expiresAt) {}
export async function getUserBySessionTokenHash(pool, tokenHash) {}
export async function deleteUserSession(pool, tokenHash) {}
```

**Tests:**

- createUser normalizes username.
- createUser inserts password hash, not raw password.
- getUserByUsername uses normalized lookup.
- createUserSession stores token hash and expiry.
- getUserBySessionTokenHash rejects expired sessions.
- deleteUserSession deletes by token hash.

---

### Task 5: Add profile repository

**Objective:** Create/list profiles and persist selected character.

**Files:**

- Create: `server/db/profiles.js`
- Create test: `test/db/profiles.test.js`

**API:**

```js
export async function createProfile(pool, userId, name) {}
export async function listProfiles(pool, userId) {}
export async function setSelectedCharacter(pool, userId, profileId, characterId) {}
export async function getProfile(pool, userId, profileId) {}
```

**Tests:**

- default profile inserts user-owned row.
- listProfiles scopes by user.
- setSelectedCharacter scopes by user and profile.
- cannot select another user character.

---

### Task 6: Add auth middleware

**Objective:** Resolve optional authenticated user from bearer token.

**Files:**

- Create: `server/auth/middleware.js`
- Create test: `test/auth/middleware.test.js`

**API:**

```js
export function optionalAuth({ pool }) {}
export function requireAuth({ pool }) {}
```

Behavior:

- No token: `req.auth = null` for optional.
- Valid token: `req.auth = { user }`.
- Expired/invalid token: optional returns 401? Prefer 401 if token is present but invalid.
- requireAuth rejects missing token with 401.

---

### Task 7: Add auth routes

**Objective:** Register, login, logout, and current-user endpoints.

**Files:**

- Create: `server/routes/auth.js`
- Modify: `server.js` to mount `/api/auth`
- Create test: `test/routes/auth.test.js`

**Routes:**

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET /api/auth/me
```

**Tests:**

- register creates user, default profile, and session token.
- duplicate username returns 409.
- login accepts valid credentials.
- login rejects wrong password.
- me returns user/profile when bearer token valid.
- logout invalidates session.

---

### Task 8: Add profile routes

**Objective:** Profile management endpoints.

**Files:**

- Create: `server/routes/profiles.js`
- Modify: `server.js` to mount `/api/profiles`
- Create test: `test/routes/profiles.test.js`

**Routes:**

```text
GET /api/profiles
POST /api/profiles
POST /api/profiles/:profileId/select-character
```

**Tests:**

- unauthenticated requests reject.
- list profiles returns only user profiles.
- create profile validates name.
- select-character persists selected character.

---

### Task 9: Update character repository for registered ownership

**Objective:** Registered users can create/list characters by profile while guest mode still works.

**Files:**

- Modify: `server/db/characters.js`
- Modify: `test/db/characters.test.js`

**Tests:**

- createCharacter accepts `userId` and `profileId`.
- listCharacters can list by user/profile.
- getCharacter scopes by user/profile when provided.
- guest `playerId` behavior remains green.

---

### Task 10: Update game bootstrap to support auth context

**Objective:** Authenticated bootstrap returns user/profile/selected character; guest bootstrap unchanged.

**Files:**

- Modify: `server/routes/game.js`
- Modify: `test/routes/game.test.js`

**Tests:**

- guest bootstrap still works with `playerId`.
- auth bootstrap ignores spoofed `playerId` ownership.
- auth bootstrap returns characters for active profile.
- auth bootstrap returns selected character if profile has one.
- auth bootstrap starts creation flow if no selected character.

---

### Task 11: Add browser auth API helpers

**Objective:** Client can register/login/logout/me.

**Files:**

- Modify: `public/js/api.js`
- Create/modify test: `test/client-auth-api.test.js`

**API:**

```js
register(input)
login(input)
logout()
getCurrentUser()
setSessionToken(token)
getSessionToken()
clearSessionToken()
```

**Tests:**

- auth helpers send/consume bearer token.
- token persisted in localStorage.
- logout clears token.
- non-JSON errors produce clear messages.

---

### Task 12: Browser registration/login minimal UI flow

**Objective:** Make Register / Upgrade Account choice functional without overbuilding UI.

**Files:**

- Modify: `public/js/game-client.js`
- Modify: `public/js/main.js` if input state needs labels.
- Modify: `test/client-game-ui.test.js`

**Flow:**

```text
Register / Upgrade Account
→ username
→ email optional or skip
→ password
→ create account
→ bootstrap as registered user
```

Login can be command-driven initially:

```text
login
→ username
→ password
```

**Tests:**

- choosing Register starts registration state.
- registration calls auth API and stores token.
- after registration bootstrap returns registered state.
- create character after registration creates registered-owned character.

---

### Task 13: Character selection UI

**Objective:** Multiple characters can be created and selected.

**Files:**

- Modify: `public/js/game-client.js`
- Modify: `test/client-game-ui.test.js`

**Flow:**

```text
Create Character
Select Character
List Characters
```

**Tests:**

- bootstrap with multiple characters renders selection choices.
- selecting a character calls profile select endpoint.
- selected character becomes active in HUD and Main Hall.
- create new character does not delete old characters.

---

## Verification Checklist

Before marking this auth phase complete:

- `npm test` passes.
- Guest flow still works without registration.
- Register creates durable account.
- Refresh after login preserves account via token.
- Multiple characters can exist under one account.
- Selecting character survives refresh.
- Character creation still follows original Eamon port rules.
- Beginner's Cave can start from selected registered character.
- No payment code exists yet.
- No AI authority over auth/game state.

---

## Out of Scope

- Stripe/payment gateway.
- Gold purchase ledger.
- OAuth/social login.
- Email verification.
- Password reset email.
- Multiplayer.
- AI adventure builder.
- AI chronicle storage implementation.

These are later phases.
