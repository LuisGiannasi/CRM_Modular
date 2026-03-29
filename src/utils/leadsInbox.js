import { normalizeLeadEtapa } from '../constants/leadsOptions';

/** Valor datetime «revisar después» (Motores / Modular: `revisar_despues_de`; legado `revisar_despues`). */
export function revisarDespuesValue(fields) {
  const f = fields || {};
  return f.revisar_despues_de ?? f.revisar_despues;
}

export function buildEndOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Posposición activa «más allá de hoy» (sale de Mi Inbox hoy, entra en Mis leads / Pospuestos). */
export function isPospuestoFuturo(fields, endToday) {
  const rev = revisarDespuesValue(fields);
  if (!rev) return false;
  return new Date(rev).getTime() > endToday.getTime();
}

/**
 * Estado de conversión para leads en Ganado (null si no aplica).
 * Considera OT (`orden_id_inicial`) o presupuesto de venta (campo configurable en Leads).
 */
export function getEstadoConversion(fields, pvField = 'presupuesto_venta') {
  const f = fields || {};
  if (normalizeLeadEtapa(f.etapa) !== 'Ganado') return null;
  const raw = String(f.estado_conversion || '').trim().toLowerCase();
  if (raw === 'pendiente' || raw === 'en_proceso' || raw === 'completada') return raw;
  if (raw === 'cancelada') return 'en_proceso';
  const orden = f.orden_id_inicial;
  if (Array.isArray(orden) && orden.length) return 'completada';
  const pv = f[pvField] ?? f.presupuesto_venta;
  if (Array.isArray(pv) && pv.length) return 'completada';
  return 'pendiente';
}

/** Comparación por vendedor asignado ( primer link en `vendedor` ). */
export function isVendedorMine(fields, especialistaRecordId) {
  if (!especialistaRecordId) return true;
  const v = fields?.vendedor;
  return Array.isArray(v) && v[0] === especialistaRecordId;
}

/**
 * @param {{ id: string; fields?: Record<string, unknown>; createdTime?: string }} record
 * @param {'mi-inbox' | 'mis-leads' | 'historicos' | 'pospuestos' | 'sin-tratar-24'} view
 * @param {string} espId `rec…` o ''
 * @param {Date} endToday fin del día local (23:59:59.999)
 * @param {string} [pvField] campo link Presupuesto_Venta en Leads
 */
export function recordMatchesInboxView(record, view, espId, endToday, pvField = 'presupuesto_venta') {
  const f = record.fields || {};
  const et = normalizeLeadEtapa(f.etapa);
  const pf = isPospuestoFuturo(f, endToday);

  switch (view) {
    case 'mi-inbox': {
      if (et === 'Nuevo') return true;
      if (et === 'Ganado') {
        if (f.proceso_incompleto === true) return isVendedorMine(f, espId);
        if (getEstadoConversion(f, pvField) === 'completada') return false;
        return isVendedorMine(f, espId);
      }
      if (et !== 'Contactado' && et !== 'En gestión') return false;
      if (!isVendedorMine(f, espId)) return false;
      if (pf) return false;
      return true;
    }
    case 'mis-leads': {
      if (et !== 'Contactado' && et !== 'En gestión') return false;
      if (!isVendedorMine(f, espId)) return false;
      return pf;
    }
    case 'historicos': {
      if (et !== 'Ganado' && et !== 'Perdido') return false;
      return isVendedorMine(f, espId);
    }
    case 'pospuestos': {
      if (!pf) return false;
      if (et !== 'Contactado' && et !== 'En gestión') return false;
      return isVendedorMine(f, espId);
    }
    case 'sin-tratar-24': {
      if (et !== 'Contactado' && et !== 'En gestión') return false;
      if (pf) return false;
      const last = f.ultimo_contacto || record.createdTime;
      if (!last) return false;
      const horas = (Date.now() - new Date(last).getTime()) / (3600 * 1000);
      if (horas < 24) return false;
      return isVendedorMine(f, espId);
    }
    default:
      return true;
  }
}
