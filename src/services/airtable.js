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

/**
 * Record ID `rec…` del comercial en tabla Especialistas (opcional).
 * Si está definido, el Kanban y altas rellenan vendedor / audit links cuando existen en la base.
 */
export const ESPECIALISTA_RECORD_ID = (() => {
  const raw = import.meta.env.VITE_ESPECIALISTA_RECORD_ID;
  const t = String(raw ?? '').trim();
  const m = t.match(/rec[a-zA-Z0-9]{14}/i);
  return m ? normalizeRecordId(m[0]) : '';
})();

export function especialistaIdsForPatch() {
  return ESPECIALISTA_RECORD_ID ? [ESPECIALISTA_RECORD_ID] : null;
}

/** Campos link a Especialistas según la nueva etapa (misma idea que Motores Pesados). */
export function leadEtapaAssignPatch(etapaNueva) {
  const ids = especialistaIdsForPatch();
  if (!etapaNueva || !ids) return {};
  const p = { modificado_por_app: ids, vendedor: ids };
  if (etapaNueva === 'Contactado') p.contactado_por = ids;
  if (etapaNueva === 'En gestión') p.en_proceso_por = ids;
  if (etapaNueva === 'Ganado') p.ganado_por = ids;
  if (etapaNueva === 'Perdido') p.perdido_por = ids;
  return p;
}

export function leadInteractionTouchPatch() {
  const now = new Date();
  return {
    ultima_interaccion: now.toISOString().split('T')[0],
    ultimo_contacto: now.toISOString(),
    fecha_modificacion_app: now.toISOString(),
  };
}

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
 * Crea una fila en Notas_Leads vinculada al lead (mismo shape que el formulario de notas).
 */
export async function appendNotaLead(leadId, { contenido, tipo = 'Observación', autor_nombre = '—' }) {
  const text = String(contenido ?? '').trim();
  if (!text) throw new Error('La nota no puede estar vacía.');
  const rid = normalizeRecordId(leadId);
  const titulo = text.slice(0, 80);
  const fecha = new Date().toISOString();
  return createRecord(AIRTABLE_TABLE_NOTAS_LEADS, {
    nota: titulo,
    contenido: text,
    tipo: tipo || 'Observación',
    fecha,
    autor_nombre: String(autor_nombre ?? '—').trim() || '—',
    [AIRTABLE_NOTAS_LINK_FIELD]: [rid],
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

// ── Conversión Ganado → Cliente + OT / Presupuesto ─────────────────────────

export const AIRTABLE_TABLE_CLIENTES = (() => {
  const raw = import.meta.env.VITE_AIRTABLE_TABLE_CLIENTES;
  return raw && String(raw).trim() ? String(raw).trim() : 'Clientes';
})();

export const AIRTABLE_TABLE_OT = (() => {
  const raw = import.meta.env.VITE_AIRTABLE_TABLE_OT;
  return raw && String(raw).trim() ? String(raw).trim() : 'Ordenes_Trabajo';
})();

export const AIRTABLE_TABLE_PRESUPUESTO_VENTA = (() => {
  const raw = import.meta.env.VITE_AIRTABLE_TABLE_PRESUPUESTO_VENTA;
  return raw && String(raw).trim() ? String(raw).trim() : 'Presupuesto_Venta';
})();

/** Campo en Leads que enlaza a Presupuesto_Venta (si existe en la base). */
export const LEAD_FIELD_PRESUPUESTO_VENTA = (() => {
  const raw = import.meta.env.VITE_LEAD_FIELD_PRESUPUESTO_VENTA;
  return raw && String(raw).trim() ? String(raw).trim() : 'presupuesto_venta';
})();

function escapeAirtableFormula(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function normalizePhoneForMatch(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  while (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('54')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('9')) d = d.slice(1);
  if (d.length > 10) d = d.slice(-10);
  return d;
}

/**
 * @param {string} table
 * @param {string} filterByFormula
 * @param {number} maxRecords
 */
export async function fetchRecordsByFormula(table, filterByFormula, maxRecords = 20) {
  const tbl = resolveTableSegmentForApi(table);
  const params = new URLSearchParams({
    filterByFormula,
    maxRecords: String(maxRecords),
  });
  const data = await req(`/${encodeURIComponent(tbl)}?${params}`);
  return data.records || [];
}

/**
 * @returns {Promise<{ id: string; nombre: string; matchField: string } | null>}
 */
export async function checkClienteDuplicado({ telefono, cuit }) {
  const conditions = [];
  const cuitTrim = (cuit || '').trim();
  const telTrim = (telefono || '').trim();
  if (cuitTrim) conditions.push(`{cuit} = '${escapeAirtableFormula(cuitTrim)}'`);
  if (telTrim) conditions.push(`{telefono} = '${escapeAirtableFormula(telTrim)}'`);
  if (conditions.length === 0) return null;
  const formula = conditions.length === 1 ? conditions[0] : `OR(${conditions.join(',')})`;
  try {
    const records = await fetchRecordsByFormula(AIRTABLE_TABLE_CLIENTES, formula, 5);
    if (records.length > 0) {
      const f = records[0].fields || {};
      const nombre = [f.nombre_referente, f.apellido_referente, f.nombre, f.apellido]
        .filter(Boolean)
        .join(' ')
        .trim();
      const matchField =
        cuitTrim && String(f.cuit || '').replace(/\s/g, '') === cuitTrim.replace(/\s/g, '')
          ? 'CUIT/DNI'
          : 'teléfono';
      return { id: records[0].id, nombre: nombre || 'Cliente existente', matchField };
    }
  } catch {
    /* fórmula o campo inválido → fallback */
  }
  const normDoc = cuitTrim.replace(/[^\dA-Za-z]/g, '').toUpperCase();
  const normTel = normalizePhoneForMatch(telefono);
  if (!normDoc && !normTel) return null;
  try {
    const all = await fetchAllRecords(AIRTABLE_TABLE_CLIENTES, { maxRecords: 500 });
    for (const r of all) {
      const f = r.fields || {};
      const nd = String(f.cuit || '').replace(/[^\dA-Za-z]/g, '').toUpperCase();
      const nt = normalizePhoneForMatch(f.telefono);
      const docMatch = !!normDoc && !!nd && normDoc === nd;
      const telMatch = !!normTel && !!nt && normTel === nt;
      if (docMatch || telMatch) {
        const nombre = [f.nombre_referente, f.apellido_referente, f.nombre, f.apellido]
          .filter(Boolean)
          .join(' ')
          .trim();
        return {
          id: r.id,
          nombre: nombre || 'Cliente existente',
          matchField: docMatch ? 'CUIT/DNI' : 'teléfono',
        };
      }
    }
  } catch {
    /* */
  }
  return null;
}

export async function createClienteFromLead({ nombre, apellido, telefono, cuit }) {
  const fields = {
    nombre_referente: String(nombre || '').trim() || '—',
    apellido_referente: String(apellido || '').trim() || '',
    telefono: String(telefono || '').trim() || '',
    fecha_creacion: new Date().toISOString(),
  };
  if (cuit && String(cuit).trim()) fields.cuit = String(cuit).trim();
  const res = await createRecord(AIRTABLE_TABLE_CLIENTES, fields);
  return res.id || res.records?.[0]?.id || null;
}

export async function vincularLeadACliente(leadId, clienteRecordId) {
  const lid = normalizeRecordId(leadId);
  const cid = normalizeRecordId(clienteRecordId);
  const esp = especialistaIdsForPatch();
  const base = {
    cliente_creado: true,
    cliente: [cid],
    fecha_modificacion_app: new Date().toISOString(),
    ...(esp ? { modificado_por_app: esp } : {}),
  };
  const attempts = [
    base,
    { ...base, cliente: [cid], cliente_id: [cid] },
    { cliente_creado: true, cliente: [cid], fecha_modificacion_app: new Date().toISOString() },
  ];
  let lastErr;
  for (const patch of attempts) {
    try {
      await updateRecord(AIRTABLE_LEADS_TABLE_API, lid, patch);
      return;
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      if (/unknown field|invalid|cannot parse|UNKNOWN_FIELD/i.test(msg)) continue;
      throw e;
    }
  }
  throw lastErr || new Error('No se pudo vincular el cliente al lead');
}

function extractCreateId(res) {
  return res?.id || res?.records?.[0]?.id || null;
}

export async function createOrdenTrabajoStub(clienteRecordId, suffix = '') {
  const cid = normalizeRecordId(clienteRecordId);
  const stamp = Date.now();
  const fields = {
    numero_ot: `CRM-${stamp}${suffix ? `-${suffix}` : ''}`,
  };
  if (cid) {
    fields.cliente = [cid];
  }
  try {
    const res = await createRecord(AIRTABLE_TABLE_OT, fields);
    return extractCreateId(res);
  } catch (e) {
    const res = await createRecord(AIRTABLE_TABLE_OT, { numero_ot: fields.numero_ot });
    return extractCreateId(res);
  }
}

export async function createPresupuestoVentaStub(clienteRecordId) {
  const cid = normalizeRecordId(clienteRecordId);
  const fields = {
    numero_pv: `PV-${Date.now()}`,
  };
  if (cid) fields.cliente = [cid];
  try {
    const res = await createRecord(AIRTABLE_TABLE_PRESUPUESTO_VENTA, fields);
    return extractCreateId(res);
  } catch {
    const res = await createRecord(AIRTABLE_TABLE_PRESUPUESTO_VENTA, { numero_pv: fields.numero_pv });
    return extractCreateId(res);
  }
}

/**
 * Actualiza lead tras conversión completa. Intenta enlazar OT o PV según `kind`.
 * @param {'ot' | 'presupuesto'} kind
 */
export async function patchLeadConversionComplete(leadId, { clienteId, followRecordId, kind }) {
  const lid = normalizeRecordId(leadId);
  const hoy = new Date().toISOString();
  const cid = normalizeRecordId(clienteId);
  const fid = normalizeRecordId(followRecordId);
  const patch = {
    etapa: 'Ganado',
    cliente: [cid],
    cliente_creado: true,
    proceso_incompleto: false,
    estado_conversion: 'completada',
    fecha_ganado: hoy,
    fecha_inicio_conversion: hoy,
    fecha_fin_conversion: hoy,
    revisar_despues_de: null,
    ...leadInteractionTouchPatch(),
    ...leadEtapaAssignPatch('Ganado'),
  };
  if (kind === 'ot' && fid) patch.orden_id_inicial = [fid];
  if (kind === 'presupuesto' && fid) patch[LEAD_FIELD_PRESUPUESTO_VENTA] = [fid];

  try {
    await updateRecord(AIRTABLE_LEADS_TABLE_API, lid, patch);
    return;
  } catch (e) {
    const msg = String(e?.message || e);
    if (kind === 'presupuesto' && fid && /unknown field|UNKNOWN_FIELD/i.test(msg)) {
      const lean = { ...patch };
      delete lean[LEAD_FIELD_PRESUPUESTO_VENTA];
      lean.presupuesto_venta = [fid];
      await updateRecord(AIRTABLE_LEADS_TABLE_API, lid, lean);
      return;
    }
    throw e;
  }
}

/** Marca Ganado con circuito incompleto (vuelve a Mi Inbox con cartel). */
export async function patchLeadGanadoIncompleto(leadId, { clienteId } = {}) {
  const hoy = new Date().toISOString();
  const patch = {
    etapa: 'Ganado',
    proceso_incompleto: true,
    estado_conversion: 'pendiente',
    fecha_ganado: hoy,
    fecha_inicio_conversion: hoy,
    fecha_fin_conversion: null,
    revisar_despues_de: null,
    ...leadInteractionTouchPatch(),
    ...leadEtapaAssignPatch('Ganado'),
  };
  if (clienteId) {
    patch.cliente = [normalizeRecordId(clienteId)];
    patch.cliente_creado = true;
  }
  await updateRecord(AIRTABLE_LEADS_TABLE_API, normalizeRecordId(leadId), patch);
}
