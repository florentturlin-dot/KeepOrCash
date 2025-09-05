// api/upload.js
// Analyse image avec pipeline complet (vision + web + 8 sections)
export const config = { runtime: 'edge' };

const OPENAI_MODEL = (typeof process !== 'undefined' && process.env.OPENAI_MODEL) || 'gpt-4o';

/* ---------------------- Helpers ---------------------- */
function toBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
async function fetchJSON(url, headers) {
  const r = await fetch(url, { headers });
  if (!r.ok) return null;
  return await r.json();
}

/* ---------------------- Card APIs (Edge) ---------------------- */
async function fetchMTGPrices({ name, set }) {
  if (!name) return null;
  const query = `!"${name}" unique:prints${set ? ` set:${set.replaceAll('"','')}` : ''}`;
  const url = 'https://api.scryfall.com/cards/search?q=' + encodeURIComponent(query);
  const j = await fetchJSON(url);
  const card = j?.data?.find(c => c?.prices?.usd || c?.prices?.eur || c?.prices?.usd_foil) || j?.data?.[0];
  if (!card) return null;
  return {
    source: 'scryfall',
    url: card?.scryfall_uri || `https://scryfall.com/search?q=${encodeURIComponent(query)}`,
    set_name: card?.set_name,
    collector_number: card?.collector_number,
    released_at: card?.released_at,
    prices: {
      usd: card?.prices?.usd || null,
      usd_foil: card?.prices?.usd_foil || null,
      eur: card?.prices?.eur || null,
      eur_foil: card?.prices?.eur_foil || null
    }
  };
}
async function fetchYGOPrices({ name }) {
  if (!name) return null;
  const url = `https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(name)}`;
  const j = await fetchJSON(url);
  const card = j?.data?.[0];
  if (!card) return null;
  const p = card?.card_prices?.[0] || {};
  return {
    source: 'ygoprodeck',
    url: `https://db.ygoprodeck.com/card/?search=${encodeURIComponent(name)}`,
    card_name: card?.name,
    set_name: card?.card_sets?.[0]?.set_name || null,
    prices: {
      tcgplayer: p.tcgplayer_price || null,
      ebay: p.ebay_price || null,
      amazon: p.amazon_price || null,
      coolstuffinc: p.coolstuffinc_price || null
    }
  };
}
async function fetchPokemonPrices({ name, set }) {
  const key = (typeof process !== 'undefined' && process.env.POKEMON_TCG_API_KEY) || null;
  if (!key || !name) return null;
  const parts = [];
  parts.push(`name:"${name}"`);
  if (set) parts.push(`set.name:"${set}"`);
  const q = parts.join(' ');
  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=6`;
  const j = await fetchJSON(url, { 'X-Api-Key': key });
  const card = j?.data?.[0];
  if (!card) return null;
  return {
    source: 'pokemontcg',
    url: card?.tcgplayer?.url || card?.images?.large || `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}`,
    set_name: card?.set?.name,
    number: card?.number,
    rarity: card?.rarity,
    prices: card?.tcgplayer?.prices || card?.cardmarket?.prices || {}
  };
}

/* ---------------------- Web search (Edge) ---------------------- */
async function tavilySearch(query) {
  const key = (typeof process !== 'undefined' && process.env.TAVILY_API_KEY) || null;
  if (!key) return null;
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: 'advanced',
      include_answer: false,
      include_images: false,
      include_raw_content: false,
      max_results: 6
    })
  });
  if (!r.ok) return null;
  const j = await r.json();
  return (j?.results || []).map(x => ({ title: x.title, url: x.url, snippet: x.content || x.snippet || '' }));
}
async function serperSearch(query) {
  const key = (typeof process !== 'undefined' && process.env.SERPER_API_KEY) || null;
  if (!key) return null;
  const r = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
    body: JSON.stringify({ q: query, gl: 'us', num: 8 })
  });
  if (!r.ok) return null;
  const j = await r.json();
  const items = [...(j?.organic || []), ...(j?.shopping || [])];
  return items.map(it => ({ title: it.title, url: it.link, snippet: it.snippet || it.price || '' }));
}
function uniqByHost(list) {
  const seen = new Set();
  const out = [];
  for (const r of list || []) {
    try {
      const host = new URL(r.url).host.replace(/^www\./, '');
      if (seen.has(host)) continue;
      seen.add(host);
      out.push(r);
    } catch {}
  }
  return out;
}
function buildQueriesForCategory(cat, q) {
  const base = [q.name, q.set, q.platform, q.brand, q.franchise, q.issue_number, q.variant, q.year].filter(Boolean).join(' ');
  switch (cat) {
    case 'pokemon':
    case 'mtg':
    case 'yugioh':
      return [`${base} price`, `${base} tcgplayer price`, `${base} ebay sold`, `${base} graded psa price`];
    case 'retro_video_game':
      return [`${base} pricecharting`, `${base} ebay sold`, `${base} cib price`, `${base} sealed price`];
    case 'postage_stamp':
      return [`${base} Scott value`, `${base} StampWorld`, `${base} ebay sold`];
    case 'toy_or_figurine':
      return [`${base} action figure price`, `${base} ebay sold`, `${base} sealed`, `${base} loose`];
    case 'comic_book':
      return [`${base} cgc 9.8 price`, `${base} heritage auctions`, `${base} ebay sold`, `${base} gocollect`];
    case 'pogs':
      return [`${base} pogs price`, `${base} slammer price`, `${base} ebay sold`];
    default:
      return [`${base} price`, `${base} ebay sold`];
  }
}
async function webSearchPricingSignalsGeneric(queries) {
  let results = [];
  for (const q of queries) {
    const a = await tavilySearch(q).catch(() => null);
    const b = await serperSearch(q).catch(() => null);
    results = results.concat(a || []).concat(b || []);
  }
  return uniqByHost(results).slice(0, 10);
}

/* ---------------------- OpenAI JSON (vision extract / fusion / appraisal) ---------------------- */
async function callOpenAIJsonVision(prompt, dataUrl) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'From the image, extract JSON: { "category": "pokemon|mtg|yugioh|retro_video_game|postage_stamp|toy_or_figurine|comic_book|pogs|other", ' +
            '"item_type": string, "name": string, "set": string, "platform": string, "brand": string, "franchise": string, "issue_number": string, ' +
            '"variant": string, "year": string, "region": string, "language": string, "condition_notes": [string] }. Only JSON.'
        },
        { role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } }
        ] }
      ]
    })
  });
  if (!r.ok) throw new Error(await r.text().catch(() => `OpenAI HTTP ${r.status}`));
  const j = await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content || '{}');
}

async function callOpenAIPriceFusion(query, apiPricing, webSnippets) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Fuse pricing. Output JSON: {estimate_low,estimate_high,currency,reasoning,sources:[{title,url}]}' },
        { role: 'user', content: JSON.stringify({ query, apiPricing, webSnippets }) }
      ]
    })
  });
  if (!r.ok) throw new Error(await r.text().catch(() => `OpenAI HTTP ${r.status}`));
  const j = await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content || '{}');
}
async function callOpenAIAppraisal8(query, fused, apiPricing, webSnippets) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system',
          content: 'Return JSON with 8 sections: {intro, details, market_trends, regional_variations, counterfeit_risks:[string], verification_methods:[string], next_steps:[string], ebay_listing}. Always start intro with: "If this [item type] is authentic, its value would be ...".'
        },
        { role: 'user', content: JSON.stringify({ query, fused, apiPricing, webSnippets }) }
      ]
    })
  });
  if (!r.ok) throw new Error(await r.text().catch(() => `OpenAI HTTP ${r.status}`));
  const j = await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content || '{}');
}

/* ---------------------- Handler ---------------------- */
export default async function handler(req) {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    if (!process.env.OPENAI_API_KEY) return new Response(JSON.stringify({ error: 'Server misconfig: OPENAI_API_KEY missing' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

    const form = await req.formData();
    const file = form.get('file');
    if (!file) return new Response(JSON.stringify({ error: 'No file provided' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (file.size > 4_500_000) return new Response(JSON.stringify({ error: 'File too large (~4.5MB limit).' }), { status: 413, headers: { 'Content-Type': 'application/json' } });

    const bytes = await file.arrayBuffer();
    const dataUrl = `data:${file.type || 'image/jpeg'};base64,${toBase64(bytes)}`;

    // 1) Vision extract
    const extract = await callOpenAIJsonVision('Return ONLY JSON per the schema.', dataUrl);
    const query = {
      category: extract.category || 'other',
      item_type: extract.item_type || '',
      name: extract.name || '',
      set: extract.set || '',
      platform: extract.platform || '',
      brand: extract.brand || '',
      franchise: extract.franchise || '',
      issue_number: extract.issue_number || '',
      variant: extract.variant || '',
      year: extract.year || '',
      region: extract.region || '',
      language: extract.language || '',
      condition_notes: Array.isArray(extract.condition_notes) ? extract.condition_notes : []
    };

    // 2) APIs spécialisées si cartes
    let apiPricing = {};
    if (['pokemon', 'mtg', 'yugioh'].includes(query.category)) {
      const [mtg, ygo, pokemon] = await Promise.all([
        query.category === 'mtg' ? fetchMTGPrices({ name: query.name, set: query.set }).catch(()=>null) : null,
        query.category === 'yugioh' ? fetchYGOPrices({ name: query.name }).catch(()=>null) : null,
        query.category === 'pokemon' ? fetchPokemonPrices({ name: query.name, set: query.set }).catch(()=>null) : null
      ]);
      apiPricing = { mtg, ygo, pokemon };
    }

    // 3) Web search
    const queries = buildQueriesForCategory(query.category, query);
    const webSnippets = await webSearchPricingSignalsGeneric(queries);

    // 4) Fusion + 5) Rapport
    const fused = await callOpenAIPriceFusion(query, apiPricing, webSnippets).catch(()=>null);
    const sections = await callOpenAIAppraisal8(query, fused, apiPricing, webSnippets).catch(()=>null);

    return new Response(JSON.stringify({
      ok: true,
      file: { name: file.name, type: file.type, size: bytes.byteLength },
      query,
      apiPricing,
      web: webSnippets,
      fused,
      sections
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (e) {
    return new Response(JSON.stringify({ error: 'Upload pipeline failed', detail: String(e?.message ?? e) }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
}
