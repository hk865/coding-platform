/**
 * Probe-only capture module (D2 byte proof). It is copied by apply-probe.py into
 * src/core/agent-runtime/__probe-log.ts in each scratch copy and never enters the
 * result. It writes one JSON line per capture to
 * `$S85_PROBE_LOG_DIR/probe-<pid>.jsonl`:
 *
 *   {testFile, testName, kind, runIndex, payload}
 *
 * `testFile` is relative to the copy root, so the base and result logs match.
 * Undefined is serialised with the `{ "__undefined__": true }` marker; key order
 * is the order of the object literal (never sorted). One file per process keeps
 * two vitest workers from interleaving writes.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect } from 'vitest';
import type { ToolDefinition } from '../../../vendor/coding-agent/dist/public-api.js';

const counters = new Map<string, number>();
const logDir = process.env['S85_PROBE_LOG_DIR'];
const countersKey = (testFile: string, testName: string, kind: string): string =>
  `${testFile}\u0000${testName}\u0000${kind}`;

type ExpectState = { testPath?: unknown; currentTestName?: unknown };

function testIdentity(): { testFile: string; testName: string } {
  const state = expect.getState() as unknown as ExpectState;
  const testPath = typeof state.testPath === 'string' ? state.testPath : '<unknown-file>';
  const testName = typeof state.currentTestName === 'string' ? state.currentTestName : '<unknown-test>';
  const relativePath = relative(process.cwd(), testPath).split('\\').join('/');
  return { testFile: relativePath === '' ? testPath : relativePath, testName };
}

/** JSON with an explicit undefined marker; never sorts or drops own keys. */
function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === undefined) return { __undefined__: true };
    if (typeof item === 'function') return { __function__: (item as { name?: string }).name ?? '<anonymous>' };
    if (typeof item === 'bigint') return { __bigint__: (item as bigint).toString() };
    if (typeof item === 'symbol') return { __symbol__: String(item) };
    return item;
  });
}

export function probeLog(kind: string, payload: unknown): void {
  if (logDir === undefined) return;
  const { testFile, testName } = testIdentity();
  const key = countersKey(testFile, testName, kind);
  const runIndex = (counters.get(key) ?? 0) + 1;
  counters.set(key, runIndex);
  mkdirSync(logDir, { recursive: true });
  const line = serialize({ testFile, testName, kind, runIndex, payload });
  appendFileSync(join(logDir, `probe-${process.pid}.jsonl`), `${line}\n`, 'utf8');
}

function schemaOf(definition: ToolDefinition): unknown {
  const candidate = definition.inputSchema as unknown as { toJSONSchema?: () => unknown };
  try {
    return typeof candidate.toJSONSchema === 'function'
      ? candidate.toJSONSchema()
      : { __schema__: 'no toJSONSchema' };
  } catch (error) {
    return { __schemaError__: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Call the existing callback exactly once and record its own return value.
 * No factory and no resource is touched here.
 */
export function probeAdditionalTools(create: () => ToolDefinition[]): ToolDefinition[] {
  const tools = create();
  probeLog('additional-tools', {
    definitions: tools.map((tool, index) => ({
      index,
      name: tool.name,
      description: tool.description,
      effectClass: tool.effectClass,
      requiredCapabilities: [...tool.requiredCapabilities],
      defaultTimeoutMs: tool.defaultTimeoutMs,
      outputLimitBytes: tool.outputLimitBytes,
      independentReadOnly: tool.independentReadOnly,
      inputSchema: schemaOf(tool),
    })),
  });
  return tools;
}
