const API = '/api/airtable';

async function req(path, options = {}) {
  const url = `${API}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `${res.status} ${res.statusText}`);
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
 * Notas vinculadas a un lead (requiere campo `lead` en Notas_Leads — script 07-link-notas-lead.js).
 */
export async function fetchNotasByLead(leadId) {
  const formula = `{lead} = '${leadId.replace(/'/g, "\\'")}'`;
  const params = new URLSearchParams({
    filterByFormula: formula,
    'sort[0][field]': 'fecha',
    'sort[0][direction]': 'desc',
  });
  try {
    const data = await req(`/${encodeURIComponent('Notas_Leads')}?${params}`);
    return data.records || [];
  } catch {
    return null;
  }
}
