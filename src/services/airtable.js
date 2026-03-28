const API = '/api/airtable';

/** Nombres de tabla sin literales legibles (Chrome Translate altera strings y "_" → espacio). */
const _n = String.fromCharCode;
export const AIRTABLE_TABLE_LEADS = _n(76, 101, 97, 100, 115); // Leads
const NOTAS_LEADS_DEFAULT = _n(78, 111, 116, 97, 115, 95, 76, 101, 97, 100, 115); // Notas_Leads

/**
 * Tabla de notas. Opcional: `VITE_AIRTABLE_TABLE_NOTAS` = nombre exacto en Airtable (con guión bajo si aplica).
 * Si en Vercel pusiste "Notas Leads" con espacio, borrá la variable o corregila a `Notas_Leads`.
 */
export const AIRTABLE_TABLE_NOTAS_LEADS = (() => {
  const raw = import.meta.env.VITE_AIRTABLE_TABLE_NOTAS;
  if (raw && String(raw).trim()) return String(raw).trim();
  return NOTAS_LEADS_DEFAULT;
})();

/**
 * Nombre del campo link en Notas_Leads → Leads (debe coincidir con Airtable).
 * Por defecto `lead` (script 07). Si creaste la columna como `leads`, en .env y Vercel:
 * VITE_AIRTABLE_NOTAS_LINK_FIELD=leads
 */
export const AIRTABLE_NOTAS_LINK_FIELD = (() => {
  const raw = import.meta.env.VITE_AIRTABLE_NOTAS_LINK_FIELD;
  if (raw && String(raw).trim()) return String(raw).trim();
  return _n(108, 101, 97, 100); // lead
})();

function errorMessageFromResponse(text, status) {
  if (!text) return `${status} ${status === 404 ? 'No encontrado' : ''}`.trim();
  try {
    const j = JSON.parse(text);
    if (j.error?.message) return j.error.message;
    if (typeof j.error === 'string') return j.error;
    if (j.error?.type) return j.error.type;
  } catch {
    /* HTML o texto plano (p. ej. página NOT_FOUND de Vercel) */
  }
  if (/NOT_FOUND|could not be found|no encontrad/i.test(text)) {
    return (
      'No se pudo contactar la API (404). Recargá la página; si sigue igual, redeploy en Vercel o revisá que la URL sea /api/airtable/…'
    );
  }
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

async function req(path, options = {}) {
  const url = `${API}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(errorMessageFromResponse(text, res.status));
  }
  return text ? JSON.parse(text) : {};
}

/**
 * @param {string} table
 * @param {Record<string, string>} query querystring params (ej. sort, filterByFormula)
 */
export async function fetchAllRecords(table, query = {}) {
  const out = [];
  let offset;
  for (;;) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null) params.append(k, String(v));
    });
    if (offset) params.set('offset', offset);
    const path = `/${encodeURIComponent(table)}?${params}`;
    const data = await req(path);
    out.push(...(data.records || []));
    offset = data.offset;
    if (!offset) break;
  }
  return out;
}

export async function createRecord(table, fields) {
  return req(`/${encodeURIComponent(table)}`, {
    method: 'POST',
    body: JSON.stringify({ fields }),
  });
}

export async function updateRecord(table, id, fields) {
  return req(`/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  });
}

/**
 * Notas vinculadas a un lead (campo link = AIRTABLE_NOTAS_LINK_FIELD).
 * El orden por fecha se hace en cliente.
 */
export async function fetchNotasByLead(leadId) {
  const lf = AIRTABLE_NOTAS_LINK_FIELD;
  const escaped = leadId.replace(/'/g, "\\'");
  const formulas = [
    `FIND('${escaped}', ARRAYJOIN({${lf}}))`,
    `{${lf}} = '${escaped}'`,
  ];

  for (const filterByFormula of formulas) {
    const params = new URLSearchParams({ filterByFormula });
    try {
      const data = await req(`/${encodeURIComponent(AIRTABLE_TABLE_NOTAS_LEADS)}?${params}`);
      const records = data.records || [];
      records.sort((a, b) => {
        const fa = String(a.fields?.fecha ?? '');
        const fb = String(b.fields?.fecha ?? '');
        return fb.localeCompare(fa);
      });
      return records;
    } catch {
      /* probá la otra fórmula o devolvé null */
    }
  }
  return null;
}
