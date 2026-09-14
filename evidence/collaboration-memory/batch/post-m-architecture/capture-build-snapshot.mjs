import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = 'dist';
const output = process.argv[2];
if (!output) throw new Error('output path required');

const paths = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) paths.push(relative(root, path).replaceAll('\\', '/'));
  }
}
walk(root);
paths.sort();

const fold = createHash('sha256');
const files = paths.map(path => {
  const body = readFileSync(join(root, path));
  const sha256 = createHash('sha256').update(body).digest('hex');
  fold.update(path);
  fold.update(Buffer.from([0]));
  fold.update(sha256);
  fold.update('\n');
  return { path, sha256, bytes: statSync(join(root, path)).size };
});
const result = {
  capturedAt: new Date().toISOString(),
  root,
  fileCount: files.length,
  fingerprintSha256: fold.digest('hex'),
  files,
};
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, fileCount: result.fileCount, fingerprintSha256: result.fingerprintSha256 }, null, 2));
