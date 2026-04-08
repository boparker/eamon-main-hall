import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function seed() {
  try {
    console.log('[SEED] Connecting...');
    await pool.query('SELECT NOW()');
    console.log('[SEED] Connected');
    
    // Read seed file
    const seedSQL = readFileSync(join(__dirname, 'database', 'seed-beginners-cave-full.sql'), 'utf8');
    
    console.log('[SEED] Running seed script...');
    await pool.query(seedSQL);
    
    console.log('[SEED] ✅ Database seeded successfully');
    
    // Verify
    const advCount = await pool.query('SELECT COUNT(*) FROM adventures');
    const locCount = await pool.query('SELECT COUNT(*) FROM locations');
    const charCount = await pool.query('SELECT COUNT(*) FROM characters');
    
    console.log(`[SEED] Adventures: ${advCount.rows[0].count}`);
    console.log(`[SEED] Locations: ${locCount.rows[0].count}`);
    console.log(`[SEED] Characters: ${charCount.rows[0].count}`);
    
  } catch (err) {
    console.error('[SEED] Error:', err.message);
    if (err.message.includes('duplicate key')) {
      console.log('[SEED] Already seeded (duplicate key) — this is fine');
    } else {
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

seed();
