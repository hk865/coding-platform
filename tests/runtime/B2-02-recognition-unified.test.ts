/**
 * B2 rework 1 item 2 (Codex item 2, L19a K8-6): ONE recognizer.
 *
 * The `before_tool` shell hook no longer keeps a second matcher. It reads the
 * binding's records and the Task's CRRs (the same reads as before) and hands
 * records, CRRs, command, cwd and the two-read cap to `config.recognizer`; its
 * `BlockedCommandMatchV1` is the only source of the blocked form. A recognizer
 * rejection loses recognition (the hook continues); a missing recognizer on a
 * non-empty binding is a wiring error and fails closed with the fixed
 * unconfirmed text; a `package.json` read failure inside the recognizer loses
 * only the expansion, so a stored exact/action hit still blocks.
 *
 * Facts are reached through the public review/decision/CRR steps of the shared
 * fixtures (`openB2HookWorld` over a real `createBlockedRecord` record, and
 * `openK3ReviewCardWorld` + `createBlockedRecord` for the two-record case);
 * only file CONTENT, read faults and counting wrappers are injected.
 */
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import {
  bindingOf, nextCall, openB2HookWorld, runHook, runTool,
} from '../helpers/B2-blocked-runtime.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { countWorkspaceReads, failWorkspaceReads, openRealWorkspace, type RealWorkspace } from '../helpers/K3-real-workspace.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { createBlockedRecord, requeueAfterRun, workRunContextOf } from '../helpers/K3-prefix-claim.js';
import { crrCardOf } from '../helpers/B2-crr-world.js';
import { createShellBlockedHook } from '../../src/core/agent-runtime/execution-driver.js';
import { createCommandRerunTools } from '../../src/core/agent-runtime/command-rerun-tools.js';
import { createCommandRecognizer } from '../../src/core/work-graph/tasks/command-recognition.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { HookPort, ToolCall } from '../../vendor/coding-agent/dist/public-api.js';

// §5.1's stand-in `shell`, hoisted per test file: the real Runs that produce the
// blocked records use it (the fixture's real chain claims → prepares → starts).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
const realWorkspaces: RealWorkspace[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const real of realWorkspaces.splice(0)) await real.close();
  for (const world of worlds.splice(0)) await world.close();
});

const FILES = {
  'app/package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }),
  'package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }),
};
const TAIL = '要再跑，先用 `request_command_rerun` 写明原因，等人允许。平台没认出来的改写，也要用 `rewriteOf` 注明以后再请求。';
const BLOCKED_UNCONFIRMED = '平台暂时确认不了这条命令有没有被拦，这次先不跑；稍后再试。';
const shell = (command: string, callId = nextCall()): ToolCall => ({ schemaVersion: 1, callId, name: 'shell',
  arguments: { command } });
const where = (runId: string): string => `#1@${runId.slice(0, 8)}`;

type HookWorld = Awaited<ReturnType<typeof openB2HookWorld>> & {
  record: UnknownCallReviewV1;
  reviews: K3ReviewCardWorld['reviews'];
  /** The production workspace reader over a real root with FILES (F-021). */
  real: RealWorkspace;
};

let worldSequence = 0;

/**
 * The shared B2 hook world (real CRR owner/read port, the real request tool and
 * the exported hook) over a REAL blocked record produced by the public claim →
 * prepare → `startRun` → classifier/draft/RUN-22 → `skip_as_done` chain; the
 * call is served by §5.1's blocking `shell` seam.
 */
async function hookWorld(kind: 'memory' | 'sqlite', command = 'cd app && npm run db:migrate'): Promise<HookWorld> {
  worldSequence += 1;
  const label = `b2-02-${String(worldSequence)}`;
  const world = await openK3ReviewCardWorld(kind);
  worlds.push(world);
  const blocked = await createBlockedRecord(world, {
    taskId: 'k3-20-a',
    runId: `b2aaaaaa-0000-4000-8000-${String(worldSequence).padStart(12, '0')}`,
    label, command, callId: `${label}-call`,
  });
  const built = await openB2HookWorld(world, blocked.record, { files: FILES });
  // F-021: the recognition rows read the REAL files through the production
  // workspace reader (`createWorkspaceAccessFactory` + `createWorkspaceTools`,
  // A8 root/authorization), never a constructed `WorkspaceFile`.
  const real = await openRealWorkspace({
    root: join(world.fixture.base.directory, `b2-02-real-workspace-${String(worldSequence)}`),
    workspace: { aggregateType: 'Workspace', projectId: world.fixture.base.scope.projectId,
      workspaceId: world.fixture.base.scope.workspaceId },
    files: FILES,
  });
  realWorkspaces.push(real);
  return { ...built, record: blocked.record, reviews: world.reviews, real };
}

/** A3/A2: count the REAL reader's calls, optionally throwing once before it. */
function countingReader(real: RealWorkspace, failFirst = false) {
  const failing = failFirst ? failWorkspaceReads(real.readWorkspace, { once: true }) : real;
  const counted = countWorkspaceReads(failing.readWorkspace);
  return { reader: counted, paths: counted.paths };
}

/** A hook over a real world's binding/records/CRRs with an injected recognizer. */
function hookOver(w: HookWorld, recognizer: ReturnType<typeof createCommandRecognizer> | undefined): HookPort {
  return createShellBlockedHook({
    ctx: w.ctx, runRef: w.runRef, taskId: w.record.task.taskId, workspace: w.workspace,
    binding: w.binding, reviews: w.reviews, requests: w.requests,
    ...(recognizer === undefined ? {} : { recognizer }),
  });
}

const F102_A_RUN = 'aaaaaaaa-0000-4000-8000-000000000001';
const F102_B_RUN = 'bbbbbbbb-0000-4000-8000-000000000002';
const F031_A_RUN = 'ffffffff-0000-4000-8000-000000000001';
const F031_B_RUN = '00000000-0000-4000-8000-000000000002';

type TwoRecordWorld = {
  world: K3ReviewCardWorld;
  a: Awaited<ReturnType<typeof createBlockedRecord>>;
  b: Awaited<ReturnType<typeof createBlockedRecord>>;
};

/**
 * F-102/F-031's shared prior state: two REAL records of ONE Task, reached by
 * the public claim → prepare → startRun → RUN-20/RUN-22 → `skip_as_done` chain,
 * with the second Run admitted by the real requeue owner. Only the A8 clock and
 * the injected Run ids (which real use mints) are inputs.
 */
async function twoRecordWorld(
  kind: 'memory' | 'sqlite',
  spec: { label: string; aRun: string; bRun: string; clock?: { a: string; b: string } },
): Promise<TwoRecordWorld> {
  const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true,
    commandRecognizer: createCommandRecognizer({}) });
  worlds.push(world);
  const clock = spec.clock;
  const a = await createBlockedRecord(world, {
    taskId: 'k3-20-a', runId: spec.aRun, label: `${spec.label}-a`,
    command: 'node a.js', callId: `${spec.label}-a-call`,
    ...(clock === undefined ? {} : { now: () => clock.a }),
  });
  const requeue = await requeueAfterRun(world, 'k3-20-a', a.claim.runRef, `${spec.label}-b`);
  const b = await createBlockedRecord(world, {
    taskId: 'k3-20-a', runId: spec.bRun, label: `${spec.label}-b`,
    command: 'node b.js', callId: `${spec.label}-b-call`, requeueRef: requeue.ref,
    ...(clock === undefined ? {} : { now: () => clock.b }),
  });
  return { world, a, b };
}

function workspaceOf(world: K3ReviewCardWorld) {
  const scope = world.fixture.base.scope;
  return { projectId: scope.projectId, workspaceId: scope.workspaceId };
}

async function taskRequestsOf(world: K3ReviewCardWorld, ctx: CoreCallContext) {
  const read = await world.commandRerun.listTaskRequests(ctx, { workspace: workspaceOf(world),
    filter: { goalId: 'B', taskId: 'k3-20-a' } });
  if (read.status !== 'ready') throw new Error(JSON.stringify(read));
  return read.value.items;
}

describe('F-031: several records — the earlier record wins by createdAt, not by Run id', () => {
  it.each(['memory', 'sqlite'] as const)(
    'F-031 (%s): the combined command blocks on the EARLIER record even when the Run ids sort in reverse',
    async kind => {
      const { world, a, b } = await twoRecordWorld(kind, {
        label: `f031-${kind}`, aRun: F031_A_RUN, bRun: F031_B_RUN,
        clock: { a: '2026-10-08T00:00:00.000Z', b: '2026-10-08T00:05:00.000Z' },
      });
      // A's Run id sorts AFTER B's, so an ordering that dropped createdAt (and
      // tied on alias) would pick B. The records' creation times must differ.
      expect(a.record.ref.runId.slice(0, 8)).toBe('ffffffff');
      expect(b.record.ref.runId.slice(0, 8)).toBe('00000000');
      expect(a.record.createdAt).not.toBe(b.record.createdAt);
      expect(a.record.createdAt < b.record.createdAt).toBe(true);
      expect(a.record.blockedCommands).toMatchObject([{ alias: 1 }]);
      expect(b.record.blockedCommands).toMatchObject([{ alias: 1 }]);

      const scope = world.fixture.base.scope;
      const hook = createShellBlockedHook({
        ctx: world.fixture.ctx,
        runRef: b.claim.runRef,
        taskId: a.record.task.taskId,
        workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId },
        binding: [...bindingOf(a.record), ...bindingOf(b.record)],
        reviews: world.reviews,
        requests: world.commandRerun,
        recognizer: createCommandRecognizer({}),
      });
      // The combined command hits both records; the earlier record's
      // `node a.js` action is the reported one, never B's `node b.js`.
      expect(await runHook(hook, shell('node a.js && node b.js'))).toEqual({
        point: 'before_tool', kind: 'block',
        reason: `平台拦下了这条命令：其中的 node a.js 是 ${where(a.record.ref.runId)} 的一部分（核对以后处置是“跳过”）。${TAIL}` });
    },
  );
});

describe('F-102: rewriteOf picks the blocked command the combined command really hits', () => {
  it.each(['memory', 'sqlite'] as const)(
    'F-102 (%s): a combined command with rewriteOf naming the B record is accepted and the card names B',
    async kind => {
      const { world, a, b } = await twoRecordWorld(kind, {
        label: `f102-${kind}`, aRun: F102_A_RUN, bRun: F102_B_RUN,
      });
      expect(a.record.blockedCommands).toMatchObject([{ alias: 1 }]);
      expect(b.record.blockedCommands).toMatchObject([{ alias: 1 }]);
      const ctx = workRunContextOf(world, b.run);
      const tool = createCommandRerunTools({
        requests: world.commandRerun, context: ctx, task: b.record.task,
        requestIdForCall: call => `f102-request-${kind}:${call.callId}`,
      }).create({} as never)[0]!;
      const combined = 'node a.js && node b.js';
      const result = await runTool(tool, { command: combined, reason: 'both node checks must run again',
        rewriteOf: { review: b.record.ref.runId, alias: 1 } });
      expect(result.status).toBe('success');
      expect(result.output[0]).toMatchObject({ kind: 'json', value: { status: 'requested' } });

      // The public request read: the saved hit is B's action, not A's.
      const requests = await taskRequestsOf(world, ctx);
      expect(requests).toHaveLength(1);
      const request = requests[0]!;
      expect(request.reviewRef.runId).toBe(b.record.ref.runId);
      expect(request.alias).toBe(1);
      expect(request.match).toEqual({ kind: 'action', action: { text: 'node b.js', sha256: expect.any(String) } });

      // The CRR card is projected from the saved request: its label names B.
      const card = await crrCardOf(world);
      const label = card.objects[0]?.label ?? '';
      expect(label).toContain(`#1@${b.record.ref.runId.slice(0, 8)}`);
      expect(label).not.toContain(`#1@${a.record.ref.runId.slice(0, 8)}`);
    },
  );
});

describe('rejects: F-102 rewriteOf names a record the command does not hit', () => {
  it.each(['memory', 'sqlite'] as const)(
    'F-102 (%s): a command that hits only A is refused rewrite_of_mismatch and writes nothing',
    async kind => {
      const { world, a, b } = await twoRecordWorld(kind, {
        label: `f102-rejects-${kind}`, aRun: F102_A_RUN, bRun: F102_B_RUN,
      });
      const ctx = workRunContextOf(world, b.run);
      const before = await taskRequestsOf(world, ctx);
      expect(before).toEqual([]);
      const result = await world.commandRerun.requestRerun(ctx, {
        input: { task: b.record.task, runRef: b.run.ref, command: 'node a.js',
          reason: 'this rewrite names the wrong record',
          rewriteOf: { review: b.record.ref.runId, alias: 1 } },
        meta: { requestId: `f102-reject-${kind}`, expected: [] },
      });
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid',
        reason: expect.stringContaining('rewrite_of_mismatch') });
      // `node a.js` hits A (the earlier record); B is a valid record of the Task
      // but not a hit, so the declared record must not be saved.
      expect(await taskRequestsOf(world, ctx)).toEqual(before);
      expect(a.record.ref.runId).not.toBe(b.record.ref.runId);
    },
  );
});

describe.each(['memory', 'sqlite'] as const)('B2-02 one recognizer: declared forms and failures (%s)', kind => {
  it('B2-02: the hook matches a declared form stored by the request tool', async () => {
    const w = await hookWorld(kind);
    const declaredCommand = 'npm run db:migrate -- --force';
    const declared = await runTool(w.tool, {
      command: declaredCommand, reason: '带参数重跑',
      rewriteOf: { review: w.record.ref.runId, alias: 1 },
    });
    expect(declared.output[0]).toMatchObject({ kind: 'json', value: { status: 'requested' } });
    const [request] = await w.listRequests(w.ctx);
    expect(request!.declaredForms.map(form => form.text)).toContain(declaredCommand);

    // No exact/action hit exists for this rewrite; only the stored declared form.
    const hook = hookOver(w, createCommandRecognizer({ readWorkspace: w.real }));
    expect(await runHook(hook, shell(declaredCommand))).toEqual({ point: 'before_tool', kind: 'block',
      reason: `平台拦下了这条命令：${where(w.record.ref.runId)}（核对以后处置是“跳过”）。${TAIL}` });
  });

  it('B2-02: a package.json read failure loses only the expansion; the stored action still blocks', async () => {
    // The stored record blocks `prisma migrate deploy`; this call additionally
    // asks the recognizer to expand `npm run missing-script`, whose package read
    // fails. The direct action hit must survive the failed expansion.
    const w = await hookWorld(kind, 'prisma migrate deploy');
    const { reader, paths } = countingReader(w.real, true);
    const hook = hookOver(w, createCommandRecognizer({ readWorkspace: reader }));
    expect(await runHook(hook, shell('prisma migrate deploy && npm run missing-script')))
      .toEqual({ point: 'before_tool', kind: 'block',
        reason: `平台拦下了这条命令：其中的 prisma migrate deploy 是 ${where(w.record.ref.runId)} 的一部分（核对以后处置是“跳过”）。${TAIL}` });
    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toContain('package.json');
  });

  it('B2-02: a recognizer rejection fails closed (F-070: only a confirmed no-match continues)', async () => {
    const w = await hookWorld(kind);
    // The exact stored form would have blocked through the old local matcher.
    const hook = hookOver(w, (async () => { throw new Error('injected recognizer failure'); }) as never);
    expect(await runHook(hook, shell('cd app && npm run db:migrate')))
      .toEqual({ point: 'before_tool', kind: 'block', reason: BLOCKED_UNCONFIRMED });
  });

  it('B2-02: a non-ready recognizer answer fails closed (F-070)', async () => {
    const w = await hookWorld(kind);
    const hook = hookOver(w, (async () => ({ status: 'rejected', code: 'unavailable', reason: 'injected unreadable recognition' })) as never);
    expect(await runHook(hook, shell('cd app && npm run db:migrate')))
      .toEqual({ point: 'before_tool', kind: 'block', reason: BLOCKED_UNCONFIRMED });
  });

  it('B2-02: a CONFIRMED no-match (ready, null) still continues (F-070)', async () => {
    const w = await hookWorld(kind);
    // A real recognizer over the real record: this command is no blocked form.
    const hook = hookOver(w, createCommandRecognizer({}));
    expect(await runHook(hook, shell('echo unrelated'))).toEqual({ point: 'before_tool', kind: 'continue' });
  });

  it('B2-02: a package.json read failure is still the documented ready/null degradation (F-070)', async () => {
    const w = await hookWorld(kind, 'prisma migrate deploy');
    const { reader } = countingReader(w.real, true);
    // The package read fails; the expansion is lost, recognition is still a
    // confirmed no-match for this command, so the shell continues.
    const hook = hookOver(w, createCommandRecognizer({ readWorkspace: reader }));
    expect(await runHook(hook, shell('npm run not-a-blocked-script')))
      .toEqual({ point: 'before_tool', kind: 'continue' });
  });

  it('B2-02: a missing recognizer on a non-empty binding is a wiring error and fails closed', async () => {
    const w = await hookWorld(kind);
    expect(await runHook(hookOver(w, undefined), shell('cd app && npm run db:migrate')))
      .toEqual({ point: 'before_tool', kind: 'block', reason: BLOCKED_UNCONFIRMED });
  });
});

describe.each(['memory', 'sqlite'] as const)('B2-02 one recognizer: one call per shell call (%s)', kind => {
  it('B2-02: the hook calls the recognizer once per shell call and never repeats a package read inside one call', async () => {
    const w = await hookWorld(kind);
    const { reader, paths } = countingReader(w.real);
    let recognitions = 0;
    const real = createCommandRecognizer({ readWorkspace: reader });
    const hook = hookOver(w, (async (ctx: Parameters<typeof real>[0], input: Parameters<typeof real>[1]) => {
      recognitions += 1;
      return await real(ctx, input);
    }) as never);
    const call = shell('npm run db:migrate');
    expect(await runHook(hook, call)).toMatchObject({ point: 'before_tool', kind: 'block' });
    expect(recognitions).toBe(1);
    const afterFirst = paths.length;
    expect(afterFirst).toBeGreaterThan(0);
    expect(new Set(paths).size).toBe(paths.length);

    // Re-issuing the same call must not grow recognition work per invocation:
    // exactly one more recognizer call, and each package file read once inside
    // that call (the Kernel-level result replay itself is not exposed here;
    // B2-15 reports the same fixture gap).
    expect(await runHook(hook, call)).toMatchObject({ point: 'before_tool', kind: 'block' });
    expect(recognitions).toBe(2);
    expect(paths.length - afterFirst).toBeLessThanOrEqual(2);
    expect(new Set(paths.slice(afterFirst)).size).toBe(paths.length - afterFirst);
  });
});
