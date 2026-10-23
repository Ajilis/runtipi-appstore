// Run in CI on *every* change affecting Rendevo. Historical SQL files are
// immutable even if they have no checksum on pre-V27 production installations.
// Usage: node scripts/check-migrations.mjs [--baseline origin/main]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertSafeMigration } from '../server/db/migration-safety.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const relativeDir = 'sources/rendevo/server/db/migrations';
const directory = path.join(root, relativeDir);
const files = fs.readdirSync(directory).filter((n) => n.endsWith('.sql')).sort();
if (!files.length) throw new Error('No migrations found');
const sequence = new Set();
for (const name of files) {
  assertSafeMigration(name, fs.readFileSync(path.join(directory, name), 'utf8'));
  const number = Number(name.slice(0, 3));
  if (sequence.has(number)) throw new Error('Duplicate migration number: ' + name);
  sequence.add(number);
}
const arg = process.argv.indexOf('--baseline');
if (arg !== -1) {
  const baseline = process.argv[arg + 1];
  if (!baseline || !/^[\w./-]+$/.test(baseline)) throw new Error('Invalid baseline ref');
  const oldNames = execFileSync('git',
    ['ls-tree', '-r', '--name-only', baseline, '--', relativeDir],
    { cwd: root, encoding: 'utf8' }).trim().split('\n')
    .filter((f) => f.endsWith('.sql'));
  const currentSet = new Set(files);
  const maxOldVersion = Math.max(0, ...oldNames.map((name) => Number(path.basename(name).slice(0, 3))));
  for (const oldName of oldNames) {
    const basename = path.basename(oldName);
    if (!currentSet.has(basename)) throw new Error('Historical migration removed: ' + basename);
    const existing = execFileSync('git', ['show', baseline + ':' + oldName], { cwd: root });
    const candidate = fs.readFileSync(path.join(directory, basename));
    if (!existing.equals(candidate)) {
      throw new Error('Historical migration modified: ' + basename
        + '. Never rewrite applied migration files; add a new additive migration.');
    }
  }
  for (const name of files) {
    if (!oldNames.some((p) => path.basename(p) === name)
      && Number(name.slice(0, 3)) <= maxOldVersion) {
      throw new Error('Migration must be appended after existing versions: ' + name);
    }
  }
  console.log('[db] immutable migration history verified against ' + baseline);
}
console.log('[db] all ' + files.length + ' migration files satisfy additive-only policy');
