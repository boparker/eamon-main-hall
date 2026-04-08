// ── Seed Database (protected) ────────────────────────────────────────────────
app.post('/api/admin/seed', async (req, res) => {
  if (req.headers.authorization !== 'Bearer eamon-seed-2024') {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!pool) return res.status(503).json({ error: 'Database not available' });
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Check if already seeded
    const check = await client.query('SELECT id FROM adventures WHERE slug = $1', ['beginners-cave']);
    if (check.rows.length > 0) {
      await client.query('COMMIT');
      return res.json({ success: true, message: 'Already seeded', adventure_id: check.rows[0].id });
    }
    
    // Insert adventure
    const advResult = await client.query(
      'INSERT INTO adventures (slug, name, description, difficulty, author) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      ['beginners-cave', 'The Beginner''s Cave', 'A simple cave for new adventurers to learn the ropes.', 1, 'Donald Brown']
    );
    const advId = advResult.rows[0].id;
    
    // Insert all 26 rooms
    const rooms = [
      [1, 'Cave Entrance', 'A cool breeze drifts past you from the cave mouth to the north. The forest path leads south.', 'dark cave entrance, stone archway, dappled sunlight filtering through trees, moss-covered rocks, mysterious shadows'],
      [2, 'Dark Passageway', 'A narrow passageway winds deeper into the mountain. The air grows colder.', 'narrow stone corridor, flickering torchlight, rough-hewn walls, dripping water, claustrophobic atmosphere'],
      [3, 'Large Cavern', 'The passage opens into a large cavern. The ceiling disappears into darkness above.', 'vast underground cavern, towering stalactites, bioluminescent fungi, echoing drips, mysterious vastness'],
      [4, 'Side Chamber', 'A small side chamber branches off from the main cavern. It appears empty.', 'small cave chamber, scattered bones, ancient campfire ashes, cracked stone floor, abandoned campsite'],
      [5, 'Healing Spring', 'A natural spring bubbles up from the rocks. The water glows with faint magical light.', 'magical underground spring, glowing blue water, crystalline formations, peaceful ethereal light, healing waters'],
      [6, 'Narrow Crevice', 'You squeeze through a narrow crevice in the rock. It''s barely wide enough to pass.', 'tight rock crevice, rough stone scraping, dim light ahead, geological striations, passage through stone'],
      [7, 'Crystal Grotto', 'Crystals line the walls of this small grotto, reflecting what little light there is.', 'crystal-lined grotto, refracted rainbow light, faceted gemstone walls, magical luminescence, natural wonder'],
      [8, 'Collapsed Tunnel', 'A tunnel has collapsed here, blocking further passage. Rubble fills the way forward.', 'collapsed mine tunnel, fallen boulders, dust motes in light, broken support beams, impassable rubble'],
      [9, 'Underground River', 'An underground river rushes past, its waters dark and swift.', 'underground river, rushing dark waters, natural stone bridge, echoing cavern, treacherous crossing'],
      [10, 'Sandy Beach', 'A small sandy beach along the riverbank. The sand is strangely warm.', 'underground beach, black volcanic sand, phosphorescent pebbles, lapping water sounds, eerie warmth'],
      [11, 'Monster Den', 'A foul smell emanates from this chamber. Scratches mark the walls.', 'monster lair, scattered bones, claw marks on stone, dried blood stains, predator territory'],
      [12, 'Treasure Vault', 'An ancient vault door hangs open. Treasures may lie within.', 'ancient treasure vault, ornate metal door, scattered gold coins, velvet-lined shelves, tempting riches'],
      [13, 'Hidden Alcove', 'A hidden alcove concealed behind a false wall. It smells of secrets.', 'hidden alcove, false stone wall, ancient scrolls, dust-covered artifacts, secret chamber'],
      [14, 'Mimic Chamber', 'This room appears to contain a treasure chest. But something feels wrong.', 'deceptive chamber, ornate treasure chest, too-perfect arrangement, subtle wrongness, mimic lair'],
      [15, 'Cursed Altar', 'An altar to forgotten gods stands here, covered in incomprehensible runes.', 'cursed altar, eldritch runes, dried blood stains, flickering shadow-flames, forbidden worship site'],
      [16, 'Rat Warren', 'The walls here are chewed and scratched. The smell is overpowering.', 'rat warren, chewed stone walls, scattered droppings, scratching sounds in walls, vermin infestation'],
      [17, 'Hermit''s Cave', 'Someone has lived here recently. A bed of straw and cold ashes suggest a former occupant.', 'hermit dwelling, straw bed, cold campfire, primitive furnishings, abandoned shelter'],
      [18, 'Gorilla Lair', 'Large ape-like prints mark the dusty floor. The smell is musky and wild.', 'gorilla territory, large primate prints, scattered fruit peels, musky animal scent, jungle-like humidity'],
      [19, 'Priest''s Sanctum', 'Religious symbols cover the walls. Someone practiced forbidden rites here.', 'priest sanctum, religious icons, forbidden symbols, incense smoke, corrupted chapel'],
      [20, 'Flooded Passage', 'Water covers the floor here, ankle-deep and freezing cold.', 'flooded passage, ankle-deep icy water, dripping ceiling, treacherous footing, cold mist'],
      [21, 'Bat Colony', 'The ceiling crawls with bats. They stir at your presence.', 'bat colony, ceiling covered in leathery wings, squeaking echoes, guano-covered floor, overwhelming smell'],
      [22, 'Ore Vein', 'A rich vein of ore sparkles in the torchlight. Someone mined here long ago.', 'mining tunnel, exposed ore vein, abandoned pickaxes, glittering minerals, dwarven remnants'],
      [23, 'Bottomless Pit', 'A dark pit yawns before you. No bottom is visible.', 'bottomless pit, yawning darkness, crumbling edge, vertigo-inducing depth, ancient chasm'],
      [24, 'Ancient Shrine', 'An ancient shrine to unknown powers. Offerings of gold still rest upon it.', 'ancient shrine, piled gold offerings, mysterious deity statue, eternal flames, sacred site'],
      [25, 'Guardian Chamber', 'A chamber that feels watched. Something protects the way forward.', 'guardian chamber, magical pressure, warning symbols, defensive enchantments, ominous presence'],
      [26, 'Pirate''s Cove', 'A hidden cove where pirates once stored their ill-gotten gains. The water laps at the shore.', 'pirate cove, hidden beach, scattered treasure chests, weathered ship beams, underground lake shore']
    ];
    
    const roomIds = {};
    for (const [num, name, desc, style] of rooms) {
      const result = await client.query(
        'INSERT INTO locations (adventure_id, room_number, name, description, style_prompt_prefix) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [advId, num, name, desc, style]
      );
      roomIds[num] = result.rows[0].id;
    }
    
    // Insert characters
    const characters = [
      ['Cynthia', 'A friendly guide who helps new adventurers learn the basics', 'friendly', 15, 14, 18],
      ['Giant Rat', 'A large aggressive rat with yellowed teeth and patchy fur', 'monster', 8, 12, 2],
      ['Goblin', 'A small green-skinned creature with jagged teeth and rusty dagger', 'monster', 10, 14, 5],
      ['Mimic', 'A shape-shifting monster disguised as a treasure chest', 'monster', 20, 8, 3],
      ['Hermit', 'An old man living in the caves, sometimes friendly', 'npc', 12, 10, 14],
      ['Gorilla', 'A massive silverback ape protecting its territory', 'monster', 25, 12, 5],
      ['Mad Priest', 'A crazed cultist performing dark rituals', 'monster', 14, 10, 16],
      ['Pirate Captain', 'The ghost of a long-dead pirate guarding his treasure', 'monster', 30, 16, 12]
    ];
    
    for (const [name, desc, type, hd, ag, ch] of characters) {
      await client.query(
        'INSERT INTO characters (adventure_id, name, description, type, hardiness, agility, charisma) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [advId, name, desc, type, hd, ag, ch]
      );
    }
    
    // Insert exits
    const exits = [
      [1, 'NORTH', 2, 'A dark passageway leads deeper'],
      [1, 'SOUTH', -999, 'Exit to the Main Hall'],
      [2, 'SOUTH', 1, 'Back to the entrance'],
      [2, 'EAST', 3, 'To the large cavern'],
      [3, 'WEST', 2, 'Back to the passageway'],
      [3, 'NORTH', 5, 'To the healing spring'],
      [3, 'EAST', 4, 'To a side chamber'],
      [3, 'DOWN', 6, 'A narrow crevice descends'],
      [4, 'WEST', 3, 'Back to main cavern'],
      [5, 'SOUTH', 3, 'Back to main cavern'],
      [6, 'UP', 3, 'Climb back up'],
      [6, 'EAST', 7, 'To crystal grotto'],
      [7, 'WEST', 6, 'Back through crevice'],
      [7, 'NORTH', 9, 'To underground river'],
      [9, 'SOUTH', 7, 'Back to grotto'],
      [9, 'EAST', 10, 'Cross to sandy beach'],
      [9, 'NORTH', 11, 'To monster den'],
      [10, 'WEST', 9, 'Back to river'],
      [11, 'SOUTH', 9, 'Back to river'],
      [11, 'NORTH', 12, 'To treasure vault'],
      [12, 'SOUTH', 11, 'Back to monster den'],
      [12, 'SECRET', 13, 'Hidden passage to alcove'],
      [13, 'SECRET', 12, 'Back to vault'],
      [13, 'EAST', 14, 'To mimic chamber'],
      [14, 'WEST', 13, 'Back to alcove'],
      [14, 'NORTH', 15, 'To cursed altar'],
      [15, 'SOUTH', 14, 'Back to mimic chamber'],
      [15, 'EAST', 16, 'To rat warren'],
      [16, 'WEST', 15, 'Back to altar'],
      [16, 'NORTH', 17, 'To hermit''s cave'],
      [17, 'SOUTH', 16, 'Back to rat warren'],
      [17, 'EAST', 18, 'To gorilla lair'],
      [18, 'WEST', 17, 'Back to hermit'],
      [18, 'NORTH', 19, 'To priest''s sanctum'],
      [19, 'SOUTH', 18, 'Back to gorilla lair'],
      [19, 'DOWN', 20, 'To flooded passage'],
      [20, 'UP', 19, 'Back to sanctum'],
      [20, 'EAST', 21, 'To bat colony'],
      [21, 'WEST', 20, 'Back to flooded passage'],
      [21, 'NORTH', 22, 'To ore vein'],
      [22, 'SOUTH', 21, 'Back to bat colony'],
      [22, 'EAST', 23, 'To bottomless pit'],
      [23, 'WEST', 22, 'Back to ore vein'],
      [23, 'NORTH', 24, 'To ancient shrine'],
      [24, 'SOUTH', 23, 'Back to pit'],
      [24, 'EAST', 25, 'To guardian chamber'],
      [25, 'WEST', 24, 'Back to shrine'],
      [25, 'EAST', 26, 'To pirate''s cove'],
      [26, 'WEST', 25, 'Back to guardian chamber'],
      [26, 'OUT', -1, 'Exit the cave']
    ];
    
    for (const [roomNum, dir, dest, desc] of exits) {
      if (roomIds[roomNum]) {
        await client.query(
          'INSERT INTO exits (location_id, direction, destination_room, description) VALUES ($1, $2, $3, $4)',
          [roomIds[roomNum], dir, dest, desc]
        );
      }
    }
    
    await client.query('COMMIT');
    
    res.json({ 
      success: true, 
      message: 'Database seeded successfully',
      adventure_id: advId,
      rooms: Object.keys(roomIds).length,
      characters: characters.length,
      exits: exits.length
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[SEED] Error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
