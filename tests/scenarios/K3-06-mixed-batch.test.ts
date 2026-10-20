/**
 * K3 row K3-06 (spec line 1413; ruling 2 of `.dsh-ref/k3-g3-impl-4.md`).
 *
 * With the real Kernel a mixed batch runs serially: a batch that contains a
 * non-read-only call is executed one call at a time, so RUN-25 lists at most one
 * unresolved call. The row's three-item record is therefore proven at the owner
 * level (`tests/work-graph/K3-06-mixed-kinds-owner.test.ts`). Ruling 2's R2 part
 * here proves the reachable SINGLE-ITEM case, one case per kind and each its own
 * Run, through the whole real chain: scripted model → Kernel → crash → RUN-25 →
 * `workflow.advanceWork` → (process only) the review round → the
 * `record_unknown_call_review` tool → the owner → settlement → public
 * `unknown-call-reviews/read`.
 *
 * Ruling 1: every stand-in keeps the REAL effect class and only blocks the
 * handler — `edit` is `workspace_write` (`edit-tool.js`), `send_session_message`
 * is the real definition's `workspace_write` (`communication-tools.ts`), `shell`
 * is `process` (`K3-tool-seams.ts`). No parallelizing read-only stand-in and no
 * fabricated Kernel history. A single serial call still reaches `running`, so
 * each crashed Turn has exactly one unresolved call.
 *
 * The card/disposition, proposal phase and continuation-note text are group 4
 * and are not asserted here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import { cleanupRestart, readExecution } from '../helpers/A2-restart-fixture.js';
import { createScriptedModel, type ScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { mailboxSeam, type MailboxSeam } from '../helpers/K3-mailbox-seam.js';
import { mixedEditSeam, releaseMixedSeams, type MixedSeam } from '../helpers/K3-mixed-seams.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import {
  AG2B_CONSUMER_ID, AG2B_QUERY_ROLE, AG2B_SCOPE, AG2B_WORK_TASK_ID, createAG2bSession, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { cleanupScenarios, HostScenario, hostCtx, performs, type Platform } from './harness.js';
import { openWorkRoot, preparedOf, redrivePolicy, WORK_TARGET } from './support/common.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { prepareOn } from './support/shell-work-root.js';

// The KE6 stand-in (as K3-05): `reviewCapability` reads the read-only probe with
// no host process; the general (process) probe stays unavailable.
const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxStandin } = await import('./support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxStandin(actual, sandbox) };
});

// --- The single-call blockers (real effect classes; see the header). --------
const seams = vi.hoisted(() => ({ edit: undefined as unknown, mailbox: undefined as unknown, shell: undefined as unknown }));

vi.mock('../../vendor/coding-agent/dist/tools/builtin/edit/edit-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/edit/edit-tool.js')>();
  return {
    ...actual,
    createEditToolDefinition: (workspace: Parameters<typeof actual.createEditToolDefinition>[0]): ToolDefinition =>
      (seams.edit as MixedSeam).definition(actual.createEditToolDefinition as never, workspace as never),
  };
});

vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return {
    ...actual,
    createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
      (seams.shell as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg),
  };
});

vi.mock('../../src/core/agent-runtime/communication-tools.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/agent-runtime/communication-tools.js')>();
  return {
    ...actual,
    createSessionMailboxTools: (config: Parameters<typeof actual.createSessionMailboxTools>[0]) => {
      const handle = actual.createSessionMailboxTools(config);
      return {
        ...handle,
        create: (workspace: Parameters<typeof handle.create>[0]) => handle.create(workspace).map((definition) =>
          definition.name === 'send_session_message'
            ? { ...definition, handler: { ...definition.handler,
                execute: (call: never, options: never) =>
                  (seams.mailbox as MailboxSeam).run(definition.handler, call, options) } }
            : definition),
      };
    },
  };
});

seams.edit = mixedEditSeam;
seams.mailbox = mailboxSeam;
seams.shell = shellSeam;

afterEach(async () => {
  releaseMixedSeams();
  mailboxSeam.release();
  shellSeam.release();
  sandbox.available = true;
  await cleanupScenarios();
  await cleanupRestart();
});

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

type BlockingSeam = {
  arm(): void; release(): void; waitForCall(): Promise<void>;
  calls: ReadonlyArray<{ callId: string }>;
};
type OpenRoot = (h: HostScenario, model: ScriptedModel) => Promise<Platform>;

/**
 * One Run that emits ONE call of `name`, blocks in the stand-in handler, then
 * crashes. The work Run is prepared through `prepareOn` on a root whose own
 * Workflow is registered (`openShellWorkRoot`), or through the Host's
 * `advance` when the Host grant already carries the tool (`openWorkRoot` has no
 * Workflow configuration). Returns the prepared origin Run once RUN-25 has
 * reconciled it `W-26`.
 */
async function crashSingleCall(options: {
  label: string; h: HostScenario; openRoot: OpenRoot; seam: BlockingSeam; prepareViaHost?: boolean;
  callId: string; name: string; args: Record<string, unknown>;
}): Promise<{ prepared: ReturnType<typeof preparedOf> }> {
  const { label, h, openRoot, seam, callId, name, args } = options;
  seam.arm();
  const model = createScriptedModel([{ kind: 'calls', calls: [{ callId, name, args }] }]);
  const root = await openRoot(h, model);
  let running: Promise<unknown> | null = null;
  let report: Awaited<ReturnType<HostScenario['restart']>>;
  let prepared: ReturnType<typeof preparedOf>;
  try {
    prepared = options.prepareViaHost === true
      ? preparedOf((await h.advance(h.select(label, AG2B_WORK_TASK_ID), { stopBefore: performs('start') })).next)
      : preparedOf(await prepareOn(root, h.select(label, AG2B_WORK_TASK_ID)));
    running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: `${label}-start` });
    await seam.waitForCall();
    report = await h.restart({ crash: true });
  } finally {
    seam.release();
    await running?.catch(() => undefined);
    await root.close();
  }
  expect(seam.calls.map(call => call.callId), `${label}: the stand-in held the one call`).toEqual([callId]);
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
    { ref: JSON.stringify(prepared.claim.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
      autoCleanup: { applied: true } }] } });
  return { prepared };
}

/** The `review` basis a `claim_task` perform carries; null for an ordinary claim. */
function reviewBasisOf(input: WorkflowAdvanceInput): unknown {
  if (input.kind !== 'perform' || input.operation.kind !== 'claim_task') return null;
  const review = (input.operation.request as { input: { review?: unknown } }).input.review;
  return review === undefined ? null : review;
}

describe('K3-06 single-item R2 chains, one per kind (ruling 2)', () => {
  it('K3-06 (file_edit, L3/L8/L9): one in-flight edit is compare_in_continuation and settles at creation', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const { prepared } = await crashSingleCall({ label: 'k3-06-file-edit', h, openRoot: openWorkRoot, seam: mixedEditSeam,
      prepareViaHost: true, callId: 'k3-06-file-edit-edit', name: 'edit',
      args: { mode: 'replace', path: 'src/module.ts', oldText: 'SCENARIO_GIT_BASELINE', newText: 'K3_06_CHANGED' } });

    const created = await reviewOf(h, prepared.claim.runRef);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;
    // No process item: L8/L9 settle the record `resolved` at creation.
    expect(created.value).toMatchObject({ status: 'resolved', decisionReasons: [], activeRound: null, rounds: [] });
    expect(created.value.items).toHaveLength(1);
    expect(created.value.items[0]).toMatchObject({ toolName: 'edit', kind: 'file_edit', contained: true,
      observed: { verdict: 'compare_in_continuation', by: 'platform' } });

    // The Workflow advances without claiming any review round.
    const toContinue = await h.advance(h.select('k3-06-file-edit-continue', AG2B_WORK_TASK_ID),
      { stopBefore: performs('start') });
    const reviewClaims = toContinue.steps.map(step => step.next).filter((next): next is WorkflowAdvanceInput => next !== null)
      .map(reviewBasisOf).filter(basis => basis !== null);
    expect(reviewClaims, 'a file_edit record needs no review round').toHaveLength(0);
    expect(toContinue.next, 'the continuation is prepared').not.toBeNull();
  }, 180_000);

  it('K3-06 (platform, L3/L4/L8/L9): one in-flight send is not_done and settles at creation', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const recipient = (await createAG2bSession(h.host, 'k3-06-platform-recipient', AG2B_QUERY_ROLE,
      [{ target: WORK_TARGET, relation: 'participates' }])).sessionRef;
    const { prepared } = await crashSingleCall({ label: 'k3-06-platform', h, openRoot: openWorkRoot, seam: mailboxSeam,
      prepareViaHost: true, callId: 'k3-06-platform-send', name: 'send_session_message',
      args: { recipient: { projectId: recipient.projectId, sessionId: recipient.sessionId }, text: 'k3-06 platform question' } });

    const created = await reviewOf(h, prepared.claim.runRef);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;
    // The blocked send never committed, so L4 answers not_done; no process item.
    expect(created.value).toMatchObject({ status: 'resolved', decisionReasons: [], activeRound: null, rounds: [] });
    expect(created.value.items).toHaveLength(1);
    expect(created.value.items[0]).toMatchObject({ toolName: 'send_session_message', kind: 'platform', contained: true,
      observed: { verdict: 'not_done', by: 'platform', evidence: { kind: 'not_committed' } } });

    const toContinue = await h.advance(h.select('k3-06-platform-continue', AG2B_WORK_TASK_ID),
      { stopBefore: performs('start') });
    const reviewClaims = toContinue.steps.map(step => step.next).filter((next): next is WorkflowAdvanceInput => next !== null)
      .map(reviewBasisOf).filter(basis => basis !== null);
    expect(reviewClaims, 'a not_done platform record needs no review round').toHaveLength(0);
    expect(toContinue.next, 'the continuation is prepared').not.toBeNull();
  }, 180_000);
});
