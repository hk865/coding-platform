/**
 * B2-09 (b) at R4 (L19a "允许一次"; spec L19a "提交以后、命令真正开始以前崩溃
 * → 允许已经用掉，这次调用照 K 的规则成了结果未知，进 K3 的核对"; CRR-03;
 * B2-09 R4/R5; L29 Host crash fixture).
 *
 * The whole chain runs on the SQLite Host, through public steps only:
 *   1. a real `shell` call in flight is closed by RUN-25 on a crash restart; a
 *      real review round + `settle_review` makes the `needs_decision` card and
 *      the public `decisions/answer` applies `skip_as_done`, so ② writes the
 *      real `blockedCommands` (no record is hand-built);
 *   2. the Workflow (on a shell-granting composition root, the K3-35 shape)
 *      requeues the crashed Run and prepares the later Work Run; its PUBLIC
 *      manifest bundle carries the binding;
 *   3. the scripted model makes the SAME command's `shell` call (the real
 *      `before_tool` hook blocks it), then calls the real
 *      `request_command_rerun` tool; the test holds the next model call and
 *      answers `allow_rerun` through the public `decisions/answer` route;
 *   4. the third model reply makes the same `shell` call again: the hook's
 *      `consumeAllowance` commits, then the call stays in flight in the
 *      stand-in `shell` seam (no host process); the Host crashes there and is
 *      restarted on the same SQLite files;
 *   5. after restart: the CRR read port says `used` with `usedBy` naming the
 *      crashed Run/call and the execution read says `outcome_unknown`. RUN-25's
 *      automatic cleanup is refused by G9 (`second_auto_cleanup`: this Task
 *      already had one), so the person's real `executions/resolve-unknown`
 *      attestation opens the K3 review record (the K3-28 path). A later `shell`
 *      of the command is blocked again (proved in the B2-09 (b) owner-level
 *      companion, because a `pending_review` Task has no next Work Run before
 *      its review is decided).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { answerCard, needsDecisionCard, queueOf, reviewOf } from './support/review-card-round.js';
import { preparedOf, redrivePolicy } from './support/common.js';
import { preparedManifestOf } from './support/brief.js';
import { openShellWorkRoot, prepareOn } from './support/shell-work-root.js';
import { createScriptedModel, type ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart, readExecution } from '../helpers/A2-restart-fixture.js';
import { listCommandRerunRequests } from '../helpers/B2-09b-crash.js';
import {
  AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';

// The KE6 stand-in: `reviewCapability` and the read-only command probe with the
// `read_only` options; no host process runs.
const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  class KProcessSandbox {
    constructor(..._args: unknown[]) { void _args; }
    get effectiveOptions(): { protectedPaths: string[]; readOnlyPaths: string[]; executablePath: string } {
      return { protectedPaths: [], readOnlyPaths: [], executablePath: '/usr/bin:/bin' };
    }
    static async probe(_root: string, _workspace: unknown, options?: Record<string, unknown>): Promise<unknown> {
      if (options?.['workspaceMode'] !== 'read_only') {
        return { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: only read-only probing' };
      }
      return sandbox.available
        ? { available: true, version: 'stub-v1', bwrapPath: '/usr/bin/bwrap', reason: null }
        : { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: bubblewrap unavailable' };
    }
  }
  return { ...actual, ProcessSandbox: KProcessSandbox };
});

// The blocking `shell` stand-in (K3 §5.1): the allowed call never starts.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return {
    ...actual,
    createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
      (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg),
  };
});
seams.shellSeam = shellSeam;

/**
 * F-026/F8: the hand-computed sha256 of this row's whole command
 * (`b2-09b runs a program`, already in normal form), written out instead of
 * calling the production `commandSha256`.
 */
const COMMAND_SHA256 = '8e3c4cbcf125956be14302d7341a5827f25804fa1b494502e4186de57bd9100f';

afterEach(async () => {
  shellSeam.release();
  sandbox.available = true;
  await cleanupScenarios();
  await cleanupRestart();
});

/** The one waiting `command_rerun_request` card. */
function crrCardOf(queue: DecisionQueueReadV1): DecisionCardV1 {
  const cards = queue.waitingAnswer.filter(card => card.source.kind === 'command_rerun_request');
  expect(cards).toHaveLength(1);
  return cards[0]!;
}

describe('B2-09 (b) allowance used, crash before the shell starts, restart', () => {
  it('B2-09b: skip_as_done writes the binding, allow_rerun is consumed, the Host crashes before the command starts, and the restart shows used + outcome_unknown + a K3 review', async () => {
    const label = 'b2-09b';
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    // --- 1. The real crash record, review round and `skip_as_done` answer. ----
    const chain = await needsDecisionCard(h, label);
    const command = `${label} runs a program`;
    const answered = await answerCard(h, chain.card, 'skip_as_done', `${label}-skip`, '已经做过了，别再跑');
    expect(answered, JSON.stringify(answered)).toMatchObject({ status: 'ready', value: { state: 'applied' } });
    const resolved = await reviewOf(h, chain.originalRunRef);
    expect(resolved.status).toBe('ready');
    if (resolved.status !== 'ready') throw new Error(JSON.stringify(resolved));
    expect(resolved.value.status).toBe('resolved');
    expect(resolved.value.blockedCommands).toHaveLength(1);
    expect(resolved.value.blockedCommands[0]).toMatchObject({ reviewRunId: chain.originalRunRef.runId,
      alias: 1, commandSha256: COMMAND_SHA256 });

    // --- 2. The later Work Run is prepared with the real binding. -----------
    const callId = `${label}-allowed-shell`;
    const blockedCallId = `${label}-blocked-shell`;
    const goalId = chain.record.task.goalId;
    const taskId = chain.record.task.taskId;
    const requestCallId = `${label}-request-rerun`;
    const replies: ScriptedReply[] = [
      { kind: 'calls', calls: [{ callId: blockedCallId, name: 'shell', args: { command } }] },
      { kind: 'calls', calls: [{ callId: requestCallId, name: 'request_command_rerun',
        args: { command, reason: '这条迁移还需要再跑一次' } }] },
      { kind: 'calls', calls: [{ callId, name: 'shell', args: { command } }] },
      { kind: 'text', text: 'b2-09b run finished' },
    ];
    let releaseThird!: () => void;
    const thirdGate = new Promise<void>((resolve) => { releaseThird = resolve; });
    let reachThird!: () => void;
    const thirdReached = new Promise<void>((resolve) => { reachThird = resolve; });
    const model = createScriptedModel(replies, async (_request, index) => {
      if (index === 2) { reachThird(); await thirdGate; }
    });
    shellSeam.arm();
    const root = await openShellWorkRoot(h, model);
    let running: Promise<unknown> | null = null;
    let prepared: ReturnType<typeof preparedOf> | undefined;
    let crashedRunRef: import('../../src/contracts/dispatch.js').RunRef | undefined;
    let review: Awaited<ReturnType<typeof reviewOf>> | undefined;
    try {
      const toStart = await prepareOn(root, h.select(`${label}-next`, AG2B_WORK_TASK_ID));
      prepared = preparedOf(toStart);
      // The manifest binding through the public materials/open route.
      const manifest = await preparedManifestOf(h, prepared.envelope.bundleRef);
      expect(manifest.blockedCommands).toEqual([{ reviewRunId: chain.originalRunRef.runId,
        alias: 1, commandSha256: COMMAND_SHA256 }]);

      running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: `${label}-start` });
      // The model's first two calls (the hook-blocked shell and the rerun
      // request) really happened before the test holds the third model call.
      await thirdReached;
      const held = model.requests[1];
      const blockText = JSON.stringify(held ?? {});
      expect(blockText).toContain('平台拦下了这条命令');
      expect(blockText).toContain('request_command_rerun');

      // --- 3. The person allows the rerun through the public answer route. ---
      const crrCard = crrCardOf(await queueOf(h));
      const allowed = await answerCard(h, crrCard, 'allow_rerun', `${label}-allow`, '允许这一次');
      expect(allowed, JSON.stringify(allowed)).toMatchObject({ status: 'ready', value: { state: 'applied' } });
      // The answer itself carries the public `allowed` revision (2); the CRR
      // row after the restart must still be that answer plus the ONE consume.
      expect((allowed as unknown as { value: { action: unknown } }).value.action)
        .toMatchObject({ status: 'committed', value: { state: 'allowed', revision: 2, usedAt: null, usedBy: null } });

      // --- 4. The same command's next `shell`: consume commits, call in flight,
      //        Host crashes before the stand-in ever starts a command. ---------
      releaseThird();
      await shellSeam.waitForCall();
      expect(shellSeam.calls.map(call => call.callId)).toEqual([callId]);
      const report = await h.restart({ crash: true });
      expect(report.report).not.toBeNull();
      if (report.report !== null) expect(report.report.problems).toEqual([]);

      // --- 5. Restart: outcome_unknown, and the K3 review record. -----------
      if (prepared === undefined) throw new Error('the later Run was not prepared');
      crashedRunRef = prepared.claim.runRef;
      const execution = await readExecution(h.host, crashedRunRef);
      expect(execution.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });

      // RUN-25's automatic cleanup is refused here by G9 (`second_auto_cleanup`:
      // the Task already had one automatic cleanup when the original crash was
      // reconciled), so the Run stays quarantined with its unresolved call. The
      // person's real `executions/resolve-unknown` attestation is the public
      // entry that opens the K3 review record for it (the K3-28 path) while the
      // abandoned run still holds the Kernel Turn (so the draft still names the
      // unresolved call).
      expect(execution.run.reconciliation).toMatchObject({ status: 'quarantined',
        observation: { kind: 'unresolved', reason: 'tool_calls_unresolved',
          unresolvedToolCallIds: [callId], autoCleanupBlockedBy: 'second_auto_cleanup' } });
      const attested = await h.post<WriteResult<unknown>>('executions/resolve-unknown', graphWrite(AG2B_SCOPE,
        { runRef: crashedRunRef, reason: 'B2-09b: the Host crashed before the allowed command started' },
        `${label}-attest`, [{ ref: crashedRunRef, revision: execution.run.revision }]));
      expect(attested).toMatchObject({ status: 'committed' });

      review = await reviewOf(h, crashedRunRef);
    } finally {
      shellSeam.release();
      await running?.catch(() => undefined);
      await root.close();
    }

    if (crashedRunRef === undefined || review === undefined) throw new Error('the crashed Run was not reviewed');
    expect(review.status).toBe('ready');
    if (review.status !== 'ready') throw new Error(JSON.stringify(review));
    expect(review.value.status).toBe('pending_review');
    expect(review.value.origin).toMatchObject({ kind: 'human_attested',
      reason: 'B2-09b: the Host crashed before the allowed command started' });
    expect(review.value.items).toHaveLength(1);
    expect(review.value.items[0]).toMatchObject({ alias: 1, callId, toolName: 'shell', kind: 'process' });

    const read = await listCommandRerunRequests(h.database, hostCtx(), AG2B_SCOPE,
      { goalId, taskId });
    expect(read).toHaveLength(1);
    const used = read[0]!;
    expect(used).toMatchObject({ state: 'used', revision: 3,
      usedBy: { runId: crashedRunRef.runId, callId }, commandSha256: COMMAND_SHA256 });
    expect(used.usedAt).not.toBeNull();
    // No second CRR write for the crash: the request stays at the `used`
    // revision, and no allowance is left waiting.
    const again = await listCommandRerunRequests(h.database, hostCtx(), AG2B_SCOPE,
      { goalId, taskId });
    expect(again.map(request => [request.state, request.revision])).toEqual([['used', 3]]);
  }, 300_000);
});
