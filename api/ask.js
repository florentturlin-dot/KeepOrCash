// api/ask.js
// Node serverless function: answers a single question with OpenAI.
// Uses OPENAI_MODEL if set; otherwise defaults to a safe modern vision-capable model.

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const { question, context } = (req.body ?? {});
    if (!question) {
      res.status(400).json({ error: 'Missing question' });
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'Server misconfig: OPENAI_API_KEY missing' });
      return;
    }

    // Prefer OPENAI_MODEL if you set it in Vercel; else default.
    const candidateModels = [
      process.env.OPENAI_MODEL,     // optional override
      'gpt-4o',                     // widely available, vision-capable
      'gpt-4.1-mini',               // good + cheaper (if enabled)
      'gpt-4o-mini'                 // legacy fallback, may be unavailable on some accounts
    ].filter(Boolean);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    let lastDetail = '';
    for (const model of candidateModels) {
      try {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: 'You are a helpful assistant for collectibles valuation.' },
              { role: 'user', content: context ? `${question}\n\nContext:\n${context}` : question }
            ],
            temperature: 0.2
          }),
          signal: controller.signal
        });

        if (resp.ok) {
          const data = await resp.json();
          clearTimeout(timer);
          const answer = data?.choices?.[0]?.message?.content ?? '';
          res.status(200).json({ answer, modelUsed: model });
          return;
        } else {
          lastDetail = await resp.text().catch(() => '');
          // try next candidate model
        }
      } catch (e) {
        // If it was an abort, stop trying.
        if (String(e?.name) === 'AbortError') {
          clearTimeout(timer);
          res.status(504).json({ error: 'Upstream timeout from OpenAI' });
          return;
        }
        lastDetail = String(e?.message ?? e);
      }
    }

    clearTimeout(timer);
    res.status(502).json({ error: 'OpenAI error', detail: lastDetail || 'All candidate models failed' });
  } catch (e) {
    res.status(500).json({ error: 'Unhandled server error', detail: String(e?.message ?? e) });
  }
}
