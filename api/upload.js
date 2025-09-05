// api/upload.js
// Analyse image: extraction JSON (vision) + enrichissement prix via APIs publiques.
// Requiert: OPENAI_API_KEY
// Optionnel: POKEMON_TCG_API_KEY
export const config = { runtime: 'edge' };

const OPENAI_MODEL = (typeof process !== 'undefined' && process.env.OPENAI_MODEL) || 'gpt-4o';

function toBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function callOpenAIJsonVision(prompt, dataUrl) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are a collectibles photo extraction agent. From the image, output JSON with fields: ' +
            'game (pokemon|mtg|yugioh|other|unknown), name, set, edition (e.g., 1st Edition/Unlimited/Shadowless), language, number, rarity, ' +
            'condition_notes (array of short strings), raw_text (OCR-ish important text). Only return JSON.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ]
    })
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(detail || `OpenAI HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '{}';
  return JSON.parse(content);
}

// ---------- Pricing helpers (Edge) ----------
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
async function enrichPrices({ game, name, set }) {
  const g = (game || '').toLowerCase();
  if (g.includes('mtg') || g.includes('magic')) {
    const mtg = await fetchMTGPrices({ name, set });
    return { game: 'mtg', mtg };
  }
  if (g.includes('yugioh') || g.includes('yu-gi')) {
    const ygo = await fetchYGOPrices({ name });
    return { game: 'yugioh', ygo };
  }
  if (g.includes('pokemon') || g.includes('pokémon')) {
    const pkm = await fetchPokemonPrices({ name, set });
    return { game: 'pokemon', pokemon: pkm };
  }
  const [mtg, ygo, pkm] = await Promise.all([
    fetchMTGPrices({ name, set }).catch(() => null),
    fetchYGOPrices({ name }).catch(() => null),
    fetchPokemonPrices({ name, set }).catch(() => null)
  ]);
  return { game: 'unknown', mtg, ygo, pokemon: pkm };
}

function buildSummary({ query, pricing }) {
  const lines = [];
  lines.push(`**Item détecté**: ${query.name || 'inconnu'}`);
  if (query.game) lines.push(`**Jeu**: ${query.game}`);
  if (query.set) lines.push(`**Édition/Set**: ${query.set}`);
  if (query.edition) lines.push(`**Tirage**: ${query.edition}`);
  if (query.language) lines.push(`**Langue**: ${query.language}`);
  if (query.number) lines.push(`**Numéro**: ${query.number}`);
  if (query.rarity) lines.push(`**Rareté**: ${query.rarity}`);
  if (query.condition_notes?.length) lines.push(`**État (indices)**: ${query.condition_notes.join(', ')}`);

  const p = pricing || {};
  if (p.mtg?.prices || p.ygo?.prices || p.pokemon?.prices) {
    lines.push('');
    lines.push('**Prix estimés (indicatifs)**:');
  }
  if (p.mtg?.prices) {
    const pr = p.mtg.prices;
    lines.push(`- MTG/Scryfall (${p.mtg.set_name || 'set ?'}): USD ${pr.usd || '-'} (non-foil), USD foil ${pr.usd_foil || '-'}, EUR ${pr.eur || '-'} | Source: ${p.mtg.url}`);
  }
  if (p.ygo?.prices) {
    const pr = p.ygo.prices;
    lines.push(`- Yu-Gi-Oh!/YGOPRODeck: TCGplayer $${pr.tcgplayer || '-'}, eBay $${pr.ebay || '-'}, Amazon $${pr.amazon || '-'} | Source: ${p.ygo.url}`);
  }
  if (p.pokemon?.prices) {
    lines.push(`- Pokémon/TCG API: voir grilles (normal/holo/foil) | Source: ${p.pokemon.url}`);
  }

  lines.push('');
  lines.push('_Note_: Les prix varient selon l’état exact et la version. Photos recto/verso, bonne lumière, bords nets, symbole d’édition visible.');
  return lines.join('\n');
}

export default async function handler(req) {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    if (!process.env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: 'Server misconfig: OPENAI_API_KEY missing' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }
    if (file.size > 4_500_000) {
      return new Response(JSON.stringify({ error: 'File too large (~4.5MB limit). Please resize/compress.' }), {
        status: 413, headers: { 'Content-Type': 'application/json' }
      });
    }

    const bytes = await file.arrayBuffer();
    const dataUrl = `data:${file.type || 'image/jpeg'};base64,${toBase64(bytes)}`;

    // 1) Extraction vision -> JSON
    const extract = await callOpenAIJsonVision(
      'Analyse l’image et renvoie UNIQUEMENT du JSON selon le schéma demandé.',
      dataUrl
    );

    const query = {
      game: extract.game || 'unknown',
      name: extract.name || '',
      set: extract.set || '',
      edition: extract.edition || '',
      language: extract.language || '',
      number: extract.number || '',
      rarity: extract.rarity || '',
      condition_notes: Array.isArray(extract.condition_notes) ? extract.condition_notes : [],
      raw_text: extract.raw_text || ''
    };

    // 2) Enrichissement prix
    const pricing = await enrichPrices({ game: query.game, name: query.name, set: query.set });

    const summary = buildSummary({ query, pricing });

    return new Response(JSON.stringify({
      ok: true,
      file: { name: file.name, type: file.type, size: bytes.byteLength },
      query,
      pricing,
      summary
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (e) {
    return new Response(JSON.stringify({ error: 'Upload enrich failed', detail: String(e?.message ?? e) }), {
      status: 502, headers: { 'Content-Type': 'application/json' }
    });
  }
}
