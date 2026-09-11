import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const root = process.cwd(), evidence = 'evidence/2026-09-10-def17/';
const manifest = JSON.parse(fs.readFileSync(evidence + 'candidate-source-sha256.json'));
const prior = JSON.parse(fs.readFileSync('evidence/2026-09-10-external-review-repair/final/final-source-sha256.json'));
const first = JSON.parse(fs.readFileSync(evidence + 'independent-review-initial-scope.json'));
const listed = new Map(manifest.files.map(f => [f.path, f.sha256]));
const errors = [];
for (const { path: p, sha256 } of manifest.files) {
 try { const actual = sha(fs.readFileSync(p)); if (actual !== sha256) errors.push({ path: p, expected: sha256, actual }); }
 catch (e) { errors.push({ path: p, error: e.code }); }
}
const ignored = new Set(['node_modules', '.vite', '.local', '.git', 'dist', 'test-results', 'playwright-report']);
const scanned = ['AGENTS.md', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.app.json', 'vitest.config.ts'];
const visit = p => { for (const d of fs.readdirSync(p, { withFileTypes: true })) {
 if (ignored.has(d.name)) continue;
 const n = p + '/' + d.name;
 if (d.isDirectory()) visit(n); else if (d.isFile()) scanned.push(n);
} };
for (const p of ['src','tests','scripts']) visit(p);
const diskSet = new Set(scanned), old = new Map(prior.files.map(f => [f.path,f.sha256]));
const workbench = manifest.files.filter(f => f.path.startsWith('src/app/public/workbench/'));
const html = fs.readFileSync('src/app/public/workbench/index.html','utf8');
const builtRoot = 'dist/app/public/workbench';
const builtFiles = [];
const listBuilt = p => { for (const d of fs.readdirSync(p, { withFileTypes: true })) {
 const n = p + '/' + d.name;
 if (d.isDirectory()) listBuilt(n); else if (d.isFile()) builtFiles.push(n);
} }; listBuilt(builtRoot);
const builtComparison = builtFiles.map(p => { const source = p.replace(/^dist\//,'src/'); return { built: p, source, equal: fs.existsSync(source) && fs.readFileSync(p).equals(fs.readFileSync(source)) }; });
const previousBuilt = new Set(builtComparison.map(f => f.source));
const result = {
 checkedAt: new Date().toISOString(), root, fileCount: manifest.files.length, calculatedDigest: sha(JSON.stringify(manifest.files)), declaredDigest: manifest.digest,
 errors, duplicateListedPaths: manifest.files.length - listed.size, independentlyScannedFileCount: scanned.length,
 unlistedPaths: scanned.filter(p => !listed.has(p)), listedOutsideScope: manifest.files.filter(f => !diskSet.has(f.path)).map(f => f.path),
 since739: { added: manifest.files.filter(f => !old.has(f.path)).map(f => f.path), modified: manifest.files.filter(f => old.has(f.path) && old.get(f.path) !== f.sha256).map(f => f.path), deleted: prior.files.filter(f => !listed.has(f.path)).map(f => f.path) },
 sinceInitialReviewScope: first.files.filter(f => listed.get(f.path) !== f.sha256).map(f => ({ path: f.path, initial: f.sha256, candidate: listed.get(f.path) })),
 workbench: { listedFiles: workbench.length, builtFiles: builtFiles.length, builtComparison, retainedUnreferencedByBuiltTree: workbench.filter(f => !previousBuilt.has(f.path)).map(f => f.path), htmlAssetReferences: [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(x => x[1]) },
};
fs.writeFileSync(evidence + 'independent-candidate-check.json', JSON.stringify(result,null,2) + '\n');
console.log(JSON.stringify(result,null,2));
