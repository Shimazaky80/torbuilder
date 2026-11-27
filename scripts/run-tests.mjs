import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const testScripts = Object.keys(packageJson.scripts).filter((name) => name.startsWith('test:'));
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  console.error('Run the test suite with `npm test` so npm can locate its CLI.');
  process.exit(1);
}

for (const name of testScripts) {
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(process.execPath, [npmCli, 'run', name], { stdio: 'inherit' });
  if (result.error) {
    console.error(`Could not run ${name}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log(`\nAll ${testScripts.length} test scripts passed.`);
