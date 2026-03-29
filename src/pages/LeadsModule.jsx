import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchAllRecords,
  createRecord,
  updateRecord,
  fetchNotasByLead,
  appendNotaLead,
  leadEtapaAssignPatch,
  leadInteractionTouchPatch,
  especialistaIdsForPatch,
  AIRTABLE_LEADS_TABLE_API,
  AIRTABLE_TABLE_NOTAS_LEADS,
  AIRTABLE_NOTAS_LINK_FIELD,
  ESPECIALISTA_RECORD_ID,
  LEAD_FIELD_PRESUPUESTO_VENTA,
  checkClienteDuplicado,
  createClienteFromLead,
  createOrdenTrabajoStub,
  createPresupuestoVentaStub,
  patchLeadConversionComplete,
  patchLeadGanadoIncompleto,
} from '../services/airtable';
import {
  recordMatchesInboxView,
  buildEndOfToday,
  revisarDespuesValue,
} from '../utils/leadsInbox';
import {
  followUpKindFromLeadFields,
  leadConversionIncomplete,
  conversionIncompleteLabel,
  ganadoKanbanBadge,
} from '../utils/leadConversion';
import {
  ETAPAS,
  TIPOS_CONSULTA,
  EMPRESAS,
  ORIGENES,
  DOCUMENTO_TIPO,
  NOTA_TIPOS,
  etapaBadgeStyle,
  normalizeLeadEtapa,
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
  'revisar_despues_de',
  'marca_motor',
  'modelo_motor',
  'observaciones',
  'proceso_incompleto',
  'nota_inicial',
];

const MOTIVOS_PERDIDA_RAPIDOS = [
  'No hubo respuesta',
  'Eligió otro proveedor',
  'Precio',
  'No es prioridad ahora',
  'No encaja con la necesidad',
  'Otro',
];

const INBOX_TABS = [
  { id: 'mi-inbox', label: 'Mi Inbox (HOY)' },
  { id: 'mis-leads', label: 'Mis leads' },
  { id: 'historicos', label: 'Históricos' },
  { id: 'pospuestos', label: 'Pospuestos' },
  { id: 'sin-tratar-24', label: 'Sin tratar 24h+' },
];

/** Horas desde `ultimo_contacto` o creación del registro. */
function horasDesdeUltimaAccion(record) {
  const f = record.fields || {};
  const last = f.ultimo_contacto || record.createdTime;
  if (!last) return null;
  return (Date.now() - new Date(last).getTime()) / (3600 * 1000);
}

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
    if (key === 'revisar_despues_de' && typeof v === 'string' && v.includes('T')) {
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
    revisar_despues_de: '',
    marca_motor: '',
    modelo_motor: '',
    observaciones: '',
    proceso_incompleto: false,
    nota_inicial: '',
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
    etapa: normalizeLeadEtapa(f.etapa),
    origen: f.origen ?? '',
    documento_tipo: f.documento_tipo ?? '',
    motivo_perdida: f.motivo_perdida ?? '',
    fecha_primer_contacto: f.fecha_primer_contacto ?? '',
    fecha_conversion: f.fecha_conversion ?? '',
    revisar_despues_de: toDatetimeLocalValue(revisarDespuesValue(f)),
    marca_motor: f.marca_motor ?? '',
    modelo_motor: f.modelo_motor ?? '',
    observaciones: f.observaciones ?? '',
    proceso_incompleto: Boolean(f.proceso_incompleto),
    nota_inicial: f.nota_inicial ?? '',
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
  const INBOX_STORAGE = 'crm-modular-leads-inbox';
  const [inboxView, setInboxView] = useState(() => {
    try {
      const v = localStorage.getItem(INBOX_STORAGE);
      if (['mi-inbox', 'mis-leads', 'historicos', 'pospuestos', 'sin-tratar-24'].includes(v)) {
        return v;
      }
    } catch {
      /* */
    }
    return 'mi-inbox';
  });
  const [posponerHoras, setPosponerHoras] = useState(24);
  /** @type {'table' | 'kanban'} */
  const VIEW_STORAGE = 'crm-modular-leads-ui-v2';
  const [listViewMode, setListViewMode] = useState(() => {
    try {
      const v = localStorage.getItem(VIEW_STORAGE);
      if (v === 'table' || v === 'kanban') return v;
    } catch {
      /* */
    }
    return 'kanban';
  });
  const [draggingLeadId, setDraggingLeadId] = useState(null);
  /** @type {{ leadId: string; nombre: string; etapaPrev: string; etapaNueva: string } | null} */
  const [etapaModal, setEtapaModal] = useState(null);
  const [notaEtapaTexto, setNotaEtapaTexto] = useState('');
  const [motivoPerdidaKanban, setMotivoPerdidaKanban] = useState('');
  const [savingEtapa, setSavingEtapa] = useState(false);
  /** @type {{ leadId: string; nombre: string; notaTexto: string } | null} */
  const [ganadoFlow, setGanadoFlow] = useState(null);
  const [ganadoCuit, setGanadoCuit] = useState('');
  const [ganadoDup, setGanadoDup] = useState(null);
  /** @type {'ot' | 'presupuesto'} */
  const [ganadoKindChoice, setGanadoKindChoice] = useState('ot');
  const [ganadoBusy, setGanadoBusy] = useState(false);
  const [ganadoErr, setGanadoErr] = useState(null);
  const [ganadoSearched, setGanadoSearched] = useState(false);
  /** @type {{ leadId: string; nombre: string } | null} */
  const [posponerModal, setPosponerModal] = useState(null);
  const [posponerMotivo, setPosponerMotivo] = useState('');
  const [savingPosponer, setSavingPosponer] = useState(false);
  /** Columna sobre la que pasás al arrastrar (feedback visual). */
  const [dragOverEtapa, setDragOverEtapa] = useState(null);

  const loadLeads = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const list = await fetchAllRecords(AIRTABLE_LEADS_TABLE_API);
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
          'No se pudieron cargar las notas. Verificá en Airtable el nombre exacto del link a Leads y en .env / Vercel: VITE_AIRTABLE_NOTAS_LINK_FIELD (ej. lead o leads).'
        );
        return;
      }
      setNotas(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const endToday = useMemo(() => buildEndOfToday(), [records]);

  const inboxFiltered = useMemo(
    () =>
      records.filter((r) =>
        recordMatchesInboxView(
          r,
          inboxView,
          ESPECIALISTA_RECORD_ID,
          endToday,
          LEAD_FIELD_PRESUPUESTO_VENTA
        )
      ),
    [records, inboxView, endToday]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inboxFiltered.filter((r) => {
      const f = r.fields || {};
      if (filtroEtapa && normalizeLeadEtapa(f.etapa) !== filtroEtapa) return false;
      if (!q) return true;
      const blob = [
        f.nombre,
        f.apellido,
        f.telefono,
        f.email,
        f.marca_motor,
        f.modelo_motor,
        f.observaciones,
        f.nota_inicial,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return blob.includes(q);
    });
  }, [inboxFiltered, search, filtroEtapa]);

  const leadsByEtapa = useMemo(() => {
    const map = Object.fromEntries(ETAPAS.map((e) => [e, []]));
    for (const r of filtered) {
      const f = r.fields || {};
      const et = normalizeLeadEtapa(f.etapa);
      if (!map[et]) map[et] = [];
      map[et].push(r);
    }
    for (const e of ETAPAS) {
      map[e].sort((a, b) => {
        const ta = new Date(a.createdTime || 0).getTime();
        const tb = new Date(b.createdTime || 0).getTime();
        return ta - tb;
      });
    }
    return map;
  }, [filtered]);

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
      const esp = especialistaIdsForPatch();
      if (esp) {
        fields.modificado_por_app = esp;
        fields.fecha_modificacion_app = new Date().toISOString();
      }
      await updateRecord(AIRTABLE_LEADS_TABLE_API, selected.id, fields);
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
      const esp = especialistaIdsForPatch();
      if (esp) {
        fields.creado_por = esp;
        fields.modificado_por_app = esp;
        fields.vendedor = esp;
        fields.fecha_modificacion_app = new Date().toISOString();
      }
      const res = await createRecord(AIRTABLE_LEADS_TABLE_API, fields);
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
      const hadRevisar = !!(
        selected.fields &&
        (selected.fields.revisar_despues_de || selected.fields.revisar_despues)
      );
      const titulo = nuevaNota.contenido.trim().slice(0, 80);
      const fecha = new Date().toISOString();
      await createRecord(AIRTABLE_TABLE_NOTAS_LEADS, {
        nota: titulo,
        contenido: nuevaNota.contenido.trim(),
        tipo: nuevaNota.tipo || 'Observación',
        fecha,
        autor_nombre: nuevaNota.autor_nombre.trim() || '—',
        [AIRTABLE_NOTAS_LINK_FIELD]: [selected.id],
      });
      const touchPatch = { ...leadInteractionTouchPatch() };
      if (hadRevisar) touchPatch.revisar_despues_de = null;
      await updateRecord(AIRTABLE_LEADS_TABLE_API, selected.id, touchPatch);
      setNuevaNota({ contenido: '', tipo: 'Observación', autor_nombre: nuevaNota.autor_nombre });
      const rows = await fetchNotasByLead(selected.id);
      setNotas(rows || []);
      await loadLeads();
    } catch (e) {
      setNotasError(
        e.message?.includes('UNKNOWN_FIELD_NAME') || /field/i.test(e.message || '')
          ? `El nombre del campo link no coincide con Airtable. Configurá VITE_AIRTABLE_NOTAS_LINK_FIELD con el nombre exacto de la columna (ej. lead o leads).`
          : e.message || String(e)
      );
    } finally {
      setSavingNota(false);
    }
  };

  function leadDisplayName(r) {
    const f = r.fields || {};
    return [f.nombre, f.apellido].filter(Boolean).join(' ') || 'Sin nombre';
  }

  function handleKanbanDragStart(e, r) {
    const f = r.fields || {};
    const et = normalizeLeadEtapa(f.etapa);
    setDraggingLeadId(r.id);
    const payload = JSON.stringify({ leadId: r.id, etapa: et });
    e.dataTransfer.setData('application/json', payload);
    e.dataTransfer.setData('text/plain', r.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleKanbanDragEnd() {
    setDraggingLeadId(null);
    setDragOverEtapa(null);
  }

  function handleKanbanDragOver(e, etapaColumna) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverEtapa(etapaColumna);
  }

  function handleKanbanDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverEtapa(null);
    }
  }

  function handleKanbanDrop(e, etapaColumna) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverEtapa(null);
    let leadId = '';
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (raw) {
        const j = JSON.parse(raw);
        if (j.leadId) leadId = j.leadId;
      }
    } catch {
      /* */
    }
    if (!leadId) {
      leadId = (e.dataTransfer.getData('text/plain') || '').trim();
    }
    if (!leadId) return;
    const r = records.find((x) => x.id === leadId);
    if (!r) return;
    const f = r.fields || {};
    const etapaPrev = normalizeLeadEtapa(f.etapa);
    if (etapaPrev === etapaColumna) return;
    setEtapaModal({
      leadId: r.id,
      nombre: leadDisplayName(r),
      etapaPrev,
      etapaNueva: etapaColumna,
    });
    setNotaEtapaTexto('');
    setMotivoPerdidaKanban('');
  }

  const ganadoRecord = useMemo(
    () => (ganadoFlow ? records.find((r) => r.id === ganadoFlow.leadId) : null),
    [ganadoFlow, records]
  );

  const ganadoKindResolved = useMemo(() => {
    if (!ganadoRecord) return 'ot';
    const k = followUpKindFromLeadFields(ganadoRecord.fields || {});
    if (k === 'choose') return ganadoKindChoice;
    return k;
  }, [ganadoRecord, ganadoKindChoice]);

  async function buscarDupGanado() {
    if (!ganadoRecord) return;
    setGanadoErr(null);
    setGanadoSearched(true);
    const f = ganadoRecord.fields || {};
    try {
      const dup = await checkClienteDuplicado({
        telefono: f.telefono,
        cuit: ganadoCuit,
      });
      setGanadoDup(dup);
    } catch (e) {
      setGanadoErr(e.message || String(e));
    }
  }

  async function ejecutarConversionGanado() {
    if (!ganadoFlow || !ganadoRecord) return;
    const { leadId, notaTexto } = ganadoFlow;
    const f = ganadoRecord.fields || {};
    const tel = String(f.telefono || '').trim();
    const cuitTrim = ganadoCuit.trim();
    if (!tel && !cuitTrim) {
      setGanadoErr('Completá el teléfono en el lead o ingresá CUIT/DNI para identificar el cliente.');
      return;
    }
    setGanadoBusy(true);
    setGanadoErr(null);
    let clienteId = ganadoDup?.id || null;
    const kind = ganadoKindResolved;
    try {
      if (!clienteId) {
        clienteId = await createClienteFromLead({
          nombre: f.nombre,
          apellido: f.apellido,
          telefono: tel,
          cuit: cuitTrim || undefined,
        });
        if (!clienteId) throw new Error('No se obtuvo el ID del cliente creado.');
      }
      let followId =
        kind === 'ot'
          ? await createOrdenTrabajoStub(clienteId)
          : await createPresupuestoVentaStub(clienteId);
      if (!followId) throw new Error('No se pudo crear la OT ni el presupuesto (revisá tablas y campos en Airtable).');
      const tipoSeg = kind === 'ot' ? 'OT' : 'Presupuesto de venta';
      await appendNotaLead(leadId, {
        contenido: `Cambio a Ganado: ${notaTexto}. ${tipoSeg} generado (${followId}). Cliente vinculado.`,
        tipo: 'Observación',
        autor_nombre: nuevaNota.autor_nombre?.trim() || '—',
      });
      await patchLeadConversionComplete(leadId, {
        clienteId,
        followRecordId: followId,
        kind,
      });
      setGanadoFlow(null);
      setGanadoDup(null);
      setGanadoCuit('');
      setGanadoSearched(false);
      await loadLeads();
      if (selectedId === leadId) {
        setDraft((d) => ({ ...d, etapa: 'Ganado', proceso_incompleto: false }));
      }
    } catch (e) {
      const msg = e.message || String(e);
      setGanadoErr(msg);
      try {
        await patchLeadGanadoIncompleto(leadId, clienteId ? { clienteId } : {});
        await appendNotaLead(leadId, {
          contenido: `Intento de conversión a Ganado (incompleto): ${msg}`,
          tipo: 'Observación',
          autor_nombre: nuevaNota.autor_nombre?.trim() || '—',
        });
      } catch {
        /* */
      }
      await loadLeads();
    } finally {
      setGanadoBusy(false);
    }
  }

  async function confirmCambioEtapaKanban() {
    if (!etapaModal) return;
    const { leadId, etapaNueva } = etapaModal;
    if (etapaNueva === 'Ganado') {
      if (!notaEtapaTexto.trim()) {
        setError('La nota es obligatoria para registrar el cambio de etapa.');
        return;
      }
      setError(null);
      const rec = records.find((x) => x.id === leadId);
      const k = followUpKindFromLeadFields(rec?.fields || {});
      setGanadoKindChoice(k === 'presupuesto' ? 'presupuesto' : 'ot');
      setGanadoFlow({
        leadId,
        nombre: etapaModal.nombre,
        notaTexto: notaEtapaTexto.trim(),
      });
      setGanadoDup(null);
      setGanadoCuit('');
      setGanadoErr(null);
      setGanadoSearched(false);
      setEtapaModal(null);
      setNotaEtapaTexto('');
      setMotivoPerdidaKanban('');
      return;
    }
    if (etapaNueva === 'Perdido') {
      if (!motivoPerdidaKanban.trim()) {
        setError('Elegí o escribí un motivo de pérdida.');
        return;
      }
    } else if (!notaEtapaTexto.trim()) {
      setError('La nota es obligatoria para registrar el cambio de etapa.');
      return;
    }
    setSavingEtapa(true);
    setError(null);
    try {
      const notaCompleto =
        etapaNueva === 'Perdido'
          ? `Cambio a ${etapaNueva}. Motivo: ${motivoPerdidaKanban.trim()}.${notaEtapaTexto.trim() ? ` Notas: ${notaEtapaTexto.trim()}` : ''}`
          : `Cambio a ${etapaNueva}: ${notaEtapaTexto.trim()}`;
      await appendNotaLead(leadId, {
        contenido: notaCompleto,
        tipo: 'Observación',
        autor_nombre: nuevaNota.autor_nombre?.trim() || '—',
      });
      const patch = {
        etapa: etapaNueva,
        ...leadInteractionTouchPatch(),
        ...leadEtapaAssignPatch(etapaNueva),
      };
      if (etapaNueva === 'Perdido') patch.motivo_perdida = motivoPerdidaKanban.trim();
      if (etapaNueva === 'Perdido') patch.revisar_despues_de = null;
      await updateRecord(AIRTABLE_LEADS_TABLE_API, leadId, patch);
      setEtapaModal(null);
      setNotaEtapaTexto('');
      setMotivoPerdidaKanban('');
      await loadLeads();
      if (selectedId === leadId) {
        setDraft((d) => ({ ...d, etapa: etapaNueva, motivo_perdida: patch.motivo_perdida ?? d.motivo_perdida }));
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSavingEtapa(false);
    }
  }

  async function confirmPosponer() {
    if (!posponerModal || !posponerMotivo.trim()) return;
    const horas = posponerHoras === 48 ? 48 : 24;
    setSavingPosponer(true);
    setError(null);
    try {
      const { leadId } = posponerModal;
      const until = new Date();
      until.setHours(until.getHours() + horas);
      await appendNotaLead(leadId, {
        contenido: `Pospuesto ${horas}h: ${posponerMotivo.trim()}`,
        tipo: 'Observación',
        autor_nombre: nuevaNota.autor_nombre?.trim() || '—',
      });
      await updateRecord(AIRTABLE_LEADS_TABLE_API, leadId, {
        revisar_despues_de: until.toISOString(),
        ...leadInteractionTouchPatch(),
      });
      setPosponerModal(null);
      setPosponerMotivo('');
      setPosponerHoras(24);
      await loadLeads();
      if (selectedId === leadId) {
        setDraft((d) => ({ ...d, revisar_despues_de: toDatetimeLocalValue(until.toISOString()) }));
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSavingPosponer(false);
    }
  }

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
        <p>
          Bandejas (Mi Inbox, Mis leads, Históricos, Pospuestos, Sin tratar 24h+) y tablero por etapa. Proceso:{' '}
          <code>docs/leads-proceso.md</code>. Panel derecho: edición y notas.
        </p>
      </header>

      <div className="layout">
        <section className="panel-list">
          {error && !loading && <div className="error-banner">{error}</div>}

          <div className="toolbar">
            <div className="toolbar-segment" role="group" aria-label="Bandeja">
              {INBOX_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={inboxView === tab.id ? 'active' : ''}
                  onClick={() => {
                    setInboxView(tab.id);
                    try {
                      localStorage.setItem(INBOX_STORAGE, tab.id);
                    } catch {
                      /* */
                    }
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {!ESPECIALISTA_RECORD_ID && (
              <p className="toolbar-hint" style={{ margin: 0, fontSize: '0.85rem', opacity: 0.85 }}>
                Opcional: <code>VITE_ESPECIALISTA_RECORD_ID</code> para filtrar «mis» leads por vendedor.
              </p>
            )}
            <div className="toolbar-segment" role="group" aria-label="Vista">
              <button
                type="button"
                className={`${listViewMode === 'kanban' ? 'active' : ''} ${listViewMode === 'table' ? 'kanban-pick-me' : ''}`}
                onClick={() => {
                  setListViewMode('kanban');
                  try {
                    localStorage.setItem(VIEW_STORAGE, 'kanban');
                  } catch {
                    /* */
                  }
                }}
              >
                Kanban
              </button>
              <button
                type="button"
                className={listViewMode === 'table' ? 'active' : ''}
                onClick={() => {
                  setListViewMode('table');
                  try {
                    localStorage.setItem(VIEW_STORAGE, 'table');
                  } catch {
                    /* */
                  }
                }}
              >
                Lista
              </button>
            </div>
            <input
              type="search"
              placeholder="Buscar por nombre, teléfono, nota…"
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
          ) : listViewMode === 'kanban' ? (
            records.length === 0 ? (
              <div className="empty-state">
                No hay leads cargados. Usá «Nuevo lead» o «Actualizar» tras crear datos en Airtable.
              </div>
            ) : inboxFiltered.length === 0 ? (
              <div className="empty-state">
                No hay leads en esta bandeja. Probá otra pestaña (arriba) o limpiá la búsqueda y el filtro de etapa.
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty-state">Ningún lead coincide con la búsqueda o el filtro de etapa.</div>
            ) : (
            <div className="kanban-board">
              {ETAPAS.map((etapa) => {
                const col = leadsByEtapa[etapa] || [];
                const st = etapaBadgeStyle(etapa);
                return (
                  <div
                    key={etapa}
                    className={`kanban-column ${dragOverEtapa === etapa ? 'kanban-column-over' : ''}`}
                    onDragOver={(e) => handleKanbanDragOver(e, etapa)}
                    onDragLeave={handleKanbanDragLeave}
                    onDrop={(e) => handleKanbanDrop(e, etapa)}
                    style={{ borderColor: st.color || 'var(--border)' }}
                  >
                    <div className="kanban-column-header" style={{ color: st.color, borderBottomColor: st.color }}>
                      <span>{etapa}</span>
                      <span className="count">{col.length}</span>
                    </div>
                    <div className="kanban-cards">
                      {col.map((r) => {
                        const f = r.fields || {};
                        const revIso = revisarDespuesValue(f);
                        const rev = revIso ? new Date(revIso).getTime() : 0;
                        const pospuesto = rev > Date.now();
                        const etCard = normalizeLeadEtapa(f.etapa);
                        const hAcc = horasDesdeUltimaAccion(r);
                        const alertaHoras =
                          (etCard === 'Contactado' || etCard === 'En gestión') &&
                          !pospuesto &&
                          hAcc != null &&
                          hAcc >= 24;
                        const badgeGanado = ganadoKanbanBadge(f, LEAD_FIELD_PRESUPUESTO_VENTA);
                        return (
                          <div key={r.id} style={{ position: 'relative' }}>
                            {/* div draggable: los <button draggable> suelen no arrastrar bien (como en el CRM viejo). */}
                            <div
                              role="button"
                              tabIndex={0}
                              draggable
                              className={`kanban-card ${r.id === selectedId ? 'selected' : ''} ${draggingLeadId === r.id ? 'dragging' : ''} ${badgeGanado ? 'kanban-card-ganado-alert' : ''}`}
                              onDragStart={(e) => handleKanbanDragStart(e, r)}
                              onDragEnd={handleKanbanDragEnd}
                              onClick={() => onSelectRow(r.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  onSelectRow(r.id);
                                }
                              }}
                            >
                              <div className="kanban-card-title-row">
                                <h4>{leadDisplayName(r)}</h4>
                                {badgeGanado && (
                                  <span className="kanban-card-badge-incomplete" title="Conversión Ganado incompleta o a revisar">
                                    {badgeGanado}
                                  </span>
                                )}
                              </div>
                              {f.nota_inicial && (
                                <p className="kanban-card-meta kanban-card-snippet">{f.nota_inicial}</p>
                              )}
                              {f.telefono && <p className="kanban-card-meta">Tel. {f.telefono}</p>}
                              {f.origen && <p className="kanban-card-meta">Origen: {f.origen}</p>}
                              {alertaHoras && (
                                <p className="kanban-card-meta" style={{ color: '#f87171' }}>
                                  +{Math.floor(hAcc)}h/sin acciones
                                </p>
                              )}
                              {pospuesto && (
                                <p className="kanban-card-meta" style={{ color: '#fbbf24' }}>
                                  Revisar {formatDisplayDate(revIso)}
                                </p>
                              )}
                              <p className="kanban-card-meta">Creado {formatDisplayDate(r.createdTime)}</p>
                            </div>
                            <div className="kanban-card-actions">
                              {(etCard === 'Contactado' || etCard === 'En gestión') && (
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPosponerHoras(24);
                                    setPosponerModal({ leadId: r.id, nombre: leadDisplayName(r) });
                                    setPosponerMotivo('');
                                  }}
                                >
                                  Posponer
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            )
          ) : records.length === 0 ? (
            <div className="empty-state">
              No hay leads cargados. Usá «Nuevo lead» o «Actualizar» tras crear datos en Airtable.
            </div>
          ) : inboxFiltered.length === 0 ? (
            <div className="empty-state">
              No hay leads en esta bandeja. Probá otra pestaña o limpiá la búsqueda y el filtro de etapa.
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">Ningún lead coincide con la búsqueda o el filtro de etapa.</div>
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
                  const et = normalizeLeadEtapa(f.etapa);
                  const st = etapaBadgeStyle(et);
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
                        {et ? (
                          <span className="badge" style={{ background: st.bg, color: st.color }}>
                            {et}
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
              {normalizeLeadEtapa(selected.fields?.etapa) === 'Ganado' &&
                (selected.fields?.proceso_incompleto === true ||
                  leadConversionIncomplete(selected.fields || {}, LEAD_FIELD_PRESUPUESTO_VENTA)) && (
                  <div
                    className="error-banner"
                    role="alert"
                    style={{
                      marginBottom: '1rem',
                      fontWeight: 800,
                      fontSize: '0.75rem',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {conversionIncompleteLabel(followUpKindFromLeadFields(selected.fields || {}))}
                  </div>
                )}
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
                    value={draft.revisar_despues_de || ''}
                    onChange={(e) => setDraft((d) => ({ ...d, revisar_despues_de: e.target.value }))}
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
                <label>
                  Nota inicial (ingreso)
                  <textarea
                    value={draft.nota_inicial}
                    onChange={(e) => setDraft((d) => ({ ...d, nota_inicial: e.target.value }))}
                    placeholder="Contexto del primer contacto o captura del formulario…"
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

      {etapaModal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => e.target === e.currentTarget && !savingEtapa && setEtapaModal(null)}
        >
          <div className="modal" role="dialog" aria-labelledby="etapa-modal-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="etapa-modal-title">Cambio a {etapaModal.etapaNueva}</h2>
            <p className="hint">
              <strong>{etapaModal.nombre}</strong> pasa de «{etapaModal.etapaPrev}» a «{etapaModal.etapaNueva}». Quedará registrado en Notas_Leads.
            </p>
            {etapaModal.etapaNueva === 'Perdido' ? (
              <>
                <p className="hint" style={{ color: 'var(--text)', fontWeight: 600 }}>
                  Motivo de pérdida (obligatorio)
                </p>
                <div className="chip-row">
                  {MOTIVOS_PERDIDA_RAPIDOS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={motivoPerdidaKanban === m ? 'active' : ''}
                      onClick={() => setMotivoPerdidaKanban(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <label>
                  Detalle u otro motivo
                  <input
                    value={motivoPerdidaKanban}
                    onChange={(e) => setMotivoPerdidaKanban(e.target.value)}
                    placeholder="Completá o editá el motivo…"
                    style={{ width: '100%', marginTop: '0.35rem' }}
                  />
                </label>
                <label>
                  Notas adicionales (opcional)
                  <textarea
                    value={notaEtapaTexto}
                    onChange={(e) => setNotaEtapaTexto(e.target.value)}
                    rows={3}
                    placeholder="Aclaraciones…"
                    style={{ width: '100%', marginTop: '0.35rem' }}
                  />
                </label>
              </>
            ) : (
              <>
                {etapaModal.etapaNueva === 'Ganado' && (
                  <p className="hint" style={{ marginBottom: '0.75rem' }}>
                    Después de esta nota se abrirá el asistente: <strong>cliente</strong> (sin duplicar por teléfono o
                    CUIT/DNI) y registro de <strong>OT</strong> (taller) o <strong>presupuesto de venta</strong>{' '}
                    (mecánica pesada), según tipo de consulta / documento.
                  </p>
                )}
                <label>
                  Nota del cambio (obligatorio)
                  <textarea
                    value={notaEtapaTexto}
                    onChange={(e) => setNotaEtapaTexto(e.target.value)}
                    rows={4}
                    placeholder={
                      etapaModal.etapaNueva === 'Ganado'
                        ? 'Ej. cliente aceptó avanzar; en el siguiente paso vincularemos cliente y OT o presupuesto…'
                        : 'Ej. llamé, acordamos enviar presupuesto…'
                    }
                    autoFocus
                    style={{ width: '100%', marginTop: '0.35rem' }}
                  />
                </label>
              </>
            )}
            <div className="form-actions">
              <button type="button" className="secondary" disabled={savingEtapa} onClick={() => setEtapaModal(null)}>
                Cancelar
              </button>
              <button
                type="button"
                disabled={
                  savingEtapa ||
                  (etapaModal.etapaNueva === 'Perdido' ? !motivoPerdidaKanban.trim() : !notaEtapaTexto.trim())
                }
                onClick={confirmCambioEtapaKanban}
              >
                {savingEtapa ? 'Guardando…' : etapaModal.etapaNueva === 'Ganado' ? 'Continuar' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {ganadoFlow && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !ganadoBusy) {
              setGanadoFlow(null);
              setGanadoDup(null);
              setGanadoCuit('');
              setGanadoErr(null);
              setGanadoSearched(false);
            }
          }}
        >
          <div className="modal" role="dialog" aria-labelledby="ganado-modal-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="ganado-modal-title">Conversión a Ganado</h2>
            {!ganadoRecord ? (
              <p className="hint">
                No se encontró el lead en la lista actual.{' '}
                <button type="button" onClick={() => setGanadoFlow(null)}>
                  Cerrar
                </button>
              </p>
            ) : (
              <>
                <p className="hint">
                  <strong>{ganadoFlow.nombre}</strong> — el lead pasará a <strong>Ganado</strong> al finalizar. La nota
                  quedará: «{ganadoFlow.notaTexto}»
                </p>
                {followUpKindFromLeadFields(ganadoRecord.fields || {}) === 'choose' && (
                  <div className="toolbar-segment" role="group" aria-label="Tipo de salida" style={{ marginBottom: '0.75rem' }}>
                    <button
                      type="button"
                      className={ganadoKindChoice === 'ot' ? 'active' : ''}
                      onClick={() => setGanadoKindChoice('ot')}
                    >
                      Orden de trabajo (taller / MP)
                    </button>
                    <button
                      type="button"
                      className={ganadoKindChoice === 'presupuesto' ? 'active' : ''}
                      onClick={() => setGanadoKindChoice('presupuesto')}
                    >
                      Presupuesto venta (mecánica pesada)
                    </button>
                  </div>
                )}
                {followUpKindFromLeadFields(ganadoRecord.fields || {}) !== 'choose' && (
                  <p className="hint" style={{ marginBottom: '0.75rem' }}>
                    Según el lead se generará:{' '}
                    <strong>{ganadoKindResolved === 'ot' ? 'Orden de trabajo' : 'Presupuesto de venta'}</strong>.
                  </p>
                )}
                <label>
                  CUIT / DNI (opcional, refuerza anti-duplicado)
                  <input
                    value={ganadoCuit}
                    onChange={(e) => setGanadoCuit(e.target.value)}
                    placeholder="Sin guiones"
                    style={{ width: '100%', marginTop: '0.35rem' }}
                  />
                </label>
                <div style={{ marginTop: '0.75rem' }}>
                  <button type="button" className="secondary" disabled={ganadoBusy} onClick={buscarDupGanado}>
                    Buscar cliente existente (teléfono del lead + CUIT/DNI)
                  </button>
                </div>
                {ganadoSearched && !ganadoDup && !ganadoErr && (
                  <p className="hint" style={{ marginTop: '0.5rem' }}>
                    No hay coincidencia: al confirmar se creará un cliente nuevo en <strong>Clientes</strong>.
                  </p>
                )}
                {ganadoDup && (
                  <p className="hint" style={{ marginTop: '0.5rem', color: 'var(--accent, #93c5fd)' }}>
                    Cliente existente por {ganadoDup.matchField}: <strong>{ganadoDup.nombre}</strong> ({ganadoDup.id}).
                  </p>
                )}
                {ganadoErr && (
                  <div className="error-banner" style={{ marginTop: '0.75rem' }}>
                    {ganadoErr}
                  </div>
                )}
                <div className="form-actions" style={{ marginTop: '1rem' }}>
                  <button
                    type="button"
                    className="secondary"
                    disabled={ganadoBusy}
                    onClick={() => {
                      setGanadoFlow(null);
                      setGanadoDup(null);
                      setGanadoCuit('');
                      setGanadoErr(null);
                      setGanadoSearched(false);
                    }}
                  >
                    Cancelar
                  </button>
                  <button type="button" disabled={ganadoBusy} onClick={ejecutarConversionGanado}>
                    {ganadoBusy
                      ? 'Procesando…'
                      : ganadoDup
                        ? `Vincular y generar ${ganadoKindResolved === 'ot' ? 'OT' : 'presupuesto'}`
                        : `Crear cliente y generar ${ganadoKindResolved === 'ot' ? 'OT' : 'presupuesto'}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {posponerModal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !savingPosponer) {
              setPosponerModal(null);
              setPosponerHoras(24);
            }
          }}
        >
          <div className="modal" role="dialog" aria-labelledby="posponer-modal-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="posponer-modal-title">Posponer revisión</h2>
            <p className="hint">
              <strong>{posponerModal.nombre}</strong> — se guardará la fecha en «Revisar después» y una nota. Motivo obligatorio.
            </p>
            <div className="toolbar-segment" role="group" aria-label="Plazo" style={{ marginBottom: '0.75rem' }}>
              <button
                type="button"
                className={posponerHoras === 24 ? 'active' : ''}
                onClick={() => setPosponerHoras(24)}
              >
                24 h
              </button>
              <button
                type="button"
                className={posponerHoras === 48 ? 'active' : ''}
                onClick={() => setPosponerHoras(48)}
              >
                48 h
              </button>
            </div>
            <label>
              Motivo
              <textarea
                value={posponerMotivo}
                onChange={(e) => setPosponerMotivo(e.target.value)}
                rows={3}
                placeholder="Ej. no atiende, espera confirmación de propuesta, taller aún no desarmó…"
                autoFocus
                style={{ width: '100%', marginTop: '0.35rem' }}
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                disabled={savingPosponer}
                onClick={() => {
                  setPosponerModal(null);
                  setPosponerHoras(24);
                }}
              >
                Cancelar
              </button>
              <button type="button" disabled={!posponerMotivo.trim() || savingPosponer} onClick={confirmPosponer}>
                {savingPosponer ? 'Guardando…' : `Posponer ${posponerHoras === 48 ? 48 : 24} h`}
              </button>
            </div>
          </div>
        </div>
      )}

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
              <label>
                Nota inicial
                <textarea
                  value={newDraft.nota_inicial}
                  onChange={(e) => setNewDraft((d) => ({ ...d, nota_inicial: e.target.value }))}
                  placeholder="Opcional: contexto del contacto, consulta…"
                  rows={3}
                />
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
