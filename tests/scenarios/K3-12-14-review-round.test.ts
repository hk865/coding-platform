/**
 * K3-12 / K3-14 (R2, L13/L14): the STARTED review round, driven end to end
 * through `workflow.advanceWork`, proves the behavior the prepare-seam and
 * owner-level tests cannot:
 *
 * - K3-12: the tools the scripted provider's request actually enables are
 *   exactly the L13 set (`read` + the exploration tools that ride with `read` +
 *   `run_readonly_command` + `record_unknown_call_review`), with no `shell`, no
 *   `edit` and no collaboration tool; the write scope is empty; and a
 *   file-changing `run_readonly_command` inside the round is refused by the
 *   read-only mount and mapped to `execution_failed` (the KE6 stand-in).
 * - K3-14 (R5): two NEW callIds overwrite the same process item, the last
 *   committed verdict wins and each commit is a new revision; a call whose
 *   `item` names no such alias is an `invalid_arguments` tool result and writes
 *   nothing; the conclusion reads back through `unknown-call-reviews/read` with
 *   the verdict, evidence, `by: 'review_round'` and the round Run ref.
 *
 * The review record comes from the same RUN-25 chain K3-05 uses: a `shell` call
 * stays in flight and the crash restart reconciles it `W-26` with
 * `autoCleanup.applied`, leaving a `pending_review` record with one `process`
 * item. The round is then claimed, prepared and started on the read-only-capable
 * composition root (./support/review-work-root.ts) with the KE6 `ProcessSandbox`
 * stand-in, so no host process runs. Replay and `idempotency_conflict` stay
 * owner-level through the real adapter (tests/work-graph/K3-14-...).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { createScriptedModel, type ScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { preparedOf, redrivePolicy, toolOutputJson } from './support/common.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { openShellWorkRoot, prepareOn } from './support/shell-work-root.js';

// The KE6 stand-in: `reviewCapability` and the read-only command both probe with
// the `read_only` workspace options, and the Kernel's capability set is built
// from the general process probe (KB-10's stand-in reports it available), so the
// composed run exposes `isolated_process`/`network_isolated`; no host process
// runs either way.
const sandbox = vi.hoisted(() => ({
  available: true as boolean,
  commands: [] as string[],
  next: ((): unknown => ({
    exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: '', totalBytes: 0, truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    sandboxProfileVersion: 'stub-v1',
    timings: { snapshotBeforeMs: 0, executionMs: 0, snapshotAfterMs: 0 },
  })) as (command: string) => unknown,
}));

vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  class KProcessSandbox {
    constructor(..._args: unknown[]) { void _args; }
    get effectiveOptions(): { protectedPaths: string[]; readOnlyPaths: string[]; executablePath: string } {
      return { protectedPaths: [], readOnlyPaths: [], executablePath: '/usr/bin:/bin' };
    }
    static async probe(_root: string, _workspace: unknown, _options?: Record<string, unknown>): Promise<unknown> {
      return sandbox.available
        ? { available: true, version: 'stub-v1', bwrapPath: '/usr/bin/bwrap', reason: null }
        : { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: bubblewrap unavailable' };
    }
    async execute(request: { command: string }): Promise<unknown> {
      // The stand-in never touches the host: it records the attempt and returns
      // the result the configured read-only mount would produce.
      sandbox.commands.push(request.command);
      return sandbox.next(request.command);
    }
  }
  return { ...actual, ProcessSandbox: KProcessSandbox };
});

// --- The shell seam (the process call RUN-25 leaves in flight) --------------
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

afterEach(async () => {
  shellSeam.release();
  sandbox.available = true;
  sandbox.commands = [];
  sandbox.next = () => ({
    exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: '', totalBytes: 0, truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    sandboxProfileVersion: 'stub-v1',
    timings: { snapshotBeforeMs: 0, executionMs: 0, snapshotAfterMs: 0 },
  });
  await cleanupScenarios();
  await cleanupRestart();
});

/**
 * L13: the exact names the review-round provider request enables, written as a
 * hand-computed literal. `read` brings the conditional exploration tools for a
 * run with a frozen (lazy) project source; the formal grant is the other three.
 */
const EXPECTED_REVIEW_REQUEST_TOOLS = [
  'read', 'list_files', 'search', 'symbols', 'code_index', 'project_source',
  'python_index', 'cpp_index', 'source_excerpt', 'run_readonly_command', 'record_unknown_call_review',
];

const FORBIDDEN_REVIEW_TOOLS = ['shell', 'edit', 'write', 'send_message', 'ask_user',
  'find_related_sessions', 'read_session_card', 'send_session_message'];

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

/** The tool message the Kernel delivered for `callId` (success or a mapped refusal). */
function toolMessage(scripted: ScriptedModel, callId: string) {
  const request = scripted.requests.find(entry => entry.messages.some(message => message.role === 'tool' && message.callId === callId));
  return request?.messages.find(message => message.role === 'tool' && message.callId === callId);
}

/**
 * The RUN-25 entry (K3-05, item A): a `shell` call is left in flight and the
 * crash restart reconciles it `W-26`/`takeover_unresolved`, so the review record
 * is `pending_review` with one `process` item. Returns the origin Run ref.
 */
async function createPendingProcessReview(h: HostScenario, prefix: string): Promise<RunRef> {
  shellSeam.arm();
  const modelA = createScriptedModel([{ kind: 'calls', calls: [
    { callId: `${prefix}-shell`, name: 'shell', args: { command: `${prefix} runs a program` } }] }]);
  const rootA = await openShellWorkRoot(h, modelA);
  let runningA: Promise<unknown> | null = null;
  try {
    const startA = await prepareOn(rootA, h.select(`${prefix}-a`, AG2B_WORK_TASK_ID));
    const preparedA = preparedOf(startA);
    runningA = rootA.runtime.startRun(hostCtx(), { prepared: preparedA, consumerId: AG2B_CONSUMER_ID,
      requestId: `${prefix}-a-start` });
    await shellSeam.waitForCall();
    const reportA = await h.restart({ crash: true });
    expect(reportA).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(preparedA.claim.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    return preparedA.claim.runRef;
  } finally {
    shellSeam.release();
    await runningA?.catch(() => undefined);
    await rootA.close();
  }
}

describe('K3-12/K3-14 the started review round (R2)', () => {
  it('K3-12 the started round enables exactly the L13 tools with an empty write scope and maps a file-changing read-only command to execution_failed', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const origin = await createPendingProcessReview(h, 'k3-12');

    const created = await reviewOf(h, origin);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;
    expect(created.value.status).toBe('pending_review');
    expect(created.value.items).toMatchObject([{ kind: 'process' }]);

    const command = 'echo written > out.txt';
    sandbox.next = () => ({
      exitCode: 1, signal: null, timedOut: false, cancelled: false,
      stdout: { text: '', totalBytes: 0, truncated: false },
      stderr: { text: 'bash: line 1: out.txt: Read-only file system\n', totalBytes: 48, truncated: false },
      effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
      sandboxProfileVersion: 'stub-v1',
      timings: { snapshotBeforeMs: 0, executionMs: 1, snapshotAfterMs: 0 },
    });
    const model = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-12-write-call', name: 'run_readonly_command',
        args: { command } }] },
      { kind: 'text', text: 'the review round saw the write refused' },
    ]);

    // Drive claim+prepare by hand to assert the persisted L13 envelope first.
    const root = await openReviewWorkRoot(h, model);
    try {
      const stop = await driveReviewUntil(root, h.select('k3-12-review', AG2B_WORK_TASK_ID), performs('start'));
      const kinds = stop.receipts.map(receipt => receipt.kind);
      expect(kinds).toContain('claim_task');
      expect(kinds).toContain('prepare');
      expect(kinds.at(-1)).toBe('prepare');
      const prepared = preparedOf(stop.stopped);
      expect(prepared.envelope.permissions.tools).toEqual(['read', 'run_readonly_command', 'record_unknown_call_review']);
      expect(prepared.envelope.permissions.writeScope).toEqual([]);

      await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-12-review-start' });

      // The scripted provider's actual request carries exactly the L13 set.
      const names = model.requests[0]?.tools.map(tool => tool.name) ?? [];
      expect([...names].sort()).toEqual([...EXPECTED_REVIEW_REQUEST_TOOLS].sort());
      for (const forbidden of FORBIDDEN_REVIEW_TOOLS) expect(names).not.toContain(forbidden);

      // The write attempt reached only the read-only sandbox and was mapped.
      const delivered = toolMessage(model, 'k3-12-write-call');
      expect(sandbox.commands).toEqual([command]);
      expect(delivered?.role === 'tool' && delivered.result.status === 'error'
        ? delivered.result.error.code : undefined).toBe('execution_failed');
      if (delivered?.role !== 'tool' || delivered.result.status !== 'error') {
        throw new Error('the read-only write attempt was not mapped to a failure');
      }
      expect(delivered.result.error.message).toContain('命令退出码 1');
      expect(delivered.result.effects.changedPaths).toEqual([]);
      expect(delivered.result.effects.sideEffect).toBe('none');
    } finally {
      await root.close();
    }
  }, 180_000);

  it('K3-14 a started round overwrites with new callIds (last verdict wins, each a new revision), rejects an unknown alias with invalid_arguments, and reads back the conclusion', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const origin = await createPendingProcessReview(h, 'k3-14');

    const created = await reviewOf(h, origin);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;
    expect(created.value.status).toBe('pending_review');
    expect(created.value.items).toMatchObject([{ kind: 'process' }]);

    const model = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-14-call-a', name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'done', evidence: 'first answer: the command finished',
          crashSuspicion: { verdict: 'unlikely', evidence: 'no crash trace' } } }] },
      { kind: 'calls', calls: [{ callId: 'k3-14-call-b', name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'not_done', evidence: 'second answer: the command did not finish',
          crashSuspicion: { verdict: 'possible', evidence: 'a trace was left behind' } } }] },
      { kind: 'calls', calls: [{ callId: 'k3-14-call-unknown-alias', name: 'record_unknown_call_review',
        args: { item: 2, verdict: 'done', evidence: 'there is no item #2',
          crashSuspicion: { verdict: 'unlikely', evidence: 'none' } } }] },
      { kind: 'text', text: 'the review round finished' },
    ]);

    const root = await openReviewWorkRoot(h, model);
    try {
      const stop = await driveReviewUntil(root, h.select('k3-14-review', AG2B_WORK_TASK_ID), performs('start'));
      const prepared = preparedOf(stop.stopped);
      const roundRunRef = prepared.claim.runRef;

      // The revision the first commit must move past: the record after the round claim.
      const atStart = await reviewOf(h, origin);
      expect(atStart.status).toBe('ready');
      if (atStart.status !== 'ready') return;
      expect(atStart.value.activeRound).not.toBeNull();
      const beforeCommits = atStart.value.revision;

      await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-14-review-start' });

      // --- Overwrite: two new callIds, both committed, each a new revision. --
      // L14 "回执": the tool returns the bounded receipt (`status`, `item`,
      // `revision`, `receipt`, `replayed`), not the whole record, so the
      // revision is top-level (K3-10's `shortReceipt` asserts the same shape).
      const first = toolOutputJson(model.requests[1], 'k3-14-call-a') as
        { status?: string; revision?: number } | undefined;
      const second = toolOutputJson(model.requests[2], 'k3-14-call-b') as
        { status?: string; revision?: number } | undefined;
      expect(first?.status).toBe('committed');
      expect(second?.status).toBe('committed');
      if (first?.revision === undefined || second?.revision === undefined) {
        throw new Error('both record calls must carry a committed revision');
      }
      expect(first.revision).toBeGreaterThan(beforeCommits);
      expect(second.revision).toBeGreaterThan(first.revision);

      // --- Invalid alias: an invalid_arguments tool result; nothing written. -
      const unknownAlias = toolMessage(model, 'k3-14-call-unknown-alias');
      expect(unknownAlias?.role === 'tool' && unknownAlias.result.status === 'error'
        ? unknownAlias.result.error.code : undefined).toBe('invalid_arguments');
      expect(toolOutputJson(model.requests[3], 'k3-14-call-unknown-alias'))
        .toMatchObject({ status: 'rejected', code: 'invalid' });

      // --- Read back through the public route; the last verdict wins. --------
      const concluded = await reviewOf(h, origin);
      expect(concluded.status).toBe('ready');
      if (concluded.status !== 'ready') return;
      expect(concluded.value.revision).toBe(second.revision);
      expect(concluded.value.items[0]!.observed).toMatchObject({
        verdict: 'not_done', by: 'review_round',
        evidence: 'second answer: the command did not finish',
        crashSuspicion: { verdict: 'possible', evidence: 'a trace was left behind' },
        roundRunRef: { runId: roundRunRef.runId },
      });
    } finally {
      await root.close();
    }
  }, 180_000);
});
