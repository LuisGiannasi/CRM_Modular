import { join } from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const cwd = process.cwd();
  // Misma carpeta que los scripts: ..\extensions\.env si no hay .env en CRM Modular
  const envParent = loadEnv(mode, join(cwd, '..'), '');
  const envLocal = loadEnv(mode, cwd, '');
  const env = { ...envParent, ...envLocal };
  const token = env.AIRTABLE_TOKEN || env.AIRTABLE_API_KEY;
  const baseId = env.AIRTABLE_BASE_ID;

  if (!token || !baseId) {
    console.warn(
      '[vite] Falta AIRTABLE_TOKEN (o AIRTABLE_API_KEY) o AIRTABLE_BASE_ID. ' +
        'Definilos en CRM Modular\\.env o en extensions\\.env (carpeta padre).'
    );
  }

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/airtable': {
          target: `https://api.airtable.com/v0/${baseId}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/airtable/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Authorization', `Bearer ${token}`);
              proxyReq.setHeader('Content-Type', 'application/json');
            });
          },
        },
      },
    },
  };
});
