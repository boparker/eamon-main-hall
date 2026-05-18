# Guest Character Claim / Migration Rules

Date: 2026-05-18
Status: Proposed implementation plan

## Purpose

Let a player who started in guest mode attach their browser-local guest character/progress to a registered account profile without corrupting ownership, duplicating adventure state, or changing deterministic game mechanics.

This is an ownership migration only. It must not rewrite character stats, inventory, gold, adventure run state, or any engine-controlled fields.

## Current ownership model

Durable registered path:

```text
users
└── player_profiles
    └── player_characters
        └── adventure_runs
```

Guest compatibility path:

```text
players
└── player_characters
    └── adventure_runs
```

Registered characters preserve compatibility with legacy gameplay by still having a synthetic player id style such as:

```text
account:<user-id>
```

## Claiming policy

### Allowed

A registered user may claim guest characters/runs from the current browser guest identity when all of these are true:

1. User is authenticated with a valid session token.
2. Target profile belongs to that user.
3. Source guest `player_id` matches the browser's current guest player id.
4. Character is currently unclaimed:
   - `user_id IS NULL`
   - `profile_id IS NULL`
5. Character belongs to the source guest player id.
6. Associated adventure runs are either also unclaimed or belong to the same guest player id.

### Not allowed

Reject claim attempts when:

- no authenticated account session exists
- target profile is not owned by the user
- character is already attached to another user/profile
- source guest player id does not match the character owner
- any run attached to the character belongs to a different guest player id
- request attempts to alter character mechanics fields during claim

## Recommended UX

Expose claim only in guest mode when a local guest character exists:

```text
Account menu / Title gateway
└── Create Account / Log In
    └── Claim this guest character?
        ├── Character: <name>
        ├── Target profile: <profile name>
        ├── What moves: character, inventory, gold, active/completed runs
        ├── What does not change: stats, equipment, room/run state, unlocks
        └── Confirm / Not now
```

Do not auto-claim on registration. Ask explicitly.

## Backend API proposal

```http
POST /api/profiles/:profileId/claim-guest-character
Authorization: Bearer <sessionToken>
Content-Type: application/json

{
  "guestPlayerId": "guest-player-id-from-browser",
  "characterId": "guest-character-id"
}
```

Successful response:

```json
{
  "ok": true,
  "profile": {
    "id": "profile-1",
    "selected_character_id": "character-id"
  },
  "character": {
    "id": "character-id",
    "user_id": "user-1",
    "profile_id": "profile-1"
  },
  "claimedRuns": 1
}
```

## Database operation

Run in a single transaction:

1. Verify profile ownership:

```sql
SELECT id FROM player_profiles
WHERE id = $profileId AND user_id = $userId
FOR UPDATE;
```

2. Verify claimable character:

```sql
SELECT id FROM player_characters
WHERE id = $characterId
  AND player_id = $guestPlayerId
  AND user_id IS NULL
  AND profile_id IS NULL
FOR UPDATE;
```

3. Update character ownership only:

```sql
UPDATE player_characters
SET user_id = $userId,
    profile_id = $profileId,
    player_id = $syntheticAccountPlayerId,
    updated_at = NOW()
WHERE id = $characterId;
```

4. Update linked adventure runs for the same guest player/character only:

```sql
UPDATE adventure_runs
SET user_id = $userId,
    profile_id = $profileId,
    player_id = $syntheticAccountPlayerId,
    updated_at = NOW()
WHERE character_id = $characterId
  AND player_id = $guestPlayerId
  AND user_id IS NULL
  AND profile_id IS NULL;
```

5. Set selected character on the profile:

```sql
UPDATE player_profiles
SET selected_character_id = $characterId,
    updated_at = NOW()
WHERE id = $profileId AND user_id = $userId;
```

## Mechanical Canon guardrails

Claim must never alter:

- stats
- hp/current_hp
- gold
- inventory
- equipment
- character class
- gender/name
- adventure run status
- current room
- visited rooms
- collected treasure
- defeated enemies
- unlock state

Claim only changes ownership fields and selected-character pointer.

## TDD implementation slices

### Slice 1: DB helper

Add a DB helper such as:

```js
claimGuestCharacter(db, {
  userId,
  profileId,
  guestPlayerId,
  characterId,
  accountPlayerId,
})
```

Tests:

- claims unowned guest character into target profile
- updates matching unowned runs
- sets selected character
- rejects already-owned character
- rejects profile owned by another user
- rejects character owned by another guest player id
- preserves mechanical fields exactly
- rolls back if run ownership update fails

### Slice 2: API route

Add:

```text
POST /api/profiles/:profileId/claim-guest-character
```

Tests:

- requires auth
- validates `guestPlayerId`
- validates `characterId`
- returns 404/409 for non-claimable character
- returns profile/character/claimedRuns on success

### Slice 3: frontend API helper

Add:

```js
claimGuestCharacter({ sessionToken, profileId, guestPlayerId, characterId })
```

Tests:

- posts to profile claim endpoint
- sends bearer token
- sends guest player and character id body
- surfaces API errors

### Slice 4: UI prompt

Add claim affordance only when:

- current mode is guest
- guest character exists
- user logs in/registers or opens account menu after auth

Tests:

- guest with local character sees claim option after auth
- registered player without guest character does not see claim option
- confirming claim calls helper and switches identity to account/profile
- cancel leaves guest state untouched

## Open product questions

1. Claim one character at a time or all guest characters for the browser player id?
   - Recommended first slice: one character at a time.
2. If guest has an active run, should claim keep it active?
   - Recommended: yes; ownership changes only.
3. Should guest unlocks tied to player-level state transfer?
   - Current unlocks appear character/run-derived; if player-level unlocks are added later, design separately.
4. Should claiming delete or retire the guest player row?
   - Recommended: no. Leave the guest player row for audit/compatibility; only move selected character/runs.
