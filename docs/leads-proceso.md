# Proceso operativo — Módulo Leads (CRM Modular)

Especificación de negocio para el embudo de consultas. La base de datos es **la del Modular** (Airtable); este documento describe qué debe ocurrir en la app.

## 1. Alcance

- Deben registrarse **todas** las consultas que ingresan a **cualquiera** de las empresas del grupo.

## 2. Ingreso de datos

- **Manual:** cuando atienden un llamado presencial o telefónico, o cuando el contacto viene a oficina.
- **Automático (API / integraciones):** cuando la central u otras vías cargan el lead (p. ej. WhatsApp, web, Instagram). *La recepción vía API es responsabilidad de integraciones externas; la app web cubre alta y gestión manual.*

## 3. Estados del embudo

| Estado | Significado |
|--------|-------------|
| **Nuevo** | Dato recién ingresado (manual o API), aún sin clasificar en el flujo comercial. |
| **Contactado** | El comercial intentó contactar (llamado / WhatsApp, etc.) pero **el cliente no respondió** aún. Típico en leads que entran por API y el vendedor hace el primer intento. |
| **En gestión** | Hubo **contacto efectivo** con el cliente; se está en espera de respuesta a una **propuesta comercial** u otra definición de avance. |
| **Ganado** | El cliente **decide avanzar** con la propuesta comercial (primera de dos salidas “exitosas” del dato como lead puro). |
| **Perdido** | El cliente **no comprará** en nuestras empresas. **Obligatorio** registrar la **causa** de pérdida (`motivo_perdida`). |

## 4. Altas manuales adicionales

- Se puede **agendar / crear un lead a mano** cuando el contacto viene a la oficina o llama (flujo recepción / comercial).

## 5. Pantallas internas (vistas de bandeja)

Estas vistas filtran **los mismos** registros Leads; cambia el criterio de qué entra en cada lista.

1. **Mi Inbox (HOY)** — Gestiones del día: pool **Nuevo**, leads **Contactado / En gestión** sin posposición “más allá de hoy”, y **Ganado** con conversión aún **no completada** (trabajo pendiente), según vendedor asignado si está configurado `VITE_ESPECIALISTA_RECORD_ID`.
2. **Mis leads** — Gestiones **pospuestas a futuro** (fecha de revisión después del fin del día de hoy) en **Contactado** o **En gestión**, del vendedor asignado.
3. **Históricos** — **Ganado** y **Perdido** de la cartera (vendedor asignado cuando hay ID de especialista).
4. **Pospuestos** — Misma idea que posposición activa: **Contactado / En gestión** con **revisar** programado **después de hoy** (24 h / 48 h u otra causa operativa).
5. **Sin tratar más de 24 h** — **Contactado** o **En gestión**, **sin** posposición futura, con **más de 24 h** sin interacción registrada (`ultimo_contacto` o fecha de creación del registro).

## 6. Posponer

- Botones **Posponer 24 h** y **48 h** cuando el cliente no se pudo contactar, está por confirmar propuesta, el taller aún no desarmó motor, etc.
- El sistema guarda **fecha/hora** en `revisar_despues_de` y registra **nota** con el motivo.

## 7. Ganado: cliente, anti-duplicado, OT o presupuesto

1. Al mover el lead a **Ganado**, la app abre un **asistente** (no deja el circuito a medias sin aviso).
2. **Cliente:** se busca duplicado por **teléfono** del lead y/o **CUIT/DNI** opcional. Si existe, se **vincula**; si no, se **crea** en la tabla **Clientes** (campos típicos `nombre_referente`, `apellido_referente`, `telefono`, `cuit`, `fecha_creacion`).
3. **Salida según negocio:**
   - **Orden de trabajo** (`Ordenes_Trabajo`): rectificación / taller / consultas alineadas a **OT Taller** o tipos Rectificación, Mecánica, Inyección.
   - **Presupuesto de venta** (`Presupuesto_Venta`): motores, repuestos, importación / **Presupuesto de Venta** o tipos Repuesto, Motor nuevo, Importación.
4. Si el tipo no define la salida, el usuario **elige** OT o presupuesto en el modal.
5. **Incompleto / error:** si falla la generación de OT o presupuesto, el lead queda en **Ganado** con **`proceso_incompleto`** y sigue en **Mi Inbox**; en el panel aparece un cartel **PROCESO INCOMPLETO** (OT o presupuesto según corresponda). Los nombres de tabla y el campo link a presupuesto en Leads se configuran en `.env` (ver `.env.example`).

## 8. Configuración técnica

- En Airtable, el single select **etapa** debe incluir exactamente: **Nuevo**, **Contactado**, **En gestión**, **Ganado**, **Perdido** (coincidiendo con la app).
- En **Leads** deben existir los campos usados por el script 08: `cliente`, `orden_id_inicial`, y un link a presupuesto (por defecto el código usa `presupuesto_venta` o el nombre en `VITE_LEAD_FIELD_PRESUPUESTO_VENTA`).
- Para filtrar “mis” leads como en un CRM multiusuario, definir `VITE_ESPECIALISTA_RECORD_ID` en `.env` con un `rec…` de **Especialistas** (vendedor de la sesión). Sin eso, las vistas muestran criterios de equipo según la lógica implementada (ver código).
