import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const sourceGlobs = ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.mts', '*.cjs', '*.cts'];
const trackedFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...sourceGlobs],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean)
  .filter((file) => file !== 'scripts/check-fallow-policy.mjs');

const suppressionPattern = /fallow-ignore|@expected-unused/u;
const violations = [];

for (const file of trackedFiles) {
  const source = readFileSync(file, 'utf8');
  if (suppressionPattern.test(source)) {
    violations.push(`${file}: inline Fallow suppression is not allowed`);
  }
}

for (const configFile of ['.fallowrc.json', '.fallowrc.jsonc', 'fallow.toml', '.fallow.toml']) {
  if (existsSync(configFile)) {
    violations.push(`${configFile}: Fallow configuration requires an explicit policy change`);
  }
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (packageJson.devDependencies?.fallow !== '3.10.0') {
  violations.push('package.json: Fallow must remain pinned to 3.10.0');
}
if (
  packageJson.scripts?.['quality:fallow'] !==
  'node scripts/check-fallow-policy.mjs && fallow audit --format compact --fail-on-issues'
) {
  violations.push('package.json: quality:fallow must use the strict CI mode');
}

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
for (const requiredWorkflowText of [
  'fetch-depth: 0',
  'node scripts/check-fallow-policy.mjs',
  'test "$(pnpm exec fallow --version | sed -n \'1p\')" = "fallow 3.10.0"',
  'pnpm exec fallow audit --base origin/main --format github-summary --fail-on-issues --quiet',
]) {
  if (!workflow.includes(requiredWorkflowText)) {
    violations.push(
      `.github/workflows/ci.yml: missing required Fallow control: ${requiredWorkflowText}`,
    );
  }
}

if (violations.length > 0) {
  console.error('Fallow policy check failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Fallow policy passed for ${trackedFiles.length} source files.`);
}
