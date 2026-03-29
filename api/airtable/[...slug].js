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
    const pathname = (reqUrl.pathname || '/').replace(/\/+$/, '') || '/';
    const prefix = '/api/airtable';
    /**
     * Importante: ir primero por pathname. Si usamos solo req.query.slug, Vercel a veces
     * manda un solo segmento (p. ej. tbl…) y se pierde rec… → PATCH a …/tbl sin id → 404.
     */
    if (pathname.startsWith(`${prefix}/`)) {
      const rest = pathname.slice(prefix.length + 1);
      if (!rest) return [];
      return rest.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
    }
    if (pathname === prefix) return [];
    const trimmed = pathname.replace(/^\/+/, '');
    if (trimmed) {
      return trimmed.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
    }
    const raw = req.query.slug;
    if (raw) {
      if (Array.isArray(raw)) return raw;
      return String(raw).split('/').filter(Boolean);
    }
    return [];
  }

  let parts = pathPartsFromRequest();
  /** Mismo segmento que el front: ID tbl… de Leads (Airtable es más estable por ID). */
  const LEADS_TBL_ID = 'tbl0cIs2by0wqny4U';
  const leadsTableSegment = String(process.env.AIRTABLE_TABLE_LEADS || LEADS_TBL_ID).trim() || LEADS_TBL_ID;
  if (parts[0] && /^leads$/i.test(parts[0])) {
    parts[0] = leadsTableSegment;
  }
  if (parts[0] && parts[0].toLowerCase() === LEADS_TBL_ID.toLowerCase()) {
    parts[0] = leadsTableSegment;
  }
  /** Si el pathname vino vacío o cortado, rearmar desde la URL cruda. */
  if (
    parts.length < 2 &&
    ['GET', 'PATCH', 'DELETE', 'PUT'].includes(req.method)
  ) {
    const m = String(req.url || '').match(/\/api\/airtable\/([^?]+)/);
    if (m) {
      const alt = m[1]
        .split('/')
        .filter(Boolean)
        .map((s) => decodeURIComponent(s));
      if (alt.length > parts.length) parts = alt;
    }
  }
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

  if (['PATCH', 'DELETE', 'PUT'].includes(req.method) && parts.length < 2) {
    return res.status(400).json({
      error: 'Faltan segmentos: se necesita /api/airtable/{tabla}/{recordId}',
      parts,
      pathname: reqUrl.pathname,
    });
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
    const b = req.body;
    if (b !== undefined && b !== null) {
      if (typeof b === 'string') init.body = b;
      else if (Buffer.isBuffer(b)) init.body = b.toString('utf8');
      else init.body = JSON.stringify(b);
    }
  }

  const r = await fetch(target, init);
  const text = await r.text();
  const ct = r.headers.get('content-type');
  if (ct) res.setHeader('Content-Type', ct);
  res.setHeader('X-Proxy-Airtable-Path', `/${pathAfterBase}`);
  return res.status(r.status).send(text);
}
