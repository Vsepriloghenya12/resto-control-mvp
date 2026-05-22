import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webappRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webappRoot, '..');
const publicDir = path.join(webappRoot, 'public');
const packageJson = JSON.parse(readFileSync(path.join(webappRoot, 'package.json'), 'utf8'));

function gitValue(command) {
  try {
    return execSync(command, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

const commit = gitValue('git rev-parse --short HEAD');
const branch = gitValue('git rev-parse --abbrev-ref HEAD');
const builtAt = new Date().toISOString();
const build = process.env.APP_BUILD_ID || [packageJson.version, commit || 'local', Date.now()].join('-');

mkdirSync(publicDir, { recursive: true });
writeFileSync(
  path.join(publicDir, 'app-version.json'),
  `${JSON.stringify({ name: packageJson.name, version: packageJson.version, build, commit, branch, built_at: builtAt }, null, 2)}\n`
);
