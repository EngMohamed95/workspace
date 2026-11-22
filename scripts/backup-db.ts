// Dumps the local Docker MySQL database (see docker-compose.yml) to backups/<db>-<timestamp>.sql.
// Usage: npm run db:backup
import 'dotenv/config';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const container = 'stack-space-mysql';
const database = process.env.MYSQL_DATABASE || 'stack_space';
const rootPassword = process.env.MYSQL_ROOT_PASSWORD;

if (!rootPassword) {
  console.error('MYSQL_ROOT_PASSWORD is not set in .env');
  process.exit(1);
}

const now = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const outDir = path.resolve('backups');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${database}-${stamp}.sql`);
const out = fs.createWriteStream(outFile);

const dump = spawn('docker', [
  'exec', '-e', `MYSQL_PWD=${rootPassword}`, container,
  'mysqldump', '-uroot', '--single-transaction', '--no-tablespaces', '--set-gtid-purged=OFF',
  '--routines', '--triggers', '--default-character-set=utf8mb4', database,
]);

dump.stdout.pipe(out);
dump.stderr.pipe(process.stderr);
dump.on('error', (err) => {
  console.error('Could not run docker:', err.message);
  process.exit(1);
});
dump.on('close', (code) => {
  out.close();
  if (code !== 0) {
    fs.rmSync(outFile, { force: true });
    console.error(`mysqldump failed (exit ${code})`);
    process.exit(code ?? 1);
  }
  console.log(`Backup written to ${outFile}`);
});
