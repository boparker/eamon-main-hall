-- Seed Beginner's Cave (Adventure #1) with all 26 canonical rooms
-- Based on Eamon Remastered SQLite data

INSERT INTO adventures (slug, name, description, difficulty, author) VALUES
('beginners-cave', 'The Beginner''s Cave', 'A simple cave for new adventurers to learn the ropes. Features friendly Cynthia as a guide and various monsters to practice combat.', 1, 'Donald Brown');

-- Insert all 26 rooms with descriptions
INSERT INTO locations (adventure_id, room_number, name, description, style_prompt_prefix) VALUES
((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 1, 'Cave Entrance', 
'A cool breeze drifts past you from the cave mouth to the north. The forest path leads south.', 
'dark cave entrance, stone archway, dappled sunlight filtering through trees, moss-covered rocks, mysterious shadows'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 2, 'Dark Passageway', 
'A narrow passageway winds deeper into the mountain. The air grows colder.', 
'narrow stone corridor, flickering torchlight, rough-hewn walls, dripping water, claustrophobic atmosphere'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 3, 'Large Cavern', 
'The passage opens into a large cavern. The ceiling disappears into darkness above.', 
vast underground cavern, towering stalactites, bioluminescent fungi, echoing drips, mysterious vastness'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 4, 'Side Chamber', 
'A small side chamber branches off from the main cavern. It appears empty.', 
small cave chamber, scattered bones, ancient campfire ashes, cracked stone floor, abandoned campsite'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 5, 'Healing Spring', 
'A natural spring bubbles up from the rocks. The water glows with faint magical light.', 
magical underground spring, glowing blue water, crystalline formations, peaceful ethereal light, healing waters'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 6, 'Narrow Crevice', 
'You squeeze through a narrow crevice in the rock. It''s barely wide enough to pass.', 
tight rock crevice, rough stone scraping, dim light ahead, geological striations, passage through stone'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 7, 'Crystal Grotto', 
'Crystals line the walls of this small grotto, reflecting what little light there is.', 
crystal-lined grotto, refracted rainbow light, faceted gemstone walls, magical luminescence, natural wonder'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 8, 'Collapsed Tunnel', 
'A tunnel has collapsed here, blocking further passage. Rubble fills the way forward.', 
collapsed mine tunnel, fallen boulders, dust motes in light, broken support beams, impassable rubble'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 9, 'Underground River', 
'An underground river rushes past, its waters dark and swift.', 
'underground river, rushing dark waters, natural stone bridge, echoing cavern, treacherous crossing'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 10, 'Sandy Beach', 
'A small sandy beach along the riverbank. The sand is strangely warm.', 
underground beach, black volcanic sand, phosphorescent pebbles, lapping water sounds, eerie warmth'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 11, 'Monster Den', 
'A foul smell emanates from this chamber. Scratches mark the walls.', 
monster lair, scattered bones, claw marks on stone, dried blood stains, predator territory'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 12, 'Treasure Vault', 
'An ancient vault door hangs open. Treasures may lie within.', 
ancient treasure vault, ornate metal door, scattered gold coins, velvet-lined shelves, tempting riches'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 13, 'Hidden Alcove', 
'A hidden alcove concealed behind a false wall. It smells of secrets.', 
hidden alcove, false stone wall, ancient scrolls, dust-covered artifacts, secret chamber'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 14, 'Mimic Chamber', 
'This room appears to contain a treasure chest. But something feels wrong.', 
deceptive chamber, ornate treasure chest, too-perfect arrangement, subtle wrongness, mimic lair'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 15, 'Cursed Altar', 
'An altar to forgotten gods stands here, covered in incomprehensible runes.', 
cursed altar, eldritch runes, dried blood stains, flickering shadow-flames, forbidden worship site'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 16, 'Rat Warren', 
'The walls here are chewed and scratched. The smell is overpowering.', 
rat warren, chewed stone walls, scattered droppings, scratching sounds in walls, vermin infestation'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 17, 'Hermit''s Cave', 
'Someone has lived here recently. A bed of straw and cold ashes suggest a former occupant.', 
hermit dwelling, straw bed, cold campfire, primitive furnishings, abandoned shelter'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 18, 'Gorilla Lair', 
'Large ape-like prints mark the dusty floor. The smell is musky and wild.', 
gorilla territory, large primate prints, scattered fruit peels, musky animal scent, jungle-like humidity'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 19, 'Priest''s Sanctum', 
'Religious symbols cover the walls. Someone practiced forbidden rites here.', 
priest sanctum, religious icons, forbidden symbols, incense smoke, corrupted chapel'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 20, 'Flooded Passage', 
'Water covers the floor here, ankle-deep and freezing cold.', 
flooded passage, ankle-deep icy water, dripping ceiling, treacherous footing, cold mist'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 21, 'Bat Colony', 
'The ceiling crawls with bats. They stir at your presence.', 
bat colony, ceiling covered in leathery wings, squeaking echoes, guano-covered floor, overwhelming smell'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 22, 'Ore Vein', 
'A rich vein of ore sparkles in the torchlight. Someone mined here long ago.', 
mining tunnel, exposed ore vein, abandoned pickaxes, glittering minerals, dwarven remnants'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 23, 'Bottomless Pit', 
'A dark pit yawns before you. No bottom is visible.', 
bottomless pit, yawning darkness, crumbling edge, vertigo-inducing depth, ancient chasm'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 24, 'Ancient Shrine', 
'An ancient shrine to unknown powers. Offerings of gold still rest upon it.', 
ancient shrine, piled gold offerings, mysterious deity statue, eternal flames, sacred site'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 25, 'Guardian Chamber', 
'A chamber that feels watched. Something protects the way forward.', 
guardian chamber, magical pressure, warning symbols, defensive enchantments, ominous presence'),

((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 26, 'Pirate''s Cove', 
'A hidden cove where pirates once stored their ill-gotten gains. The water laps at the shore.', 
pirate cove, hidden beach, scattered treasure chests, weathered ship beams, underground lake shore');

-- Insert characters/monsters
INSERT INTO characters (adventure_id, name, description, type, hardiness, agility, charisma) VALUES
((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 'Cynthia', 'A friendly guide who helps new adventurers learn the basics', 'friendly', 15, 14, 18),
((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 'Giant Rat', 'A large aggressive rat with yellowed teeth and patchy fur', 'monster', 8, 12, 2),
((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 'Goblin', 'A small green-skinned creature with jagged teeth and rusty dagger', 'monster', 10, 14, 5),
((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 'Mimic', 'A shape-shifting monster disguised as a treasure chest', 'monster', 20, 8, 3),
((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 'Hermit', 'An old man living in the caves, sometimes friendly', 'npc', 12, 10, 14),
((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 'Gorilla', 'A massive silverback ape protecting its territory', 'monster', 25, 12, 5),
((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 'Mad Priest', 'A crazed cultist performing dark rituals', 'monster', 14, 10, 16),
((SELECT id FROM adventures WHERE slug = 'beginners-cave'), 'Pirate Captain', 'The ghost of a long-dead pirate guarding his treasure', 'monster', 30, 16, 12);

-- Insert room exits (connectivity)
INSERT INTO exits (location_id, direction, destination_room, description) VALUES
-- Room 1 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 1), 'NORTH', 2, 'A dark passageway leads deeper'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 1), 'SOUTH', -999, 'Exit to the Main Hall'),

-- Room 2 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 2), 'SOUTH', 1, 'Back to the entrance'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 2), 'EAST', 3, 'To the large cavern'),

-- Room 3 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 3), 'WEST', 2, 'Back to the passageway'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 3), 'NORTH', 5, 'To the healing spring'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 3), 'EAST', 4, 'To a side chamber'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 3), 'DOWN', 6, 'A narrow crevice descends'),

-- Room 4 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 4), 'WEST', 3, 'Back to main cavern'),

-- Room 5 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 5), 'SOUTH', 3, 'Back to main cavern'),

-- Room 6 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 6), 'UP', 3, 'Climb back up'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 6), 'EAST', 7, 'To crystal grotto'),

-- Room 7 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 7), 'WEST', 6, 'Back through crevice'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 7), 'NORTH', 9, 'To underground river'),

-- Room 9 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 9), 'SOUTH', 7, 'Back to grotto'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 9), 'EAST', 10, 'Cross to sandy beach'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 9), 'NORTH', 11, 'To monster den'),

-- Room 10 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 10), 'WEST', 9, 'Back to river'),

-- Room 11 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 11), 'SOUTH', 9, 'Back to river'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 11), 'NORTH', 12, 'To treasure vault'),

-- Room 12 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 12), 'SOUTH', 11, 'Back to monster den'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 12), 'SECRET', 13, 'Hidden passage to alcove'),

-- Room 13 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 13), 'SECRET', 12, 'Back to vault'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 13), 'EAST', 14, 'To mimic chamber'),

-- Room 14 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 14), 'WEST', 13, 'Back to alcove'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 14), 'NORTH', 15, 'To cursed altar'),

-- Room 15 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 15), 'SOUTH', 14, 'Back to mimic chamber'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 15), 'EAST', 16, 'To rat warren'),

-- Room 16 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 16), 'WEST', 15, 'Back to altar'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 16), 'NORTH', 17, 'To hermit''s cave'),

-- Room 17 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 17), 'SOUTH', 16, 'Back to rat warren'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 17), 'EAST', 18, 'To gorilla lair'),

-- Room 18 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 18), 'WEST', 17, 'Back to hermit'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 18), 'NORTH', 19, 'To priest''s sanctum'),

-- Room 19 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 19), 'SOUTH', 18, 'Back to gorilla lair'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 19), 'DOWN', 20, 'To flooded passage'),

-- Room 20 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 20), 'UP', 19, 'Back to sanctum'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 20), 'EAST', 21, 'To bat colony'),

-- Room 21 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 21), 'WEST', 20, 'Back to flooded passage'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 21), 'NORTH', 22, 'To ore vein'),

-- Room 22 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 22), 'SOUTH', 21, 'Back to bat colony'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 22), 'EAST', 23, 'To bottomless pit'),

-- Room 23 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 23), 'WEST', 22, 'Back to ore vein'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 23), 'NORTH', 24, 'To ancient shrine'),

-- Room 24 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 24), 'SOUTH', 23, 'Back to pit'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 24), 'EAST', 25, 'To guardian chamber'),

-- Room 25 exits
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 25), 'WEST', 24, 'Back to shrine'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 25), 'EAST', 26, 'To pirate''s cove'),

-- Room 26 exits (final room)
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 26), 'WEST', 25, 'Back to guardian chamber'),
((SELECT id FROM locations WHERE adventure_id = (SELECT id FROM adventures WHERE slug = 'beginners-cave') AND room_number = 26), 'OUT', -1, 'Exit the cave');
