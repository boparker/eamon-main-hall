// Default fal.ai portrait generator → returns raw PNG bytes (Buffer).
// Injectable as deps.generateImage so tests mock it; reads FAL_KEY at call time.
// Returns { png: Buffer } on success or { error: string } on failure.
export async function generatePortraitImage(prompt) {
  const falKey = process.env.FAL_KEY;
  if (!falKey) return { error: 'no-api-key' };
  try {
    const r = await fetch('https://fal.run/fal-ai/flux/dev', {
      method: 'POST',
      headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, image_size: 'portrait_4_3', num_images: 1, output_format: 'png' }),
    });
    if (!r.ok) return { error: `api-${r.status}` };
    const data = await r.json();
    const url = data.images?.[0]?.url;
    if (!url) return { error: 'no-image' };
    const img = await fetch(url);
    if (!img.ok) return { error: 'download-failed' };
    return { png: Buffer.from(await img.arrayBuffer()) };
  } catch (err) {
    return { error: err.message };
  }
}
