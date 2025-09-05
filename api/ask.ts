export default async function handler(req: Request) {
  try {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    const { question, context } = await req.json().catch(() => ({}));
    if (!question) {
      return new Response(JSON.stringify({ error: 'Missing question' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Server misconfig: OPENAI_API_KEY missing' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful assistant for collectibles valuation.' },
          { role: 'user', content: question + (context ? `\nContext:\n${context}` : '') }
        ],
        temperature: 0.2
      })
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return new Response(JSON.stringify({ error: 'OpenAI error', detail }), {
        status: 502, headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await resp.json();
    const answer = data?.choices?.[0]?.message?.content ?? '';

    return new Response(JSON.stringify({ answer }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Unhandled server error', detail: String(e?.message ?? e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
