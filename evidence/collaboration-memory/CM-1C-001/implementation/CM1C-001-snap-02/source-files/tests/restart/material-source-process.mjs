// Independent Node process, with a local TypeScript loader solely for test sources.
// Production source files, SQLite adapters and filesystem reads remain real.
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from '../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.startsWith('file:')) {
      const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.ts')) return { format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText };
    return nextLoad(url, context);
  },
});
const { createPersistentSqliteHarness } = await import('../../src/harness/persistent-harness.ts');
const { WorkspaceSourceApplicability } = await import('../../src/data/workspace-reader/source-applicability.ts');
const { filesystemSourceAccess } = await import('../data/source-applicability-fixture.ts');
const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const access = filesystemSourceAccess(request.sourceRoot);
const sourceApplicability = new WorkspaceSourceApplicability(scope => scope.projectId === request.scope.projectId && scope.workspaceId === request.scope.workspaceId ? access : null);
const host = await createPersistentSqliteHarness({ dir: request.stateDir, sourceApplicability });
try {
  await host.advanceProjection();
  const result = await host.vault.open(request.ref, { requesterRunRef: request.reader, currentBasis: request.basis, usage: 'current', includeOwner: true });
  const historical = await host.vault.open(request.ref, { requesterRunRef: request.reader, currentBasis: request.basis, usage: 'historical_explanation', includeOwner: true });
  process.stdout.write(JSON.stringify({ pid: process.pid, result, historical }));
} finally { await host.close(); }
