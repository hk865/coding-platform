/**
 * Slice 8 L8 / A-03 (spec §5.2 A-03; book rulings 9–11): the PURE architecture
 * reminder rows and the pure directory-prefix helper. Constructed input only —
 * the rendering rules (order, text, time, cap, empty cases) are the seam.
 * Expected strings are hand-computed from the A-03 fixture, never printed from
 * the implementation. The public prepare path is in the sibling
 * `S8A-L8-reminders-public.test.ts`; the file-plus-child-path combination below
 * is unreachable from public steps and therefore lives only in this pure file
 * (T27).
 */
import { describe, expect, it } from 'vitest';
import type { AdoptedArchitecture } from '../../src/contracts/architecture-catalog.js';
import type {
  ArchitectureReminderFactsV1, ArchitectureReminderObservationV1,
} from '../../src/contracts/architecture-observation.js';
import type { FormalObservedFindingV1, ObservedCaptureRef } from '../../src/contracts/architecture-inspection.js';
import type { ModuleRef } from '../../src/contracts/core/identity.js';
import type { PersistedSourceCaptureRef } from '../../src/contracts/core/source.js';
import {
  bestModuleDirectoryPrefixLength, commonDirectoryPrefixLength,
} from '../../src/contracts/path-ownership.js';
import { architectureReminderRowEntries } from '../../src/core/agent-runtime/architecture-reminders.js';

const OBSERVED_AT = '2026-10-17T00:00:00.000Z';
const PROJECT = 'p';
const A: ModuleRef = { projectId: PROJECT, moduleId: 'A' };
const B: ModuleRef = { projectId: PROJECT, moduleId: 'B' };
const CAPTURE: ObservedCaptureRef = {
  aggregateType: 'ObservedArchitecture', projectId: PROJECT, workspaceId: 'w', captureId: 'cap-2',
};
const PREVIOUS_CAPTURE: ObservedCaptureRef = { ...CAPTURE, captureId: 'cap-1' };
/** The stored ref the public observation-state read also returns (suggestion 5). */
function persisted(captureId: string): PersistedSourceCaptureRef {
  return {
    capture: { projectId: PROJECT, workspaceId: 'w', captureId, workspaceRevision: 1,
      sourceDigest: 'source', configDigest: 'config', indexVersion: 'typescript@1' },
    material: { kind: 'artifact', contentType: 'application/json', digest: 'digest', sizeBytes: 1,
      source: { kind: 'workspace', refId: 'w', revision: '1' } },
  };
}

/** Plus the exact preparation time `+3h05m`; floor -> `3 小时前`. */
function at(offsetMs: number): string {
  return new Date(Date.parse(OBSERVED_AT) + offsetMs).toISOString();
}
const THREE_HOURS_FIVE = at((3 * 60 + 5) * 60_000);

/** The final rendered row texts; ordering and keys are the pure builder's. */
function texts(input: Parameters<typeof architectureReminderRowEntries>[0]): string[] {
  return architectureReminderRowEntries(input).map(row => row.text);
}

function a03Catalog(): AdoptedArchitecture {
  return {
    requireDag: true,
    modules: [
      { ref: A, name: 'A', responsibility: 'A core', paths: ['src/a/core'], interfaces: [] },
      { ref: B, name: 'B', responsibility: 'B', paths: ['src/b'], interfaces: [] },
    ],
    dependencies: [{ from: A, to: B, reason: 'A uses B' }],
  };
}

function nodes(paths: { path: string; digest: string }[]): ArchitectureReminderObservationV1 {
  return { observedAt: OBSERVED_AT, nodes: paths };
}

const A03_LATEST = nodes([
  { path: 'src/a/core/one.ts', digest: 'd1' },
  { path: 'src/a/core/util.ts', digest: 'd2' },
  { path: 'src/b/lib.ts', digest: 'd3' },
  { path: 'src/b/extra.ts', digest: 'd4' },
  { path: 'src/a/loose.ts', digest: 'd5' },
  { path: 'src/new.ts', digest: 'd' },
]);
const A03_PREVIOUS = nodes([
  { path: 'src/a/core/one.ts', digest: 'd1' },
  { path: 'src/b/lib.ts', digest: 'd3' },
  { path: 'src/old.ts', digest: 'd' },
]);

const A03_FINDINGS: FormalObservedFindingV1[] = [
  { kind: 'dependency_missing', moduleRef: A, path: 'src/a/core', detail: 'A→B', certainty: 'proven' },
  { kind: 'import_undeclared', moduleRef: B, path: 'src/b/extra.ts', detail: 'src/a/core/util.ts', certainty: 'proven' },
  { kind: 'ungrouped', moduleRef: null, path: 'src/a/loose.ts', detail: '不在任何模块 path 下', certainty: 'unknown' },
];

function facts(overrides: Partial<ArchitectureReminderFactsV1> = {}): ArchitectureReminderFactsV1 {
  return {
    state: { current: { captureRef: CAPTURE, persistedRef: persisted('cap-2'), observedAt: OBSERVED_AT },
      previous: PREVIOUS_CAPTURE, previousPersistedRef: persisted('cap-1'), autoCapture: null },
    catalog: a03Catalog(),
    latest: A03_LATEST,
    previous: A03_PREVIOUS,
    findings: A03_FINDINGS,
    ...overrides,
  };
}

describe('commonDirectoryPrefixLength / bestModuleDirectoryPrefixLength (interface §9)', () => {
  it('A-03: src/a/loose.ts scores 2 for src/a/core and 1 for src/b', () => {
    expect(commonDirectoryPrefixLength('src/a/loose.ts', 'src/a/core')).toBe(2);
    expect(commonDirectoryPrefixLength('src/a/loose.ts', 'src/b')).toBe(1);
  });

  it('A-03: src/new.ts ties at 1 between src/a/core and src/b', () => {
    expect(bestModuleDirectoryPrefixLength('src/new.ts', ['src/a/core'])).toBe(1);
    expect(bestModuleDirectoryPrefixLength('src/new.ts', ['src/b'])).toBe(1);
  });

  it('counts only leading DIRECTORY segments; a basename is never a directory', () => {
    expect(commonDirectoryPrefixLength('src/a/core/one.ts', 'src/a/core')).toBe(3);
    // The file's own last segment is not a directory, even when it equals the module path.
    expect(commonDirectoryPrefixLength('src/a/core', 'src/a/core')).toBe(2);
    expect(commonDirectoryPrefixLength('src/a/core', 'src/a/core/one.ts')).toBe(2);
    // The module path is a directory even when it ends in a file-looking name.
    expect(commonDirectoryPrefixLength('src/a/one.ts', 'src/a/other.ts')).toBe(2);
    expect(commonDirectoryPrefixLength('src/x.ts', 'lib')).toBe(0);
  });

  it('`.` scores 0 and at least 1 counts only', () => {
    expect(commonDirectoryPrefixLength('src/a/loose.ts', '.')).toBe(0);
    expect(commonDirectoryPrefixLength('loose.ts', 'src')).toBe(0);
    expect(bestModuleDirectoryPrefixLength('src/a/loose.ts', ['.', 'src/a/core'])).toBe(2);
    expect(bestModuleDirectoryPrefixLength('src/a/loose.ts', [])).toBe(0);
  });
});

describe('architectureReminderRowEntries (interface §8/§11, book rulings 9–11)', () => {
  it('an observation with nothing to say -> no rows', () => {
    expect(texts({
      facts: facts({ catalog: null, findings: [], previous: A03_LATEST }), taskModuleRef: null, now: THREE_HOURS_FIVE,
    })).toEqual([]);
  });

  // T25: the two "only moves" conditions are independent inputs. Deleting the
  // catalog check fails the first row; deleting the task-module check fails the
  // second; neither row can be satisfied through the other condition.
  it('T25: catalog=null with a task module present -> only move rows', () => {
    expect(texts({
      facts: facts({ catalog: null }), taskModuleRef: A, now: THREE_HOURS_FIVE,
    })).toEqual(['可能移动：src/old.ts → src/new.ts（3 小时前的观测）']);
  });

  it('T25: taskModule=null with a catalog present -> only move rows', () => {
    expect(texts({
      facts: facts(), taskModuleRef: null, now: THREE_HOURS_FIVE,
    })).toEqual(['可能移动：src/old.ts → src/new.ts（3 小时前的观测）']);
  });

  // T26: the two uniqueness checks are proved separately (deleted 2/added 1,
  // then deleted 1/added 2), plus the positive 1/1. A full-list uniqueness rule
  // is not what these rows assert.
  it('T26: two deleted paths carrying the digest and one added path -> no move', () => {
    const previous = nodes([
      { path: 'src/old-a.ts', digest: 'same' },
      { path: 'src/old-b.ts', digest: 'same' },
    ]);
    const latest = nodes([{ path: 'src/new.ts', digest: 'same' }]);
    expect(texts({
      facts: facts({ latest, previous, findings: [] }), taskModuleRef: A, now: THREE_HOURS_FIVE,
    })).toEqual([]);
  });

  it('T26: one deleted path carrying the digest and two added paths -> no move', () => {
    const previous = nodes([{ path: 'src/old.ts', digest: 'same' }]);
    const latest = nodes([
      { path: 'src/new-a.ts', digest: 'same' },
      { path: 'src/new-b.ts', digest: 'same' },
    ]);
    expect(texts({
      facts: facts({ latest, previous, findings: [] }), taskModuleRef: A, now: THREE_HOURS_FIVE,
    })).toEqual([]);
  });

  it('T26: exactly one deleted and one added path carrying the digest -> one move', () => {
    const previous = nodes([{ path: 'src/moved-from.ts', digest: 'same' }]);
    const latest = nodes([{ path: 'src/moved-to.ts', digest: 'same' }]);
    expect(texts({
      facts: facts({ latest, previous, findings: [] }), taskModuleRef: A, now: THREE_HOURS_FIVE,
    })).toEqual(['可能移动：src/moved-from.ts → src/moved-to.ts（3 小时前的观测）']);
  });

  // T31: the unchanged path also carries the digest, so full-list uniqueness
  // would reject; the ruling-9 deleted/added subset rule still yields one move.
  it('T31: one deleted + one added + one unchanged path with the same digest -> exactly one move', () => {
    const previous = nodes([
      { path: 'src/old.ts', digest: 'carried' },
      { path: 'src/keep.ts', digest: 'carried' },
    ]);
    const latest = nodes([
      { path: 'src/keep.ts', digest: 'carried' },
      { path: 'src/new.ts', digest: 'carried' },
    ]);
    expect(texts({
      facts: facts({ latest, previous, findings: [] }), taskModuleRef: A, now: THREE_HOURS_FIVE,
    })).toEqual(['可能移动：src/old.ts → src/new.ts（3 小时前的观测）']);
  });

  // T30: each boundary is its own input; every literal is hand-computed from
  // the ruling-11 floor rule (59 s, 60 s, 119 s, 59 min, 60 min, 23 h, 24 h,
  // 3 days and 3 days 23 h).
  const ELAPSED_CASES: ReadonlyArray<readonly [number, string]> = [
    [59_000, '刚才'],
    [60_000, '1 分钟前'],
    [119_000, '1 分钟前'],
    [59 * 60_000, '59 分钟前'],
    [60 * 60_000, '1 小时前'],
    [23 * 3_600_000, '23 小时前'],
    [24 * 3_600_000, '1 天前'],
    [3 * 24 * 3_600_000, '3 天前'],
    [3 * 24 * 3_600_000 + 23 * 3_600_000, '3 天前'],
  ];
  it.each(ELAPSED_CASES)('T30: %s ms elapsed renders %s', (offset, elapsed) => {
    const latest = nodes([{ path: 'src/a/core/one.ts', digest: 'd1' }]);
    expect(texts({
      facts: facts({ latest, previous: latest, findings: [
        { kind: 'ungrouped', moduleRef: null, path: 'src/a/core/loose.ts', detail: '', certainty: 'unknown' },
      ] }), taskModuleRef: A, now: at(offset),
    })).toEqual([`新文件没归组：src/a/core/loose.ts（${elapsed}的观测）`]);
  });

  // T32: the third sort key is the rest of the row. Same kind, same path, two
  // different dependency contents, shuffled input: the complete literal order.
  it('T32: same kind and path, different rest -> sorted by the full row content', () => {
    const findings: FormalObservedFindingV1[] = [
      { kind: 'dependency_missing', moduleRef: A, path: 'src/a/core', detail: 'A→C', certainty: 'proven' },
      { kind: 'dependency_missing', moduleRef: A, path: 'src/a/core', detail: 'A→B', certainty: 'proven' },
    ];
    const rows = architectureReminderRowEntries({
      facts: facts({ findings, previous: A03_LATEST }), taskModuleRef: A, now: THREE_HOURS_FIVE,
    });
    expect(rows.map(row => row.text)).toEqual([
      '声明的依赖没有 import：A→B，src/a/core（3 小时前的观测）',
      '声明的依赖没有 import：A→C，src/a/core（3 小时前的观测）',
    ]);
    expect(rows.map(row => row.key)).toEqual(['architecture:000000', 'architecture:000001']);
  });

  it('keeps a dependency finding whose OTHER end is the task module', () => {
    // B→A: the missing dependency is declared from B, and A is its target.
    const fromB: FormalObservedFindingV1 = {
      kind: 'dependency_missing', moduleRef: B, path: 'src/b', detail: 'B→A', certainty: 'proven',
    };
    const catalog = a03Catalog();
    catalog.dependencies.push({ from: B, to: A, reason: 'B uses A' });
    const rows = texts({
      facts: facts({ catalog, findings: [fromB], previous: A03_LATEST }), taskModuleRef: A, now: THREE_HOURS_FIVE,
    });
    expect(rows).toEqual(['声明的依赖没有 import：B→A，src/b（3 小时前的观测）']);
  });

  // T27: a file and its own child path cannot exist together on a real
  // filesystem, so no public capture can produce this pair; this pure renderer
  // file is its only home. The exact pair the path-in-key sort inverted
  // (`/` sorts before the key separator).
  it('T27: keeps the literal src/a before src/a/inner paths with ascending keys', () => {
    const latest = nodes([
      { path: 'src/a', digest: 'u1' },
      { path: 'src/a/inner', digest: 'u2' },
    ]);
    const catalog = a03Catalog();
    catalog.modules = [catalog.modules[0]!, { ...catalog.modules[1]!, paths: ['lib'] }];
    const findings: FormalObservedFindingV1[] = [
      { kind: 'ungrouped', moduleRef: null, path: 'src/a', detail: '不在任何模块 path 下', certainty: 'unknown' },
      { kind: 'ungrouped', moduleRef: null, path: 'src/a/inner', detail: '不在任何模块 path 下', certainty: 'unknown' },
    ];
    const entries = architectureReminderRowEntries({
      facts: facts({ catalog, latest, previous: latest, findings }), taskModuleRef: A, now: THREE_HOURS_FIVE,
    });
    expect(entries.map(entry => entry.text)).toEqual([
      '新文件没归组：src/a（3 小时前的观测）',
      '新文件没归组：src/a/inner（3 小时前的观测）',
    ]);
    expect(entries.map(entry => entry.key)).toEqual(['architecture:000000', 'architecture:000001']);
  });
});
