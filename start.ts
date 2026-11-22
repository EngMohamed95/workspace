// Production entry point. `npm run build` bundles this file into dist/server.js,
// which is what Hostinger runs. It always starts the server, unlike server.ts,
// which only starts when executed directly (so tests can import createApp).
import { startServer } from './server.ts';

startServer().catch((err) => {
  console.error('Failed to start Stack Space server:', err);
  process.exit(1);
});
