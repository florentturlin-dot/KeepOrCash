// api/chat.js
// Node serverless function: accepts an array of messages for a chat-like flow.
// Body example:
// {
//   "messages": [
//     {"role":"system","content":"You are helpful."},
//     {"role":"user","content":"Hello"}
//   ]
// }

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const { messages } = (req.body ?? {});
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Missing messages array' });
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'Server misconfig: OPENAI_API_KEY missing' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.2
      }),
      signal: controller.signal
    }).catch((e) => {
      throw new Error(e?.name === 'AbortError' ? 'Upstream timeout' : (e?.message || 'OpenAI fetch failed'));
    });

    clearTimeout(timer);

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      res.status(502).json({ error: 'OpenAI error', detail });
      return;
    }

    const data = await resp.json();
    const answer = data?.choices?.[0]?.message?.content ?? '';
    res.status(200).json({ answer });
  } catch (e) {
    res.status(500).json({ error: 'Unhandled server error', detail: String(e?.message ?? e) });
  }
}
