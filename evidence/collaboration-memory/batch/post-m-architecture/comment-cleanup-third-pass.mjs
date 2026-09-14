import { readFileSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const replacements = new Map([
  ['governance/plan', 'governance and plan'],
  ['human/role collaboration', 'human collaboration and role policy'],
  ['architecture evolution/14', 'architecture evolution'],
  ['verification/05', 'verification reduction'],
  ['dispatch/04/06', 'dispatch and handoff'],
]);
const suffixes = new Set(['.ts', '.tsx', '.js', '.md', '.html']);
const excluded = ['src/fixtures/', 'src/testing/', 'src/vendor/'];
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else files.push(path.replaceAll('\\', '/'));
  }
}
await walk('src');
const changed = [];
for (const path of files.sort()) {
  if (!suffixes.has(extname(path)) || excluded.some(prefix => path.startsWith(prefix))) continue;
  const before = readFileSync(path, 'utf8');
  let after = before;
  for (const [oldText, newText] of replacements) after = after.replaceAll(oldText, newText);
  if (after !== before) {
    writeFileSync(path, after);
    changed.push(path);
  }
}
console.log(JSON.stringify({ changed }, null, 2));

