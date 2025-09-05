// api/upload.ts
export const config = { runtime: 'edge' }; // Tell Vercel this is an Edge Function

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Edge runtime supports Web FormData directly:
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check size without Node Buffer (Edge doesn't have Buffer by default)
    if (file.size > 4_500_000) {
      return new Response(JSON.stringify({ error: 'File too large for this endpoint (limit ~4.5MB). Compress first.' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // If you need bytes:
    const bytes = await file.arrayBuffer();
    // TODO: send to your vision pipeline / Vercel Blob, etc.

    return new Response(JSON.stringify({ ok: true, size: bytes.byteLength, name: file.name, type: file.type }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Upload failed', detail: String(e?.message ?? e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
