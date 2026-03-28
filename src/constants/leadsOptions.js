export const ETAPAS = ['Nuevo', 'Contactado', 'En gestión', 'Ganado', 'Perdido'];

export const TIPOS_CONSULTA = [
  'Rectificación',
  'Mecánica',
  'Inyección',
  'Repuesto',
  'Motor nuevo',
  'Importación',
  'Otro',
];

export const EMPRESAS = ['RMP', 'MP'];

export const ORIGENES = [
  'WhatsApp',
  'Teléfono',
  'Presencial',
  'Web',
  'Instagram',
  'Referido',
  'API',
];

export const DOCUMENTO_TIPO = ['OT Taller', 'Presupuesto de Venta', 'Ninguno'];

export const NOTA_TIPOS = [
  'Llamada',
  'WhatsApp',
  'Email',
  'Presencial',
  'Observación',
];

const ETAPA_STYLE = {
  Nuevo: { bg: '#374151', color: '#e5e7eb' },
  Contactado: { bg: '#1e3a5f', color: '#93c5fd' },
  'En gestión': { bg: '#422006', color: '#fcd34d' },
  Ganado: { bg: '#14532d', color: '#86efac' },
  Perdido: { bg: '#450a0a', color: '#fca5a5' },
};

export function etapaBadgeStyle(etapa) {
  return ETAPA_STYLE[etapa] || { bg: '#334155', color: '#cbd5e1' };
}
