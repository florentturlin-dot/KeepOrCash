// src/api.js — Frontend helpers with timeouts so UI doesn't spin forever.

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
    if (!r.ok) throw new Error(data?.error || r.statusText || 'Request failed');
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
    if (!r.ok) throw new Error(data?.error || r.statusText || 'Upload failed');
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

// Optional: example chat wrapper if you ever want multi-turn
export async function chat(messages) {
  return await postJSON('/api/chat', { messages });
}
