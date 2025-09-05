// api/ask.js
// Q/R textuelle avec extraction structurée + enrichissement prix via APIs publiques.
// Requiert: OPENAI_API_KEY
// Optionnel: POKEMON_TCG_API_KEY (pour prix Pokémon via pokemontcg.io)

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

async function callOpenAIJson(messages, signal) {
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
      messages
    }),
    signal
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(detail || `OpenAI HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '{}';
  return JSON.parse(content);
}

// ---------- Pricing helpers ----------

async function fetchMTGPrices({ name, set }) {
  if (!name) return null;
  const base = 'https://api.scryfall.com/cards/search?q=';
  // recherche exacte sur le nom, on liste les éditions (prints)
  const query = `!"${name}" unique:prints${set ? ` set:${JSON.stringify(set).replaceAll('"','')}` : ''}`;
  const url = base + encodeURIComponent(query);
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  if (!j?.data?.length) return null;

  // on prend la première carte avec un prix USD ou EUR
  const card = j.data.find(c => c?.prices?.usd || c?.prices?.eur || c?.prices?.usd_foil) || j.data[0];
  const prices = card?.prices || {};
  return {
    source: 'scryfall',
    url: card?.scryfall_uri || `https://scryfall.com/search?q=${encodeURIComponent(query)}`,
    set_name: card?.set_name,
    collector_number: card?.collector_number,
    released_at: card?.released_at,
    prices: {
      usd: prices.usd || null,
      usd_foil: prices.usd_foil || null,
      eur: prices.eur || null,
      eur_foil: prices.eur_foil || null
    }
  };
}

async function fetchYGOPrices({ name }) {
  if (!name) return null;
  // YGOPRODeck docs: https://db.ygoprodeck.com/api-guide/
  // "fname" = fuzzy name search
  const url = `https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(name)}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
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
  // Nécessite POKEMON_TCG_API_KEY (gratuit à créer)
  const key = process.env.POKEMON_TCG_API_KEY;
  if (!key || !name) return null;
  // Docs: https://docs.pokemontcg.io/
  // Exemple de query: q=name:"Charizard" set.name:"Base Set"
  const parts = [];
  parts.push(`name:"${name}"`);
  if (set) parts.push(`set.name:"${set}"`);
  const q = parts.join(' ');

  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=6`;
  const r = await fetch(url, { headers: { 'X-Api-Key': key } });
  if (!r.ok) return null;
  const j = await r.json();
  const card = j?.data?.[0];
  if (!card) return null;

  const prices = card?.tcgplayer?.prices || card?.cardmarket?.prices || {};
  return {
    source: 'pokemontcg',
    url: card?.tcgplayer?.url || card?.images?.large || `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}`,
    set_name: card?.set?.name,
    number: card?.number,
    rarity: card?.rarity,
    prices // structure variable selon la rareté (normal/foil/holo)
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
  // si on ne sait pas: on essaie dans l'ordre MTG -> YGO -> Pokémon
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
  if (query.condition_notes?.length) lines.push(`**État (indices visuels)**: ${query.condition_notes.join(', ')}`);

  // prix
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
  lines.push('_Note_: Les prix dépendent fortement de la **condition** réelle et de la **version exacte**. Faites des photos recto/verso, bonne lumière, bordures nettes, et le code de set visible.');
  return lines.join('\n');
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    const { question, context } = (req.body ?? {});
    if (!question) return res.status(400).json({ error: 'Missing question' });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'Server misconfig: OPENAI_API_KEY missing' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    // 1) Extraction structurée (JSON)
    const extract = await callOpenAIJson([
      {
        role: 'system',
        content:
          'You are a collectibles extraction agent. From the user query, output compact JSON with fields: ' +
          'game (pokemon|mtg|yugioh|other|unknown), name, set, edition, language, number, rarity, condition_notes (array of strings). ' +
          'Only return JSON.'
      },
      {
        role: 'user',
        content: context ? `${question}\n\nContext:\n${context}` : question
      }
    ], controller.signal);

    const query = {
      game: extract.game || 'unknown',
      name: extract.name || '',
      set: extract.set || '',
      edition: extract.edition || '',
      language: extract.language || '',
      number: extract.number || '',
      rarity: extract.rarity || '',
      condition_notes: Array.isArray(extract.condition_notes) ? extract.condition_notes : []
    };

    // 2) Enrichissement web (prix)
    const pricing = await enrichPrices({ game: query.game, name: query.name, set: query.set });

    clearTimeout(timer);

    const summary = buildSummary({ query, pricing });

    res.status(200).json({
      ok: true,
      query,
      pricing,
      summary
    });
  } catch (e) {
    res.status(502).json({ error: 'Ask enrich failed', detail: String(e?.message ?? e) });
  }
}
