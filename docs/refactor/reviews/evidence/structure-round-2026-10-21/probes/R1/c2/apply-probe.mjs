// C2 byte proof v2: apply the same read-call probe to a base or result copy.
//
// Usage: node apply-probe.mjs <copy-root>
//
// The probe is honest instrumentation only. It adds views/c2-probe.ts (not
// imported by any production entry point) and imports it from the four view
// files. It logs, one tab-separated line per call, newline-terminated:
//
//   <test name>\t<tag>\t<kind>\t<detail>
//
// Store calls (readMany / lookup / lookupOrdered / eventAt) log their arguments
// AND their resolved result or thrown error; calendar now() logs its result.
// The four public read loops log a `*-result` / `result` line. Values are
// serialized without sorting, canonicalisation or JSON's undefined merging.
//
// The view files differ between the base (inline loops) and the result (shared
// executor), so only the loop-argument edits branch, exactly as in S2. The
// factory-return wrapping anchors are identical in both branches.
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

// The generated probe. Keep this byte-identical in the base and result copies.
const probe = `/**
 * C2 byte-proof probe. Duplicated verbatim into the base and result copies; no
 * production entry point imports it. It appends one line per read call to
 * $C2_PROBE_LOG so the two copies' logs can be compared byte for byte.
 */
import { appendFileSync } from 'node:fs';
import { expect } from 'vitest';

const LOG = process.env.C2_PROBE_LOG;
const READ_METHODS = new Set(['readMany', 'lookup', 'lookupOrdered', 'eventAt']);

// Literal text, not a NUL byte: keeps logs printable and line-oriented.
const ZERO = '\\\\u0000';
const UNDEFINED = ZERO + 'undefined';

function testName(): string {
  try {
    return expect.getState().currentTestName ?? '-';
  } catch {
    return '-';
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.name + ': ' + JSON.stringify(error.message);
  let text: string;
  try {
    text = String(error);
  } catch {
    text = 'unprintable';
  }
  return 'thrown: ' + JSON.stringify(text);
}

function encode(value: unknown, seen: Set<object>): string {
  if (value === undefined) return UNDEFINED;
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number': {
      if (Number.isNaN(value)) return 'NaN';
      if (value === Infinity) return 'Infinity';
      if (value === -Infinity) return '-Infinity';
      if (Object.is(value, -0)) return '-0';
      return JSON.stringify(value);
    }
    case 'bigint':
      return ZERO + 'bigint:' + value.toString();
    case 'symbol':
      return ZERO + 'symbol:' + String(value);
    case 'function':
      return ZERO + 'function:' + (value.name === '' ? 'anonymous' : value.name);
    case 'object':
      break;
    default:
      return ZERO + typeof value;
  }
  const object = value as object;
  if (seen.has(object)) return ZERO + 'circular';
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      const parts: string[] = [];
      for (let index = 0; index < object.length; index += 1) {
        parts.push(Object.prototype.hasOwnProperty.call(object, index)
          ? encode((object as unknown[])[index], seen)
          : ZERO + 'hole');
      }
      return '[' + parts.join(',') + ']';
    }
    if (object instanceof Date) return ZERO + 'date:' + object.toISOString();
    if (object instanceof Map) {
      const parts: string[] = [];
      for (const [key, item] of object) {
        parts.push(encode(key, seen) + '=>' + encode(item, seen));
      }
      return ZERO + 'map{' + parts.join(',') + '}';
    }
    if (object instanceof Set) {
      const parts: string[] = [];
      for (const item of object) parts.push(encode(item, seen));
      return ZERO + 'set{' + parts.join(',') + '}';
    }
    const parts: string[] = [];
    for (const key of Object.keys(object)) {
      parts.push(JSON.stringify(key) + ':' + encode((object as Record<string, unknown>)[key], seen));
    }
    return '{' + parts.join(',') + '}';
  } finally {
    seen.delete(object);
  }
}

/** Own key order preserved; missing, explicit undefined and null stay distinct. */
export function serialize(value: unknown): string {
  return encode(value, new Set<object>());
}

function writeLine(line: string): void {
  if (LOG === undefined || LOG === '') return;
  appendFileSync(LOG, line + '\\n');
}

function logCall(tag: string, kind: string, detail: string): void {
  writeLine(testName() + '\\t' + tag + '\\t' + kind + '\\t' + detail);
}

export function probeRecords<T extends object>(records: T, tag: string): T {
  return new Proxy(records, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || typeof property !== 'string' || !READ_METHODS.has(property)) {
        return value;
      }
      const method = value as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => {
        const argsText = 'args=' + serialize(args);
        let outcome: unknown;
        try {
          outcome = method.apply(target, args);
        } catch (error) {
          logCall(tag, property, argsText + ' error=' + errorText(error));
          throw error;
        }
        if (outcome !== null && (typeof outcome === 'object' || typeof outcome === 'function')
          && typeof (outcome as { then?: unknown }).then === 'function') {
          return (outcome as Promise<unknown>).then(
            (resolved) => {
              logCall(tag, property, argsText + ' result=' + serialize(resolved));
              return resolved;
            },
            (error: unknown) => {
              logCall(tag, property, argsText + ' error=' + errorText(error));
              throw error;
            },
          );
        }
        logCall(tag, property, argsText + ' result=' + serialize(outcome));
        return outcome;
      };
    },
  });
}

export function probeDeps<T extends { records: object }>(deps: T, tag: string): T {
  return { ...deps, records: probeRecords(deps.records, tag) } as T;
}

export function probeNow(now: () => string, tag: string): () => string {
  return () => {
    let value: string;
    try {
      value = now();
    } catch (error) {
      logCall(tag, 'now', 'args=[] error=' + errorText(error));
      throw error;
    }
    logCall(tag, 'now', 'args=[] result=' + serialize(value));
    return value;
  };
}

/** Wrap one public read-loop method and log its resolved value or throw. */
export function probeResult<A extends unknown[], R>(
  tag: string,
  method: (...args: A) => R,
): (...args: A) => Promise<Awaited<R>> {
  return async (...args: A): Promise<Awaited<R>> => {
    try {
      const value = await method(...args);
      logCall(tag, 'result', 'result=' + serialize(value));
      return value;
    } catch (error) {
      logCall(tag, 'result', 'error=' + errorText(error));
      throw error;
    }
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

const IMPORT_LINE = "import { probeDeps, probeNow, probeResult } from './c2-probe.js';";
const IMPORT_SIMPLE = "import { probeDeps, probeResult } from './c2-probe.js';";

// Turn the factory's final `return { ...methods... }; }` into
// `const model = { ...methods... }; return { <wrapped methods> }; }`.
// The method names are unique, so the opening anchor picks the factory itself.
function wrapFactory(text, file, firstMethod, entries) {
  text = replaceOnce(text,
    `  return {\n    async ${firstMethod}`,
    `  const model = {\n    async ${firstMethod}`, file);
  const closeMarker = '\n  };\n}';
  const at = text.lastIndexOf(closeMarker);
  if (at === -1) throw new Error(`${file}: missing factory close ${JSON.stringify(closeMarker)}`);
  const before = text.slice(0, at);
  const after = text.slice(at + closeMarker.length);
  const wrapped = entries.map(([method, tag]) =>
    `    ${method}: probeResult('${tag}', model.${method}.bind(model)),`).join('\n');
  return before + '\n  };\n  return {\n' + wrapped + '\n  };\n}' + after;
}

function probeActivity() {
  const file = 'activity-read-model.ts';
  const path = join(views, file);
  let text = readFileSync(path, 'utf8');
  text = replaceOnce(text, "} from './activity-read-helpers.js';",
    "} from './activity-read-helpers.js';\n" + IMPORT_LINE, file);
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
  text = wrapFactory(text, file, 'readActivityCalendar', [
    ['readActivityCalendar', 'calendar-result'],
    ['readRunActivities', 'run-result'],
  ]);
  writeFileSync(path, text);
}

function probeSimple(file, tag, firstMethod, windowCall, windowProbed, resultTag) {
  const path = join(views, file);
  let text = readFileSync(path, 'utf8');
  text = replaceOnce(text, "} from './activity-read-helpers.js';",
    "} from './activity-read-helpers.js';\n" + IMPORT_SIMPLE, file);
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
  text = wrapFactory(text, file, firstMethod, [[firstMethod, resultTag]]);
  writeFileSync(path, text);
}

probeActivity();
probeSimple('track-read-model.ts', 'track', 'readTrackBars',
  'readTrackBarsWindow(deps, ctx, input, budget)', 'readTrackBarsWindow(probedDeps, ctx, input, budget)', 'track-result');
probeSimple('task-state-timeline.ts', 'timeline', 'readTaskStateTimeline',
  'readTimelineWindow(deps, ctx, input, budget)', 'readTimelineWindow(probedDeps, ctx, input, budget)', 'timeline-result');

console.log(`probe applied to ${root}`);
