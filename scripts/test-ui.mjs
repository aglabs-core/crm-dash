// Keep React development test behavior consistent on Windows and POSIX shells.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const runner = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const args = process.argv.slice(2);
const workers = args.some(arg => arg.startsWith('--maxWorkers')) ? [] : ['--maxWorkers=2'];
const result = spawnSync(process.execPath, [runner, 'run', ...workers, ...args], {
  stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' },
});
if (result.error) console.error('Não foi possível iniciar os testes de interface.');
process.exit(result.status ?? 1);
