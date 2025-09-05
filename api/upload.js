// api/upload.js
// Edge runtime: supports Request/FormData/File web APIs directly
export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Vercel serverless body limit ~4.5 MB; reject larger files
    if (file.size > 4_500_000) {
      return new Response(JSON.stringify({ error: 'File too large for this endpoint (limit ~4.5MB). Compress first.' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const bytes = await file.arrayBuffer();
    // TODO: send `bytes` to your vision pipeline or store via Vercel Blob and pass the URL into your /api/ask as context

    return new Response(
      JSON.stringify({ ok: true, size: bytes.byteLength, name: file.name, type: file.type }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (e) {
    return new Response(JSON.stringify({ error: 'Upload failed', detail: String(e?.message ?? e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
