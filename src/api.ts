// src/api.ts
function withTimeout<T>(p: Promise<T>, ms = 25_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  // @ts-ignore - we pass the signal into fetch below
  (p as any)._signal = ctrl.signal;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => {
      ctrl.signal.addEventListener('abort', () => rej(new Error('Request timed out')));
    })
  ]);
}

async function postJSON(url: string, body: any, ms = 25_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    let data: any = {};
    try { data = await r.json(); } catch {}
    if (!r.ok) throw new Error(data?.error || r.statusText || 'Request failed');
    return data;
  } finally {
    clearTimeout(t);
  }
}

async function postForm(url: string, fd: FormData, ms = 25_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { method: 'POST', body: fd, signal: ctrl.signal });
    let data: any = {};
    try { data = await r.json(); } catch {}
    if (!r.ok) throw new Error(data?.error || r.statusText || 'Upload failed');
    return data;
  } finally {
    clearTimeout(t);
  }
}

export async function ask(question: string, context?: string): Promise<string> {
  const data = await postJSON('/api/ask', { question, context });
  return (data?.answer as string) || '';
}

export async function uploadFile(file: File): Promise<{ ok: boolean; size?: number }> {
  const fd = new FormData();
  fd.append('file', file);
  return await postForm('/api/upload', fd);
}
