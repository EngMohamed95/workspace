// Hostinger entry point (the Node.js app's entry file is "server.js" in the project root).
// It loads a .env file sitting next to this file, when there is one (the FTP deploy writes it,
// since that setup does not get hPanel's environment variables), then starts the production
// bundle that `npm run build` writes to dist/server.js.
// No top-level await: Hostinger may load this file with require().
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('./.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

import('./dist/server.js').catch((err) => {
  console.error('Failed to load dist/server.js:', err);
  process.exit(1);
});
