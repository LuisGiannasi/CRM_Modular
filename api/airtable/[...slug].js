/**
 * Proxy serverless: el front llama a /api/airtable/... y aquí se reenvía a Airtable.
 * Variables en Vercel (o .env local con `vercel dev`): AIRTABLE_TOKEN, AIRTABLE_BASE_ID
 */
export default async function handler(req, res) {
  const token = String(
    process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY || ''
  ).trim();
  const baseId = String(process.env.AIRTABLE_BASE_ID || '').trim();

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
      if (Array.isArray(raw)) return raw;
      return String(raw).split('/').filter(Boolean);
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
  /** Mismo segmento que el front (ID tabla Leads en base modular). */
  const leadsTableSegment = process.env.AIRTABLE_TABLE_LEADS_ID || 'tbl0cIs2by0wqny4U';
  /**
   * Vercel a veces entrega solo /recXXXXXXXX en PATCH/GET por registro.
   */
  if (
    parts.length === 1 &&
    /^rec[a-zA-Z0-9]{8,}$/i.test(parts[0]) &&
    ['GET', 'PATCH', 'DELETE', 'PUT'].includes(req.method)
  ) {
    parts = [leadsTableSegment, parts[0]];
  }

  if (parts.length === 0) {
    return res.status(400).json({ error: 'Ruta inválida' });
  }

  /* tbl… y rec… son seguros en path; evitar doble-encoding que a veces rompe el PATCH. */
  const pathAfterBase = parts.map((p) => String(p).trim()).filter(Boolean).join('/');
  const airtableSearch = req.method === 'GET' ? reqUrl.search : '';
  const target = `https://api.airtable.com/v0/${baseId}/${pathAfterBase}${airtableSearch}`;

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
