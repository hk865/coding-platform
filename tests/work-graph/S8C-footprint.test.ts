/**
 * 8C G3 R5 — the pure repair-footprint predicate (`footprintProblem`).
 *
 * Rule sheet A5: each row hands the predicate already-read material and states
 * the hand-computed result. The catalog is the W-A shape `src` / `src/a` /
 * `docs`; a definite file maps by the longest path owner. No store, no owner.
 */
import { describe, expect, it } from 'vitest';
import type { AdoptedArchitecture, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { CatalogRepairOpV1 } from '../../src/contracts/note.js';
import type { RunActivitySnapshot } from '../../src/contracts/run-activity.js';
import { footprintProblem } from '../../src/core/work-graph/notes/activate-repair.js';

const P = 's8c-footprint';
const ref = (moduleId: string) => ({ projectId: P, moduleId });

function catalog(): AdoptedArchitecture {
  const module = (moduleId: string, paths: string[]): ModuleDefinition => ({ ref: ref(moduleId), name: moduleId,
    responsibility: `Own ${moduleId}`, paths, interfaces: [] });
  return { requireDag: true, dependencies: [], modules: [module('M', ['src']), module('M2', ['src/a']),
    module('N', ['docs'])] };
}

function counted(definite: string[], overrides: { possiblyIncomplete?: boolean; definiteOmitted?: number } = {})
: RunActivitySnapshot {
  return { ref: { aggregateType: 'RunActivity', projectId: P, goalId: 'g', runId: 'r' }, revision: 1, schemaVersion: 1,
    runRef: { aggregateType: 'Run', projectId: P, goalId: 'g', runId: 'r' }, taskId: 't1', workspaceId: 'w',
    sessionRef: null, runEndedAt: 'T', recordedBy: 'run_end', recordedAt: 'T',
    facts: { status: 'counted', ruleVersion: 1,
      window: { kernelRunId: 'k', kernelTurnId: 'u', fromPosition: 1, throughPosition: 2, bound: 'end_position',
        turnTerminal: true, unresolvedCalls: 0, turnStartedAt: 'T', lastRecordAt: 'T' },
      quarters: [], overflow: null, totals: { steps: 0, edits: 0, editsUnknown: 0 },
      changedFiles: { definite, possible: [], definiteOmitted: overrides.definiteOmitted ?? 0, possibleOmitted: 0,
        possiblyIncomplete: overrides.possiblyIncomplete ?? false, incompleteBecause: [] },
      changedLines: { added: 0, deleted: 0, complete: true },
      usage: { requests: [], omitted: 0, totals: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, complete: true } },
    span: { firstAt: null, lastAt: 'T', basis: 'run_times' } };
}

const unknown: RunActivitySnapshot = { ...counted([]), facts: { status: 'unknown', ruleVersion: 1,
  reason: 'history_read_failed', detail: 'unreadable' } };
const setM: CatalogRepairOpV1 = { op: 'set_responsibility', moduleId: 'M', text: 'repair' };
const observed = new Set(['src/a/x.ts', 'docs/readme.md']);
const definite = ['src/a/x.ts'];

const CASES: readonly { name: string; activity: RunActivitySnapshot | null; observation: ReadonlySet<string> | null;
  ops: CatalogRepairOpV1[]; approval: 'approve' | null;
  expected: { kind: 'unknown' | 'outside' } | null; paths?: string[] }[] = [
  { name: 'a missing activity is unknown', activity: null, observation: observed, ops: [setM], approval: null,
    expected: { kind: 'unknown' } },
  { name: 'an unknown activity is unknown', activity: unknown, observation: observed, ops: [setM], approval: null,
    expected: { kind: 'unknown' } },
  { name: 'an incomplete activity is unknown', activity: counted(definite, { possiblyIncomplete: true }),
    observation: observed, ops: [setM], approval: null, expected: { kind: 'unknown' } },
  { name: 'a literal file outside the definite set is outside', activity: counted(definite), observation: observed,
    ops: [{ op: 'add_path', moduleId: 'M', path: 'docs/readme.md' }], approval: null, expected: { kind: 'outside' },
    paths: ['docs/readme.md'] },
  { name: 'a new module path that is a definite file is allowed', activity: counted(definite), observation: observed,
    ops: [{ op: 'add_module', module: { ref: ref('M3'), name: 'M3', responsibility: 'new', paths: ['src/a/x.ts'],
      interfaces: [] } }], approval: null, expected: null },
  { name: 'a dependency endpoint outside is refused', activity: counted(definite), observation: observed,
    ops: [{ op: 'add_dependency', from: ref('M'), to: ref('N'), reason: 'test' }], approval: null, expected: { kind: 'outside' },
    paths: ['N'] },
  { name: 'a forbid endpoint outside is refused', activity: counted(definite), observation: observed,
    ops: [{ op: 'add_forbid_rule', from: ref('M'), to: ref('N'), reason: 'test' }], approval: null, expected: { kind: 'outside' },
    paths: ['N'] },
  { name: 'a prefix without a successful observation is unknown', activity: counted(definite), observation: null,
    ops: [{ op: 'add_path', moduleId: 'M', path: 'src/a' }], approval: null, expected: { kind: 'unknown' }, paths: ['src/a'] },
  { name: 'a prefix with an observed file not definite is outside', activity: counted(definite),
    observation: new Set(['src/a/x.ts', 'src/a/y.ts']), ops: [{ op: 'add_path', moduleId: 'M', path: 'src/a' }], approval: null,
    expected: { kind: 'outside' }, paths: ['src/a'] },
  { name: 'the `.` root prefix needs every observed file definite', activity: counted(definite), observation: observed,
    ops: [{ op: 'add_path', moduleId: 'M', path: '.' }], approval: null, expected: { kind: 'outside' }, paths: ['.'] },
  { name: 'approve clears a prefix without a successful observation', activity: counted(['src/a.ts']), observation: null,
    ops: [{ op: 'add_path', moduleId: 'M', path: 'src' }], approval: 'approve', expected: null },
  { name: 'a prefix without a successful observation stays unknown without approve', activity: counted(['src/a.ts']),
    observation: null, ops: [{ op: 'add_path', moduleId: 'M', path: 'src' }], approval: null,
    expected: { kind: 'unknown' }, paths: ['src'] },
  { name: 'approve clears an unknown footprint', activity: null, observation: observed, ops: [setM],
    approval: 'approve', expected: null },
  { name: 'approve does not clear a proven outside path', activity: counted(definite), observation: observed,
    ops: [{ op: 'add_path', moduleId: 'M', path: 'docs/readme.md' }], approval: 'approve', expected: { kind: 'outside' },
    paths: ['docs/readme.md'] },
];

describe('S8C G3 R5 footprint predicate', () => {
  it.each(CASES)('R5: $name', testCase => {
    const result = footprintProblem({ activity: testCase.activity, catalog: catalog(), declared: [ref('M')],
      observation: testCase.observation, ops: testCase.ops, approval: testCase.approval });
    if (testCase.expected === null) expect(result).toBeNull();
    else expect(result).toMatchObject({ ...testCase.expected, paths: testCase.paths ?? [] });
  });
});
