# CRM Modular

Base **CRM Modular** en Airtable + app web del **módulo 1 (Leads)**.

## Módulo 1 — Leads (Vite + React)

1. Copiá `.env.example` a `.env` en esta carpeta (`CRM Modular`).
2. Completá `AIRTABLE_TOKEN` (o `AIRTABLE_API_KEY`) y `AIRTABLE_BASE_ID`.
3. Instalá dependencias y levantá el dev server:

```bash
cd "CRM Modular"
npm install
npm run dev
```

En **desarrollo**, Vite reenvía `/api/airtable/*` a Airtable usando tu `.env` local (el token no va al bundle del navegador).

En **Vercel**, la misma ruta la atiende la función en `api/airtable/[...slug].js`; configurá las variables de entorno en el panel de Vercel (ver abajo).

### Notas por lead

Si usás el monorepo `extensions`, ejecutá **una vez** desde su raíz:

```bash
node scripts/airtable-schema/07-link-notas-lead.js
```

(Ese script crea el campo link `lead` en `Notas_Leads`.)

### Proceso de negocio y esquema (Leads)

- Documento operativo: **`docs/leads-proceso.md`** (embudo, vistas Mi Inbox / Mis leads / Históricos / Pospuestos / Sin tratar 24h+).
- En Airtable, la etapa intermedia debe llamarse **`En gestión`** (contacto efectivo + espera respuesta a propuesta). El código acepta también **`En Proceso`** como alias y lo normaliza a **En gestión**.
- Campo datetime **`revisar_despues_de`** para posponer 24/48 h. Si solo existe **`revisar_despues`**, la app lo **lee** al cargar; al guardar o posponer escribe **`revisar_despues_de`**.

### Campos extra en Leads (Kanban, conversión y enlaces)

Desde la raíz del monorepo `extensions`, con `.env` que tenga `AIRTABLE_TOKEN` y `AIRTABLE_BASE_ID`:

```bash
node scripts/airtable-schema/08-campos-leads-motores.js
```

*(El nombre del archivo recuerda el flujo de referencia del equipo; el script solo toca la base cuyo `AIRTABLE_BASE_ID` tengas en `.env`.)*

Crea en **Leads**: `nota_inicial`, `ultima_interaccion`, `ultimo_contacto`, `fecha_modificacion_app`, `fecha_ganado`, `estado_conversion`, fechas de conversión, `cliente_creado`, links opcionales a **Especialistas** / **Clientes** / **Ordenes_Trabajo** (si esas tablas existen en la base). El CRM Modular actualiza interacción y conversión al mover tarjetas en el Kanban y al posponer.

Opcional en `.env`: `VITE_ESPECIALISTA_RECORD_ID` (un `rec…` de la tabla Especialistas) para rellenar `vendedor` y campos de auditoría al guardar.

**Ganado:** el Kanban abre un asistente para **cliente** (anti-duplicado por teléfono/CUIT), luego **OT** o **presupuesto de venta** según tipo de consulta; tablas y campo link de presupuesto: variables en `.env.example`. Si algo falla, el lead queda con **proceso incompleto** y cartel en el detalle.

## Subir a GitHub

1. En [github.com](https://github.com) creá un repositorio **vacío** (sin README ni `.gitignore` automáticos, o después fusioná).
2. En esta carpeta (`CRM Modular`), en la terminal:

```bash
cd "ruta/a/CRM Modular"
git init
git add .
git status
```

Verificá que **no** aparezca `.env` en la lista (debe estar ignorado por `.gitignore`).

```bash
git commit -m "CRM Modular M1 Leads — Vite + Airtable"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

Reemplazá `TU_USUARIO/TU_REPO` por tu repo. Si usás SSH, cambiá la URL del `remote`.

## Desplegar en Vercel

1. Entrá a [vercel.com](https://vercel.com), iniciá sesión e importá el proyecto desde el mismo repositorio de GitHub.
2. **Root Directory:** dejá la raíz del repo si subiste solo `CRM Modular` como proyecto único; si el repo es la carpeta padre, indicá `CRM Modular` como directorio raíz en los ajustes del proyecto.
3. En **Settings → Environment Variables** agregá (para *Production*, *Preview* y *Development* si querés):
   - `AIRTABLE_TOKEN` — tu PAT (o `AIRTABLE_API_KEY` con el mismo valor).
   - `AIRTABLE_BASE_ID` — el `app…` de la base.
4. **Deploy.** La URL pública usará el mismo `/api/airtable` que en local.

No commitees `.env` ni pegues el token en el repositorio.
