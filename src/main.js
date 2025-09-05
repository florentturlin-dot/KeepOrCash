import { ask, uploadFile } from './api.js';

// Quick DOM helpers
const $ = (sel) => document.querySelector(sel);

const askForm = $('#ask-form');
const askInput = $('#question');
const askBtn = $('#ask-btn');
const answerEl = $('#answer');

const uploadForm = $('#upload-form');
const fileInput = $('#file');
const uploadBtn = $('#upload-btn');
const uploadResultEl = $('#upload-result');

// ASK flow
askForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = (askInput.value || '').trim();
  if (!q) return;

  askBtn.disabled = true;
  answerEl.textContent = 'Thinking…';

  try {
    const text = await ask(q);
    answerEl.textContent = text || '(no answer)';
  } catch (err) {
    answerEl.textContent = `Ask failed: ${err?.message || err}`;
  } finally {
    askBtn.disabled = false;
  }
});

// UPLOAD flow
uploadForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = fileInput.files?.[0];
  if (!f) {
    uploadResultEl.textContent = 'Pick a file first.';
    return;
  }

  uploadBtn.disabled = true;
  uploadResultEl.textContent = 'Uploading…';

  try {
    const res = await uploadFile(f);
    uploadResultEl.textContent = JSON.stringify(res, null, 2);
  } catch (err) {
    uploadResultEl.textContent = `Upload failed: ${err?.message || err}`;
  } finally {
    uploadBtn.disabled = false;
  }
});
