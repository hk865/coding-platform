/**
 * Slice 8 L8 / A-03 (spec §5.2 A-03; book rulings 9–12, rework-2 rows C/D/F):
 * the public preparation path. A real claim is produced by the real claim
 * service over a real accepted Plan whose first Task carries a module; the
 * active catalog is adopted through the public architecture writer; the
 * observations are real captures of real workspace files; only then does the
 * real `platform.runtime.prepareExecution` run — and it is stopped before any
 * model call (no client call happens).
 *
 * Expected rows are hand-computed literals from A-03 (and the ruling-11
 * variants). The observation refs and `observedAt` are read through the public
 * `architecture.observationState` port, never from the store. Preparation goes
 * through ONE `runtime.prepareExecution` and reads its manifest body through
 * `materials.openArtifact` (W3's H4 helper), never a locally built body store.
 * The reminder-fault rows are A2 wrappers around the composition root's REAL
 * reminder reader; the cancellation rows abort a real prepare context.
 */
import { describe, expect, it } from 'vitest';
import type { ArchitectureObservationStateV1 } from '../../src/contracts/architecture-observation.js';
import type { PreparedTaskExecution } from '../../src/contracts/core/prepared-execution.js';
import {
  A03_STAGES, FIRST_AT, THREE_HOURS_FIVE, architectureRows, createReminderWorld,
  occurrences, waitObservationState,
} from '../helpers/S8A-L8-reminder-world.js';

const a03Rows = [
  '声明的依赖没有 import：A→B，src/a/core（3 小时前的观测）',
  'import 没有声明的依赖：src/b/extra.ts → src/a/core/util.ts（3 小时前的观测）',
  '新文件没归组：src/a/loose.ts（3 小时前的观测）',
  '可能移动：src/old.ts → src/new.ts（3 小时前的观测）',
];

function prepNowAfter(observedAt: string | null): string {
  return new Date(Date.parse(observedAt ?? FIRST_AT) + THREE_HOURS_FIVE * 60_000).toISOString();
}

async function observationState(world: Awaited<ReturnType<typeof createReminderWorld>>):
Promise<ArchitectureObservationStateV1> {
  const state = await world.platform.architecture.observationState(world.ctx, { workspace: world.scope });
  if (state.status !== 'ready') throw new Error(`the public observation state read failed: ${JSON.stringify(state)}`);
  return state.value;
}

async function prepareAtObservedTime(world: Awaited<ReturnType<typeof createReminderWorld>>,
  requestId: string): Promise<{ prepared: PreparedTaskExecution; input: string }> {
  const state = await observationState(world);
  const now = prepNowAfter(state.current?.observedAt ?? null);
  const result = await world.prepare(world.ctx, requestId, now);
  return { prepared: result.prepared, input: result.input };
}

describe('A-03 through the public platform.runtime.prepareExecution', () => {
  it.each(['memory', 'sqlite'] as const)(
    'renders the four literal rows in order after two real captures (%s)', async (kind) => {
    const world = await createReminderWorld(kind);
    try {
      const state = await observationState(world);
      expect(state.current).not.toBeNull();
      expect(state.previous).not.toBeNull();
      expect(Number.isNaN(Date.parse(state.current!.observedAt))).toBe(false);
      expect(state.current!.captureRef.captureId).not.toBe(state.previous!.captureId);
      expect(state.current!.captureRef.captureId).toBe(world.captureIds[1]);
      expect(state.previous!.captureId).toBe(world.captureIds[0]);

      const { input } = await prepareAtObservedTime(world, 's8a-l8-prepare-a03');
      expect(architectureRows(input)).toEqual(a03Rows);
    } finally {
      await world.close();
    }
  });

  it.each(['memory', 'sqlite'] as const)(
    'keeps ruling-11 path order after the renderer key sort (%s)', async (kind) => {
    // A file path cannot also be a directory, so the two hazard paths are
    // `src/a` and its string prefix `src/a-inner`: the old path-in-key sort put
    // the longer path first because `-` sorts before the key separator.
    const world = await createReminderWorld(kind, {
      catalog: { modules: [{ id: 'A', paths: ['src/a/core'] }, { id: 'B', paths: ['lib'] }],
        dependencies: [], taskModule: 'A' },
      stages: [{ write: {
        'src/a': 'export const a = 1;\n',
        'src/a-inner': 'export const backup = 2;\n',
      } }],
    });
    try {
      const { input } = await prepareAtObservedTime(world, 's8a-l8-prepare-order');
      expect(architectureRows(input)).toEqual([
        '新文件没归组：src/a（3 小时前的观测）',
        '新文件没归组：src/a-inner（3 小时前的观测）',
      ]);
    } finally {
      await world.close();
    }
  });

  it.each(['memory', 'sqlite'] as const)(
    'caps twelve real ungrouped rows at ten plus one omission line (%s)', async (kind) => {
    const files = Object.fromEntries(Array.from({ length: 12 }, (_unused, index) => {
      const name = `n${String(index + 1).padStart(2, '0')}`;
      return [`src/a/loose/${name}.ts`, `export const ${name} = ${String(index + 1)};\n`];
    }));
    const world = await createReminderWorld(kind, {
      catalog: { modules: [{ id: 'A', paths: ['src/a/core'] }, { id: 'B', paths: ['src/b'] }],
        dependencies: [], taskModule: 'A' },
      stages: [{ write: files }],
    });
    try {
      const { input } = await prepareAtObservedTime(world, 's8a-l8-prepare-caps');
      const rows = architectureRows(input);
      expect(rows).toHaveLength(11);
      expect(rows.slice(0, 10)).toEqual(Array.from({ length: 10 }, (_unused, index) =>
        `新文件没归组：src/a/loose/n${String(index + 1).padStart(2, '0')}.ts（3 小时前的观测）`));
      expect(rows[10]).toBe('另有 2 条架构提醒没列出');
    } finally {
      await world.close();
    }
  });

  it.each(['memory', 'sqlite'] as const)(
    'renders an unknown dependency finding with ，不确定 after one real capture (%s)', async (kind) => {
    const world = await createReminderWorld(kind, {
      stages: [{ write: {
        'src/a/core/one.ts': 'import { missing } from "./nowhere";\n\nexport const a = missing;\n',
        'src/b/lib.ts': 'export const b = 1;\n',
      } }],
    });
    try {
      const { input } = await prepareAtObservedTime(world, 's8a-l8-prepare-unknown');
      expect(architectureRows(input)).toEqual([
        '声明的依赖没有 import：A→B，src/a/core，不确定（3 小时前的观测）',
      ]);
    } finally {
      await world.close();
    }
  });

  it.each(['memory', 'sqlite'] as const)(
    'renders 还没有观测 when no capture has succeeded (%s)', async (kind) => {
    const world = await createReminderWorld(kind, { stages: [] });
    try {
      const state = await observationState(world);
      expect(state.current).toBeNull();
      const { input } = await prepareAtObservedTime(world, 's8a-l8-prepare-empty');
      expect(input.split('\n').filter(line => line === '还没有观测')).toEqual(['还没有观测']);
      expect(occurrences(input, '还没有观测')).toBe(1);
    } finally {
      await world.close();
    }
  });

  it.each(['memory', 'sqlite'] as const)(
    'renders no architecture rows for an observation with nothing to say (%s)', async (kind) => {
    const world = await createReminderWorld(kind, {
      stages: [{ write: {
        'src/a/core/one.ts': 'import { b } from "../../b/lib";\n\nexport const a = b;\n',
        'src/b/lib.ts': 'export const b = 1;\n',
      } }],
    });
    try {
      const { input } = await prepareAtObservedTime(world, 's8a-l8-prepare-clean');
      expect(architectureRows(input)).toEqual([]);
      expect(occurrences(input, '还没有观测')).toBe(0);
    } finally {
      await world.close();
    }
  });

  it.each(['memory', 'sqlite'] as const)(
    'a reminder read that throws adds 架构提醒不可用 once and continues (%s)', async (kind) => {
    const world = await createReminderWorld(kind, { reminder: { kind: 'throw' } });
    try {
      const { prepared, input } = await prepareAtObservedTime(world, 's8a-l8-prepare-throw');
      expect(prepared.kind).toBe('task');
      expect(occurrences(input, '架构提醒不可用')).toBe(1);
    } finally {
      await world.close();
    }
  });

  it.each(['memory', 'sqlite'] as const)(
    'a rejected reminder read adds 架构提醒不可用 once and continues (%s)', async (kind) => {
    const world = await createReminderWorld(kind, { reminder: { kind: 'reject' } });
    try {
      const { prepared, input } = await prepareAtObservedTime(world, 's8a-l8-prepare-reject');
      expect(prepared.kind).toBe('task');
      expect(occurrences(input, '架构提醒不可用')).toBe(1);
    } finally {
      await world.close();
    }
  });

  it.each(['memory', 'sqlite'] as const)(
    'a cancellation while the real reminder read returns ready still cancels before the manifest write (%s)', async (kind) => {
    const world = await createReminderWorld(kind, { reminder: { kind: 'gate-ready' },
      countPreparedManifestPuts: true });
    try {
      const controller = new AbortController();
      const pending = world.prepareExecution(world.ctxWithSignal(controller.signal), 's8a-l8-prepare-cancel-ready');
      const gate = world.gate;
      if (gate === null) throw new Error('the reminder gate is missing');
      await gate.entered;
      expect(gate.held()).toBe(true);
      controller.abort();
      gate.release();
      expect(await pending).toMatchObject({ status: 'rejected', code: 'cancelled' });
      expect(world.preparedManifestPuts()).toBe(0);
    } finally {
      await world.close();
    }
  });

  it.each(['memory', 'sqlite'] as const)(
    'a cancellation while the real reminder read throws still cancels instead of 架构提醒不可用 (%s)', async (kind) => {
    const world = await createReminderWorld(kind, { reminder: { kind: 'gate-throw' },
      countPreparedManifestPuts: true });
    try {
      const controller = new AbortController();
      const pending = world.prepareExecution(world.ctxWithSignal(controller.signal), 's8a-l8-prepare-cancel-throw');
      const gate = world.gate;
      if (gate === null) throw new Error('the reminder gate is missing');
      await gate.entered;
      expect(gate.held()).toBe(true);
      controller.abort();
      gate.release();
      expect(await pending).toMatchObject({ status: 'rejected', code: 'cancelled' });
      expect(world.preparedManifestPuts()).toBe(0);
    } finally {
      await world.close();
    }
  });
});

describe('rework-3 row J and row A: cancellation from the reminder through the put', () => {
  it.each(['memory', 'sqlite'] as const)(
    'J %s: a reminder reader that answers cancelled with the signal NOT set cancels before any prepared-manifest put', async (kind) => {
    // Restored check (ledger Pub:504–505), not a C-1 RED row: the reminder
    // branch at context-assembler.ts:1056 already returns this dependency's
    // explicit cancellation unchanged.
    const world = await createReminderWorld(kind, { reminder: { kind: 'cancel' },
      countPreparedManifestPuts: true });
    try {
      expect(world.ctx.signal.aborted).toBe(false);
      const result = await world.prepareExecution(world.ctx, 's8a-l8-prepare-reminder-answer-cancelled');
      expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });
      expect(world.preparedManifestPuts()).toBe(0);
    } finally {
      await world.close();
    }
  });

  it.each(['memory', 'sqlite'] as const)(
    'A C-1 %s: the upstream missing-input facts read that answers cancelled with the signal NOT set cancels the preparation', async (kind) => {
    const world = await createReminderWorld(kind, {
      planInput: { upstreamTaskId: 'task-upstream', requires: { kind: 'artifact', label: 's8a-l8-upstream-material' } },
      graph: { kind: 'cancel-upstream' },
      countPreparedManifestPuts: true,
    });
    try {
      expect(world.ctx.signal.aborted).toBe(false);
      const result = await world.prepareExecution(world.ctx, 's8a-l8-prepare-upstream-answer-cancelled');
      expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });
      expect(world.preparedManifestPuts()).toBe(0);
    } finally {
      await world.close();
    }
  });

  it.each(['memory', 'sqlite'] as const)(
    'A %s: a cancellation while the upstream missing-input facts read is in flight cancels before the put', async (kind) => {
    const world = await createReminderWorld(kind, {
      planInput: { upstreamTaskId: 'task-upstream', requires: { kind: 'artifact', label: 's8a-l8-upstream-material' } },
      graph: { kind: 'gate-upstream' },
      countPreparedManifestPuts: true,
    });
    try {
      const controller = new AbortController();
      const pending = world.prepareExecution(world.ctxWithSignal(controller.signal), 's8a-l8-prepare-upstream-gate');
      const gate = world.graphGate;
      if (gate === null) throw new Error('the graph-context gate is missing');
      await gate.entered;
      expect(gate.held()).toBe(true);
      controller.abort();
      gate.release();
      expect(await pending).toMatchObject({ status: 'rejected', code: 'cancelled' });
      expect(world.preparedManifestPuts()).toBe(0);
    } finally {
      await world.close();
    }
  });

  it.each(['memory', 'sqlite'] as const)(
    'A %s: a task input page that answers cancelled with the signal NOT set cancels the preparation', async (kind) => {
    const world = await createReminderWorld(kind, {
      planInput: { upstreamTaskId: 'task-upstream', requires: { kind: 'environment-revision', label: 'workspace' } },
      inputPage: { kind: 'cancel-page' },
      countPreparedManifestPuts: true,
    });
    try {
      expect(world.ctx.signal.aborted).toBe(false);
      const result = await world.prepareExecution(world.ctx, 's8a-l8-prepare-page-answer-cancelled');
      expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });
      expect(world.preparedManifestPuts()).toBe(0);
    } finally {
      await world.close();
    }
  });

  it.each(['memory', 'sqlite'] as const)(
    'A %s: a cancellation while the task input page read is in flight cancels before the put', async (kind) => {
    const world = await createReminderWorld(kind, {
      planInput: { upstreamTaskId: 'task-upstream', requires: { kind: 'environment-revision', label: 'workspace' } },
      inputPage: { kind: 'gate-page' },
      countPreparedManifestPuts: true,
    });
    try {
      const controller = new AbortController();
      const pending = world.prepareExecution(world.ctxWithSignal(controller.signal), 's8a-l8-prepare-page-gate');
      const gate = world.inputPageGate;
      if (gate === null) throw new Error('the task input page gate is missing');
      await gate.entered;
      expect(gate.held()).toBe(true);
      controller.abort();
      gate.release();
      expect(await pending).toMatchObject({ status: 'rejected', code: 'cancelled' });
      expect(world.preparedManifestPuts()).toBe(0);
    } finally {
      await world.close();
    }
  });

  it.each(['memory', 'sqlite'] as const)(
    'A %s: a cancellation while the real prepared-manifest put is in flight returns cancelled and keeps the written body', async (kind) => {
    // The REAL put completed (count 1) before the wrapper released; the
    // preparation must not report ready and nothing rolls the body back.
    const world = await createReminderWorld(kind, { gatePreparedPut: true });
    try {
      const controller = new AbortController();
      const pending = world.prepareExecution(world.ctxWithSignal(controller.signal), 's8a-l8-prepare-put-gate');
      const gate = world.putGate;
      if (gate === null) throw new Error('the prepared-manifest put gate is missing');
      await gate.entered;
      expect(gate.held()).toBe(true);
      expect(world.preparedManifestPuts()).toBe(1);
      controller.abort();
      gate.release();
      expect(await pending).toMatchObject({ status: 'rejected', code: 'cancelled' });
      expect(world.preparedManifestPuts()).toBe(1);
    } finally {
      await world.close();
    }
  });
});

describe('A-03 failure and retry through real catalog revisions', () => {
  it.each(['memory', 'sqlite'] as const)(
    'a failure after a success keeps the old observation rows until the retry (%s)', async (kind) => {
    // One real manual capture of A-03's first observation is the `previous`; the
    // REAL Host driver then captures the A-03 latest state, so the four A-03 rows
    // (including the move) are produced by the platform, not by hand.
    const world = await createReminderWorld(kind, { stages: [A03_STAGES[0]!] });
    try {
      for (const path of A03_STAGES[1]!.remove ?? []) await world.removeFile(path);
      await world.writeFiles(A03_STAGES[1]!.write);

      // The fixture's workspace registration is a real cause; the driver forwards
      // it once, exactly as the Host does after registration.
      world.driver.workspaceRegistered(world.scope);
      const succeeded = await waitObservationState(world, state =>
        state.autoCapture?.requestSeq === 1 && state.autoCapture.pending === false && state.current !== null);
      const savedRef = succeeded.current!.captureRef;
      // The auto capture is a NEW observation, not the fixture's manual one.
      expect(savedRef.captureId).not.toBe(world.captureIds[0]);
      const prepNow = prepNowAfter(succeeded.current!.observedAt);
      const before = await world.prepare(world.ctx, 's8a-l8-prepare-before-failure', prepNow);
      expect(architectureRows(before.input)).toEqual(a03Rows);

      // A REAL failure: the sandbox cannot resolve the moved workspace root. The
      // second capture is requested by a real, non-replayed catalog revision.
      const away = await world.moveRootAway();
      await world.reviseCatalog('s8a-l8-revise-failure');
      const failed = await waitObservationState(world, state =>
        state.autoCapture?.requestSeq === 2 && state.autoCapture.status === 'failed'
        && state.autoCapture.pending === true);
      expect(failed.current?.captureRef).toEqual(savedRef);
      expect(failed.autoCapture?.failure).not.toBeNull();

      // Root restored, but BEFORE the retry: the preparation still reads the old
      // successful observation and its original time.
      await world.restoreRoot(away);
      const beforeRetry = await world.prepare(world.ctx, 's8a-l8-prepare-before-retry', prepNow);
      expect(architectureRows(beforeRetry.input)).toEqual(a03Rows);

      // A second real revision is the retry's cause; it commits a new observation.
      await world.reviseCatalog('s8a-l8-revise-retry');
      const retried = await waitObservationState(world, state =>
        state.autoCapture?.requestSeq === 3 && state.autoCapture.pending === false
        && state.current !== null && state.current.captureRef.captureId !== savedRef.captureId);
      expect(retried.previous).toEqual(savedRef);
    } finally {
      await world.close();
    }
  });
});
