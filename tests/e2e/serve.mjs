import { execSync, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

execSync('npx vite build --outDir dist/e2e-client', { stdio: 'inherit', env: { ...process.env, VITE_TEST_HOOKS: '1' }, shell: true });
execSync('npm run build:server', { stdio: 'inherit', shell: true });
const dir = mkdtempSync(join(tmpdir(), 'ss-e2e-'));
const child = spawn(process.execPath, ['dist/server/index.js'], {
  stdio: 'inherit',
  env: { ...process.env, DB_PATH: join(dir, 'e2e.db'), CLIENT_DIR: 'dist/e2e-client' },
});
const stop = () => child.kill();
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (c) => process.exit(c ?? 0));
