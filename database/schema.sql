-- Eamon: The Second Age — PostgreSQL Schema
-- Run this to set up the database on Railway Postgres

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- CORE ADVENTURES
-- ============================================
CREATE TABLE adventures (
    id TEXT PRIMARY KEY, -- URL-safe slug: beginners-cave, zephyr-river
    name TEXT NOT NULL,
    description TEXT,
    artist_style TEXT NOT NULL DEFAULT 'Eyvind Earle',
    inspiration_artist TEXT NOT NULL DEFAULT 'Eyvind Earle Sleeping Beauty 1959',
    style_prompt_prefix TEXT NOT NULL,
    music_track TEXT,
    difficulty INTEGER CHECK (difficulty BETWEEN 1 AND 10),
    author TEXT,
    image_preference TEXT CHECK (image_preference IN ('generate', 'upload')) DEFAULT 'generate',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- LOCATIONS (Rooms)
-- ============================================
CREATE TABLE locations (
    id TEXT PRIMARY KEY, -- {adventure_id}-{room_number}
    adventure_id TEXT NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
    room_number INTEGER NOT NULL,
    name TEXT NOT NULL,
    narration_text TEXT NOT NULL,
    background_description TEXT NOT NULL, -- For image generation
    generation_prompt TEXT, -- Full prompt (auto-built if null)
    image_url TEXT, -- Path to generated/uploaded image
    image_source TEXT CHECK (image_source IN ('generated', 'uploaded')),
    music_override TEXT, -- Optional different music
    is_combat_zone BOOLEAN DEFAULT false,
    light_level TEXT CHECK (light_level IN ('bright', 'dim', 'dark')) DEFAULT 'dim',
    UNIQUE(adventure_id, room_number)
);

-- ============================================
-- EXITS (Room connections)
-- ============================================
CREATE TABLE exits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    adventure_id TEXT NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
    from_room INTEGER NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('N', 'S', 'E', 'W', 'UP', 'DOWN')),
    to_room INTEGER, -- NULL = special exit (back to Main Hall, etc.)
    is_door BOOLEAN DEFAULT false,
    is_locked BOOLEAN DEFAULT false,
    key_item_id TEXT, -- References items.id if locked
    UNIQUE(adventure_id, from_room, direction)
);

-- ============================================
-- CHARACTERS (NPCs and Enemies)
-- ============================================
CREATE TABLE characters (
    id TEXT PRIMARY KEY, -- {adventure_id}-{slug}
    adventure_id TEXT NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    type TEXT CHECK (type IN ('npc', 'enemy', 'boss', 'merchant')) NOT NULL,
    is_hostile BOOLEAN DEFAULT false,
    description TEXT,
    portrait_description TEXT NOT NULL,
    generation_prompt TEXT,
    portrait_url TEXT,
    portrait_source TEXT CHECK (portrait_source IN ('generated', 'uploaded')),
    voice_id TEXT,
    voice_role TEXT CHECK (voice_role IN ('irishman', 'narrator', 'marcos', 'hokas', 'shylock', 'sam', 'custom')),
    hp INTEGER,
    max_hp INTEGER,
    damage_dice TEXT, -- e.g., "2d6"
    armor_class INTEGER DEFAULT 0,
    special_ability TEXT,
    friendliness TEXT CHECK (friendliness IN ('friendly', 'neutral', 'hostile')) DEFAULT 'neutral',
    first_encounter_text TEXT,
    location_room INTEGER, -- Which room they start in
    is_random_spawn BOOLEAN DEFAULT false, -- Can appear in multiple rooms
    spawn_rooms INTEGER[], -- Array of room numbers if random
    UNIQUE(adventure_id, slug)
);

-- ============================================
-- ITEMS
-- ============================================
CREATE TABLE items (
    id TEXT PRIMARY KEY, -- {adventure_id}-{slug}
    adventure_id TEXT NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    type TEXT CHECK (type IN ('weapon', 'armor', 'shield', 'potion', 'spell', 'scroll', 'treasure', 'key', 'misc')) NOT NULL,
    description TEXT,
    value INTEGER DEFAULT 0, -- Gold value
    weight INTEGER DEFAULT 0,
    damage_dice TEXT, -- Weapons
    hit_bonus INTEGER DEFAULT 0, -- Weapons
    defense_bonus INTEGER DEFAULT 0, -- Armor/shields
    agility_penalty INTEGER DEFAULT 0, -- Heavy armor
    heal_amount INTEGER, -- Potions
    uses INTEGER DEFAULT 1, -- Potions/spells charges
    effect_description TEXT, -- Spells/scrolls
    is_key_item BOOLEAN DEFAULT false,
    image_url TEXT,
    location_room INTEGER, -- Where it spawns (NULL = shop/loot drop)
    is_hidden BOOLEAN DEFAULT false, -- Must be found
    container_id TEXT, -- Inside another item (chest, etc.)
    UNIQUE(adventure_id, slug)
);

-- ============================================
-- CHARACTER LOOT TABLES (What enemies drop)
-- ============================================
CREATE TABLE character_loot (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    drop_chance DECIMAL(3,2) DEFAULT 1.0, -- 0.0 to 1.0 probability
    quantity INTEGER DEFAULT 1
);

-- ============================================
-- MAIN HALL (Separate from adventures)
-- ============================================
CREATE TABLE main_hall_npcs (
    id TEXT PRIMARY KEY, -- marcos, hokas, shylock, sam, irishman
    name TEXT NOT NULL,
    role TEXT NOT NULL, -- weapons, magic, bank, pawn, registration
    description TEXT,
    portrait_description TEXT NOT NULL,
    portrait_url TEXT,
    voice_id TEXT NOT NULL,
    voice_role TEXT NOT NULL,
    greeting_text TEXT,
    shop_type TEXT CHECK (shop_type IN ('weapons', 'magic', 'bank', 'pawn', null))
);

CREATE TABLE main_hall_locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    background_description TEXT NOT NULL,
    image_url TEXT,
    generation_prompt TEXT,
    npc_ids TEXT[] -- Which NPCs are present
);

-- ============================================
-- PLAYER CHARACTERS (For save/load)
-- ============================================
CREATE TABLE player_characters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    hd INTEGER NOT NULL, -- Hardiness
    ag INTEGER NOT NULL, -- Agility
    ch INTEGER NOT NULL, -- Charisma
    max_hp INTEGER NOT NULL,
    current_hp INTEGER NOT NULL,
    gold INTEGER DEFAULT 0,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    current_adventure_id TEXT REFERENCES adventures(id),
    current_room INTEGER,
    inventory JSONB DEFAULT '[]', -- Array of item IDs
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_played TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- GENERATED IMAGES CACHE
-- ============================================
CREATE TABLE image_cache (
    id TEXT PRIMARY KEY, -- MD5 hash of prompt
    prompt TEXT NOT NULL,
    image_url TEXT NOT NULL,
    adventure_id TEXT REFERENCES adventures(id),
    type TEXT CHECK (type IN ('background', 'portrait', 'item')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    used_count INTEGER DEFAULT 1
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_locations_adventure ON locations(adventure_id);
CREATE INDEX idx_characters_adventure ON characters(adventure_id);
CREATE INDEX idx_items_adventure ON items(adventure_id);
CREATE INDEX idx_exits_adventure ON exits(adventure_id);
CREATE INDEX idx_image_cache_adventure ON image_cache(adventure_id);
CREATE INDEX idx_image_cache_type ON image_cache(type);

-- ============================================
-- TRIGGER: Update updated_at on adventures
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_adventures_updated_at BEFORE UPDATE
    ON adventures FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- VIEW: Full location with adventure style
-- ============================================
CREATE VIEW location_full AS
SELECT 
    l.*,
    a.artist_style,
    a.inspiration_artist,
    a.style_prompt_prefix,
    COALESCE(l.generation_prompt, 
        a.style_prompt_prefix || '. ' || l.background_description || '. Cinematic composition, dramatic lighting, no text, no UI elements.'
    ) AS full_generation_prompt
FROM locations l
JOIN adventures a ON l.adventure_id = a.id;

-- ============================================
-- VIEW: Character with adventure style
-- ============================================
CREATE VIEW character_full AS
SELECT 
    c.*,
    a.artist_style,
    a.inspiration_artist,
    a.style_prompt_prefix,
    COALESCE(c.generation_prompt,
        a.style_prompt_prefix || '. ' || c.portrait_description || '. Character portrait, head and shoulders, facing slightly left, neutral background. No text.'
    ) AS full_generation_prompt
FROM characters c
JOIN adventures a ON c.adventure_id = a.id;

-- ============================================
-- SEED DATA: Main Hall NPCs
-- ============================================
INSERT INTO main_hall_npcs (id, name, role, description, portrait_description, voice_id, voice_role, greeting_text, shop_type) VALUES
('marcos', 'Marcos Cavielli', 'weapons', 'A burly Italian blacksmith with soot-stained hands and a warm smile.', 'Italian blacksmith, muscular build, soot-stained hands and apron, warm smile, dark hair, Eyvind Earle flat graphic style, Celtic ornamental trim on leather apron', '2ajXGJNYBR0iNHpS4VZb', 'marcos', 'Benvenuto! You look like you need a good blade. I got just the thing.', 'weapons'),
('hokas', 'Hokas Tokas', 'magic', 'An eccentric magic dealer with wild eyes and robes that seem to shimmer.', 'Eccentric magic dealer, wild eyes, shimmering robes in purple and gold, long grey beard, mysterious smile, Eyvind Earle flat graphic style, Celtic knotwork on cuffs', '6sFKzaJr574YWVu4UuJF', 'hokas', 'Ahh, seeker of mysteries! The artifacts whispered of your coming.', 'magic'),
('shylock', 'Shylock McFenney', 'bank', 'A meticulous banker with spectacles and a ledger always in hand.', 'Meticulous banker, spectacles on chain, ledger in hand, formal attire in green velvet, calculating expression, Eyvind Earle flat graphic style', 'goT3UYdM9bhm0n2lmKQx', 'shylock', 'Your gold is safe with the McFenney Guarantee. Deposit or withdraw?', 'bank'),
('sam', 'Sam Slicker', 'pawn', 'A shifty pawn broker who always seems to be calculating your worth.', 'Shifty pawn broker, calculating eyes, worn coat with many pockets, forced smile, Eyvind Earle flat graphic style', '7cOBG34AiHrAzs842Rdi', 'sam', 'What have we here? I might take it off your hands... for a fair price, of course.', 'pawn'),
('irishman', 'The Burly Irishman', 'registration', 'The proprietor of the Main Hall, a large man with a booming voice and a heart of gold.', 'Large Irish barkeep, booming presence, red hair and beard, leather apron, welcoming grin, Eyvind Earle flat graphic style with Celtic ornamental details', '1BfrkuYXmEwp8AWqSLWk', 'irishman', 'Welcome to the Hall, traveler! First time? Let''s get you registered.', null);

-- ============================================
-- SEED DATA: Main Hall Locations
-- ============================================
INSERT INTO main_hall_locations (id, name, description, background_description, npc_ids) VALUES
('main-hall-great-hall', 'The Great Hall', 'The central chamber of the Main Hall. A massive hearth burns at one end, tables line the walls, and adventurers gather to share stories.', 'Massive medieval hall with high vaulted ceilings, massive stone hearth with roaring fire, long wooden tables, adventurers at benches, warm torchlight, banners hanging, Eyvind Earle Sleeping Beauty 1959 style, geometric Gothic architecture, jewel-tone palette, dramatic depth', ARRAY['irishman']),
('main-hall-marcos-shop', 'Cavielli''s Forge', 'The weapons shop. Heat radiates from the forge. Weapons of all kinds hang on the walls.', 'Medieval forge interior, glowing furnace, heat shimmer, weapons on walls, anvil and tools, warm orange light, Eyvind Earle style', ARRAY['marcos']),
('main-hall-hokas-shop', 'Tokas''s Curiosities', 'The magic shop. Strange artifacts and glowing potions fill the shelves. The air smells of ozone and herbs.', 'Mystical magic shop, glowing potions on shelves, floating artifacts, purple and blue ambient light, incense smoke, Eyvind Earle style', ARRAY['hokas']),
('main-hall-shylock-desk', 'McFenney''s Vault', 'The bank. Stacks of gold coins, heavy iron vaults, and the reassuring presence of wealth.', 'Medieval bank interior, stacks of gold coins, iron vault door, polished wood counters, green and gold color scheme, Eyvind Earle style', ARRAY['shylock']),
('main-hall-sam-counter', 'Slicker''s Exchange', 'The pawn shop. A cluttered counter and the faint smell of old leather and dust.', 'Cluttered pawn shop, worn counter, shelves of odd items, dim lighting, dusty atmosphere, Eyvind Earle style', ARRAY['sam']);
