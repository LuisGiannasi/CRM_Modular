/**
 * Vercel a veces no enruta /api/airtable/{tabla}/{rec} al catch-all [...slug].js
 * y responde 404 de plataforma (NOT_FOUND id gru1::…). Esta ruta fija delega
 * en el mismo handler.
 */
export { default } from '../[...slug].js';
