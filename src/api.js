// src/api.js — Frontend helpers with timeouts; surfaces server "detail" for easier debugging.

async function postJSON(url, body, ms = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
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
  } finally {
    clearTimeout(timer);
  }
}

async function postForm(url, fd, ms = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { method: 'POST', body: fd, signal: ctrl.signal });
    let data = {};
    try { data = await r.json(); } catch {}
    if (!r.ok) {
      const msg = [data?.error, data?.detail].filter(Boolean).join(': ') || r.statusText || 'Upload failed';
      throw new Error(msg);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function ask(question, context) {
  const data = await postJSON('/api/ask', { question, context });
  return data?.answer || '';
}

export async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  return await postForm('/api/upload', fd);
}

// Optional multi-turn chat
export async function chat(messages) {
  return await postJSON('/api/chat', { messages });
}
