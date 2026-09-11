import { SourceIndex } from '../dist/data/source-index.js';
import { WorkspaceSandbox } from '../vendor/coding-agent/dist/public-api.js';
import assert from 'node:assert/strict';

const workspace = await WorkspaceSandbox.create(process.cwd(), { deniedPrefixes: ['.git', '.env', '.evaluator', '.oracle'] });
const paths = ['src/runtime/exploration-tools.ts', 'src/data/source-index.ts'];
const index = new SourceIndex({ read: (p, bytes) => workspace.read(p, bytes), allowed: p => paths.includes(p) });
const source = await workspace.read(paths[0], 256 * 1024);
const prefix = source.content.slice(0, source.content.indexOf('new SourceIndex') + 4);
const lines = prefix.split('\n');
const result = await index.query({ paths, operation: 'definitions', path: paths[0], line: lines.length, column: lines.at(-1).length + 1 });
assert.equal(result.status, 'sourced');
const declaration = result.results.find(r => r.path === paths[1]);
assert.ok(declaration, 'real platform import must resolve to SourceIndex');
const material = await index.excerpt(declaration.path, declaration.digest, declaration.line, declaration.line);
assert.equal(material.status, 'sourced');
assert.match(material.content, /class SourceIndex/);
console.log(JSON.stringify({ status: 'passed', snapshot: result.snapshot, sources: result.sources,
  definition: declaration, material, coverage: result.coverage, diagnostics: result.diagnostics,
  externalModelCalls: 0 }, null, 2));
