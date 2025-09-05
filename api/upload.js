// api/upload.js
// Edge runtime: parses FormData, sends image inline (base64 data URL) to OpenAI Vision, returns analysis.
export const config = { runtime: 'edge' };

function toBase64(buffer) {
  // Convert ArrayBuffer -> base64 (chunked to avoid call stack limits)
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  // btoa is available in Edge runtime
  return btoa(binary);
}

export default async function handler(req) {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const form = await req.formData();
    const file = form.get('file');
    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Enforce ~4.5 MB body limit to be safe on Vercel
    if (file.size > 4_500_000) {
      return new Response(JSON.stringify({
        error: 'File too large for this endpoint (limit ~4.5MB). Please resize/compress.'
      }), { status: 413, headers: { 'Content-Type': 'application/json' } });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Server misconfig: OPENAI_API_KEY missing' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    const bytes = await file.arrayBuffer();
    const base64 = toBase64(bytes);
    const dataUrl = `data:${file.type || 'image/jpeg'};base64,${base64}`;

    // Prefer OPENAI_MODEL if set; else default to gpt-4o (vision-capable)
    const candidateModels = [
      process.env.OPENAI_MODEL,
      'gpt-4o',
      'gpt-4.1-mini',
      'gpt-4o-mini'
    ].filter(Boolean);

    const prompt =
      "You're a collectibles expert. Analyze the attached photo. " +
      "Identify the item(s), edition/print if visible, key condition issues, and what details are needed to price it accurately. " +
      "If it's a Pokémon/MTG/Yu-Gi-Oh! card, extract name, set/edition symbol, language, and visible grade. " +
      "Finish with a short checklist for a better valuation photo.";

    let lastDetail = '';

    for (const model of candidateModels) {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: dataUrl } }
              ]
            }
          ],
          temperature: 0.2
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        const analysis = data?.choices?.[0]?.message?.content ?? '';
        return new Response(JSON.stringify({
          ok: true,
          modelUsed: model,
          name: file.name,
          type: file.type,
          size: bytes.byteLength,
          analysis
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } else {
        lastDetail = await resp.text().catch(() => '');
        // try next model
      }
    }

    return new Response(JSON.stringify({ error: 'OpenAI error', detail: lastDetail || 'All models failed' }), {
      status: 502, headers: { 'Content-Type': 'application/json' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: 'Upload failed', detail: String(e?.message ?? e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
