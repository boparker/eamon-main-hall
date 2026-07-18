// gen-portraits.mjs — cast portraits via Seedream v3 (the ONLY model that
// lands our painterly Arcane/Fortiche register; flux cannot). Reads
// portrait_description from the adventure manifest. Seedream returns JPEG
// regardless of extension — transcode with `sips -s format png` after.
// Lesson (Cynthia): describe only what you WANT — Seedream ignores negations.
//   node tools/gen-portraits.mjs data/adventures/<id>.json [slugs...]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const KEY = process.env.FAL_KEY;
const [manifestPath, ...only] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const advId = manifest.adventure.id;
mkdirSync(`art-out/portraits/${advId}`, { recursive: true });

// The locked character register (calibrated on the beginners-cave cast).
const REGISTER = 'Painterly matte oil-rendered character portrait in the exact style of the animated series Arcane by studio Fortiche and Spider-Verse: soft cel-shaded planes with visible painterly oil-brush texture, grounded semi-realistic proportions, natural eyes, dramatic single-source lighting, restrained cool palette with one warm accent, dark simple background, bust framing facing the viewer.';

const cast = manifest.characters.filter((c) => c.portrait_description && (!only.length || only.includes(c.slug)));
console.log(`painting ${cast.length} portraits for ${advId}`);
for (const c of cast) {
  const prompt = `${c.portrait_description}. ${REGISTER}`;
  try {
    const r = await fetch('https://fal.run/fal-ai/bytedance/seedream/v3/text-to-image', {
      method: 'POST', headers: { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, image_size: { width: 768, height: 1024 }, num_images: 1 }),
    });
    if (!r.ok) { console.log('ERR', c.slug, r.status, (await r.text()).slice(0, 120)); continue; }
    const d = await r.json();
    const url = d.images?.[0]?.url;
    if (!url) { console.log('ERR', c.slug, 'no image url'); continue; }
    writeFileSync(`art-out/portraits/${advId}/${c.slug}.png`, Buffer.from(await (await fetch(url)).arrayBuffer()));
    console.log('made', c.slug);
  } catch (e) { console.log('FAIL', c.slug, e.message); }
}
