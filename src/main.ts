// src/main.ts
import { ask, uploadFile } from './api';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const askForm = $('#ask-form') as HTMLFormElement;
const askInput = $('#question') as HTMLInputElement;
const answerEl = $('#answer') as HTMLPreElement;

const uploadForm = $('#upload-form') as HTMLFormElement;
const fileInput = $('#file') as HTMLInputElement;
const uploadResultEl = $('#upload-result') as HTMLPreElement;

askForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  answerEl.textContent = 'Thinking…';
  try {
    const text = await ask(askInput.value.trim());
    answerEl.textContent = text || '(no answer)';
  } catch (err: any) {
    answerEl.textContent = `Ask failed: ${err?.message || err}`;
  }
});

uploadForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = fileInput.files?.[0];
  if (!f) {
    uploadResultEl.textContent = 'Pick a file first.';
    return;
  }
  uploadResultEl.textContent = 'Uploading…';
  try {
    const res = await uploadFile(f);
    uploadResultEl.textContent = JSON.stringify(res, null, 2);
  } catch (err: any) {
    uploadResultEl.textContent = `Upload failed: ${err?.message || err}`;
  }
});
