// api/hello.js
export default async function handler(req, res) {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, now: new Date().toISOString() });
    return;
  }
  res.status(405).send('Method Not Allowed');
}
