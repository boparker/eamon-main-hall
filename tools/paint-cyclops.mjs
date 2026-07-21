// paint-cyclops.mjs — the PREMIUM art pipeline for The Cyclops's Cave
// (odyssey-cyclops). Same brief→paint→verify loop as pipeline.mjs, but with
// hand-authored per-room setting contracts (this island is Homeric coastline
// and a GIANT's cave — the generic cave/river biomes don't fit) and an
// all-signature register: every room is a hero frame here.
//
// Modes (from repo root, with .env.local + .fal.env sourced):
//   node art-out/paint-cyclops.mjs rooms [n…]        brief→paint→verify stills
//   node art-out/paint-cyclops.mjs cover             the gate cover
//   node art-out/paint-cyclops.mjs animate [n…]      seedance i2v + ping-pong loop per room still
//   node art-out/paint-cyclops.mjs animate-portraits [slug…]   living portraits
//   node art-out/paint-cyclops.mjs install           copy passing assets into public/scenes/
//
// Portraits stills come from the existing register-locked script:
//   node tools/gen-portraits.mjs data/adventures/odyssey-cyclops.json

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ANTHROPIC_KEY = process.env.PIPELINE_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
const FAL_KEY = process.env.FAL_KEY;
const MODEL = process.env.PIPELINE_MODEL || 'claude-haiku-4-5-20251001';
const VISION_MODEL = process.env.PIPELINE_VISION_MODEL || 'claude-sonnet-5';
const MAX_ATTEMPTS = 3;
const ADV = 'odyssey-cyclops';
const MANIFEST = JSON.parse(readFileSync('data/adventures/odyssey-cyclops.json', 'utf8'));
const OUT = `art-out/pipeline/${ADV}`;
mkdirSync(OUT, { recursive: true });

// ── Anthropic helpers (same shape as pipeline.mjs) ──────────────────────────
async function claude(messages, { system = null, maxTokens = 700, model = MODEL } = {}) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, ...(system ? { system } : {}), messages }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return d.content?.find((b) => b.type === 'text')?.text ?? '';
}
function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`no JSON in: ${text.slice(0, 120)}`);
  return JSON.parse(m[0]);
}
function imageBlock(path) {
  const small = `/tmp/cyclops-qa-${Date.now()}.png`;
  execSync(`sips -Z 1024 -s format png "${path}" --out "${small}" >/dev/null 2>&1`);
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: readFileSync(small).toString('base64') } };
}

// ── The premium register ────────────────────────────────────────────────────
const PAINTERLY = 'painterly matte finish of the animated series Arcane by studio Fortiche, a moving-oil-painting look with visible directional brushstrokes and matte hand-painted texture, with the stylized graphic landscape design of Eyvind Earle: crisp layered silhouettes, terraced rock forms, sharply designed stylized foliage';
const NEG = 'NOT busy, NOT cluttered, NOT evenly lit, no allover detail, NOT photorealistic, NOT a photograph, NOT glossy, NOT a 3d render, NOT CGI, no text, no words, no letters, no watermark, no signature, no border, no UI.';
const NO_FIGURES = 'An empty scene — no people, no figures, no person, no silhouette of a person, no giants, no creatures except livestock where stated.';
const PALETTE = 'Homeric dusk palette: wine-dark sea blues and deep teal shadow, bronze and honey-gold light, long shadows, atmospheric depth.';
const REGISTER = (setting) => `Cinematic signature keyframe, ${PAINTERLY}: one dominant focal element, a SINGLE dramatic motivated light source, deep chiaroscuro, restricted palette, generous negative space, monumental scale. ${PALETTE} ${NO_FIGURES} ${setting} ${NEG}`;

// Hand-authored setting contracts — the load-bearing difference from the
// generic pipeline. Rooms 1–4 are open Aegean coastline (sky is CORRECT
// here); 5–6 are the threshold; 7–9 are the giant's cave, whose scale must
// read colossal, never cramped.
const SETTINGS = {
  1: 'An open-air Aegean cove at dusk: a black-hulled bronze-age Greek galley at anchor on still water, bare mast, high cliff headlands framing the cove, open sea beyond. Sky and horizon are correct here.',
  2: 'An open-air grey shingle beach at dusk under cliffs: driftwood wreckage of old boats, goat tracks, hazy sea light. Sky and horizon are correct here.',
  3: 'An open-air sacred grove: tall poplars around a clear spring, late golden light through leaves, a small tended votive altar of stacked stone with offerings in a niche. Sky glimpsed through foliage is correct here.',
  4: 'An open-air vertiginous cliff path: hoof-polished stone climbing hard against a cliff face, the sea and a tiny anchored ship far below, and above, a cave mouth tall as a temple gate. Sky and dizzying height are correct here.',
  5: 'The threshold of a giant\'s cave at dusk: a walled sheep-fold of rough stone and olive-wood beams just inside the vast cave mouth, huge woolly rams, warm animal darkness breathing from the cave depths to one side, fading daylight on the other. The scale of beams and walls is built for a twelve-foot keeper.',
  6: 'Just inside a giant\'s cave: a passage tall enough for a ship\'s mast, and a colossal door-slab of living rock resting in a worn groove, beside a rock shelf at giant\'s hand-height bearing a neat row of large polished counting pebbles. Monumental, not cramped; the light is dim warm fire-glow from deeper in, with a cold sliver of dusk from the throat of the cave.',
  7: 'The great chamber of a giant\'s cave, monumental in scale: a fire pit big enough to roast an ox whole burning as the single light source, towering racks of hundreds of round cheeses, huge pails, woodsmoke haze under a ceiling lost in darkness. A tidy colossal household — fully enclosed, no sky.',
  8: 'A giant\'s pantry alcove inside the cave: whey-tubs, cheese presses and woven baskets all at colossal scale, lit by warm firelight spilling from off-frame, deep shadow beyond. Fully enclosed, no sky.',
  9: 'The cold far end of a giant\'s cave, nearly black: a low stooping ceiling, thick darkness, one faint distant ember-glow from the firelight far off-frame, the merest cold rimlight on rock edges. Almost nothing visible — the darkest frame in the set. Fully enclosed, no sky.',
};

// ── BRIEF ───────────────────────────────────────────────────────────────────
const BRIEF_SYSTEM = `You turn a text-adventure room description into a VISUAL SCENE BRIEF for an image model painting the room's background art. Reply with ONLY JSON:
{
  "subject": "<2-4 sentences describing exactly what the camera sees, composed for a single dramatic frame>",
  "camera": "<the point of view, stated unambiguously>",
  "must_show": ["<3-6 concrete visual elements a viewer must be able to point at>"],
  "must_not": ["<traps to avoid for THIS room>"],
  "light": "<the single dominant light source and mood, from the text>"
}
RULES:
- Use ONLY what the description states or clearly implies. Do not invent landmarks.
- The description is PLAYER NAVIGATION TEXT: ignore exit directions and meta-instructions.
- POV matters most: state it twice — once in camera, once in subject.
- The scene is UNPEOPLED (characters are overlaid separately) — no people, no giants. Livestock (rams, sheep) may appear where the text describes them.
- THIS ADVENTURE IS A HOMERIC ISLAND: coastal rooms are genuinely outdoors (sky, sea and horizon are correct); the cave rooms belong to a TWELVE-FOOT giant — their scale is monumental and homely at once, never a cramped crawlspace.`;

async function makeBrief(room) {
  const text = await claude([{ role: 'user', content: `Room name: ${room.name}\nRoom description: ${room.narration_text}` }], { system: BRIEF_SYSTEM });
  return parseJson(text);
}

// ── VERIFY ──────────────────────────────────────────────────────────────────
const VERIFY_SYSTEM = `You are a strict but fair art QA inspector for a premium game episode set on Homer's Cyclops island. You get a room's TEXT DESCRIPTION and its background IMAGE. Judge ONLY visually checkable claims. Reply with ONLY JSON:
{
  "observed": "<2-3 sentences: what the image actually shows — POV, space, scale, light — before any judgment>",
  "pov_ok": <bool>,
  "scale_ok": <bool — coastal rooms read as real coastline; GIANT's-cave rooms read monumental (built for a 12-foot keeper), never a cramped human-scale cave>,
  "elements": [{"element": "<key visual element from the text>", "present": <bool>}],
  "violations": ["<hard-rule breaches ONLY: a person/figure/giant visible; rendered text, lettering, logo or watermark; sky/horizon in rooms described as fully enclosed cave interior>"],
  "style_ok": <bool — restrained painterly matte concept art with stylized graphic landscape design; false if photoreal, 3D-render flat, cluttered-busy, or gilded-ornate>,
  "verdict": "pass" | "fail",
  "reasons": ["<short, concrete, actionable>"]
}
CONTRACT (do NOT fail for these):
- Coastal/grove/cliff rooms are OUTDOORS: sky, sea, horizon are correct there.
- Rams/sheep may appear where the text places them; rooms are otherwise unpeopled by design.
- Inscriptions may appear as blank carved stone — never fail for missing lettering; RENDERED readable text is a violation.
- Dramatic fire-glow and dusk gradients are style, not violations.
RULES:
- Describe "observed" FIRST from the image alone; then judge.
- Only fail for what a player reading the room text would notice: wrong POV, wrong scale, a named CENTERPIECE missing (the ship, the votive altar, the door stone, the counting pebbles, the fire pit), a hard violation, or a direct contradiction.
- When an element is small or ambiguous, mark present:true. False alarms are costly.
- verdict "fail" only if pov_ok=false, scale_ok=false, style_ok=false, a violation exists, or a named centerpiece is missing.`;

async function verify(room, imagePath) {
  const text = await claude([{
    role: 'user',
    content: [
      { type: 'text', text: `Room name: ${room.name}\nRoom description: ${room.narration_text}\n\nDoes the image match?` },
      imageBlock(imagePath),
    ],
  }], { system: VERIFY_SYSTEM, maxTokens: 1200, model: VISION_MODEL });
  return parseJson(text);
}

// ── PAINT ───────────────────────────────────────────────────────────────────
async function paint(prompt, outPath) {
  const r = await fetch('https://fal.run/fal-ai/flux-pro/v1.1', {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image_size: 'landscape_16_9', num_images: 1, output_format: 'png', safety_tolerance: '5' }),
  });
  if (!r.ok) throw new Error(`fal ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const d = await r.json();
  writeFileSync(outPath, Buffer.from(await (await fetch(d.images[0].url)).arrayBuffer()));
}

function promptFrom(brief, room) {
  const register = REGISTER(SETTINGS[room.room_number]);
  const musts = brief.must_show ?? [];
  return `${brief.subject} PROMINENTLY FEATURING, clearly visible: ${musts.join('; ')}. ${register} CAMERA: ${brief.camera}. LIGHT: ${brief.light}. AVOID: ${(brief.must_not ?? []).join('; ')}.`;
}

// ── ANIMATE: seedance i2v + ping-pong seamless loop ─────────────────────────
// Motion briefs are hand-authored per asset: subtle ambient cinemagraph
// motion only, locked camera — the ping-pong encode makes any drift loop
// seamlessly (A then A-reversed returns exactly to frame one).
const ROOM_MOTION = {
  1: 'Gentle water movement in the cove, the anchored ship rocking almost imperceptibly, faint shimmer of dusk light on the sea. Static locked camera, subtle ambient motion only, cinemagraph.',
  2: 'Slow waves washing the shingle, sea haze drifting, dusk light shimmering on wet stones. Static locked camera, subtle ambient motion only, cinemagraph.',
  3: 'Poplar leaves trembling in a light breeze, the spring water rippling softly, dappled light shifting. Static locked camera, subtle ambient motion only, cinemagraph.',
  4: 'Wind-driven dust drifting off the cliff path, distant sea glinting far below, faint heat-shimmer. Static locked camera, subtle ambient motion only, cinemagraph.',
  5: 'Rams stirring slightly in the fold, wool ruffled by breeze, warm dark breathing from the cave depths. Static locked camera, subtle ambient motion only, cinemagraph.',
  6: 'Faint warm fire-glow pulsing from deeper in the cave, dust motes drifting in the cold sliver of dusk light. Static locked camera, subtle ambient motion only, cinemagraph.',
  7: 'The great fire pit flickering and breathing, woodsmoke drifting up through haze, firelight dancing on cheese racks. Static locked camera, subtle ambient motion only, cinemagraph.',
  8: 'Warm firelight from off-frame flickering gently across tubs and baskets, faint steam rising from whey-tubs. Static locked camera, subtle ambient motion only, cinemagraph.',
  9: 'Almost imperceptible: the distant ember-glow pulsing faintly, darkness breathing. Static locked camera, extremely subtle ambient motion only, cinemagraph.',
};
const PORTRAIT_MOTION = {
  polyphemus: 'Slow heavy breathing, the single eye blinking once, firelight flickering across the face. Static locked camera, subtle ambient portrait motion, cinemagraph.',
  elpenor: 'Nervous shallow breathing, eyes glancing aside once, firelight flicker. Static locked camera, subtle ambient portrait motion, cinemagraph.',
  perimedes: 'Slow steady breathing, an unhurried blink, firelight moving softly on bronze. Static locked camera, subtle ambient portrait motion, cinemagraph.',
  eurylochus: 'Controlled breathing, a slow skeptical blink, firelight glinting on the baldric studs. Static locked camera, subtle ambient portrait motion, cinemagraph.',
};

async function seedance(imagePath, motionPrompt, outPath) {
  const dataUri = `data:image/png;base64,${readFileSync(imagePath).toString('base64')}`;
  const r = await fetch('https://fal.run/fal-ai/bytedance/seedance/v1/lite/image-to-video', {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: motionPrompt, image_url: dataUri, resolution: '720p', duration: '5' }),
  });
  if (!r.ok) throw new Error(`seedance ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const d = await r.json();
  const url = d.video?.url;
  if (!url) throw new Error(`seedance: no video url in ${JSON.stringify(d).slice(0, 120)}`);
  const raw = outPath.replace(/\.mp4$/, '-raw.mp4');
  writeFileSync(raw, Buffer.from(await (await fetch(url)).arrayBuffer()));
  // Ping-pong: forward then reversed — returns exactly to frame one, so the
  // loop is seamless by construction. Silent, faststart for instant playback.
  execSync(`ffmpeg -y -i "${raw}" -filter_complex "[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1,format=yuv420p[v]" -map "[v]" -an -c:v libx264 -crf 23 -movflags +faststart "${outPath}" 2>/dev/null`);
}

// ── Runner ──────────────────────────────────────────────────────────────────
const [, , mode, ...args] = process.argv;
const wanted = args.map(Number).filter(Boolean);
const rooms = MANIFEST.locations
  .filter((l) => wanted.length === 0 || wanted.includes(l.room_number))
  .sort((a, b) => a.room_number - b.room_number);

if (mode === 'rooms') {
  const results = [];
  for (const room of rooms) {
    const out = `${OUT}/room-${room.room_number}.png`;
    try {
      const brief = await makeBrief(room);
      let prompt = promptFrom(brief, room);
      let verdict = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        await paint(prompt, out);
        verdict = await verify(room, out);
        if (verdict.verdict === 'pass') { console.log(`✓ room ${room.room_number} ${room.name} (attempt ${attempt})`); break; }
        console.log(`… room ${room.room_number} attempt ${attempt} failed: ${(verdict.reasons ?? []).join(' | ')}`);
        prompt = `${promptFrom(brief, room)} CRITICAL FIXES from a failed previous attempt: ${(verdict.reasons ?? []).join('; ')}.`;
      }
      results.push({ room: room.room_number, verdict: verdict?.verdict ?? 'error', reasons: verdict?.reasons ?? [] });
      if (verdict?.verdict !== 'pass') console.log(`✗ room ${room.room_number} FLAGGED for human review`);
    } catch (e) { results.push({ room: room.room_number, verdict: 'error', reasons: [e.message] }); console.log('! room', room.room_number, e.message); }
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));
  console.log('report →', `${OUT}/report.json`);
}

if (mode === 'cover') {
  const prompt = `A cave mouth tall as a temple gate high on a sea-cliff at dusk, one warm eye of firelight glowing deep within its darkness, a tiny black-hulled Greek galley at anchor in the wine-dark cove far below, stylized terraced cliffs. ${REGISTER('Open-air Homeric island coast at dusk; sky and sea are correct.')}`;
  await paint(prompt, `${OUT}/cover.png`);
  console.log('✓ cover →', `${OUT}/cover.png`);
}

// Premium loops: Luma Ray-2 with loop:true generates the clip AS a loop —
// last frame conditioned to meet the first. No dissolve, no reversal, no
// seam to hide. (~2-3x seedance cost; the room set earns it.)
if (mode === 'animate-loop') {
  for (const room of rooms) {
    const still = `${OUT}/room-${room.room_number}.png`;
    if (!existsSync(still)) { console.log(`skip room ${room.room_number}: no still`); continue; }
    try {
      const dataUri = `data:image/png;base64,${readFileSync(still).toString('base64')}`;
      const r = await fetch('https://fal.run/fal-ai/luma-dream-machine/ray-2/image-to-video', {
        method: 'POST', headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: ROOM_MOTION[room.room_number], image_url: dataUri, loop: true, resolution: '720p', duration: '5s' }),
      });
      if (!r.ok) throw new Error(`ray2 ${r.status}: ${(await r.text()).slice(0, 120)}`);
      const d = await r.json();
      const raw = `${OUT}/room-${room.room_number}-living-raw.mp4`;
      writeFileSync(raw, Buffer.from(await (await fetch(d.video.url)).arrayBuffer()));
      // Re-encode only (faststart, yuv420p) — the loop itself is already seamless.
      execSync(`ffmpeg -y -i "${raw}" -an -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart "${OUT}/room-${room.room_number}-living.mp4" 2>/dev/null`);
      console.log(`✓ ray-2 loop room ${room.room_number}`);
    } catch (e) { console.log('! room', room.room_number, e.message); }
  }
}

if (mode === 'animate') {
  for (const room of rooms) {
    const still = `${OUT}/room-${room.room_number}.png`;
    if (!existsSync(still)) { console.log(`skip room ${room.room_number}: no still`); continue; }
    try {
      await seedance(still, ROOM_MOTION[room.room_number], `${OUT}/room-${room.room_number}-living.mp4`);
      console.log(`✓ living room ${room.room_number}`);
    } catch (e) { console.log('! room', room.room_number, e.message); }
  }
}

if (mode === 'animate-portraits') {
  const slugs = args.length ? args : Object.keys(PORTRAIT_MOTION);
  for (const slug of slugs) {
    const still = `art-out/portraits/${ADV}/${slug}.png`;
    if (!existsSync(still)) { console.log(`skip ${slug}: no still`); continue; }
    try {
      await seedance(still, PORTRAIT_MOTION[slug], `art-out/portraits/${ADV}/${slug}-living.mp4`);
      console.log(`✓ living portrait ${slug}`);
    } catch (e) { console.log('!', slug, e.message); }
  }
}

if (mode === 'install') {
  const dest = `public/scenes/${ADV}`;
  mkdirSync(`${dest}/portraits`, { recursive: true });
  for (const f of readdirSync(OUT).filter((f) => /^(room-\d+(-living)?\.(png|mp4)|cover\.png)$/.test(f))) {
    copyFileSync(`${OUT}/${f}`, `${dest}/${f}`);
    console.log('installed', f);
  }
  const pdir = `art-out/portraits/${ADV}`;
  if (existsSync(pdir)) {
    for (const f of readdirSync(pdir).filter((f) => /\.(png|mp4)$/.test(f) && !/-raw\.mp4$/.test(f))) {
      copyFileSync(`${pdir}/${f}`, `${dest}/portraits/${f}`);
      console.log('installed portraits/' + f);
    }
  }
}
