// pipeline.mjs — Self-verifying room-art pipeline. Closes the loop so new
// levels don't need image-by-image human review:
//
//   BRIEF   Claude turns the room's ACTUAL narration_text into a visual scene
//           brief — camera/POV, must-show elements, lighting — while stripping
//           the nav-text traps (exit directions, "light from outside") that
//           historically dragged the model outdoors.
//   PAINT   flux-pro renders the brief in the established cinematic register.
//   VERIFY  Claude *looks at the image* and checks it against the description:
//           POV correct? must-show elements present? contradictions? people?
//           outdoor vistas? Fail → regenerate with the failures appended to
//           the prompt (up to MAX_ATTEMPTS), then flag for human review.
//   REPORT  A human only ever reviews the flagged rooms.
//
// Usage (from repo root, with .env.local + .fal.env sourced):
//   node art-out/pipeline.mjs verify data/adventures/beginners-cave.json
//       → QA the EXISTING public/scenes/<id>/room-N.png images, no painting
//   node art-out/pipeline.mjs paint data/adventures/beginners-cave.json [rooms...]
//       → full brief→paint→verify loop into art-out/pipeline/<id>/
//
// This is the "Latitude evals" idea applied to art: the spec is the room text,
// and every image is tested against its spec before a human sees it.

import { readFileSync, writeFileSync, mkdirSync, existsSync , copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Prefer a DEDICATED key for offline art runs so they never rate-limit the
// live game's narration (PIPELINE_ANTHROPIC_KEY; falls back to the main key).
const ANTHROPIC_KEY = process.env.PIPELINE_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
const FAL_KEY = process.env.FAL_KEY;
const MODEL = process.env.PIPELINE_MODEL || 'claude-haiku-4-5-20251001';
const VISION_MODEL = process.env.PIPELINE_VISION_MODEL || 'claude-sonnet-5';
const MAX_ATTEMPTS = 3;

// ── Anthropic helpers ────────────────────────────────────────────────────────
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

// Downscale for vision QA so token cost stays trivial.
function imageBlock(path) {
  const small = `/tmp/pipeline-qa-${Date.now()}.png`;
  execSync(`sips -Z 1024 -s format png "${path}" --out "${small}" >/dev/null 2>&1`);
  const data = readFileSync(small).toString('base64');
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data } };
}

// ── Style registers (locked; same language as paint-cinematic-set.mjs) ──────
const PAINTERLY = 'painterly matte finish of the animated series Arcane by studio Fortiche, a moving-oil-painting look with visible directional brushstrokes and matte hand-painted texture';
const NEG = 'NOT busy, NOT cluttered, NOT evenly lit, no allover detail, NOT photorealistic, NOT a photograph, NOT glossy, NOT a 3d render, NOT CGI, no text, no words, no letters, no watermark, no signature, no border, no UI.';
const NO_FIGURES = 'An empty environment — no people, no figures, no person, no silhouette of a person, no creatures.';
// Setting contract, chosen PER ROOM by biome — the beginners-cave version
// hardcoded 'enclosed raw cave', which forced the Minotaur's beaches,
// temple and forest to be painted as caves (40 rooms flagged in one run).
const BIOMES = {
  cave: 'Fully enclosed underground: no sky, no horizon, no outside vista, no buildings. Raw rough-hewn cave rock, cracked and damp with age — NEVER dressed masonry, polished stone or palace architecture; any door is battered aged rough timber with rusted iron, set directly into the rock.',
  river: 'An open-air river gorge: a broad swift river under open sky, pale sand and shingle shores, high rocky cliff walls rising in the distance with tunnel mouths at their base, natural hazy daylight, atmospheric depth. Somber and vast, not tropical, not cheerful.',
  temple: 'An ancient subterranean temple cut and built by hands long dead: crude old worked-stone masonry, squat pillars, cracked flagstones, soot-stained carvings — ancient and oppressive, NEVER polished palace grandeur; timber and iron are old and battered.',
  outdoor: 'An outdoor scene: open air, natural daylight or dusk, trees, undergrowth or open ground as the text describes. Grounded and slightly somber — a real place after a long darkness, not a fantasy vista.',
};
function biomeFor(room) {
  const t = `${room.name} ${room.narration_text ?? room.description ?? ''}`.toLowerCase();
  if (/forest|clearing|bushes|road|outside|daylight|open air|camp/.test(t)) return 'outdoor';
  if (/river|beach|grotto|shore|water's edge|boat/.test(t)) return 'river';
  if (/temple|chapel|altar|idol|sanctuary|treasury|vestry|worship|well-built|smithy|blacksmith/.test(t)) return 'temple';
  return 'cave';
}
const LOUD = (biome) => `Cinematic signature keyframe, ${PAINTERLY}: one dominant focal element, a SINGLE dramatic motivated light source, deep chiaroscuro with crushed black shadow, a restricted palette, generous negative space, high contrast, atmospheric depth. ${NO_FIGURES} ${BIOMES[biome]} ${NEG}`;
const QUIET = (biome) => `Quiet understated background, ${PAINTERLY}: a single soft dim light, mostly deep shadow and empty space, a restrained cold desaturated palette, calm and low-drama, minimal detail with a few small grace notes. Deliberately NOT a hero shot. ${NO_FIGURES} ${BIOMES[biome]} ${NEG}`;

// ── BRIEF: description → visual scene spec ───────────────────────────────────
const BRIEF_SYSTEM = `You turn a text-adventure room description into a VISUAL SCENE BRIEF for an image model painting the room's background art. Reply with ONLY JSON:
{
  "subject": "<2-4 sentences describing exactly what the camera sees, composed for a single dramatic frame>",
  "camera": "<the point of view, stated unambiguously — e.g. 'standing at the TOP of the stairs looking DOWN; the steps descend away from the viewer into darkness'>",
  "must_show": ["<3-6 concrete visual elements a viewer must be able to point at>"],
  "must_not": ["<traps to avoid for THIS room, e.g. 'stairs ascending toward light' when the text says they descend>"],
  "light": "<the single dominant light source and mood, from the text>"
}
RULES:
- Use ONLY what the description states or clearly implies. Do not invent landmarks.
- The description is PLAYER NAVIGATION TEXT: ignore exit directions and meta-instructions; "you see light to the east/from outside" means a distant glow at a passage mouth, NEVER an outdoor scene.
- POV matters most: if the text places the viewer somewhere (top of stairs, entrance, shore), say it twice — once in camera, once in subject.
- The scene is UNPEOPLED (characters are overlaid separately) — never include people or creatures, even if the text mentions them.
- Underground rooms stay fully enclosed: any "light" is torchlight, a shaft from a crack, or a distant glow — no sky, no vistas.
- MATERIALS: this is an old CAVE, not a castle. Walls are raw rough-hewn living rock, cracked, damp and ancient — NEVER dressed ashlar masonry, polished stone, tile, or palace architecture. "Cells" are crude chambers cut from rock; doors are heavy, aged, rough timber planks with rusted iron bands and crude hinges, set directly into the rock — battered and old, never grand or ornate.`;

async function makeBrief(room) {
  const text = await claude([{ role: 'user', content: `Room name: ${room.name}\nRoom description: ${room.narration_text}` }], { system: BRIEF_SYSTEM });
  return parseJson(text);
}

// ── VERIFY: does the image match the description? ────────────────────────────
const VERIFY_SYSTEM = `You are a strict but fair art QA inspector for a game. You get a room's TEXT DESCRIPTION and its background IMAGE. Judge ONLY visually checkable claims. Reply with ONLY JSON:
{
  "observed": "<2-3 sentences: what the image actually shows — POV, space, scale, light — before any judgment>",
  "pov_ok": <bool — is the camera where the text puts the viewer? (e.g. "top of a stairway" must look DOWN the stairs, not up)>,
  "scale_ok": <bool — does the SIZE of the space match the text? ("a small stark cell" must not be a vast cavern)>,
  "elements": [{"element": "<key visual element from the text>", "present": <bool>}],
  "violations": ["<hard-rule breaches ONLY: a person/figure/creature visible; genuine outdoor SKY/horizon/landscape/buildings in an underground room; any rendered text, lettering, logo or watermark artifact in the image>"],
  "style_ok": <bool — does it look like restrained painterly concept art (matte, hand-painted, one light, generous shadow)? false if it reads as ornate/gilded/baroque/palatial, cluttered-busy, or like a flat 3D-render/videogame texture>,
  "verdict": "pass" | "fail",
  "reasons": ["<short, concrete, actionable — what to change>"]
}
THE GAME'S ART CONTRACT (do NOT fail for these — they are intentional):
- Signs/inscriptions from the text may appear as blank boards or carved stones, or be absent — never fail for that. HOWEVER: any rendered lettering, logo or watermark IN the image IS a violation (it is an artifact).
- Rooms are UNPEOPLED by design even when the text mentions people or creatures.
- Dramatic light shafts, cracks of light, and bright glows at passage mouths are STYLE, not sky. A violation requires actual visible sky/clouds/horizon/landscape/buildings.
- Style, palette, mood, and exit directions are not your concern.
RULES:
- Describe "observed" FIRST, from the image alone; then judge. Cite only what you can actually see.
- Only fail for what a player reading the room text would notice: wrong POV, wrong scale, a named CENTERPIECE missing (altars, a boat, a hearth, books in a library), a hard violation, or a direct contradiction.
- Be certain: when an element is small or ambiguous at this resolution, mark it present:true and move on. False alarms are costly.
- STYLE GATE: the game's look is restrained painterly matte concept art — rough-hewn, humble, one light, deep shadow. Mark style_ok=false for ornate gilded/baroque/palatial grandeur, allover clutter, a flat sterile 3D-render look, OR polished/dressed masonry where the text describes a cave (cave walls must read as raw cracked rock; doors as battered old timber, not palace joinery). When in doubt, style_ok=true.
- verdict is "fail" only if pov_ok=false, scale_ok=false, style_ok=false, a violation exists, or a named centerpiece is missing.`;

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

// ── PAINT ────────────────────────────────────────────────────────────────────
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

function promptFrom(brief, register) {
  // Style LEADS the prompt (order matters: subject-first drags flux toward
  // ornate realism; register-first keeps the cinematic hand). EXCEPT when the
  // room has named centerpiece props (coffin, altar, anvil, mirror): flux
  // drops trailing props, so prop-critical rooms lead with the subject and
  // repeat the must-shows early — the style register follows immediately.
  const musts = brief.must_show ?? [];
  const propCritical = musts.length >= 2;
  if (propCritical) {
    return `${brief.subject} PROMINENTLY FEATURING, clearly visible: ${musts.join('; ')}. ${register} CAMERA: ${brief.camera}. LIGHT: ${brief.light}. AVOID: ${(brief.must_not ?? []).join('; ')}. Keep it restrained: humble materials, one light source, generous shadow — never ornate, gilded, baroque or grand.`;
  }
  return `${register} THE SCENE: ${brief.subject} CAMERA: ${brief.camera}. LIGHT: ${brief.light}. MUST SHOW: ${musts.join('; ')}. AVOID: ${(brief.must_not ?? []).join('; ')}. Keep it restrained: rough-hewn and rocky, humble materials, one light source, generous shadow — never ornate, gilded, baroque or grand.`;
}

// ── Runner ───────────────────────────────────────────────────────────────────
const SIGNATURE_SETS = {
  'beginners-cave': [1, 4, 18, 22, 26],
  // Minotaur beats: the shaft fall, the mirror, the chapel (Lil), the lair, the gypsy clearing.
  'lair-of-the-minotaur': [1, 5, 52, 87, 90],
};

const [, , mode, manifestPath, ...roomArgs] = process.argv;
if (!mode || !manifestPath) {
  console.log('usage: node art-out/pipeline.mjs <verify|paint> <adventure.json> [roomNumbers…]');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const advId = manifest.adventure.id;
const wanted = roomArgs.map(Number).filter(Boolean);
const rooms = manifest.locations
  .filter((l) => wanted.length === 0 || wanted.includes(l.room_number))
  .sort((a, b) => a.room_number - b.room_number);

const results = [];

if (mode === 'verify') {
  for (const room of rooms) {
    const img = `public/scenes/${advId}/room-${room.room_number}.png`;
    if (!existsSync(img)) { results.push({ room: room.room_number, name: room.name, verdict: 'missing' }); continue; }
    try {
      const v = await verify(room, img);
      results.push({ room: room.room_number, name: room.name, verdict: v.verdict, pov_ok: v.pov_ok, scale_ok: v.scale_ok, reasons: v.reasons ?? [], violations: v.violations ?? [] });
      console.log(`${v.verdict === 'pass' ? '✓' : '✗'} room ${room.room_number} ${room.name}${v.verdict === 'fail' ? ' — ' + (v.reasons ?? []).join(' | ') : ''}`);
    } catch (e) { results.push({ room: room.room_number, name: room.name, verdict: 'error', reasons: [e.message] }); console.log('! room', room.room_number, e.message); }
  }
}

if (mode === 'paint') {
  mkdirSync(`art-out/pipeline/${advId}`, { recursive: true });
  for (const room of rooms) {
    const register = (new Set(SIGNATURE_SETS[advId] ?? []).has(room.room_number) ? LOUD : QUIET)(biomeFor(room));
    const out = `art-out/pipeline/${advId}/room-${room.room_number}.png`;
    try {
      const brief = await makeBrief(room);
      let prompt = promptFrom(brief, register);
      let verdict = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        await paint(prompt, out);
        verdict = await verify(room, out);
        if (verdict.verdict === 'pass') { console.log(`✓ room ${room.room_number} ${room.name} (attempt ${attempt})`); break; }
        console.log(`… room ${room.room_number} attempt ${attempt} failed: ${(verdict.reasons ?? []).join(' | ')}`);
        prompt = `${promptFrom(brief, register)} CRITICAL FIXES from a failed previous attempt: ${(verdict.reasons ?? []).join('; ')}.`;
      }
      results.push({ room: room.room_number, name: room.name, verdict: verdict?.verdict ?? 'error', reasons: verdict?.reasons ?? [] });
      paintedByText.set(textKey, { out, room: room.room_number, verdict: verdict?.verdict ?? 'error' });
      if (verdict?.verdict !== 'pass') console.log(`✗ room ${room.room_number} FLAGGED for human review`);
    } catch (e) { results.push({ room: room.room_number, name: room.name, verdict: 'error', reasons: [e.message] }); console.log('! room', room.room_number, e.message); }
  }
}

const flagged = results.filter((r) => r.verdict !== 'pass');
writeFileSync(`art-out/pipeline-report-${advId}.json`, JSON.stringify(results, null, 2));
console.log(`\n${results.length - flagged.length}/${results.length} passed. ${flagged.length ? `REVIEW NEEDED: rooms ${flagged.map((f) => f.room).join(', ')}` : 'Nothing needs human review.'}`);
console.log(`report: art-out/pipeline-report-${advId}.json`);
