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

  const host = req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const reqUrl = new URL(req.url || '/', `${proto}://${host}`);

  /**
   * Segmentos hacia Airtable (tabla, opcional record id, …).
   * En Vercel, req.url suele ser solo el subpath del handler (ej. /Leads?pageSize=100),
   * no la URL completa /api/airtable/Leads.
   */
  function pathPartsFromRequest() {
    const raw = req.query.slug;
    if (raw) {
      return Array.isArray(raw) ? raw : [raw];
    }
    const pathname = (reqUrl.pathname || '/').replace(/\/+$/, '') || '/';
    const prefix = '/api/airtable';
    if (pathname.startsWith(`${prefix}/`)) {
      const rest = pathname.slice(prefix.length + 1);
      if (!rest) return [];
      return rest.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
    }
    if (pathname === prefix) return [];
    const trimmed = pathname.replace(/^\/+/, '');
    if (!trimmed) return [];
    return trimmed.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  }

  let parts = pathPartsFromRequest();
  /**
   * Vercel a veces entrega solo /recXXXXXXXX (sin "Leads") en PATCH/GET por registro.
   * Este CRM solo usa esa forma para la tabla Leads.
   */
  if (
    parts.length === 1 &&
    /^rec[a-zA-Z0-9]{8,}$/i.test(parts[0]) &&
    ['GET', 'PATCH', 'DELETE', 'PUT'].includes(req.method)
  ) {
    parts = ['Leads', parts[0]];
  }

  if (parts.length === 0) {
    return res.status(400).json({ error: 'Ruta inválida' });
  }

  const pathAfterBase = parts.map((p) => encodeURIComponent(p)).join('/');
  const target = `https://api.airtable.com/v0/${baseId}/${pathAfterBase}${reqUrl.search}`;

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
