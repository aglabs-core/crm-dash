// Keep React development test behavior consistent on Windows and POSIX shells.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const runner = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const result = spawnSync(process.execPath, [runner, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' },
});
if (result.error) console.error('Não foi possível iniciar os testes de interface.');
process.exit(result.status ?? 1);
