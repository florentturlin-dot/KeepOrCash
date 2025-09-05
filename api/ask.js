// api/ask.js
// Évaluation texte avec pipeline complet :
// 1) Extraction structurée (catégorie, nom, set, plateforme, etc.)
// 2) Enrichissement via APIs spécialisées (TCG: Scryfall/YGOPRODeck/Pokémon TCG)
// 3) Recherche web (Tavily et/ou Serper) multi-sources (eBay sold, PriceCharting, Heritage, etc.)
// 4) Fusion des signaux de prix
// 5) Mise en forme "rapport 8 sections" + phrase d’intro "If this [item type] is authentic..."

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

/* ---------------------- OpenAI helpers ---------------------- */
async function callOpenAIJson(messages, signal) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages
    }),
    signal
  });
  if (!r.ok) throw new Error(await r.text().catch(() => `OpenAI HTTP ${r.status}`));
  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content || '{}';
  return JSON.parse(content);
}

/* ---------------------- Card APIs ---------------------- */
async function fetchJSON(url, headers) {
  const r = await fetch(url, { headers });
  if (!r.ok) return null;
  return await r.json();
}
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
  const key = process.env.POKEMON_TCG_API_KEY;
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

/* ---------------------- Web search (Tavily / Serper) ---------------------- */
async function tavilySearch(query) {
  const key = process.env.TAVILY_API_KEY;
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
  const key = process.env.SERPER_API_KEY;
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
async function webSearchPricingSignalsGeneric(queries) {
  let results = [];
  for (const q of queries) {
    const a = await tavilySearch(q).catch(() => null);
    const b = await serperSearch(q).catch(() => null);
    results = results.concat(a || []).concat(b || []);
  }
  return uniqByHost(results).slice(0, 10);
}

/* ---------------------- Query + category helpers ---------------------- */
function buildQueriesForCategory(cat, q) {
  // q: {name,set,platform,year,brand,franchise,issue_number,variant}
  const base = [q.name, q.set, q.platform, q.brand, q.franchise, q.issue_number, q.variant, q.year].filter(Boolean).join(' ');
  switch (cat) {
    case 'pokemon':
    case 'mtg':
    case 'yugioh':
      return [
        `${base} price`,
        `${base} tcgplayer price`,
        `${base} ebay sold`,
        `${base} graded psa price`,
        `${base} sold listings`
      ];
    case 'retro_video_game':
      return [
        `${base} pricecharting`,
        `${base} ebay sold`,
        `${base} cib price`,
        `${base} loose price`,
        `${base} sealed price`
      ];
    case 'postage_stamp':
      return [
        `${base} Scott catalog value`,
        `${base} StampWorld price`,
        `${base} ebay sold`,
        `${base} watermark UV verify`
      ];
    case 'toy_or_figurine':
      return [
        `${base} action figure price`,
        `${base} ebay sold`,
        `${base} sealed new price`,
        `${base} loose price`,
        `${base} variant value`
      ];
    case 'comic_book':
      return [
        `${base} graded price`,
        `${base} cgc 9.8 price`,
        `${base} heritage auctions`,
        `${base} ebay sold`,
        `${base} go collect price`
      ];
    case 'pogs':
      return [
        `${base} pogs price`,
        `${base} slammer price`,
        `${base} ebay sold`,
        `${base} lot price`
      ];
    default:
      return [`${base} price`, `${base} ebay sold`, `${base} market value`];
  }
}

/* ---------------------- Price fusion + Appraisal ---------------------- */
async function callOpenAIPriceFusion({ query, apiPricing, webSnippets }, signal) {
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
            'You merge pricing signals for collectibles. Output pure JSON: ' +
            '{ "estimate_low":number, "estimate_high":number, "currency":"USD|EUR", "reasoning":string, ' +
            '"sources":[{"title":string,"url":string}] }'
        },
        { role: 'user', content: JSON.stringify({ query, apiPricing, webSnippets }) }
      ]
    }),
    signal
  });
  if (!r.ok) throw new Error(await r.text().catch(() => `OpenAI HTTP ${r.status}`));
  const j = await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content || '{}');
}

async function callOpenAIAppraisal8({ query, fused, apiPricing, webSnippets }, signal) {
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
            'You are an expert appraiser for collectibles (cards, pogs, retro games, stamps, toys, comics). ' +
            'Always start with: `If this [item type] is authentic, its value would be ...` ' +
            'Return JSON with keys: ' +
            '{ "intro": string, "details": string, "market_trends": string, "regional_variations": string, ' +
            '"counterfeit_risks": [string], "verification_methods": [string], "next_steps": [string], ' +
            '"ebay_listing": string }'
        },
        {
          role: 'user',
          content: JSON.stringify({ query, fused, apiPricing, webSnippets })
        }
      ]
    }),
    signal
  });
  if (!r.ok) throw new Error(await r.text().catch(() => `OpenAI HTTP ${r.status}`));
  const j = await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content || '{}');
}

/* ---------------------- Main handler ---------------------- */
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'Server misconfig: OPENAI_API_KEY missing' });

    const { question, context } = (req.body ?? {});
    if (!question) return res.status(400).json({ error: 'Missing question' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    // 1) Extraction: catégorie + champs utiles
    const extract = await callOpenAIJson([
      {
        role: 'system',
        content:
          'Extract compact JSON for a collectible query. Keys: ' +
          '{ "category": "pokemon|mtg|yugioh|retro_video_game|postage_stamp|toy_or_figurine|comic_book|pogs|other", ' +
          '"item_type": string, "name": string, "set": string, "platform": string, "brand": string, "franchise": string, ' +
          '"issue_number": string, "variant": string, "year": string, "region": string, "language": string, ' +
          '"condition_notes": [string] }. Only JSON.'
      },
      { role: 'user', content: context ? `${question}\n\nContext:\n${context}` : question }
    ], controller.signal);

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

    // 2) APIs spécialisées (si trading cards)
    let apiPricing = {};
    if (['pokemon', 'mtg', 'yugioh'].includes(query.category)) {
      const [mtg, ygo, pokemon] = await Promise.all([
        query.category === 'mtg' ? fetchMTGPrices({ name: query.name, set: query.set }).catch(()=>null) : null,
        query.category === 'yugioh' ? fetchYGOPrices({ name: query.name }).catch(()=>null) : null,
        query.category === 'pokemon' ? fetchPokemonPrices({ name: query.name, set: query.set }).catch(()=>null) : null
      ]);
      apiPricing = { mtg, ygo, pokemon };
    }

    // 3) Recherche web (nécessite TAVILY_API_KEY ou SERPER_API_KEY)
    const queries = buildQueriesForCategory(query.category, query);
    const webSnippets = await webSearchPricingSignalsGeneric(queries);

    // 4) Fusion estimation
    const fused = await callOpenAIPriceFusion({ query, apiPricing, webSnippets }, controller.signal).catch(()=>null);

    // 5) Rapport 8 sections
    const sections = await callOpenAIAppraisal8({ query, fused, apiPricing, webSnippets }, controller.signal).catch(()=>null);

    clearTimeout(timer);

    res.status(200).json({
      ok: true,
      query,
      apiPricing,
      web: webSnippets,
      fused,
      sections
    });
  } catch (e) {
    res.status(502).json({ error: 'Ask pipeline failed', detail: String(e?.message ?? e) });
  }
}
