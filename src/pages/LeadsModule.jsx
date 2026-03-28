import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchAllRecords,
  createRecord,
  updateRecord,
  fetchNotasByLead,
} from '../services/airtable';
import {
  ETAPAS,
  TIPOS_CONSULTA,
  EMPRESAS,
  ORIGENES,
  DOCUMENTO_TIPO,
  NOTA_TIPOS,
  etapaBadgeStyle,
} from '../constants/leadsOptions';

const LEAD_FIELD_KEYS = [
  'nombre',
  'apellido',
  'telefono',
  'email',
  'tipo_consulta',
  'empresa_destino',
  'etapa',
  'origen',
  'documento_tipo',
  'motivo_perdida',
  'fecha_primer_contacto',
  'fecha_conversion',
  'revisar_despues',
  'marca_motor',
  'modelo_motor',
  'observaciones',
  'proceso_incompleto',
];

function formatDisplayDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toDatetimeLocalValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildLeadPayload(draft) {
  const fields = {};
  for (const key of LEAD_FIELD_KEYS) {
    if (key === 'proceso_incompleto') {
      fields[key] = Boolean(draft.proceso_incompleto);
      continue;
    }
    const v = draft[key];
    if (v === '' || v === undefined || v === null) continue;
    if (key === 'revisar_despues' && typeof v === 'string' && v.includes('T')) {
      const t = new Date(v);
      if (!Number.isNaN(t.getTime())) fields[key] = t.toISOString();
      continue;
    }
    fields[key] = v;
  }
  return fields;
}

function emptyDraft() {
  return {
    nombre: '',
    apellido: '',
    telefono: '',
    email: '',
    tipo_consulta: '',
    empresa_destino: '',
    etapa: 'Nuevo',
    origen: '',
    documento_tipo: '',
    motivo_perdida: '',
    fecha_primer_contacto: '',
    fecha_conversion: '',
    revisar_despues: '',
    marca_motor: '',
    modelo_motor: '',
    observaciones: '',
    proceso_incompleto: false,
  };
}

function recordToDraft(record) {
  const f = record.fields || {};
  return {
    nombre: f.nombre ?? '',
    apellido: f.apellido ?? '',
    telefono: f.telefono ?? '',
    email: f.email ?? '',
    tipo_consulta: f.tipo_consulta ?? '',
    empresa_destino: f.empresa_destino ?? '',
    etapa: f.etapa ?? 'Nuevo',
    origen: f.origen ?? '',
    documento_tipo: f.documento_tipo ?? '',
    motivo_perdida: f.motivo_perdida ?? '',
    fecha_primer_contacto: f.fecha_primer_contacto ?? '',
    fecha_conversion: f.fecha_conversion ?? '',
    revisar_despues: toDatetimeLocalValue(f.revisar_despues),
    marca_motor: f.marca_motor ?? '',
    modelo_motor: f.modelo_motor ?? '',
    observaciones: f.observaciones ?? '',
    proceso_incompleto: Boolean(f.proceso_incompleto),
  };
}

export default function LeadsModule() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filtroEtapa, setFiltroEtapa] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newDraft, setNewDraft] = useState(emptyDraft());
  const [notas, setNotas] = useState([]);
  const [notasError, setNotasError] = useState(null);
  const [nuevaNota, setNuevaNota] = useState({ contenido: '', tipo: 'Observación', autor_nombre: '' });
  const [savingNota, setSavingNota] = useState(false);

  const loadLeads = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const list = await fetchAllRecords('Leads');
      list.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
      setRecords(list);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const selected = useMemo(
    () => records.find((r) => r.id === selectedId) || null,
    [records, selectedId]
  );

  useEffect(() => {
    if (!selected) {
      setDraft(emptyDraft());
      setNotas([]);
      setNotasError(null);
      return;
    }
    setDraft(recordToDraft(selected));
    let cancelled = false;
    (async () => {
      setNotasError(null);
      const rows = await fetchNotasByLead(selected.id);
      if (cancelled) return;
      if (rows === null) {
        setNotas([]);
        setNotasError(
          'No se pudieron cargar las notas. Si aún no existe el campo link, ejecutá: node scripts/airtable-schema/07-link-notas-lead.js'
        );
        return;
      }
      setNotas(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      const f = r.fields || {};
      if (filtroEtapa && f.etapa !== filtroEtapa) return false;
      if (!q) return true;
      const blob = [
        f.nombre,
        f.apellido,
        f.telefono,
        f.email,
        f.marca_motor,
        f.modelo_motor,
        f.observaciones,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return blob.includes(q);
    });
  }, [records, search, filtroEtapa]);

  const onSelectRow = (id) => {
    setSelectedId(id === selectedId ? null : id);
  };

  const onSaveLead = async () => {
    if (!selected) return;
    if (!draft.nombre?.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fields = buildLeadPayload(draft);
      await updateRecord('Leads', selected.id, fields);
      await loadLeads();
      setSelectedId(selected.id);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const onCreateLead = async () => {
    if (!newDraft.nombre?.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fields = buildLeadPayload(newDraft);
      const res = await createRecord('Leads', fields);
      setShowNewModal(false);
      setNewDraft(emptyDraft());
      await loadLeads();
      if (res?.id) setSelectedId(res.id);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const onAddNota = async () => {
    if (!selected || !nuevaNota.contenido.trim()) return;
    setSavingNota(true);
    setNotasError(null);
    try {
      const titulo = nuevaNota.contenido.trim().slice(0, 80);
      const fecha = new Date().toISOString();
      await createRecord('Notas_Leads', {
        nota: titulo,
        contenido: nuevaNota.contenido.trim(),
        tipo: nuevaNota.tipo || 'Observación',
        fecha,
        autor_nombre: nuevaNota.autor_nombre.trim() || '—',
        lead: [selected.id],
      });
      setNuevaNota({ contenido: '', tipo: 'Observación', autor_nombre: nuevaNota.autor_nombre });
      const rows = await fetchNotasByLead(selected.id);
      setNotas(rows || []);
    } catch (e) {
      setNotasError(
        e.message?.includes('UNKNOWN_FIELD_NAME') || e.message?.includes('lead')
          ? 'Falta el campo link en Notas_Leads. Ejecutá: node scripts/airtable-schema/07-link-notas-lead.js'
          : e.message || String(e)
      );
    } finally {
      setSavingNota(false);
    }
  };

  const renderSelect = (key, label, options, optional = true) => (
    <label key={key}>
      {label}
      <select
        value={draft[key] || ''}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      >
        {optional && <option value="">—</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <header className="app-header">
        <h1>CRM Modular — Módulo 1 · Leads</h1>
        <p>Listado, alta y edición contra la tabla Leads de Airtable (el token solo en el servidor: Vite en local o función en Vercel).</p>
      </header>

      <div className="layout">
        <section className="panel-list">
          {error && !loading && <div className="error-banner">{error}</div>}

          <div className="toolbar">
            <input
              type="search"
              placeholder="Buscar por nombre, teléfono, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar leads"
            />
            <select
              value={filtroEtapa}
              onChange={(e) => setFiltroEtapa(e.target.value)}
              aria-label="Filtrar por etapa"
            >
              <option value="">Todas las etapas</option>
              {ETAPAS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setShowNewModal(true)}>
              Nuevo lead
            </button>
            <button type="button" className="secondary" onClick={loadLeads} disabled={loading}>
              Actualizar
            </button>
          </div>

          {loading ? (
            <div className="loading">Cargando leads…</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">No hay leads que coincidan con los filtros.</div>
          ) : (
            <table className="leads-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Etapa</th>
                  <th>Origen</th>
                  <th>Teléfono</th>
                  <th>Creado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const f = r.fields || {};
                  const st = etapaBadgeStyle(f.etapa);
                  return (
                    <tr
                      key={r.id}
                      className={r.id === selectedId ? 'selected' : ''}
                      onClick={() => onSelectRow(r.id)}
                    >
                      <td>
                        <strong>{[f.nombre, f.apellido].filter(Boolean).join(' ') || '—'}</strong>
                      </td>
                      <td>
                        {f.etapa ? (
                          <span className="badge" style={{ background: st.bg, color: st.color }}>
                            {f.etapa}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{f.origen || '—'}</td>
                      <td>{f.telefono || '—'}</td>
                      <td>{formatDisplayDate(r.createdTime)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <aside className="panel-detail">
          {!selected ? (
            <div className="empty-state">Seleccioná un lead para ver y editar los datos.</div>
          ) : (
            <>
              <h2>Editar lead</h2>
              <div className="form-grid">
                <label>
                  Nombre *
                  <input
                    value={draft.nombre}
                    onChange={(e) => setDraft((d) => ({ ...d, nombre: e.target.value }))}
                  />
                </label>
                <label>
                  Apellido
                  <input
                    value={draft.apellido}
                    onChange={(e) => setDraft((d) => ({ ...d, apellido: e.target.value }))}
                  />
                </label>
                <label>
                  Teléfono
                  <input
                    value={draft.telefono}
                    onChange={(e) => setDraft((d) => ({ ...d, telefono: e.target.value }))}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={draft.email}
                    onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                  />
                </label>
                {renderSelect('tipo_consulta', 'Tipo de consulta', TIPOS_CONSULTA)}
                {renderSelect('empresa_destino', 'Empresa destino', EMPRESAS)}
                {renderSelect('etapa', 'Etapa', ETAPAS, false)}
                {renderSelect('origen', 'Origen', ORIGENES)}
                {renderSelect('documento_tipo', 'Documento tipo', DOCUMENTO_TIPO)}
                <label>
                  Motivo pérdida
                  <input
                    value={draft.motivo_perdida}
                    onChange={(e) => setDraft((d) => ({ ...d, motivo_perdida: e.target.value }))}
                  />
                </label>
                <label>
                  Fecha primer contacto
                  <input
                    type="date"
                    value={draft.fecha_primer_contacto || ''}
                    onChange={(e) => setDraft((d) => ({ ...d, fecha_primer_contacto: e.target.value }))}
                  />
                </label>
                <label>
                  Fecha conversión
                  <input
                    type="date"
                    value={draft.fecha_conversion || ''}
                    onChange={(e) => setDraft((d) => ({ ...d, fecha_conversion: e.target.value }))}
                  />
                </label>
                <label>
                  Revisar después
                  <input
                    type="datetime-local"
                    value={draft.revisar_despues || ''}
                    onChange={(e) => setDraft((d) => ({ ...d, revisar_despues: e.target.value }))}
                  />
                </label>
                <label>
                  Marca motor
                  <input
                    value={draft.marca_motor}
                    onChange={(e) => setDraft((d) => ({ ...d, marca_motor: e.target.value }))}
                  />
                </label>
                <label>
                  Modelo motor
                  <input
                    value={draft.modelo_motor}
                    onChange={(e) => setDraft((d) => ({ ...d, modelo_motor: e.target.value }))}
                  />
                </label>
                <label>
                  Observaciones
                  <textarea
                    value={draft.observaciones}
                    onChange={(e) => setDraft((d) => ({ ...d, observaciones: e.target.value }))}
                  />
                </label>
                <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={draft.proceso_incompleto}
                    onChange={(e) => setDraft((d) => ({ ...d, proceso_incompleto: e.target.checked }))}
                  />
                  Proceso incompleto
                </label>
              </div>
              <div className="form-actions">
                <button type="button" onClick={onSaveLead} disabled={saving}>
                  {saving ? 'Guardando…' : 'Guardar cambios'}
                </button>
                <button type="button" className="secondary" onClick={() => setDraft(recordToDraft(selected))}>
                  Descartar
                </button>
              </div>

              <div className="notes-section">
                <h3>Notas</h3>
                {notasError && <div className="error-banner">{notasError}</div>}
                {notas.length === 0 && !notasError ? (
                  <p className="empty-state" style={{ padding: '0.5rem 0' }}>
                    Sin notas para este lead.
                  </p>
                ) : (
                  notas.map((n) => {
                    const f = n.fields || {};
                    return (
                      <div key={n.id} className="note-item">
                        <div className="meta">
                          {formatDisplayDate(f.fecha)} · {f.tipo || '—'} · {f.autor_nombre || '—'}
                        </div>
                        <div>{f.contenido || f.nota || '—'}</div>
                      </div>
                    );
                  })
                )}
                <div className="form-grid" style={{ marginTop: '1rem' }}>
                  <label>
                    Nueva nota
                    <textarea
                      value={nuevaNota.contenido}
                      onChange={(e) => setNuevaNota((n) => ({ ...n, contenido: e.target.value }))}
                      placeholder="Texto de la nota…"
                    />
                  </label>
                  <label>
                    Tipo
                    <select
                      value={nuevaNota.tipo}
                      onChange={(e) => setNuevaNota((n) => ({ ...n, tipo: e.target.value }))}
                    >
                      {NOTA_TIPOS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Autor (texto libre)
                    <input
                      value={nuevaNota.autor_nombre}
                      onChange={(e) => setNuevaNota((n) => ({ ...n, autor_nombre: e.target.value }))}
                    />
                  </label>
                </div>
                <div className="form-actions">
                  <button type="button" onClick={onAddNota} disabled={savingNota || !nuevaNota.contenido.trim()}>
                    {savingNota ? 'Guardando…' : 'Agregar nota'}
                  </button>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      {showNewModal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => e.target === e.currentTarget && setShowNewModal(false)}
        >
          <div className="modal">
            <h2>Nuevo lead</h2>
            <div className="form-grid">
              <label>
                Nombre *
                <input
                  value={newDraft.nombre}
                  onChange={(e) => setNewDraft((d) => ({ ...d, nombre: e.target.value }))}
                />
              </label>
              <label>
                Apellido
                <input
                  value={newDraft.apellido}
                  onChange={(e) => setNewDraft((d) => ({ ...d, apellido: e.target.value }))}
                />
              </label>
              <label>
                Teléfono
                <input
                  value={newDraft.telefono}
                  onChange={(e) => setNewDraft((d) => ({ ...d, telefono: e.target.value }))}
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={newDraft.email}
                  onChange={(e) => setNewDraft((d) => ({ ...d, email: e.target.value }))}
                />
              </label>
              <label>
                Etapa
                <select
                  value={newDraft.etapa}
                  onChange={(e) => setNewDraft((d) => ({ ...d, etapa: e.target.value }))}
                >
                  {ETAPAS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Origen
                <select
                  value={newDraft.origen}
                  onChange={(e) => setNewDraft((d) => ({ ...d, origen: e.target.value }))}
                >
                  <option value="">—</option>
                  {ORIGENES.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-actions">
              <button type="button" onClick={onCreateLead} disabled={saving}>
                {saving ? 'Creando…' : 'Crear lead'}
              </button>
              <button type="button" className="secondary" onClick={() => setShowNewModal(false)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
