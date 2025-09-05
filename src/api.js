// src/api.js — appels avec timeout & erreurs détaillées
async function postJSON(url, body, ms = 35000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    let data = {};
    try { data = await r.json(); } catch {}
    if (!r.ok) {
      const msg = [data?.error, data?.detail].filter(Boolean).join(': ') || r.statusText || 'Request failed';
      throw new Error(msg);
    }
    return data;
  } finally { clearTimeout(t); }
}

async function postForm(url, fd, ms = 35000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { method: 'POST', body: fd, signal: ctrl.signal });
    let data = {};
    try { data = await r.json(); } catch {}
    if (!r.ok) {
      const msg = [data?.error, data?.detail].filter(Boolean).join(': ') || r.statusText || 'Upload failed';
      throw new Error(msg);
    }
    return data;
  } finally { clearTimeout(t); }
}

export async function ask(question, context) {
  return await postJSON('/api/ask', { question, context });
}
export async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  return await postForm('/api/upload', fd);
}
