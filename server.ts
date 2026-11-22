import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createDatabase } from './src/server/db.ts';
import { createApiRouter } from './src/server/routes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createApp(options?: {
  sqlitePath?: string;
  forceSqlite?: boolean;
}) {
  const db = await createDatabase(options);
  const app = express();

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', createApiRouter(db));

  return { app, db };
}

export async function startServer() {
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';
  const { app } = await createApp();

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // When bundled (npm run build) this file runs as dist/server.js, next to the client build.
    const distDir =
      path.basename(__dirname) === 'dist' ? __dirname : path.resolve(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Stack Space server listening on http://0.0.0.0:${port}`);
  });
}

// Only auto-start when server.ts itself is executed (npm run dev). The production
// bundle (dist/server.js) is started by start.ts instead.
const isMain =
  __filename.endsWith('.ts') &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  startServer().catch((err) => {
    console.error('Failed to start Stack Space server:', err);
    process.exit(1);
  });
}
