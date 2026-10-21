#!/usr/bin/env node
/**
 * S4/D3b byte-proof installer. It makes the identical probe edit in a scratch
 * copy of the repository (the base copy now, a result copy later). It never
 * runs against the repository working tree.
 *
 * Usage: node apply-probes.mjs <copy-root>
 *
 * The four probes of book §5.1 "Byte proof, S4":
 *   1 whole assembler result (assembleTask/assembleQuery/readAttentionGraph)
 *   2 deps proxy + clock (method, arguments, order, resolved value/rejection)
 *   3 stored raw manifest string + preparation digests (+ the put request)
 *   4 read points no test reaches (derived from the same deps capture)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(join(root, 'package.json'))) {
  console.error('usage: node apply-probes.mjs <copy-root>');
  process.exit(2);
}

const HOOK_IMPORT = "import { probeAssembler, probeDeps } from '../../probe-hook.js';";
const STORED_IMPORT = "import { probeStoredManifest } from '../../probe-hook.js';";

const write = (path, content) => writeFileSync(join(root, path), content, 'utf8');
const read = path => readFileSync(join(root, path), 'utf8');

function edit(path, from, to, marker) {
  const before = read(path);
  if (before.includes(marker)) return;
  if (!before.includes(from)) {
    throw new Error(`anchor not found in ${path}: ${JSON.stringify(from.slice(0, 100))}`);
  }
  writeFileSync(join(root, path), before.replace(from, to), 'utf8');
}

// ---------------------------------------------------------------------- //
// The probe hook and the per-test key setup                                //
// ---------------------------------------------------------------------- //
write('src/probe-hook.ts', readFileSync(join(here, 'probe-hook.ts'), 'utf8'));
write('tests/probe-setup.ts', readFileSync(join(here, 'probe-setup.ts'), 'utf8'));

edit('vitest.config.ts',
  "    environment: 'node', include: ['tests/**/*.test.ts'], clearMocks: true, restoreMocks: true,",
  "    environment: 'node', include: ['tests/**/*.test.ts'], clearMocks: true, restoreMocks: true,\n    setupFiles: ['./tests/probe-setup.ts'],",
  "setupFiles: ['./tests/probe-setup.ts'],");

// ---------------------------------------------------------------------- //
// Item 1 + 2: wrap the factory's deps and every returned method.           //
// ---------------------------------------------------------------------- //
{
  const path = 'src/core/agent-runtime/context-assembler.ts';
  let source = read(path);
  if (!source.includes(HOOK_IMPORT)) {
    const header = /export function createContextAssembler\(([^)]*)\): ContextAssembler \{/;
    const match = source.match(header);
    if (match === null) throw new Error(`createContextAssembler header not found in ${path}`);
    // Keep the clock read and every dependency access inside the implementation;
    // the exported factory only receives the recording proxy.
    source = source.replace(header, `function createContextAssemblerImpl(${match[1]}): ContextAssembler {`);
    source += `\n/** Copy-only probe: records the deps calls and each complete result. */\n`
      + `export function createContextAssembler(${match[1]}): ContextAssembler {\n`
      + `  const probed = probeDeps(deps);\n`
      + `  return probeAssembler(createContextAssemblerImpl(probed), probed);\n`
      + `}\n`;
    source = HOOK_IMPORT + '\n' + source;
    write(path, source);
  }
}

// ---------------------------------------------------------------------- //
// Item 3: the raw stored manifest and the preparation's digests.           //
// ---------------------------------------------------------------------- //
{
  const path = 'src/core/agent-runtime/execution-preparation.ts';
  let source = read(path);
  if (!source.includes(STORED_IMPORT)) {
    edit(path,
      "      const manifestJson = JSON.stringify(manifest);\n      if (Buffer.byteLength(manifestJson, 'utf8') > MAX_PREPARED_MANIFEST_BYTES) {",
      "      const manifestJson = JSON.stringify(manifest);\n"
      + "      // Copy-only probe: the raw stored manifest and the preparation's digests.\n"
      + "      probeStoredManifest('stored:task', {\n"
      + "        inputDigest, manifestInputDigest: sha256Hex(manifest.input),\n"
      + "        manifestJson, inputBytes: Buffer.byteLength(manifest.input, 'utf8'),\n"
      + "        manifestBytes: Buffer.byteLength(manifestJson, 'utf8'),\n"
      + "      });\n"
      + "      if (Buffer.byteLength(manifestJson, 'utf8') > MAX_PREPARED_MANIFEST_BYTES) {",
      "probeStoredManifest('stored:task'");
    edit(path,
      "        stored = await deps.bodies.put({\n"
      + "          body: manifestJson, contentType: PREPARED_MANIFEST_CONTENT_TYPE, sourceRefs,\n"
      + "          origin: { kind: 'run', owner: runRef }, requestedAt: deps.now(),\n"
      + "        });",
      "        const putRequest = {\n"
      + "          body: manifestJson, contentType: PREPARED_MANIFEST_CONTENT_TYPE, sourceRefs,\n"
      + "          origin: { kind: 'run', owner: runRef }, requestedAt: deps.now(),\n"
      + "        };\n"
      + "        probeStoredManifest('stored:task:put', { putRequest });\n"
      + "        stored = await deps.bodies.put(putRequest);",
      "probeStoredManifest('stored:task:put'");
    source = read(path);
    write(path, STORED_IMPORT + '\n' + source);
  }
}
{
  const path = 'src/core/agent-runtime/query-preparation.ts';
  let source = read(path);
  if (!source.includes(STORED_IMPORT)) {
    edit(path,
      "      const manifestJson = JSON.stringify(manifest);\n      if (Buffer.byteLength(manifestJson, 'utf8') > MAX_QUERY_MANIFEST_BYTES) {",
      "      const manifestJson = JSON.stringify(manifest);\n"
      + "      // Copy-only probe: the raw stored Query manifest and its digest.\n"
      + "      probeStoredManifest('stored:query', {\n"
      + "        inputDigest, manifestInputDigest: sha256Hex(manifest.input),\n"
      + "        manifestJson, inputBytes: Buffer.byteLength(manifest.input, 'utf8'),\n"
      + "        manifestBytes: Buffer.byteLength(manifestJson, 'utf8'),\n"
      + "      });\n"
      + "      if (Buffer.byteLength(manifestJson, 'utf8') > MAX_QUERY_MANIFEST_BYTES) {",
      "probeStoredManifest('stored:query'");
    edit(path,
      "        stored = await deps.bodies.put({\n"
      + "          body: manifestJson,\n"
      + "          contentType: QUERY_MANIFEST_CONTENT_TYPE,\n"
      + "          sourceRefs,\n"
      + "          origin: { kind: 'run', owner: queryRunRef },\n"
      + "          requestedAt: deps.now(),\n"
      + "        });",
      "        const putRequest = {\n"
      + "          body: manifestJson,\n"
      + "          contentType: QUERY_MANIFEST_CONTENT_TYPE,\n"
      + "          sourceRefs,\n"
      + "          origin: { kind: 'run', owner: queryRunRef },\n"
      + "          requestedAt: deps.now(),\n"
      + "        };\n"
      + "        probeStoredManifest('stored:query:put', { putRequest });\n"
      + "        stored = await deps.bodies.put(putRequest);",
      "probeStoredManifest('stored:query:put'");
    source = read(path);
    write(path, STORED_IMPORT + '\n' + source);
  }
}

function replaceAll(path, from, to, marker) {
  const before = read(path);
  if (before.includes(marker)) return;
  const parts = before.split(from);
  if (parts.length < 2) throw new Error(`anchor not found in ${path}: ${JSON.stringify(from.slice(0, 100))}`);
  write(path, parts.join(to));
}

function prependImport(path, line, marker) {
  const before = read(path);
  if (before.includes(marker)) return;
  write(path, line + '\n' + before);
}

// ---------------------------------------------------------------------- //
// Determinism for the copy (book §5.0 rule 3): the seeded id generator and //
// the fixed monotonic clock replace the production defaults *in the copy*.  //
// ---------------------------------------------------------------------- //
{
  const path = 'src/composition/create-platform.ts';
  edit(path,
    "import { randomBytes, randomUUID } from 'node:crypto';",
    "import { randomBytes } from 'node:crypto';\nimport { probeNow, probeRandomId as randomUUID } from '../probe-hook.js';",
    'probeRandomId');
  edit(path,
    'const now = options.now ?? (() => new Date().toISOString());',
    'const now = options.now ?? probeNow;',
    'options.now ?? probeNow');
}
for (const path of ['src/core/workspace/capture.ts', 'src/core/workspace/source-query.ts']) {
  edit(path,
    "import { randomUUID } from 'node:crypto';",
    "import { probeRandomId as randomUUID } from '../../probe-hook.js';",
    'probeRandomId');
}
for (const path of ['src/core/work-graph/architecture/architecture-service.ts', 'src/core/work-graph/architecture/catalog-service.ts']) {
  edit(path,
    "import { randomUUID } from 'node:crypto';",
    "import { probeNow, probeRandomId as randomUUID } from '../../../probe-hook.js';",
    'probeRandomId');
  replaceAll(path, 'new Date().toISOString()', 'probeNow()', 'probeNow()');
}
{
  const path = 'src/app/host.ts';
  prependImport(path, "import { probeNow } from '../probe-hook.js';", 'probe-hook.js');
  replaceAll(path, 'options.now ?? (() => new Date().toISOString())', 'options.now ?? probeNow', 'options.now ?? probeNow');
}
{
  const path = 'src/business/workflow/workflow.ts';
  prependImport(path, "import { probeNow } from '../../probe-hook.js';", 'probe-hook.js');
  edit(path,
    'now: deps.now ?? (() => new Date().toISOString()),',
    'now: deps.now ?? probeNow,',
    'now: deps.now ?? probeNow');
}
{
  const path = 'src/business/workflow/session-maintenance.ts';
  prependImport(path, "import { probeNow } from '../../probe-hook.js';", 'probe-hook.js');
  edit(path,
    'const now = deps.now?.() ?? new Date().toISOString();',
    'const now = deps.now?.() ?? probeNow();',
    'deps.now?.() ?? probeNow()');
}
for (const path of ['src/core/work-graph/sessions/session-directory.ts', 'src/core/work-graph/sessions/session-lifecycle.ts']) {
  prependImport(path, "import { probeNow } from '../../../probe-hook.js';", 'probe-hook.js');
  replaceAll(path, 'new Date().toISOString()', 'probeNow()', 'probeNow()');
}
// ---------------------------------------------------------------------- //
// Determinism for the frozen vendor Kernel (copy-only, book §5.0 rule 3):  //
// its run clock is one literal, so no capture depends on the wall clock.   //
// This file is in the copy only; the repository's dist is never touched.    //
// ---------------------------------------------------------------------- //
{
  const path = 'vendor/coding-agent/dist/app/composition/composition-root.js';
  if (existsSync(join(root, path))) {
    replaceAll(path,
      '    const now = new Date().toISOString();',
      "    const now = '2026-10-21T00:00:00.000Z';",
      "const now = '2026-10-21T00:00:00.000Z';");
  }
  // The Kernel's per-event clock (occurredAt -> startedAt/recordedAt) is this
  // injected clock. Its default is the only other `new Date()` in the dist.
  const clockPath = 'vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js';
  if (existsSync(join(root, clockPath))) {
    replaceAll(clockPath,
      '        return new Date();',
      "        return new Date('2026-10-21T00:00:00.000Z');",
      "return new Date('2026-10-21T00:00:00.000Z');");
  }
  // The workspace identity is `dev:ino` of the temporary root; the temp dir is
  // recreated each run, so the inode changes. Pin the identity string (same
  // edit both copies) so Kernel event bodies and capture digests are stable.
  const identityPath = 'vendor/coding-agent/dist/sandbox/workspace/workspace-sandbox.js';
  if (existsSync(join(root, identityPath))) {
    replaceAll(identityPath,
      '    return `${String(value.dev)}:${String(value.ino)}`;',
      "    return '1:1';",
      "return '1:1';");
  }
}

console.log(`S4 probes installed in ${root}`);
