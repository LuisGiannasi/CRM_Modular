import { normalizeLeadEtapa } from '../constants/leadsOptions';

const TIPOS_OT = new Set(['Rectificación', 'Mecánica', 'Inyección']);
const TIPOS_PRESUPUESTO = new Set(['Repuesto', 'Motor nuevo', 'Importación']);

/** @returns {'ot' | 'presupuesto' | 'choose'} */
export function followUpKindFromLeadFields(fields) {
  const f = fields || {};
  const doc = f.documento_tipo;
  if (doc === 'OT Taller') return 'ot';
  if (doc === 'Presupuesto de Venta') return 'presupuesto';
  const tc = f.tipo_consulta;
  if (TIPOS_OT.has(tc)) return 'ot';
  if (TIPOS_PRESUPUESTO.has(tc)) return 'presupuesto';
  return 'choose';
}

export function firstLinkId(value) {
  if (Array.isArray(value) && value.length > 0) return value[0];
  return null;
}

/**
 * Lead en Ganado sin cerrar circuito (cliente + OT o PV según corresponda).
 * @param {string} pvField nombre del campo link a Presupuesto_Venta en Leads
 */
export function leadConversionIncomplete(fields, pvField = 'presupuesto_venta') {
  if (normalizeLeadEtapa(fields?.etapa) !== 'Ganado') return false;
  if (!firstLinkId(fields?.cliente)) return true;
  const kind = followUpKindFromLeadFields(fields);
  if (kind === 'ot') return !firstLinkId(fields?.orden_id_inicial);
  if (kind === 'presupuesto') {
    const pv = fields[pvField] ?? fields.presupuesto_venta;
    return !firstLinkId(pv);
  }
  const hasOt = firstLinkId(fields?.orden_id_inicial);
  const pv = fields[pvField] ?? fields.presupuesto_venta;
  const hasPv = firstLinkId(pv);
  return !hasOt && !hasPv;
}

export function conversionIncompleteLabel(kind) {
  if (kind === 'ot') {
    return 'PROCESO INCOMPLETO: NO SE GENERÓ LA ORDEN DE TRABAJO (OT). Completá el circuito para mantener trazabilidad.';
  }
  if (kind === 'presupuesto') {
    return 'PROCESO INCOMPLETO: NO SE GENERÓ EL PRESUPUESTO DE VENTA. Completá el circuito para mantener trazabilidad.';
  }
  return 'PROCESO INCOMPLETO: NO SE GENERÓ OT NI PRESUPUESTO SEGÚN CORRESPONDA. Completá el circuito para mantener trazabilidad.';
}

/**
 * Texto corto para badge en tarjeta Kanban (misma condición que el cartel del panel).
 * @returns {string | null}
 */
export function ganadoKanbanBadge(fields, pvField = 'presupuesto_venta') {
  if (normalizeLeadEtapa(fields?.etapa) !== 'Ganado') return null;
  const needsAttention =
    fields?.proceso_incompleto === true || leadConversionIncomplete(fields, pvField);
  if (!needsAttention) return null;
  const f = fields || {};
  if (!firstLinkId(f.cliente)) return 'Sin cliente';
  const kind = followUpKindFromLeadFields(f);
  if (kind === 'ot') {
    return !firstLinkId(f.orden_id_inicial) ? 'Sin OT' : 'Revisar';
  }
  if (kind === 'presupuesto') {
    const pv = f[pvField] ?? f.presupuesto_venta;
    return !firstLinkId(pv) ? 'Sin PV' : 'Revisar';
  }
  const hasOt = firstLinkId(f.orden_id_inicial);
  const pv = f[pvField] ?? f.presupuesto_venta;
  const hasPv = firstLinkId(pv);
  if (!hasOt && !hasPv) return 'Sin OT/PV';
  return 'Revisar';
}
