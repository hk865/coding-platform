#!/usr/bin/env node
/**
 * Copy-only byte proof for S3/D3a: installs the identical probe edit into a
 * scratch copy of the repository. Run it on the base copy and, later, on the
 * result copy. It never runs against the repository tree.
 *
 * Usage: node apply-probes.mjs /tmp/s85-scratch/S3/base-e2
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(join(root, 'package.json'))) {
  console.error('usage: node apply-probes.mjs <copy-root>');
  process.exit(2);
}

const write = (path, content) => writeFileSync(join(root, path), content, 'utf8');
const edit = (path, from, to, marker) => {
  const full = join(root, path);
  const before = readFileSync(full, 'utf8');
  if (before.includes(marker)) return; // already applied
  if (!before.includes(from)) throw new Error(`anchor not found in ${path}: ${JSON.stringify(from.slice(0, 80))}`);
  writeFileSync(full, before.replace(from, to), 'utf8');
};

write('src/probe-hook.ts', `/**
 * COPY-ONLY byte-proof probe (S3/D3a). This file is written by
 * probes/e2/apply-probes.mjs into a scratch copy and is never part of the
 * repository. It appends one JSON line per captured call; S85_PROBE_DIR names
 * the output directory, one JSONL file per test file.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

type ProbeContext = { testPath: string; testName: string };
const context: ProbeContext = { testPath: 'unknown', testName: '' };
const runCounters = new Map<string, number>();
const callCounters = new Map<string, number>();
const madeDirectories = new Set<string>();

export function relProbePath(file: string | undefined): string {
  if (file === undefined || file === '') return 'unknown';
  return relative(process.cwd(), file).split(sep).join('/');
}

export function setProbeContext(next: Partial<ProbeContext>): void {
  if (next.testPath !== undefined) context.testPath = next.testPath;
  if (next.testName !== undefined) context.testName = next.testName;
}

/** Keep undefined distinct from a missing key and from null in the JSONL. */
function encode(value: unknown): unknown {
  if (value === undefined) return { $probe: 'undefined' };
  if (typeof value === 'number' && !Number.isFinite(value)) return { $probe: 'number', value: String(value) };
  if (Array.isArray(value)) return value.map(encode);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = encode((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/** Call the definition's Zod-to-JSON-Schema method exactly where the Kernel would. */
export function jsonSchemaOf(schema: unknown): unknown {
  if (schema !== null && typeof schema === 'object'
    && typeof (schema as { toJSONSchema?: unknown }).toJSONSchema === 'function') {
    return (schema as { toJSONSchema: () => unknown }).toJSONSchema();
  }
  return schema;
}

export function probeLog(kind: string, payload: unknown): void {
  const directory = process.env.S85_PROBE_DIR;
  if (directory === undefined || directory === '') return;
  if (!madeDirectories.has(directory)) {
    mkdirSync(directory, { recursive: true });
    madeDirectories.add(directory);
  }
  const testPath = context.testPath;
  const testName = context.testName;
  const runIndex = runCounters.get(testPath) ?? 0;
  runCounters.set(testPath, runIndex + 1);
  const callKey = testPath + '\\u0000' + testName + '\\u0000' + kind;
  const callIndex = callCounters.get(callKey) ?? 0;
  callCounters.set(callKey, callIndex + 1);
  const fileName = testPath.replace(/[^A-Za-z0-9._-]/g, '__') + '.jsonl';
  const line = JSON.stringify({ schema: 1, testPath, testName, runIndex, kind, callIndex, payload: encode(payload) });
  appendFileSync(join(directory, fileName), line + '\\n', 'utf8');
}
`);

write('tests/probe-setup.ts', `/**
 * COPY-ONLY byte-proof setup (S3/D3a). Installed by
 * probes/e2/apply-probes.mjs into a scratch copy; never part of the repository.
 */
import { beforeEach } from 'vitest';
import { INITIAL_COORDINATION_RESPONSE_GUIDE } from '../src/core/agent-runtime/query-preparation.js';
import { probeLog, relProbePath, setProbeContext } from '../src/probe-hook.js';

const guideLogged = new Set<string>();

beforeEach(({ task }) => {
  const testPath = relProbePath(task?.file?.filepath);
  setProbeContext({ testPath, testName: task?.name ?? '' });
  // One direct-import copy of the constant per test file, before that file's first test.
  if (!guideLogged.has(testPath)) {
    guideLogged.add(testPath);
    probeLog('guide-constant', {
      text: INITIAL_COORDINATION_RESPONSE_GUIDE,
      byteLength: Buffer.byteLength(INITIAL_COORDINATION_RESPONSE_GUIDE, 'utf8'),
    });
  }
});
`);

edit('vitest.config.ts',
  "    environment: 'node', include: ['tests/**/*.test.ts'], clearMocks: true, restoreMocks: true,",
  "    environment: 'node', include: ['tests/**/*.test.ts'], clearMocks: true, restoreMocks: true,\n    setupFiles: ['./tests/probe-setup.ts'],", "setupFiles: ['./tests/probe-setup.ts'],");

edit('src/core/agent-runtime/query-preparation.ts',
  "import { ARTIFACT_MAX_SIZE_BYTES } from '../../contracts/artifact.js';",
  "import { ARTIFACT_MAX_SIZE_BYTES } from '../../contracts/artifact.js';\nimport { probeLog } from '../../probe-hook.js';", "probe-hook");

edit('src/core/agent-runtime/query-preparation.ts',
  `      const question = execution.kind === 'initial_coordination'
        ? \`\${record.job.job.intent.question}\\n\\n\${INITIAL_COORDINATION_RESPONSE_GUIDE}\`
        : record.job.job.intent.question;`,
  `      const question = execution.kind === 'initial_coordination'
        ? \`\${record.job.job.intent.question}\\n\\n\${INITIAL_COORDINATION_RESPONSE_GUIDE}\`
        : record.job.job.intent.question;
      // Copy-only probe: log the final Query input after the guide decision.
      probeLog('query-input', { kind: execution.kind, question });`, "// Copy-only probe: log the final Query input");

edit('src/core/agent-runtime/observed-model-run.ts',
  "import { createHash } from 'node:crypto';",
  "import { createHash } from 'node:crypto';\nimport { jsonSchemaOf, probeLog } from '../../probe-hook.js';", "probe-hook");

edit('src/core/agent-runtime/observed-model-run.ts',
  `    const enabledNames = hasRead && reviewSource
      ? ['read_source', ...(o.materialTools ? ['read_material'] : []), ...readTools, ...coordinationNames, ...readonlyCommandNames, ...unknownCallReviewNames, ...commandRerunNames]
      : [...allowed.map(kernelToolNameOf), ...readTools, ...coordinationNames, ...readonlyCommandNames, ...unknownCallReviewNames, ...commandRerunNames];`,
  `    const enabledNames = hasRead && reviewSource
      ? ['read_source', ...(o.materialTools ? ['read_material'] : []), ...readTools, ...coordinationNames, ...readonlyCommandNames, ...unknownCallReviewNames, ...commandRerunNames]
      : [...allowed.map(kernelToolNameOf), ...readTools, ...coordinationNames, ...readonlyCommandNames, ...unknownCallReviewNames, ...commandRerunNames];
    // Copy-only probe: record both Kernel lists exactly where this function computes them.
    const hostAuthorizedTools = [...coordinationNames, ...readonlyCommandNames, ...unknownCallReviewNames, ...commandRerunNames];
    probeLog('tool-lists', { enabledNames: [...enabledNames], hostAuthorizedTools: [...hostAuthorizedTools] });`, "// Copy-only probe: record both Kernel lists");

edit('src/core/agent-runtime/observed-model-run.ts',
  '        hostAuthorizedTools: [...coordinationNames, ...readonlyCommandNames, ...unknownCallReviewNames, ...commandRerunNames],',
  '        hostAuthorizedTools,', '        hostAuthorizedTools,');

edit('src/core/agent-runtime/observed-model-run.ts',
  `          if (commandRerunTool !== undefined) tools.push(commandRerunTool(workspace));
          return tools;`,
  `          if (commandRerunTool !== undefined) tools.push(commandRerunTool(workspace));
          // Copy-only probe: record the registered definitions in registration order at the existing return.
          probeLog('tools-additional', {
            enabledNames: [...enabledNames], hostAuthorizedTools: [...hostAuthorizedTools],
            tools: tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: jsonSchemaOf(tool.inputSchema) })),
          });
          return tools;`, "// Copy-only probe: record the registered definitions");

edit('src/core/agent-runtime/observed-model-run.ts',
  `    const client: ModelClientPort = {
      async *stream(request, options) {
        await o.sourceTools?.assertCurrent?.();`,
  `    const client: ModelClientPort = {
      async *stream(request, options) {
        // Copy-only probe: the complete tool specs exactly as the Kernel hands them to the provider.
        probeLog('model-client-tools', {
          tools: request.tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
        });
        await o.sourceTools?.assertCurrent?.();`, "// Copy-only probe: the complete tool specs");

console.log(`probes installed in ${root}`);
