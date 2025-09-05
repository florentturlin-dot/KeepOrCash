import { ask, uploadFile } from './api.js';

const $ = (sel) => document.querySelector(sel);
const askForm = $('#ask-form');
const askInput = $('#question');
const askBtn = $('#ask-btn');
const answerEl = $('#answer');
const uploadForm = $('#upload-form');
const fileInput = $('#file');
const uploadBtn = $('#upload-btn');
const uploadResultEl = $('#upload-result');

const esc = (s) => (s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

function li(list) {
  if (!Array.isArray(list) || !list.length) return '<div class="muted">—</div>';
  return `<ul>${list.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
}
function sourceList(list) {
  if (!Array.isArray(list) || !list.length) return '<div class="muted">Aucune source web (ajoute TAVILY_API_KEY ou SERPER_API_KEY).</div>';
  return `<ul>${list.map(s=>`<li><a target="_blank" href="${esc(s.url)}">${esc(s.title || s.url)}</a></li>`).join('')}</ul>`;
}

function renderReport(data) {
  const q = data?.query || {};
  const s = data?.sections || {};
  const fused = data?.fused || {};
  const api = data?.apiPricing || {};
  const web = data?.web || [];

  const meta = [];
  if (q.item_type) meta.push(`Type: ${q.item_type}`);
  if (q.category) meta.push(`Catégorie: ${q.category}`);
  if (q.name) meta.push(`Nom: ${q.name}`);
  if (q.set) meta.push(`Set/Série: ${q.set}`);
  if (q.platform) meta.push(`Plateforme: ${q.platform}`);
  if (q.brand) meta.push(`Marque: ${q.brand}`);
  if (q.franchise) meta.push(`Franchise: ${q.franchise}`);
  if (q.issue_number) meta.push(`Numéro: ${q.issue_number}`);
  if (q.variant) meta.push(`Variante: ${q.variant}`);
  if (q.year) meta.push(`Année: ${q.year}`);
  if (q.region) meta.push(`Région: ${q.region}`);
  if (q.language) meta.push(`Langue: ${q.language}`);

  const apiBlocks = [];
  if (api?.mtg?.prices) {
    const p = api.mtg.prices;
    apiBlocks.push(`<div class="subcard"><div class="tag">MTG · Scryfall</div>
      <div>Set: ${esc(api.mtg.set_name || '?')} · #${esc(api.mtg.collector_number || '?')}</div>
      <div>USD: ${p.usd || '-'} · USD foil: ${p.usd_foil || '-'} · EUR: ${p.eur || '-'}</div>
      <a target="_blank" href="${esc(api.mtg.url)}">Source</a></div>`);
  }
  if (api?.ygo?.prices) {
    const p = api.ygo.prices;
    apiBlocks.push(`<div class="subcard"><div class="tag">Yu-Gi-Oh! · YGOPRODeck</div>
      <div>TCGplayer: $${p.tcgplayer || '-'} · eBay: $${p.ebay || '-'} · Amazon: $${p.amazon || '-'}</div>
      <a target="_blank" href="${esc(api.ygo.url)}">Source</a></div>`);
  }
  if (api?.pokemon?.prices) {
    apiBlocks.push(`<div class="subcard"><div class="tag">Pokémon · TCG API</div>
      <div>Voir grille (normal/foil/holo) sur la source</div>
      <a target="_blank" href="${esc(api.pokemon.url)}">Source</a></div>`);
  }

  const fusedBlock = (fused?.estimate_low || fused?.estimate_high)
    ? `<div class="subcard"><div class="tag">Estimation synthèse</div>
         <div><strong>${fused.estimate_low ?? '?'}–${fused.estimate_high ?? '?'} ${esc(fused.currency || 'USD')}</strong></div>
         <div class="muted">${esc(fused.reasoning || '')}</div>
         ${sourceList(fused.sources)}
       </div>`
    : '<div class="muted">Pas d’estimation synthèse.</div>';

  return `
  <div class="card">
    <div class="title">Évaluation standardisée</div>
    <ul class="meta">${meta.map(m=>`<li>${esc(m)}</li>`).join('')}</ul>

    <div class="section">
      <h3>1. Intro value statement</h3>
      <p>${esc(s.intro || 'If this item is authentic, its value would be ...')}</p>
    </div>

    <div class="section">
      <h3>2. Item details</h3>
      <p>${esc(s.details || '')}</p>
    </div>

    <div class="section">
      <h3>3. Market trends</h3>
      <p>${esc(s.market_trends || '')}</p>
    </div>

    <div class="section">
      <h3>4. Regional variations</h3>
      <p>${esc(s.regional_variations || '')}</p>
    </div>

    <div class="section">
      <h3>5. Counterfeit risk notes</h3>
      ${li(s.counterfeit_risks)}
    </div>

    <div class="section">
      <h3>6. Verification methods</h3>
      ${li(s.verification_methods)}
    </div>

    <div class="section">
      <h3>7. Next steps</h3>
      ${li(s.next_steps)}
    </div>

    <div class="section">
      <h3>8. Suggested eBay listing description</h3>
      <pre class="code">${esc(s.ebay_listing || '')}</pre>
    </div>

    <div class="section">
      <h3>Sources web</h3>
      ${sourceList(data?.web)}
    </div>

    <div class="section">
      <h3>Repères des APIs spécialisées</h3>
      ${apiBlocks.length ? apiBlocks.join('') : '<div class="muted">—</div>'}
    </div>

    <div class="section">
      ${fusedBlock}
    </div>

    <div class="hint">Les valeurs dépendent fortement de l’authenticité, la version exacte et l’état. Pour maximiser la précision : photos recto/verso nettes, lumière diffuse, bords visibles, références (numéro/édition) lisibles.</div>
  </div>`;
}

/* --------- ASK flow --------- */
askForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = (askInput.value || '').trim();
  if (!q) return;
  askBtn.disabled = true;
  answerEl.innerHTML = '<div class="muted">Analyzing…</div>';
  try {
    const data = await ask(q);
    answerEl.innerHTML = renderReport(data);
  } catch (err) {
    answerEl.innerHTML = `<div class="error">Ask failed: ${esc(err?.message || String(err))}</div>`;
  } finally {
    askBtn.disabled = false;
  }
});

/* --------- UPLOAD flow --------- */
uploadForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = fileInput.files?.[0];
  if (!f) { uploadResultEl.innerHTML = '<div class="error">Pick a file first.</div>'; return; }
  uploadBtn.disabled = true;
  uploadResultEl.innerHTML = '<div class="muted">Uploading & analyzing…</div>';
  try {
    const data = await uploadFile(f);
    uploadResultEl.innerHTML = renderReport(data);
  } catch (err) {
    uploadResultEl.innerHTML = `<div class="error">Upload failed: ${esc(err?.message || String(err))}</div>`;
  } finally {
    uploadBtn.disabled = false;
  }
});
