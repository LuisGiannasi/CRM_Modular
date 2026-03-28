/**
 * Proxy serverless: el front llama a /api/airtable/... y aquí se reenvía a Airtable.
 * Variables en Vercel (o .env local con `vercel dev`): AIRTABLE_TOKEN, AIRTABLE_BASE_ID
 */
export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;

  if (!token || !baseId) {
    return res.status(500).json({
      error: 'Falta AIRTABLE_TOKEN (o AIRTABLE_API_KEY) o AIRTABLE_BASE_ID en el entorno del servidor',
    });
  }

  /** Segmentos tras /api/airtable/ (Vercel a veces no rellena req.query.slug en rutas catch-all). */
  function pathPartsFromRequest() {
    const raw = req.query.slug;
    if (raw) {
      return Array.isArray(raw) ? raw : [raw];
    }
    const host = req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const url = new URL(req.url || '/', `${proto}://${host}`);
    const pathname = url.pathname;
    const prefix = '/api/airtable/';
    if (!pathname.startsWith(prefix)) return [];
    const rest = pathname.slice(prefix.length);
    if (!rest) return [];
    return rest.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  }

  const parts = pathPartsFromRequest();
  if (parts.length === 0) {
    return res.status(400).json({ error: 'Ruta inválida' });
  }

  const pathAfterBase = parts.map((p) => encodeURIComponent(p)).join('/');
  const url = new URL(req.url || '/', 'https://vercel.local');
  const target = `https://api.airtable.com/v0/${baseId}/${pathAfterBase}${url.search}`;

  const allowed = ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'];
  if (!allowed.includes(req.method)) {
    res.setHeader('Allow', allowed.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const init = { method: req.method, headers };

  if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
    if (req.body !== undefined && req.body !== null) {
      init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }
  }

  const r = await fetch(target, init);
  const text = await r.text();
  const ct = r.headers.get('content-type');
  if (ct) res.setHeader('Content-Type', ct);
  return res.status(r.status).send(text);
}
