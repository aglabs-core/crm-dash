// Run the same Node test suite without the tsx CLI's unnecessary IPC listener.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = readdirSync('lib').filter(name => name.endsWith('.test.ts')).sort().map(name => `lib/${name}`);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit' });
if (result.error) console.error('Não foi possível iniciar os testes de lógica.');
process.exit(result.status ?? 1);
