// Bundles the production server (start.ts) into a single self-contained dist/server.js.
// All npm dependencies are inlined, so the server needs no node_modules at runtime —
// the deploy only has to upload dist/ and package.json (e.g. over FTP).
import { build } from 'esbuild';

await build({
  entryPoints: ['start.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // vite is only used by the dev server; better-sqlite3 is a native, optional
  // dependency used only for the local SQLite fallback (production uses MySQL).
  external: ['vite', 'better-sqlite3'],
  define: { 'process.env.NODE_ENV': '"production"' },
  // Bundled CommonJS packages (express, mysql2, ...) call require() for Node built-ins.
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
