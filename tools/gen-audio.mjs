// gen-audio.mjs — First-pass game audio via fal stable-audio.
// Ambience beds (loop ~40s) + short event SFX. WAV out → converted to m4a by caller.
import { writeFileSync, mkdirSync } from 'node:fs';
const KEY = process.env.FAL_KEY;
mkdirSync('art-out/audio', { recursive: true });

const JOBS = [
  // ── Ambience beds (the floor; music is punctuation) ──
  ['amb-tunnel', 40, 'dark underground cave ambience, distant water drips echoing on stone, very low rock rumble, faint cold air movement through a tunnel, sparse, no music, no melody, seamless ambient loop'],
  ['amb-cell', 40, 'oppressive near-silence inside a small stone prison cell, one slow water drip echoing every few seconds, extremely sparse, claustrophobic room tone, no music, seamless ambient loop'],
  ['amb-temple', 40, 'distant solemn male choir chanting a slow gregorian hymn deep in a cave, echoing, reverent and eerie, soft cave reverb, no percussion, seamless ambient loop'],
  ['amb-cove', 40, 'sea waves lapping and crashing softly inside an enclosed sea cave, water echo on rock walls, low wind moan, briny underground cove, no music, seamless ambient loop'],
  ['amb-entrance', 40, 'cave mouth ambience, soft outside wind heard from just inside a cave entrance, faint distant birdsong bleeding in, stone quiet, no music, seamless ambient loop'],
  // ── Event SFX one-shots ──
  ['sfx-hit', 3, 'single sword blade striking metal and flesh in combat, sharp metallic clash impact, one hit, short'],
  ['sfx-miss', 2, 'single fast sword swing whoosh through air, no impact, one swing, short'],
  ['sfx-telegraph', 3, 'single deep ominous war drum boom with cave echo, threatening, one hit'],
  ['sfx-yield', 3, 'soft low chime with a gentle warm resolve, weapons lowering, tension releasing, short'],
  ['sfx-spare', 4, 'gentle warm harp arpeggio resolution, merciful, hopeful, short'],
  ['sfx-coin', 2, 'a handful of gold coins clinking into a leather pouch, short'],
  ['sfx-chest', 3, 'old wooden chest lid creaking open on iron hinges, short'],
  ['sfx-ignite', 3, 'magical fire whoosh igniting along a sword blade, arcane flame burst, short'],
  ['sfx-death', 4, 'dark low orchestral sting, tragic minor chord, doom, short'],
  ['sfx-fanfare', 5, 'short triumphant medieval fanfare, small brass flourish, homecoming victory, brief'],
];

for (const [name, secs, prompt] of JOBS) {
  try {
    const r = await fetch('https://fal.run/fal-ai/stable-audio', {
      method: 'POST', headers: { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, seconds_total: secs }),
    });
    if (!r.ok) { console.log('ERR', name, r.status); continue; }
    const d = await r.json();
    writeFileSync(`art-out/audio/${name}.wav`, Buffer.from(await (await fetch(d.audio_file.url)).arrayBuffer()));
    console.log('made', name);
  } catch (e) { console.log('FAIL', name, e.message); }
}
