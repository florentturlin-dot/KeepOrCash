import { ask, uploadFile } from './api.js';

const $ = (sel) => document.querySelector(sel);

const askForm = $('#ask-form');
const askInput = $('#question');
const askBtn = $('#ask-btn');
const answerEl = $('#answer');      // now we render HTML cards inside
const uploadForm = $('#upload-form');
const fileInput = $('#file');
const uploadBtn = $('#upload-btn');
const uploadResultEl = $('#upload-result'); // HTML cards too

function escapeHTML(s) {
  return (s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function renderPricing(pr) {
  const blocks = [];
  if (pr?.mtg) {
    const p = pr.mtg.prices || {};
    blocks.push(`
      <div class="subcard">
        <div class="tag">MTG · Scryfall</div>
        <div>Set: ${escapeHTML(pr.mtg.set_name || '?')} · #${escapeHTML(pr.mtg.collector_number || '?')}</div>
        <div>USD: ${p.usd || '-'} (non-foil) · USD foil: ${p.usd_foil || '-'} · EUR: ${p.eur || '-'}</div>
        <a target="_blank" href="${escapeHTML(pr.mtg.url)}">Source</a>
      </div>
    `);
  }
  if (pr?.ygo) {
    const p = pr.ygo.prices || {};
    blocks.push(`
      <div class="subcard">
        <div class="tag">Yu-Gi-Oh! · YGOPRODeck</div>
        <div>TCGplayer: $${p.tcgplayer || '-'} · eBay: $${p.ebay || '-'} · Amazon: $${p.amazon || '-'}</div>
        <a target="_blank" href="${escapeHTML(pr.ygo.url)}">Source</a>
      </div>
    `);
  }
  if (pr?.pokemon) {
    blocks.push(`
      <div class="subcard">
        <div class="tag">Pokémon · TCG API</div>
        <div>Voir grille de prix (normal/foil/holo) sur la source</div>
        <a target="_blank" href="${escapeHTML(pr.pokemon.url)}">Source</a>
      </div>
    `);
  }
  if (!blocks.length) return '<div class="muted">Aucun prix trouvé (ajuste le nom/set ou ajoute une clé POKEMON_TCG_API_KEY pour Pokémon).</div>';
  return blocks.join('');
}

function renderResult({ title, meta = [], notes = [], pricing }) {
  return `
    <div class="card">
      <div class="title">${escapeHTML(title)}</div>
      ${meta.length ? `<ul class="meta">${meta.map(m => `<li>${escapeHTML(m)}</li>`).join('')}</ul>` : ''}
      ${notes.length ? `<div class="muted">État : ${notes.map(escapeHTML).join(', ')}</div>` : ''}
      <div class="pricing">${renderPricing(pricing)}</div>
      <div class="hint">Les prix sont indicatifs — condition/version exactes essentielles (recto/verso, lumière, bordures, symbole d’édition).</div>
    </div>
  `;
}

// ASK flow
askForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = (askInput.value || '').trim();
  if (!q) return;

  askBtn.disabled = true;
  answerEl.innerHTML = '<div class="muted">Thinking…</div>';

  try {
    const data = await ask(q);
    // data = { ok, query, pricing, summary }
    const meta = [];
    if (data?.query?.game) meta.push(`Jeu: ${data.query.game}`);
    if (data?.query?.set) meta.push(`Set: ${data.query.set}`);
    if (data?.query?.edition) meta.push(`Tirage: ${data.query.edition}`);
    if (data?.query?.language) meta.push(`Langue: ${data.query.language}`);
    if (data?.query?.number) meta.push(`Numéro: ${data.query.number}`);
    if (data?.query?.rarity) meta.push(`Rareté: ${data.query.rarity}`);

    const html = renderResult({
      title: data?.query?.name || 'Résultat',
      meta,
      notes: data?.query?.condition_notes || [],
      pricing: data?.pricing
    });

    answerEl.innerHTML = html;
  } catch (err) {
    answerEl.innerHTML = `<div class="error">Ask failed: ${escapeHTML(err?.message || String(err))}</div>`;
  } finally {
    askBtn.disabled = false;
  }
});

// UPLOAD flow
uploadForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = fileInput.files?.[0];
  if (!f) {
    uploadResultEl.innerHTML = '<div class="error">Pick a file first.</div>';
    return;
  }

  uploadBtn.disabled = true;
  uploadResultEl.innerHTML = '<div class="muted">Uploading & analyzing…</div>';

  try {
    const res = await uploadFile(f);
    // res = { ok, file, query, pricing, summary }
    const meta = [];
    if (res?.query?.game) meta.push(`Jeu: ${res.query.game}`);
    if (res?.query?.set) meta.push(`Set: ${res.query.set}`);
    if (res?.query?.edition) meta.push(`Tirage: ${res.query.edition}`);
    if (res?.query?.language) meta.push(`Langue: ${res.query.language}`);
    if (res?.query?.number) meta.push(`Numéro: ${res.query.number}`);
    if (res?.query?.rarity) meta.push(`Rareté: ${res.query.rarity}`);

    const html = renderResult({
      title: res?.query?.name || res?.file?.name || 'Analyse',
      meta,
      notes: res?.query?.condition_notes || [],
      pricing: res?.pricing
    });

    uploadResultEl.innerHTML = html;
  } catch (err) {
    uploadResultEl.innerHTML = `<div class="error">Upload failed: ${escapeHTML(err?.message || String(err))}</div>`;
  } finally {
    uploadBtn.disabled = false;
  }
});
