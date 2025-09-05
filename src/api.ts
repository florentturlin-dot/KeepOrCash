// src/api.ts
export async function ask(question: string, context?: string): Promise<string> {
  const r = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, context })
  });

  // Try to read server's JSON error details (so you see real errors)
  let data: any = {};
  try { data = await r.json(); } catch { /* ignore */ }

  if (!r.ok) {
    const msg = data?.error || r.statusText || 'Request failed';
    throw new Error(msg);
  }
  return (data?.answer as string) || '';
}

export async function uploadFile(file: File): Promise<{ ok: boolean; size?: number }> {
  const fd = new FormData();
  fd.append('file', file);

  const r = await fetch('/api/upload', { method: 'POST', body: fd });

  let data: any = {};
  try { data = await r.json(); } catch { /* ignore */ }

  if (!r.ok) {
    const msg = data?.error || r.statusText || 'Upload failed';
    throw new Error(msg);
  }
  return data;
}
