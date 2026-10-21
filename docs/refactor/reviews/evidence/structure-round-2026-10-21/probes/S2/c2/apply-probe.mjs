// C2 byte proof: apply the same read-call probe to a base or result copy.
//
// Usage: node apply-probe.mjs <copy-root>
//
// The probe is honest instrumentation only: it wraps the record port handed to
// the four stable-window loops and the calendar clock, appending every read
// call (readMany / lookup / lookupOrdered / eventAt) and every now() call to
// $C2_PROBE_LOG, one tab-separated line per call. It adds no production export.
//
// The three view files differ between the base (inline loops) and the result
// (shared executor), so the loop-argument edits are the only branch. The log
// points are identical: the record port that reaches the window read, and the
// calendar's now() expression. `probedDeps` is created once per factory call,
// exactly where deps enters the loop.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (root === undefined) {
  console.error('usage: node apply-probe.mjs <copy-root>');
  process.exit(2);
}

const views = join(root, 'src/core/work-graph/views');
const probePath = join(views, 'c2-probe.ts');
if (existsSync(probePath)) {
  console.error(`refusing to re-apply: ${probePath} already exists`);
  process.exit(1);
}

const probe = `/**
 * C2 byte-proof probe. Duplicated verbatim into the base and result copies; no
 * production entry point imports it. It appends one line per read call to
 * $C2_PROBE_LOG so the two copies' logs can be compared byte for byte.
 */
import { appendFileSync } from 'node:fs';
import { expect } from 'vitest';

const LOG = process.env.C2_PROBE_LOG;
const READ_METHODS = new Set(['readMany', 'lookup', 'lookupOrdered', 'eventAt']);

function testName(): string {
  try {
    return expect.getState().currentTestName ?? '-';
  } catch {
    return '-';
  }
}

function log(tag: string, kind: string, detail: unknown): void {
  if (LOG === undefined || LOG === '') return;
  appendFileSync(LOG, \`\${testName()}\\t\${tag}\\t\${kind}\\t\${JSON.stringify(detail)}\\n\`);
}

export function probeRecords<T extends object>(records: T, tag: string): T {
  return new Proxy(records, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || typeof property !== 'string' || !READ_METHODS.has(property)) {
        return value;
      }
      return (...args: unknown[]) => {
        log(tag, property, args);
        return (value as (...rest: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

export function probeDeps<T extends { records: object }>(deps: T, tag: string): T {
  return { ...deps, records: probeRecords(deps.records, tag) } as T;
}

export function probeNow(now: () => string, tag: string): () => string {
  return () => {
    log(tag, 'now', []);
    return now();
  };
}
`;
writeFileSync(probePath, probe);

const replaceCount = (text, from, to, file) => {
  const parts = text.split(from);
  if (parts.length === 1) throw new Error(`${file}: missing anchor ${JSON.stringify(from)}`);
  return parts.join(to);
};

const replaceOnce = (text, from, to, file) => {
  const parts = text.split(from);
  if (parts.length !== 2) {
    throw new Error(`${file}: anchor must occur once, got ${String(parts.length - 1)}: ${JSON.stringify(from)}`);
  }
  return parts.join(to);
};

function probeActivity() {
  const file = 'activity-read-model.ts';
  const path = join(views, file);
  let text = readFileSync(path, 'utf8');
  text = replaceOnce(text, "} from './activity-read-helpers.js';",
    "} from './activity-read-helpers.js';\nimport { probeDeps, probeNow } from './c2-probe.js';", file);
  text = replaceOnce(text,
    '  const cap = deps.readRecordCap ?? ACTIVITY_READ_RECORD_CAP;\n  const now = deps.now;',
    '  const cap = deps.readRecordCap ?? ACTIVITY_READ_RECORD_CAP;\n'
      + "  const probedDeps = probeDeps(deps, 'activity');\n"
      + "  const now = probeNow(deps.now, 'calendar');", file);
  if (text.includes('readStableActivityWindow')) {
    // Result copy: the stable window is the shared executor, so the port it
    // receives and the deferred calendar read both go through probedDeps.
    text = replaceCount(text, 'records: deps.records,', 'records: probedDeps.records,', file);
    text = replaceCount(text, 'readCalendarWindow(deps, ctx, input, now(), budget)',
      'readCalendarWindow(probedDeps, ctx, input, now(), budget)', file);
    text = replaceCount(text, 'readRunActivitiesWindow(deps, ctx, input, budget)',
      'readRunActivitiesWindow(probedDeps, ctx, input, budget)', file);
  } else {
    // Base copy: the inline loop reads the watermark and the window directly.
    text = replaceCount(text, 'readWatermark(deps.records)', 'readWatermark(probedDeps.records)', file);
    text = replaceCount(text, 'readCalendarWindow(deps, ctx, input, now(), budget)',
      'readCalendarWindow(probedDeps, ctx, input, now(), budget)', file);
    text = replaceCount(text, 'readRunActivitiesWindow(deps, ctx, input, budget)',
      'readRunActivitiesWindow(probedDeps, ctx, input, budget)', file);
  }
  writeFileSync(path, text);
}

function probeSimple(file, tag, windowCall, windowProbed) {
  const path = join(views, file);
  let text = readFileSync(path, 'utf8');
  text = replaceOnce(text, "} from './activity-read-helpers.js';",
    "} from './activity-read-helpers.js';\nimport { probeDeps } from './c2-probe.js';", file);
  text = replaceOnce(text,
    '  const cap = deps.readRecordCap ?? ACTIVITY_READ_RECORD_CAP;\n  return {',
    '  const cap = deps.readRecordCap ?? ACTIVITY_READ_RECORD_CAP;\n'
      + `  const probedDeps = probeDeps(deps, '${tag}');\n  return {`, file);
  if (text.includes('readStableActivityWindow')) {
    text = replaceCount(text, 'records: deps.records,', 'records: probedDeps.records,', file);
  } else {
    text = replaceCount(text, 'readWatermark(deps.records)', 'readWatermark(probedDeps.records)', file);
  }
  text = replaceCount(text, windowCall, windowProbed, file);
  writeFileSync(path, text);
}

probeActivity();
probeSimple('track-read-model.ts', 'track',
  'readTrackBarsWindow(deps, ctx, input, budget)', 'readTrackBarsWindow(probedDeps, ctx, input, budget)');
probeSimple('task-state-timeline.ts', 'timeline',
  'readTimelineWindow(deps, ctx, input, budget)', 'readTimelineWindow(probedDeps, ctx, input, budget)');

console.log(`probe applied to ${root}`);
