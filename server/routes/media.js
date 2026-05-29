import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── ElevenLabs config (FULL voice IDs) ────────────────────────────────────────
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const VOICES = {
  irishman: 'JBFqnCBsd6RMkjVDRZzb',
  narrator: 'nPczCjzI2devNBz1zQrb',
  shopkeep: 'iP95p4xoKVk53GoZ742B',
};

// ── Image Generation (Fal.ai Flux) ───────────────────────────────────────────
const IMAGE_CACHE_DIR = join(__dirname, '..', '..', 'public', 'gen-images');

(async () => {
  if (!existsSync(IMAGE_CACHE_DIR)) await mkdir(IMAGE_CACHE_DIR, { recursive: true });
})();

const SCENE_STYLE_PREFIX = `Eyvind Earle painting style, geometric painterly landscape, angular Gothic forms, ` +
  `dramatic depth and layered parallax planes, jewel-tone palette with deep purples midnight blues and burnished gold, ` +
  `architectural detail, Sleeping Beauty 1959 background aesthetic, cinematic wide composition, no text no words no letters`;

const PORTRAIT_STYLE_PREFIX = `Eyvind Earle and Sleeping Beauty 1959 character design, flat cel-shaded with 1-2 subtle shadow planes, ` +
  `angular elegant features, tall adult proportions 8 heads tall, Celtic ornamental detail on clothing and armor, ` +
  `jewel-tone palette, dark moody background, portrait bust shot centered, no text no words no letters`;

function cacheKey(prefix, text) {
  return prefix + '-' + crypto.createHash('md5').update(text.toLowerCase().trim()).digest('hex').slice(0, 12);
}

async function pollFalResult(requestId, falKey) {
  const maxAttempts = 30;
  const delayMs = 1000;

  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`https://queue.fal.run/fal-ai/flux/dev/requests/${requestId}/status`, {
      headers: { 'Authorization': `Key ${falKey}` }
    });

    if (!res.ok) {
      console.error('[IMG] Fal poll error:', res.status);
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }

    const status = await res.json();
    console.log(`[IMG] Fal status: ${status.status}`);

    if (status.status === 'COMPLETED') {
      const resultRes = await fetch(`https://queue.fal.run/fal-ai/flux/dev/requests/${requestId}`, {
        headers: { 'Authorization': `Key ${falKey}` }
      });
      if (resultRes.ok) {
        return await resultRes.json();
      }
    } else if (status.status === 'FAILED') {
      throw new Error('Fal generation failed');
    }

    await new Promise(r => setTimeout(r, delayMs));
  }

  throw new Error('Fal polling timeout');
}

async function generateImage(prompt, cachePrefix) {
  const key = cacheKey(cachePrefix, prompt);
  const cachedPath = join(IMAGE_CACHE_DIR, `${key}.jpg`);
  const publicUrl = `/gen-images/${key}.jpg`;

  if (existsSync(cachedPath)) {
    console.log(`[IMG] Cache hit: ${key}`);
    return publicUrl;
  }

  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    console.error('[IMG] No FAL_KEY set');
    return { error: 'No API key configured' };
  }

  console.log(`[IMG] Generating: ${cachePrefix} — ${prompt.slice(0, 60)}...`);

  try {
    const submitRes = await fetch('https://queue.fal.run/fal-ai/flux/dev', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${falKey}`
      },
      body: JSON.stringify({
        prompt: prompt,
        image_size: cachePrefix === 'scene' ? 'landscape_16_9' : 'portrait_4_3',
        num_inference_steps: 28,
        guidance_scale: 3.5
      })
    });

    if (!submitRes.ok) {
      const err = await submitRes.text();
      console.error('[IMG] Fal submit error:', submitRes.status, err.slice(0, 200));
      return { error: `API ${submitRes.status}: ${err.slice(0, 100)}` };
    }

    const submitData = await submitRes.json();
    const requestId = submitData.request_id;

    if (!requestId) {
      console.error('[IMG] No request_id from Fal');
      return { error: 'No request ID' };
    }

    console.log(`[IMG] Fal request: ${requestId}`);

    const result = await pollFalResult(requestId, falKey);

    if (!result.images?.[0]?.url) {
      console.error('[IMG] No image URL in Fal response');
      return { error: 'No image data' };
    }

    const imageRes = await fetch(result.images[0].url);
    if (!imageRes.ok) {
      return { error: 'Failed to download image' };
    }

    const buffer = Buffer.from(await imageRes.arrayBuffer());
    await writeFile(cachedPath, buffer);
    console.log(`[IMG] Saved: ${cachedPath} (${(buffer.length / 1024).toFixed(0)}KB)`);
    return publicUrl;
  } catch (err) {
    console.error('[IMG] Generation error:', err.message);
    return { error: err.message };
  }
}

export function createMediaRouter() {
  const router = express.Router();

  // ── ElevenLabs TTS ──────────────────────────────────────────────────────────
  router.post('/tts', async (req, res) => {
    const { text, voiceId } = req.body;
    if (!text || !ELEVEN_KEY) return res.status(400).json({ error: 'missing text or API key' });

    try {
      const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId || VOICES.narrator}/stream`, {
        method: 'POST',
        headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.slice(0, 500),
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.35 },
        }),
      });

      if (!ttsRes.ok) {
        const errText = await ttsRes.text();
        console.error('ElevenLabs error:', ttsRes.status, errText);
        return res.status(ttsRes.status).json({ error: errText });
      }

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-cache');
      const reader = ttsRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); return; }
        res.write(Buffer.from(value));
      }
    } catch (err) {
      console.error('TTS error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Scene background image ────────────────────────────────────────────────────
  router.post('/scene-image', async (req, res) => {
    const { location, description } = req.body;
    if (!location) return res.status(400).json({ error: 'missing location' });

    const prompt = `${SCENE_STYLE_PREFIX}. Scene: ${location}${description ? '. ' + description : ''}`;
    const result = await generateImage(prompt, 'scene');
    if (result?.error) return res.status(500).json(result);
    res.json({ url: result });
  });

  // ── Character / monster portrait ──────────────────────────────────────────────
  router.post('/portrait', async (req, res) => {
    const { name, description, type } = req.body;
    if (!name) return res.status(400).json({ error: 'missing name' });

    const typeHint = type === 'monster' ? 'fearsome creature portrait' : type === 'npc' ? 'RPG character portrait' : 'character portrait';
    const prompt = `${PORTRAIT_STYLE_PREFIX}. ${typeHint}: ${name}${description ? '. ' + description : ''}`;
    const result = await generateImage(prompt, type || 'char');
    if (result?.error) return res.status(500).json(result);
    res.json({ url: result });
  });

  return router;
}

export default createMediaRouter;
