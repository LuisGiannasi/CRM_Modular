const API = '/api/airtable';

/** Nombre de la tabla Leads en Airtable. Opcional: `VITE_AIRTABLE_TABLE_LEADS` si el nombre difiere. Si alguien puso un ID tbl… por error, se ignora y se usa Leads. */
export const AIRTABLE_TABLE_LEADS = (() => {
  const raw = import.meta.env.VITE_AIRTABLE_TABLE_LEADS;
  if (raw && String(raw).trim()) {
    const t = String(raw).trim();
    if (/^tbl[a-z0-9]{10,}$/i.test(t)) return 'Leads';
    return t;
  }
  return 'Leads';
})();
const NOTAS_LEADS_TABLE_ID_DEFAULT = 'tble7Gy290bQ7O8Z1';
/** Copiado de la URL de Airtable: …/app…/tblXXXXXXXXXXXXXX/… — 17 caracteres: tbl + 14 alfanuméricos. */
const KNOWN_LEADS_TABLE_ID = 'tbl0cIs2by0wqny4U';

/**
 * Segmento de URL hacia Airtable para la tabla Leads.
 * Si en Vercel `VITE_AIRTABLE_LEADS_TABLE_API` tiene un typo (I vs l, 0 vs O), POST/PATCH devuelven 404: borrá la variable o pegá el id exacto desde la barra del navegador en Airtable.
 */
export const AIRTABLE_LEADS_TABLE_API = (() => {
  const raw = import.meta.env.VITE_AIRTABLE_LEADS_TABLE_API;
  if (raw && String(raw).trim()) {
    const t = String(raw).trim();
    if (/^tbl[a-zA-Z0-9]{14}$/.test(t)) return t;
  }
  return KNOWN_LEADS_TABLE_ID;
})();

/** rec + 14 caracteres; elimina espacios o caracteres raros pegados al copiar. */
function normalizeRecordId(id) {
  const s = String(id || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  const m = s.match(/rec[a-zA-Z0-9]{14}/i);
  return m ? m[0] : s;
}

/** Evita env errónea tipo `Notas` o `Notas Leads` (la tabla real es Notas_Leads / tble…). */
function normalizeNotasTableForApi(raw) {
  if (raw == null || !String(raw).trim()) return NOTAS_LEADS_TABLE_ID_DEFAULT;
  const t = String(raw).trim();
  if (/^notas$/i.test(t)) return NOTAS_LEADS_TABLE_ID_DEFAULT;
  if (/^notas\s+leads$/i.test(t)) return 'Notas_Leads';
  return t;
}

/** Si en Vercel pegaron `{leads}` o basura, la fórmula rompe (422). Solo identificador Airtable. */
function sanitizeNotasLinkFieldName(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  s = s.replace(/^\{+/, '').replace(/\}+$/g, '').trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) return '';
  return s;
}

/** Leads por nombre o por ID conocido → siempre el segmento API (tbl…). */
function resolveTableSegmentForApi(table) {
  const t = String(table).trim();
  if (!t) return t;
  if (t === 'Leads' || t.toLowerCase() === KNOWN_LEADS_TABLE_ID.toLowerCase()) {
    return AIRTABLE_LEADS_TABLE_API;
  }
  return t;
}

/**
 * Tabla Notas en la API (Airtable acepta nombre o ID `tbl…` / `tble…`).
 * Por defecto: ID del esquema exportado (evita confusiones Notas_Leads vs "Notas Leads").
 */
export const AIRTABLE_TABLE_NOTAS_LEADS = (() => {
  return normalizeNotasTableForApi(import.meta.env.VITE_AIRTABLE_TABLE_NOTAS);
})();

/**
 * Nombre del campo link en Notas_Leads → Leads (debe coincidir exactamente con Airtable).
 * Por defecto `lead` (script 07 y muchas bases). Si tu columna se llama `leads`, en Vercel: VITE_AIRTABLE_NOTAS_LINK_FIELD=leads
 */
export const AIRTABLE_NOTAS_LINK_FIELD = (() => {
  const fromEnv = sanitizeNotasLinkFieldName(import.meta.env.VITE_AIRTABLE_NOTAS_LINK_FIELD);
  if (fromEnv) return fromEnv;
  return 'lead';
})();

function errorMessageFromResponse(text, status) {
  if (!text) return `${status} ${status === 404 ? 'No encontrado' : ''}`.trim();
  try {
    const j = JSON.parse(text);
    const err = j.error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const msg = [err.type, err.message].filter(Boolean).join(': ');
      if (msg) return msg;
    }
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
  const tbl = resolveTableSegmentForApi(table);
  const out = [];
  let offset;
  for (;;) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null) params.append(k, String(v));
    });
    if (offset) params.set('offset', offset);
    const path = `/${encodeURIComponent(tbl)}?${params}`;
    const data = await req(path);
    out.push(...(data.records || []));
    offset = data.offset;
    if (!offset) break;
  }
  return out;
}

export async function createRecord(table, fields) {
  const tbl = resolveTableSegmentForApi(table);
  return req(`/${encodeURIComponent(tbl)}`, {
    method: 'POST',
    body: JSON.stringify({ fields, typecast: true }),
  });
}

/**
 * Actualización vía API de “varios registros” con un solo ítem.
 * Importante en Vercel: la URL queda igual que POST (solo `/tabla`), no `/tabla/recId`;
 * así se evita el 404 cuando el proxy/edge trata mal rutas con dos segmentos.
 * @see https://airtable.com/developers/web/api/update-multiple-records
 */
export async function updateRecord(table, id, fields) {
  const tbl = resolveTableSegmentForApi(table);
  const tid = normalizeRecordId(id);
  return req(`/${encodeURIComponent(tbl)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      records: [{ id: tid, fields }],
      typecast: true,
    }),
  });
}

export async function fetchNotasByLead(leadId) {
  const rid = String(leadId || '').trim();
  if (!/^rec[a-zA-Z0-9]{8,}$/i.test(rid)) return [];
  const linkField = AIRTABLE_NOTAS_LINK_FIELD;
  const esc = rid.replace(/'/g, "\\'");
  /** Link a un solo lead: comparación directa suele ir bien; si no, FIND+ARRAYJOIN. */
  const formulas = [
    `{${linkField}} = '${esc}'`,
    `FIND('${esc}', ARRAYJOIN({${linkField}}))`,
  ];
  const sort = {
    'sort[0][field]': 'fecha',
    'sort[0][direction]': 'desc',
  };
  const table = encodeURIComponent(AIRTABLE_TABLE_NOTAS_LEADS);
  for (const formula of formulas) {
    const params = new URLSearchParams({ filterByFormula: formula, ...sort });
    try {
      const data = await req(`/${table}?${params}`);
      return data.records || [];
    } catch {
      /* probá la siguiente fórmula */
    }
  }
  return null;
}
