// api/ask.js
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    // In Node serverless, JSON body is already parsed if sent as application/json
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

    // 20s timeout for the upstream request
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 20000);

    const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful assistant for collectibles valuation.' },
          { role: 'user', content: context ? `${question}\n\nContext:\n${context}` : question }
        ],
        temperature: 0.2
      }),
      signal: controller.signal
    }).catch((e) => {
      throw new Error(e?.name === 'AbortError' ? 'Upstream timeout' : (e?.message || 'OpenAI fetch failed'));
    });

    clearTimeout(t);

    if (!openaiResp.ok) {
      const detail = await openaiResp.text().catch(() => '');
      res.status(502).json({ error: 'OpenAI error', detail });
      return;
    }

    const data = await openaiResp.json();
    const answer = data?.choices?.[0]?.message?.content ?? '';
    res.status(200).json({ answer });
  } catch (e) {
    res.status(500).json({ error: 'Unhandled server error', detail: String(e?.message ?? e) });
  }
}
