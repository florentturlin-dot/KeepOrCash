export default async function handler(req: Request) {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.byteLength > 4_500_000) {
      return new Response(JSON.stringify({ error: 'File too large for this endpoint (limit ~4.5MB). Compress first.' }), {
        status: 413, headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ ok: true, size: buf.byteLength }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Upload failed', detail: String(e?.message ?? e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
