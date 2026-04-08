-- Beginner's Cave Full Data (26 Rooms)
-- Run after schema.sql to populate

INSERT INTO adventures (
    id, name, description, artist_style, inspiration_artist, style_prompt_prefix,
    music_track, difficulty, author, image_preference
) VALUES (
    'beginners-cave',
    'The Beginner\'s Cave',
    'A simple cavern for new adventurers to test their mettle. Many have entered. Some have returned.',
    'Eyvind Earle',
    'Eyvind Earle Sleeping Beauty 1959',
    'Eyvind Earle Sleeping Beauty 1959 style, geometric angular Gothic architecture, jewel-tone palette of deep purples and midnight blues with burnished gold accents, Byzantine and Persian miniature influence, architectural depth with layered planes, painterly backgrounds with light-defined detail, flat graphic characters with subtle shading, Celtic ornamental details',
    'cave-static-teeth.mp3',
    1,
    'Donald Brown',
    'generate'
);

-- All 26 locations
INSERT INTO locations (id, adventure_id, room_number, name, narration_text, background_description, light_level, is_combat_zone) VALUES
('beginners-cave-1', 'beginners-cave', 1, 'Cave Entrance', 
 'You stand at the mouth of a damp cave. The walls glisten with moisture. Flickering torches cast dancing shadows on rough stone. A narrow tunnel leads north into darkness. The entrance is to the south with a sign over it reading, "Beginners Only!" To the north is the road back to town.',
 'Rocky cave entrance, moss-covered stone walls, flickering torchlight casting warm orange glow, damp ground with puddles, angular Gothic rock formations, wooden sign reading "Beginners Only", dark tunnel mouth leading north',
 'dim', false),

('beginners-cave-2', 'beginners-cave', 2, 'Dark Tunnel',
 'To the north you see bright light streaming in from the outside. To the south you see flickering torch light, but you cannot make out any details. The corridor stretches ahead, dark and foreboding.',
 'Dark north-south tunnel, bright light visible at north exit, distant flickering torchlight to south, rough stone walls, damp floor, mysterious shadows',
 'dark', false),

('beginners-cave-3', 'beginners-cave', 3, 'West Side Chamber',
 'It is very cold here and the only light comes in dimly from the large chamber to the east. The walls are rough-hewn and water drips steadily from above. A sense of isolation permeates the air.',
 'Small cold side chamber, dim light from east entrance, rough-hewn walls, water dripping from ceiling, puddles on floor, isolated atmosphere',
 'dark', false),

('beginners-cave-4', 'beginners-cave', 4, 'The Great Chamber',
 'You are in a huge chamber where the roof rises out of sight. Burning torches line the walls making it easy to see. Tunnels lead north and south, and there are small chambers to the east and west. The scale is awe-inspiring.',
 'Massive underground chamber, roof vanishing into darkness, burning torches lining walls, multiple tunnel entrances, awe-inspiring scale, warm torchlight illuminating stone pillars',
 'bright', false),

('beginners-cave-5', 'beginners-cave', 5, 'East Side Chamber',
 'It is very cold here and the only light comes in dimly from the large chamber to the west. The stone walls are slick with moisture, and your breath clouds in the frigid air.',
 'Small cold side chamber, dim light from west entrance, slick moisture-covered walls, frigid atmosphere, breath condensation visible',
 'dark', false),

('beginners-cave-6', 'beginners-cave', 6, 'West Cell',
 'You are in a small stark cell with a door on the east side of the room. Iron bars cast long shadows. The floor is bare stone, and a musty smell fills the air.',
 'Small stark prison cell, iron bars casting shadows, bare stone floor, wooden door to east, musty atmosphere, dim light filtering through bars',
 'dim', false),

('beginners-cave-7', 'beginners-cave', 7, 'North Passage Junction',
 'A tunnel goes north and east and west are doors that are bolted shut. (Locking something in?). In the dim light you can see that the hall goes south but you cannot make out any details.',
 'Passage junction with bolted doors to east and west, tunnel continuing north, dim lighting creating mystery, heavy iron bolts on doors, rough stone walls',
 'dim', false),

('beginners-cave-8', 'beginners-cave', 8, 'East Cell',
 'You are in a small stark cell with a door on the west side of the room. The walls are damp and cold. A rat scurries away as you enter.',
 'Small prison cell, door on west wall, damp cold walls, rat scurrying in corner, straw on floor, oppressive atmosphere',
 'dim', false),

('beginners-cave-9', 'beginners-cave', 9, 'West Cell',
 'You are in a small stark cell with a door on the east side. Empty manacles hang from one wall, telling a grim story of previous occupants.',
 'Prison cell with door to east, empty iron manacles on wall, scratched stone floor, grim atmosphere, single barred window',
 'dim', false),

('beginners-cave-10', 'beginners-cave', 10, 'Middle Passage',
 'Doors are bolted on both sides of you (east and west). The hall extends north and south. You feel a draft from the south, carrying a faint scent of salt.',
 'Passage with bolted doors on both sides, draft from south carrying salt air, rough stone floor, flickering torch in bracket, sense of being watched',
 'dim', false),

('beginners-cave-11', 'beginners-cave', 11, 'East Cell',
 'You are in a small stark cell with a door on the west side. Ancient graffiti covers the walls — warnings and names of those who came before.',
 'Prison cell, west door, walls covered in ancient graffiti and warnings, scratched names, history of prisoners, dim light',
 'dim', false),

('beginners-cave-12', 'beginners-cave', 12, 'West Cell',
 'You are in a small stark cell with a door on the east side. A broken chain lies on the floor, suggesting someone escaped long ago.',
 'Prison cell with east door, broken chain on floor, signs of old escape attempt, rough walls, debris scattered about',
 'dim', false),

('beginners-cave-13', 'beginners-cave', 13, 'South Passage End',
 'To your great shock there are doors to the east and west. The hall goes north from here and a broken tunnel goes south, blocked by rubble.',
 'Passage end with doors east and west, rubble blocking south tunnel, dust in air, cracked ceiling, unstable atmosphere',
 'dim', false),

('beginners-cave-14', 'beginners-cave', 14, 'East Cell',
 'You are in a small stark cell with a door on the west side. A skeleton lies in the corner, still clutching a rusted key.',
 'Prison cell with west door, skeleton in corner clutching rusted key, cobwebs, undisturbed for years, grim discovery',
 'dim', false),

('beginners-cave-15', 'beginners-cave', 15, 'Broken Tunnel',
 'The sides of the tunnel are very broken and rough. You see torch light to the south. The east wall has a smooth shape in the center, about the size of a door. A secret passage?',
 'Broken rough tunnel, debris on floor, torchlight visible to south, smooth door-shaped outline on east wall, secret passage hint',
 'dim', false),

('beginners-cave-16', 'beginners-cave', 16, 'Secret Music Tunnel',
 'You are in a secret east/west passage. You hear a faint melody coming from the east. The walls are smoother here, carved with care rather than rough-hewn.',
 'Secret passage, smooth carved walls, faint music from east, mysterious atmosphere, better craftsmanship than main caves',
 'dim', false),

('beginners-cave-17', 'beginners-cave', 17, 'Approaching the Temple',
 'You can very clearly hear religious music being played and can smell incense from the east. The passage opens up ahead, and golden light spills from around the corner.',
 'Passage opening up, golden light ahead, incense smoke visible, religious music audible, anticipation of discovery',
 'bright', false),

('beginners-cave-18', 'beginners-cave', 18, 'The Temple',
 'You are in a temple that has paintings of great deeds covering the walls. There are two altars here, one covered with gold paint and the other stained with blood. The only exit leads to the west.',
 'Underground temple, paintings of heroic deeds on walls, two altars (one gold, one blood-stained), incense burners, golden light, sacred and ominous atmosphere',
 'bright', false),

('beginners-cave-19', 'beginners-cave', 19, 'The Library',
 'You are in what was obviously once a library. Most of the books have been destroyed, with the scraps left lying on the ground. A door, torn from its hinges, also lies on the floor. The exit is to the east.',
 'Ruined library, destroyed books scattered, torn door on floor, broken shelves, sense of violence and loss, paper debris everywhere',
 'dim', false),

('beginners-cave-20', 'beginners-cave', 20, 'T-Intersection',
 'A brightly burning torch is bolted to the south wall. Dark tunnels lead north and east. To the west is a place where once a door stood, but it has been torn from its hinges.',
 'T-intersection passage, bright torch on south wall, dark tunnels north and east, torn door frame to west, ominous choices',
 'bright', false),

('beginners-cave-21', 'beginners-cave', 21, 'East/West Tunnel',
 'You are in an unremarkable tunnel. You can see torch light in both directions. The floor is worn smooth by countless footsteps over the years.',
 'Unremarkable connecting tunnel, torchlight both directions, worn smooth floor, plain stone walls, functional passage',
 'dim', false),

('beginners-cave-22', 'beginners-cave', 22, 'Top of Stairs',
 'You are at an unremarkable stone landing at the top of a flight of stairs. A single torch is bolted to the wall. A tunnel heads back west. It looks very dark down there...',
 'Stone landing at top of stairs, single torch, dark stairwell descending, tunnel west, apprehensive atmosphere',
 'dim', false),

('beginners-cave-23', 'beginners-cave', 23, 'Bottom of Stairs',
 'You are at an unremarkable stone landing at the bottom of a flight of stairs. A light can be seen at the top and a very dim light can be seen down the tunnel to the east.',
 'Stone landing at bottom of stairs, light above from entrance, dim light to east tunnel, damp air from below',
 'dark', false),

('beginners-cave-24', 'beginners-cave', 24, 'Deep Tunnel',
 'You are in a very rough tunnel carved out of a series of natural caverns. Dim light can be seen in both directions. Stalactites hang from above like stone teeth.',
 'Rough natural cavern tunnel, stalactites hanging like teeth, dim light both directions, uneven floor, ancient cave formation',
 'dark', false),

('beginners-cave-25', 'beginners-cave', 25, 'Salt Air Tunnel',
 'You see light to the east, and feel a cool wind coming from there. In the wind you smell a hint of salt. The end of your journey approaches.',
 'Tunnel with light at east end, cool wind blowing, smell of salt and sea, anticipation of exit, natural cave walls',
 'dim', false),

('beginners-cave-26', 'beginners-cave', 26, 'Pirate\'s Cove',
 'You are at a small bay. Cliffs rise on either side of you so that the only exit is back in the tunnel to the west. A broken old boat is resting on the bank of the rough and stormy sea. All around you is salt water, as far as the eye can see.',
 'Hidden underground bay, cliffs on both sides, broken old boat on shore, rough stormy sea, salt water stretching to horizon, dramatic finale location',
 'bright', true);

-- Characters
INSERT INTO characters (
    id, adventure_id, name, slug, type, is_hostile, description, portrait_description,
    voice_role, voice_id, friendliness, first_encounter_text, hp, damage_dice, armor_class, location_room
) VALUES
('beginners-cave-cynthia', 'beginners-cave', 'Cynthia', 'cynthia', 'npc', false,
 'A fellow adventurer resting by the fire. She wears leather armor and carries a short sword.',
 'Young female adventurer, leather armor, kind face with warm smile, short brown hair, holding sword, Eyvind Earle flat graphic style with Celtic ornamental trim on armor',
 'shopkeep', 'iP95p4xoKVk53GoZ742B', 'friendly',
 'Oh! Another brave soul. I\'m Cynthia. Careful in the east tunnel — I heard growling.', 15, null, 2, 6),

('beginners-cave-goblin', 'beginners-cave', 'Cave Goblin', 'goblin', 'enemy', true,
 'A wiry green goblin with jagged teeth and rusty dagger.',
 'Green goblin, wiry build, jagged yellow teeth, rusty dagger in hand, aggressive snarl, ragged clothing, Eyvind Earle flat graphic style with angular features',
 'narrator', 'nPczCjzI2devNBz1zQrb', 'hostile',
 'The goblin shrieks and lunges at you with its dagger!', 6, '1d4', 3, 3),

('beginners-cave-rat', 'beginners-cave', 'Giant Rat', 'rat', 'enemy', true,
 'A rat the size of a dog with yellowed fangs.',
 'Giant rat, mangy fur, yellow fangs bared, red beady eyes, aggressive pose, Eyvind Earle flat graphic style with subtle shading',
 'narrator', 'nPczCjzI2devNBz1zQrb', 'hostile',
 'A giant rat screeches and lunges at you!', 8, '1d4', 2, 8),

('beginners-cave-mimic', 'beginners-cave', 'Mimic', 'mimic', 'boss', true,
 'A predatory creature disguised as a treasure chest. Rows of teeth and grasping pseudopods.',
 'Mimic monster as treasure chest with teeth and tongue, wooden texture turning into flesh, grasping tentacle-legs, surprise attack pose, Eyvind Earle stylized horror',
 'narrator', 'nPczCjzI2devNBz1zQrb', 'hostile',
 'The chest sprouts legs and teeth! The mimic attacks!', 20, '2d4', 5, 7),

('beginners-cave-pirate', 'beginners-cave', 'Skeleton Pirate', 'pirate', 'enemy', true,
 'An undead pirate, bones held together by dark magic. Wields a rusted cutlass.',
 'Skeleton pirate, bones held by dark magic, rusted cutlass, tattered pirate hat, glowing eye sockets, menacing pose, Eyvind Earle stylized undead',
 'narrator', 'nPczCjzI2devNBz1zQrb', 'hostile',
 'The skeleton pirate rattles its bones and raises its cutlass!', 12, '1d6', 4, 26),

('beginners-cave-hermit', 'beginners-cave', 'Old Hermit', 'hermit', 'npc', false,
 'An elderly hermit who dwells in the deeper caves. He may help or hinder.',
 'Elderly hermit, long white beard, tattered robes, wise but wary eyes, holding wooden staff, Eyvind Earle flat graphic style, Celtic ornamental details on staff',
 'narrator', 'HAvvFKatz0uu0Fv55Riy', 'neutral',
 'The hermit squints at you. "Not many come this deep, traveler. What do you seek?"', 8, null, 0, 4),

('beginners-cave-gorilla', 'beginners-cave', 'Cave Gorilla', 'gorilla', 'enemy', true,
 'A massive albino gorilla that has adapted to the darkness. Incredibly strong.',
 'Massive albino gorilla, adapted to darkness, white fur, muscular build, aggressive stance, Eyvind Earle stylized beast',
 'narrator', 'nPczCjzI2devNBz1zQrb', 'hostile',
 'The gorilla beats its chest and charges!', 25, '2d6', 4, 16),

('beginners-cave-priest', 'beginners-cave', 'Mad Priest', 'priest', 'boss', true,
 'A former cleric driven mad by isolation. Guards the temple with religious fervor.',
 'Mad priest, tattered religious robes, wild eyes, clutching holy symbol, manic expression, Eyvind Earle stylized character',
 'narrator', 'nPczCjzI2devNBz1zQrb', 'hostile',
 'The priest screams: "The altars demand blood! YOUR blood!"', 18, '1d8', 3, 18);

-- Sample items
INSERT INTO items (id, adventure_id, name, slug, type, description, value, weight, heal_amount, uses, location_room) VALUES
('beginners-cave-healing-potion', 'beginners-cave', 'Healing Potion', 'healing-potion', 'potion',
 'A small vial of glowing red liquid. Smells of herbs and honey.', 50, 1, 10, 1, 5),

('beginners-cave-diamonds', 'beginners-cave', 'Bag of Diamonds', 'diamonds', 'treasure',
 'A small leather bag containing uncut diamonds.', 200, 1, null, null, 7),

('beginners-cave-trollsfire', 'beginners-cave', 'Troll\'s Fire', 'trollsfire', 'weapon',
 'A flaming blade that burns with cold fire. Rare and valuable.', 200, 5, null, null, 26);
