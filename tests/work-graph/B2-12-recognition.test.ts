/**
 * Rework 1 item 2 / B2-12 (L19a, K8-6): ONE recognition function.
 *
 * The recognizer is a pure function over constructed records/requests; F-021
 * makes its workspace read the PRODUCTION reader over real files (the A2
 * failing wrapper delegates every non-failed path to it). The last case reaches
 * the request owner through the real public path (`skip_as_done` →
 * `requestRerun`) to prove a valid `rewriteOf` with an unknown script still
 * reaches the request path.
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { createCommandRecognizer } from '../../src/core/work-graph/tasks/command-recognition.js';
import { commandSha256 } from '../../src/core/work-graph/state/command-normalization.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { createK3PendingReview, readK3ReviewCard, settleK3Review } from '../helpers/K3-proposal-round.js';
import { createCommandRerunRequestService } from '../../src/core/work-graph/tasks/command-rerun-request-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { failWorkspaceReads, openRealWorkspace, type RealWorkspace } from '../helpers/K3-real-workspace.js';
import { GOAL_B, T, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';

// §5.1's stand-in `shell`, hoisted per test file (the fixture's real Run uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const keyOf = (words: string[]): string => sha(JSON.stringify(words));
const worlds: K3ReviewCardWorld[] = [];
const workspaces: RealWorkspace[] = [];
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close();
  for (const world of worlds.splice(0)) await world.close();
});

const ctx: CoreCallContext = {
  projectId: 'P', workspaceId: 'W',
  principal: { kind: 'host', actor: { kind: 'human', id: 'o' } },
  materialReader: { kind: 'none' }, signal: new AbortController().signal,
} as never;

function record(input: {
  runId: string; createdAt: string;
  blocked: Array<{
    alias: number; commandSha256: string;
    actions?: Array<{ text: string; sha256: string }>;
    expansions?: Array<{ action: string; scriptName: string; scriptText: string;
      actions: Array<{ text: string; sha256: string }>;
      basis: { path: string; digest: string } | { status: 'unavailable'; reason: string } }>;
  }>;
}): UnknownCallReviewV1 {
  return {
    ref: { aggregateType: 'UnknownCallReview', projectId: 'P', goalId: 'B', runId: input.runId },
    createdAt: input.createdAt,
    blockedCommands: input.blocked.map(entry => ({
      reviewRunId: input.runId, alias: entry.alias, commandSha256: entry.commandSha256,
      kernelCallRef: {}, actions: entry.actions ?? [], expansions: entry.expansions ?? [],
      truncated: false,
    })),
  } as unknown as UnknownCallReviewV1;
}

function request(input: {
  runId: string; alias: number; declaredForms: Array<{ sha256: string; text: string }>;
}): CommandRerunRequestV1 {
  return {
    reviewRef: { aggregateType: 'UnknownCallReview', projectId: 'P', goalId: 'B', runId: input.runId },
    alias: input.alias, declaredForms: input.declaredForms,
  } as unknown as CommandRerunRequestV1;
}

/** F-021: real files served by the production workspace reader. */
async function workspace(files: Record<string, string>): Promise<RealWorkspace> {
  const opened = await openRealWorkspace({ files });
  workspaces.push(opened);
  return opened;
}

describe('rework 1 item 2 / B2-12 recognition', () => {
  it('matches the CURRENT package.json expansion and names the current script', async () => {
    const only = record({ runId: 'run-1', createdAt: '2026-01-01T00:00:00.000Z',
      blocked: [{ alias: 1, commandSha256: commandSha256('cd app && npm run build'),
        actions: [{ text: 'prisma migrate deploy', sha256: keyOf(['prisma', 'migrate', 'deploy']) }] }] });
    const real = await workspace({
      'app/package.json': JSON.stringify({ scripts: { build: 'prisma migrate deploy' } }),
    });
    const recognizer = createCommandRecognizer({ readWorkspace: real });
    const result = await recognizer(ctx, { records: [only], requests: [],
      command: 'bash -c "cd app && npm run build"', cwd: '.', maxPackageReads: 2 });
    expect(result).toMatchObject({ status: 'ready', value: { alias: 1, match: { kind: 'action',
      viaScript: { scriptName: 'build', dir: 'app' } } } });
  });

  it('loses only the current expansion when the workspace read fails (never the whole recognition)', async () => {
    const only = record({ runId: 'run-1', createdAt: '2026-01-01T00:00:00.000Z',
      blocked: [{ alias: 1, commandSha256: commandSha256('npm run db:migrate') }] });
    const real = await workspace({});
    const recognizer = createCommandRecognizer({ readWorkspace: failWorkspaceReads(real.readWorkspace) });
    expect(await recognizer(ctx, { records: [only], requests: [], command: 'npm run unknown',
      cwd: '.', maxPackageReads: 2 })).toEqual({ status: 'ready', value: null });
    expect(await recognizer(ctx, { records: [only], requests: [], command: 'npm run db:migrate',
      cwd: '.', maxPackageReads: 2 })).toMatchObject({ status: 'ready', value: { match: { kind: 'exact' } } });
  });

  it('matches a declared form even when the package.json read fails', async () => {
    const only = record({ runId: 'run-1', createdAt: '2026-01-01T00:00:00.000Z',
      blocked: [{ alias: 1, commandSha256: commandSha256('npm run db:migrate') }] });
    const declared = request({ runId: 'run-1', alias: 1,
      declaredForms: [{ sha256: commandSha256('npm run custom'), text: 'npm run custom' }] });
    const real = await workspace({});
    const recognizer = createCommandRecognizer({ readWorkspace: failWorkspaceReads(real.readWorkspace) });
    expect(await recognizer(ctx, { records: [only], requests: [declared], command: 'npm run custom',
      cwd: '.', maxPackageReads: 2 })).toMatchObject({ status: 'ready', value: { match: { kind: 'declared' } } });
  });
});

let seq = 0;

describe('rework 1 item 2: a valid rewriteOf with an unknown script still requests', () => {
  it.each(['memory', 'sqlite'] as const)('creates a declared request through the real owner when package.json cannot be read (%s)', async (kind) => {
    // ONE real `pending_review` record from the Runtime's own blocked Run; the
    // production Kernel command reader over the SAME store serves skip_as_done.
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const pending = await settleK3Review(world, await createK3PendingReview(world, {
      taskId: 'k3-20-a', label: 'b2-12', callId: 'b2-12-call-1', command: 'echo k3-fixture',
    }), { cause: 'review_unavailable' });
    expect(pending.status).toBe('needs_decision');
    const { card } = await readK3ReviewCard(world, pending);
    const applied = await world.decisionActions.resolveDecision(world.fixture.ctx, {
      input: { source: card.source, selection: { kind: 'option', optionId: 'skip_as_done' },
        text: 'done', annotations: [] },
      meta: { requestId: `b2-12-answer-${String(++seq)}`, expected: card.source.pins },
    });
    if (applied.status !== 'ready' || applied.value.state !== 'applied'
      || applied.value.action === null || applied.value.action.status !== 'committed') {
      throw new Error(`the disposition did not apply: ${JSON.stringify(applied)}`);
    }
    const record = applied.value.action.value as unknown as UnknownCallReviewV1;
    const runRead = await createRunStateReader({ records: world.fixture.records })
      .readExecution(world.fixture.ctx, record.runRef);
    if (runRead.status !== 'ready') throw new Error('the Run is not readable');
    const run = runRead.value.run;
    const service = createCommandRerunRequestService({
      records: world.fixture.records,
      listTaskReviews: async (ctx, input) => {
        const page = await world.reviews.listReviews(ctx, { workspace: WORKSPACE_SCOPE,
          filter: { goalRef: input.goalRef, taskId: input.taskId }, page: { limit: 200 } });
        return page.status === 'ready' ? { status: 'ready', value: page.value.items } : page;
      },
      // Rework 2 item 2: the REQUIRED Task-closure reader, the production one
      // over the SAME records (never an absent → open default).
      readTaskClosure: async (_ctx, task) => readTaskClosure(world.fixture.records,
        { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId }, task.taskId),
      // The workspace read throws: only the current expansion is lost.
      recognize: createCommandRecognizer({ readWorkspace: { readWorkspace: async () => {
        throw new Error('injected workspace read failure');
      } } as never }),
      now: () => T, eventId: () => `b2-12-event-${String(++seq)}`,
    });
    const ctx: CoreCallContext = { projectId: 'P', workspaceId: record.workspaceId,
      principal: { kind: 'work_run', runRef: record.runRef, roleBinding: run.roleBinding },
      materialReader: { kind: 'run', requester: record.runRef },
      signal: world.fixture.ctx.signal };
    const created = await service.requestRerun(ctx, {
      input: { task: record.task, runRef: record.runRef, command: 'npm run custom', reason: 'renamed script',
        rewriteOf: { review: record.ref.runId, alias: 1 } },
      meta: { requestId: `b2-12-declared-${String(++seq)}`, expected: [] },
    }) as unknown as import('../../src/core/work-graph/model/command-rerun-request-contracts.js').CommandRerunRequestReplyV1;
    expect(created).toMatchObject({ status: 'committed', value: { outcome: { status: 'requested' },
      request: { declared: true, match: { kind: 'declared' },
        declaredForms: [{ text: 'npm run custom' }] } } });
  }, 120_000);
});
