// api/ask.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    // In Node serverless, body is on req.body (not req.json())
    const { question, context } = (req.body ?? {}) as { question?: string; context?: string };
    if (!question) {
      res.status(400).json({ error: 'Missing question' });
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'Server misconfig: OPENAI_API_KEY missing' });
      return;
    }

    // Add a sane timeout so the function can't hang forever
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000); // 20s

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
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
    }).catch((e: any) => {
      // Map aborts/timeouts to useful errors
      throw new Error(e?.name === 'AbortError' ? 'Upstream timeout' : (e?.message || 'OpenAI fetch failed'));
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      res.status(502).json({ error: 'OpenAI error', detail });
      return;
    }

    const data = await resp.json();
    const answer = data?.choices?.[0]?.message?.content ?? '';
    res.status(200).json({ answer });
  } catch (e: any) {
    res.status(500).json({ error: 'Unhandled server error', detail: String(e?.message ?? e) });
  }
}
