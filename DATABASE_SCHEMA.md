# Eamon: The Second Age — Content Database Schema

## Overview

Each adventure (level) has its own artistic identity, locations, and cast of characters/enemies. This schema enables both AI-generated content on-the-fly and pre-generated asset management.

---

## Table: `adventures`

Core adventure metadata and artistic direction.

| Field | Type | Description |
|-------|------|-------------|
| `id` | TEXT PRIMARY KEY | URL-safe slug (e.g., "beginners-cave", "zephyr-river") |
| `name` | TEXT | Display name (e.g., "The Beginner's Cave") |
| `description` | TEXT | One-line teaser for adventure select |
| `artist_style` | TEXT | Primary aesthetic (e.g., "Eyvind Earle", "Studio Ghibli", "Moebius") |
| `inspiration_artist` | TEXT | Specific artist reference (e.g., "Eyvind Earle Sleeping Beauty 1959") |
| `style_prompt_prefix` | TEXT | Prepended to all image prompts for this adventure |
| `music_track` | TEXT | Filename (e.g., "cave-static-teeth.mp3") |
| `difficulty` | INTEGER | 1-10 scale |
| `author` | TEXT | Original Eamon author or "AI-generated" |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |

**Example:**
```json
{
  "id": "beginners-cave",
  "name": "The Beginner's Cave",
  "description": "A simple cavern for new adventurers to test their mettle.",
  "artist_style": "Eyvind Earle",
  "inspiration_artist": "Eyvind Earle Sleeping Beauty 1959",
  "style_prompt_prefix": "Eyvind Earle style, geometric angular trees, jewel-tone palette, Byzantine influence, architectural depth, painterly backgrounds",
  "music_track": "cave-static-teeth.mp3",
  "difficulty": 1,
  "author": "Donald Brown"
}
```

---

## Table: `locations`

Every distinct room/area in an adventure.

| Field | Type | Description |
|-------|------|-------------|
| `id` | TEXT PRIMARY KEY | `{adventure_id}-{room_number}` (e.g., "beginners-cave-1") |
| `adventure_id` | TEXT FK | References adventures.id |
| `room_number` | INTEGER | In-adventure room ID (matches original Eamon data) |
| `name` | TEXT | Display name (e.g., "Cave Entrance") |
| `narration_text` | TEXT | DM narration for this location |
| `background_description` | TEXT | Detailed visual description for image generation |
| `generation_prompt` | TEXT | Full prompt sent to Imagen (auto-built or custom) |
| `image_url` | TEXT | Path to generated/uploaded image |
| `image_source` | TEXT | "generated" or "uploaded" |
| `music_override` | TEXT | Optional different music for this room |
| `is_combat_zone` | BOOLEAN | Whether enemies can appear here |
| `light_level` | TEXT | "bright", "dim", "dark" (affects scene rendering) |

**Example:**
```json
{
  "id": "beginners-cave-1",
  "adventure_id": "beginners-cave",
  "room_number": 1,
  "name": "Cave Entrance",
  "narration_text": "You stand at the mouth of a damp cave. Torches flicker on the walls.",
  "background_description": "Rocky cave entrance, moss-covered stone walls, flickering torchlight casting warm orange glow, damp ground, angular Gothic rock formations in Eyvind Earle style",
  "generation_prompt": "Eyvind Earle style, geometric angular trees, jewel-tone palette... Rocky cave entrance, moss-covered stone walls, flickering torchlight...",
  "image_url": "/gen-images/bg-beginners-cave-1.jpg",
  "image_source": "generated",
  "light_level": "dim"
}
```

---

## Table: `characters`

NPCs and enemies for each adventure.

| Field | Type | Description |
|-------|------|-------------|
| `id` | TEXT PRIMARY KEY | `{adventure_id}-{character_slug}` |
| `adventure_id` | TEXT FK | References adventures.id |
| `name` | TEXT | Display name |
| `slug` | TEXT | URL-safe identifier |
| `type` | TEXT | "npc", "enemy", "boss", "merchant" |
| `is_hostile` | BOOLEAN | Auto-attacks player? |
| `description` | TEXT | Physical description for DM narration |
| `portrait_description` | TEXT | Detailed visual for image generation |
| `generation_prompt` | TEXT | Full prompt sent to Imagen |
| `portrait_url` | TEXT | Path to portrait image |
| `portrait_source` | TEXT | "generated" or "uploaded" |
| `voice_id` | TEXT | ElevenLabs voice ID |
| `voice_role` | TEXT | "irishman", "narrator", "marcos", "hokas", "custom" |
| `hp` | INTEGER | Hit points (enemies only) |
| `damage_dice` | TEXT | e.g., "2d6" (enemies only) |
| `armor_class` | INTEGER | Defense rating |
| `special_ability` | TEXT | Combat ability description |
| `loot_table` | JSON | Array of item IDs this enemy can drop |
| `friendliness` | TEXT | "friendly", "neutral", "hostile" |
| `first_encounter_text` | TEXT | What DM says when you first meet them |

**Example — Enemy:**
```json
{
  "id": "beginners-cave-rat",
  "adventure_id": "beginners-cave",
  "name": "Giant Rat",
  "slug": "rat",
  "type": "enemy",
  "is_hostile": true,
  "description": "A rat the size of a dog with yellowed fangs.",
  "portrait_description": "Giant rat, mangy fur, yellow fangs bared, red beady eyes, aggressive pose, Eyvind Earle flat graphic style with subtle shading",
  "generation_prompt": "Eyvind Earle Sleeping Beauty style... Giant rat, mangy fur...",
  "portrait_url": "/gen-images/portrait-rat.jpg",
  "voice_id": "nPczCjzI2devNBz1zQrb",
  "voice_role": "narrator",
  "hp": 8,
  "damage_dice": "1d4",
  "armor_class": 2,
  "first_encounter_text": "A giant rat screeches and lunges at you!"
}
```

**Example — NPC:**
```json
{
  "id": "beginners-cave-cynthia",
  "adventure_id": "beginners-cave",
  "name": "Cynthia",
  "slug": "cynthia",
  "type": "npc",
  "is_hostile": false,
  "description": "A fellow adventurer resting by the fire.",
  "portrait_description": "Young female adventurer, leather armor, kind face, warm smile, Eyvind Earle flat graphic style",
  "portrait_url": "/gen-images/portrait-cynthia.jpg",
  "voice_id": "iP95p4xoKVk53GoZ742B",
  "voice_role": "shopkeep",
  "friendliness": "friendly",
  "first_encounter_text": "Oh! Another brave soul. Careful in the east tunnel."
}
```

---

## Table: `items`

Weapons, armor, potions, treasures specific to each adventure.

| Field | Type | Description |
|-------|------|-------------|
| `id` | TEXT PRIMARY KEY | `{adventure_id}-{item_slug}` |
| `adventure_id` | TEXT FK | |
| `name` | TEXT | Display name |
| `slug` | TEXT | URL-safe |
| `type` | TEXT | "weapon", "armor", "shield", "potion", "spell", "treasure" |
| `description` | TEXT | Flavor text |
| `value` | INTEGER | Gold value |
| `weight` | INTEGER | Eamon weight units |
| `damage_dice` | TEXT | Weapons only: "1d8", "2d6" |
| `hit_bonus` | INTEGER | Weapons: +to hit |
| `defense_bonus` | INTEGER | Armor/shields: AC bonus |
| `agility_penalty` | INTEGER | Heavy armor: -AG |
| `heal_amount` | INTEGER | Potions: HP restored |
| `uses` | INTEGER | Potions/spells: charges |
| `image_url` | TEXT | Small icon or full image |
| `is_key_item` | BOOLEAN | Required to complete adventure? |

---

## Image Generation Workflow

### Option A: On-the-fly (Current)
```
Player enters room → Server receives [LOCATION: Cave Entrance]
→ Query locations table for generation_prompt
→ Call Imagen API → Cache image → Return URL
→ Client displays with crossfade
```

### Option B: Pre-generate (Recommended for production)
```
Design adventure → Write all locations/characters
→ Generate all images locally with Imagen
→ Upload to /public/adventures/{adventure_id}/
→ Update image_url fields to static paths
→ Disable on-the-fly generation
```

### Prompt Building Formula
```javascript
function buildLocationPrompt(location, adventure) {
  return `${adventure.style_prompt_prefix}. ${location.background_description}. 
    Cinematic composition, dramatic lighting, no text, no UI elements.`;
}

function buildPortraitPrompt(character, adventure) {
  return `${adventure.style_prompt_prefix}. ${character.portrait_description}. 
    Character portrait, head and shoulders, facing slightly left, neutral background.`;
}
```

---

## File Structure (Pre-generated Assets)

```
/public/adventures/
  beginners-cave/
    manifest.json          # Copy of adventure + locations + characters
    bg-entrance.jpg
    bg-tunnel-east.jpg
    bg-goblin-den.jpg
    bg-treasure-room.jpg
    portrait-cynthia.jpg
    portrait-goblin.jpg
    portrait-mimic.jpg
  zephyr-river/
    manifest.json
    bg-riverbank.jpg
    ...
```

---

## Implementation Notes

1. **SQLite** for local development, **PostgreSQL** for production
2. **JSON files** work for static adventures (no DB needed)
3. **Image cache** should store MD5 of prompt → avoid regenerating
4. **Style consistency** comes from strict `style_prompt_prefix` adherence
5. **Voice consistency** via `voice_role` mapping to ElevenLabs IDs

---

## Next Steps

1. Create `data/` folder with JSON files for Beginner's Cave
2. Build admin UI for entering adventure data
3. Add `image_preference` field ("generate" vs "upload") to adventures
4. Create batch generation script for pre-generating all images