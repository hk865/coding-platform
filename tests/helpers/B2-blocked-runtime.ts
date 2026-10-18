/**
 * B2 L19a behavior-test world (rows B2-01..B2-09, B2-12..B2-16, B2-18).
 *
 * It reuses the `K3-blocked-command-fixture` world: a REAL Work Run whose
 * `shell` call went through §5.1's stand-in, the real Kernel facts that ② reads,
 * the real `blockedCommands` written by ②, and the real decision path. The
 * answers are SAVED through the decision coordinator before the CRR owner
 * applies the saved reference. On top of it this helper builds:
 *   - the SAME `CommandRerunRequest` owner/read port the routes publish, with
 *     the ONE shared recognizer (`createCommandRecognizer`) over a literal
 *     workspace double (only file CONTENT is injected; digests are real);
 *   - the exported `before_tool` shell hook (`createShellBlockedHook`) with the
 *     real record state and the real CRR reads;
 *   - optionally the real execution preparation over a real continuation claim
 *     (a human requeue + `claimTask`), so `manifest.blockedCommands` is the real
 *     prepared binding, not a hand-built array;
 *   - the hook's later Run: a REAL claimed Run of the same Task, reached through
 *     the public requeue → claim path of the shared real-Run harness. It is
 *     never entered; it is then ended through the public control owner (RUN-09
 *     `platform_not_entered`) so the Task stays closable, and both facts are the
 *     platform's. Its identity and role binding are the platform's (there is no
 *     constructed Run).
 *
 * The hook is exercised at its public `before_tool` seam with a real manifest
 * binding and real records (stated per test). The Kernel's own contract turns a
 * `block` into a `hook_blocked` tool result without a sandbox; the Runtime
 * registration path is covered by the driver assembly.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { RoleBindingRefV1, RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { CommandRerunRequestRef, CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';
import type { ReadWorkspaceRequest, WorkspaceFile } from '../../src/core/workspace/ports.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createCommandRecognizer } from '../../src/core/work-graph/tasks/command-recognition.js';
import { readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createCommandRerunRequestService } from '../../src/core/work-graph/tasks/command-rerun-request-service.js';
import {
  COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE, COMMAND_RERUN_REQUEST_SCHEMA_ID,
} from '../../src/core/work-graph/tasks/command-rerun-request-codecs.js';
import { createCommandRerunTools } from '../../src/core/agent-runtime/command-rerun-tools.js';
import { createShellBlockedHook, type ShellBlockedHookConfig } from '../../src/core/agent-runtime/execution-driver.js';
import type { HookPort, ToolCall } from '../../vendor/coding-agent/dist/public-api.js';
import {
  openK3BlockedCommandWorld, sha256Of, type K3BlockedCommandWorld,
} from './K3-blocked-command-fixture.js';
import type { K3ReviewCardWorld } from './K3-review-card-fixture.js';
import { crrCardOf, runIdGeneratorOf } from './B2-crr-world.js';
import { openRealRunHarness } from './K3-35-continuation-fixture.js';
import { PLAN_B2, T } from './S5-decision-fixture.js';

export type B2BlockedWorld = {
  blocked: K3BlockedCommandWorld;
  record: UnknownCallReviewV1;
  binding: NonNullable<ShellBlockedHookConfig['binding']>;
  /** The trusted context the hook/CRR owner reads under. */
  ctx: CoreCallContext;
  /** A later Work Run identity of the same Task (the hook never reads the Run). */
  runRef: RunRef;
  workspace: { projectId: string; workspaceId: string };
  requests: ReturnType<typeof createCommandRerunRequestService>;
  /** Every CRR `listRequests` page request, in order. */
  listCalls: Array<{ limit: number; cursor: string | undefined }>;
  /** Every record read, in order. */
  recordReads: string[];
  /** Every workspace read through the recognizer, in order. */
  packageReads: string[];
  /** Every task-review page read by the request owner, in order. */
  taskReviewCalls: Array<{ taskId: string; cursor: string | undefined }>;
  /** Every committed CRR event body (the `used` row is asserted from here). */
  crrEvents: Array<Record<string, unknown>>;
  counts: { crrCommits: number };
  hook: HookPort;
  /** The real `request_command_rerun` tool definition. */
  tool: ReturnType<ReturnType<typeof createCommandRerunTools>['create']>[number];
  /** Fail the NEXT CRR write commit once (rejected `unavailable`). */
  failNextCrrCommit(): void;
  /** Answer through the real CRR owner `applyAnswer` (the card adapter is another lane's). */
  answer(selection: 'allow_rerun' | 'deny' | 'deny_final', requestRef: CommandRerunRequestRef,
    revision: number, messageId?: string): Promise<Awaited<ReturnType<ReturnType<typeof createCommandRerunRequestService>['applyAnswer']>>>;
  readRecord(): Promise<UnknownCallReviewV1>;
  listRequests(ctx: CoreCallContext): Promise<CommandRerunRequestV1[]>;
  close(): Promise<void>;
};

/** The three-field binding exactly as preparation derives it from the record. */
export function bindingOf(record: UnknownCallReviewV1): NonNullable<ShellBlockedHookConfig['binding']> {
  return [...record.blockedCommands]
    .sort((left, right) => left.alias - right.alias)
    .map(entry => ({ reviewRunId: record.ref.runId, alias: entry.alias, commandSha256: entry.commandSha256 }));
}

/**
 * The REQUIRED production Task-closure seam (`readTaskClosure` in the CRR
 * owner). A test may wrap it to count reads; the default is unchanged.
 */
export type B2TaskClosureReader = (ctx: CoreCallContext, task: TaskTriple) =>
  Promise<ReadResult<{ closed: boolean; cause: 'satisfied' | 'cancelled' | 'superseded' | null }>>;

let eventSeq = 0;
let callSeq = 0;
let laterRunSeq = 0;

/** A unique Kernel call identity for the scripted shell/tool calls. */
export function nextCall(callId?: string): string {
  callSeq += 1;
  return callId ?? `b2-hook-call-${String(callSeq)}`;
}

/** The public execution read of one Run: its claim, snapshot and role binding. */
async function readExecutionOf(world: K3ReviewCardWorld, runRef: RunRef) {
  const read = await createRunStateReader({ records: world.records })
    .readExecution(world.fixture.ctx, runRef);
  if (read.status !== 'ready') {
    throw new Error(`B2 blocked fixture: the Run ${runRef.runId} is not readable: ${JSON.stringify(read)}`);
  }
  return read.value;
}

/**
 * The hook's later Run of the same Task, reached through the public path: the
 * record Run's platform-written claim → the public requeue → a real claim → the
 * public not-entered cancel (it never enters a Kernel Turn, but the Task must
 * remain closable). Its Session, identity and role binding are the platform's.
 * `options.runRef` is only a caller-supplied REAL claimed Run.
 */
async function openLaterHookRun(
  world: K3ReviewCardWorld,
  record: UnknownCallReviewV1,
  options: { claim?: TaskClaim; runRef?: RunRef },
): Promise<{ runRef: RunRef; roleBinding: RoleBindingRefV1 }> {
  // The claim owner's Run id comes from the WORLD's one stream: a fresh
  // harness's default counter restarts and would name the later Run with its
  // own predecessor's id ("requeueRef cannot cover its own Run").
  const harness = await openRealRunHarness(world, { newId: runIdGeneratorOf(world) });
  try {
    let runRef: RunRef;
    if (options.runRef !== undefined) {
      runRef = options.runRef;
    } else {
      const claim = options.claim ?? (await readExecutionOf(world, record.runRef)).outbox.claim;
      const requeued = await harness.requeue(claim, `${record.task.taskId}: hook later Run`);
      laterRunSeq += 1;
      const session = await world.fixture.createS5Session(`b2-hook-later-session-${String(laterRunSeq)}`);
      const followUp = await harness.claimRun({
        sessionRef: session, planRef: PLAN_B2, taskId: record.task.taskId,
        requeueRef: requeued.ref, requestId: `b2-hook-later-claim-${String(laterRunSeq)}`,
      });
      // Plan Guard 1 (`plan-machine.ts` ~657) refuses to close a Task while ANY
      // of its Runs is unfinished. B2-16 (vi)/(vii) close the Task through the
      // public Plan change after this world exists, so the claimed, never-
      // entered later Run is ended the public way: the RUN-09
      // `platform_not_entered` cancel (`control-service.ts` submitControl). It
      // never entered a Kernel Turn; the hook uses only its identity and role
      // binding, and the claim/cancel facts are the platform's.
      const created = await readExecutionOf(world, followUp.runRef);
      const controls = createRunControlService({ records: world.records,
        authority: createMaterialRecordReaders(world.records).authority,
        reads: createRunStateReader({ records: world.records }),
        now: () => T, eventId: () => `b2-hook-later-control-${String(laterRunSeq)}` });
      const cancelled = await controls.submitControl(world.fixture.ctx, {
        input: { runRef: followUp.runRef, kind: 'cancel',
          reason: 'the hook later Run never enters; the Task must stay closable' },
        meta: { requestId: `b2-hook-later-cancel-${String(laterRunSeq)}`,
          expected: [{ ref: followUp.runRef, revision: created.run.revision }] },
      });
      if (cancelled.status !== 'committed') {
        throw new Error(`B2 blocked fixture: the later Run cancel failed: ${JSON.stringify(cancelled)}`);
      }
      runRef = followUp.runRef;
    }
    const roleBinding = (await readExecutionOf(world, runRef)).run.roleBinding;
    return { runRef, roleBinding };
  } finally {
    await harness.closeUnion();
  }
}

/**
 * The shared hook/tool world over an ALREADY blocked record (either the
 * `skip_as_done` record or an approved one). Only the workspace file CONTENT is
 * a double; the recognizer, owner, hook and tool are the production ones.
 */
export async function openB2HookWorld(
  world: K3ReviewCardWorld,
  record: UnknownCallReviewV1,
  options: {
    files?: Record<string, string>;
    /**
     * The record Run's platform-written claim. When omitted, the helper reads
     * it through the public execution read (`outbox.claim`), never constructs
     * one. `openB2BlockedWorld` has it from the seed and injects it.
     */
    claim?: TaskClaim;
    /** A REAL claimed Run of the same Task supplied by the caller (no default). */
    runRef?: RunRef;
    /**
     * Optional wrapper around the production Task-closure reader (the owner's
     * required seam) so a test can count reads. The inner reader is the real
     * `plan-readers.readTaskClosure` over the same records; omitted, the
     * production reader is used directly and behavior is unchanged.
     */
    readTaskClosure?: (inner: B2TaskClosureReader) => B2TaskClosureReader;
  } = {},
): Promise<Omit<B2BlockedWorld, 'blocked' | 'record' | 'close'>> {
  const files = options.files ?? {
    'app/package.json': JSON.stringify({ scripts: { 'db-migrate': 'prisma migrate deploy' } }),
  };
  const workspace = { projectId: world.fixture.base.scope.projectId,
    workspaceId: world.fixture.base.scope.workspaceId };
  // The hook is evaluated for a REAL later Run of the same Task, created by the
  // public requeue + claim path; the Run is never entered, so the hook's reads
  // stay its own. The role binding in the context comes from that same Run.
  const { runRef, roleBinding } = await openLaterHookRun(world, record, options);
  const recordReads: string[] = [];
  const listCalls: B2BlockedWorld['listCalls'] = [];
  const packageReads: string[] = [];
  const base = world.fixture.records;
  const faults = { crrCommit: 0 };
  const counts = { crrCommits: 0 };
  const crrEvents: Array<Record<string, unknown>> = [];
  const records = {
    readMany: (keys: readonly string[]) => base.readMany(keys),
    lookupCommit: (input: { identityKey: string; fingerprint: string }) => base.lookupCommit(input),
    eventAt: (cursor: CommitCursor) => base.eventAt(cursor),
    lookup: (input: Parameters<RecordLookupPort['lookup']>[0]) => base.lookup(input),
    async commit(input: Parameters<GoalRecordTransactionPort['commit']>[0]) {
      const crrWrite = input.records.some(row => row.schemaId === COMMAND_RERUN_REQUEST_SCHEMA_ID)
        || input.events.some(event => event.eventType === COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE);
      if (crrWrite && faults.crrCommit > 0) {
        faults.crrCommit -= 1;
        return { status: 'rejected' as const, code: 'unavailable' as const,
          reason: 'injected CRR commit failure' };
      }
      const committed = await base.commit(input);
      if (crrWrite && committed.status === 'committed') {
        counts.crrCommits += 1;
        for (const event of input.events) {
          if (event.eventType !== COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE) continue;
          try { crrEvents.push(JSON.parse(event.json) as Record<string, unknown>); } catch { /* ignore */ }
        }
      }
      return committed;
    },
  } as GoalRecordTransactionPort & RecordLookupPort;
  const reads = {
    async readReview(ctx: CoreCallContext, input: { ref: { runId: string } }) {
      recordReads.push(input.ref.runId);
      return world.reviews.readReview(ctx, input as never);
    },
  };
  const readWorkspace = {
    async readWorkspace(_ctx: CoreCallContext, input: ReadWorkspaceRequest):
    Promise<ReadResult<WorkspaceFile>> {
      packageReads.push(input.path);
      const content = files[input.path];
      if (content === undefined) {
        return { status: 'rejected', code: 'not_found', reason: `no such workspace file: ${input.path}` };
      }
      return { status: 'ready', value: {
        path: input.path, content, digest: sha256Of(content), sizeBytes: Buffer.byteLength(content, 'utf8'),
        digestBasis: 'raw_bytes', version: { kind: 'working_tree' }, readAt: T,
      } };
    },
  };
  const recognizer = createCommandRecognizer({ readWorkspace: readWorkspace as never });
  const taskReviewCalls: B2BlockedWorld['taskReviewCalls'] = [];
  const listTaskReviews = async (ctx: CoreCallContext, input: { goalRef: GoalRef; taskId: string }) => {
    const items: UnknownCallReviewV1[] = [];
    let cursor: string | undefined;
    for (;;) {
      taskReviewCalls.push({ taskId: input.taskId, cursor });
      const page = await world.reviews.listReviews(ctx, { workspace,
        filter: { goalRef: input.goalRef, taskId: input.taskId },
        page: { limit: 200, ...(cursor === undefined ? {} : { cursor }) } });
      if (page.status !== 'ready') return page;
      items.push(...page.value.items);
      if (page.value.nextCursor === null) break;
      cursor = page.value.nextCursor;
    }
    return { status: 'ready' as const, value: items };
  };
  const innerClosure: B2TaskClosureReader = async (_ctx, task) => readTaskClosure(base,
    { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId }, task.taskId);
  const requests = createCommandRerunRequestService({
    records,
    listTaskReviews,
    // Item 2: the ONE canonical Task-closure reader over the SAME records; never
    // an absent default. An optional test wrapper counts reads only.
    readTaskClosure: options.readTaskClosure === undefined
      ? innerClosure : options.readTaskClosure(innerClosure),
    recognize: recognizer,
    now: () => T,
    eventId: () => `b2-crr-event-${String(++eventSeq)}`,
  });
  // The counting wrapper around the PUBLIC CRR read port (B2-15/B2-16). The
  // one-closure pager is forwarded so the hook's production path is the real one.
  const countingRequests = {
    readRequest: requests.readRequest.bind(requests),
    async listRequests(ctx: CoreCallContext, input: Parameters<typeof requests.listRequests>[1]) {
      listCalls.push({ limit: input.page.limit, cursor: input.page.cursor });
      return requests.listRequests(ctx, input);
    },
    listTaskRequests: requests.listTaskRequests.bind(requests),
    requestRerun: requests.requestRerun.bind(requests),
    applyAnswer: requests.applyAnswer.bind(requests),
    consumeAllowance: requests.consumeAllowance.bind(requests),
  };
  const ctx: CoreCallContext = {
    projectId: workspace.projectId, workspaceId: workspace.workspaceId,
    principal: { kind: 'work_run', runRef, roleBinding },
    materialReader: { kind: 'run', requester: runRef },
    signal: new AbortController().signal,
  };
  const hook = createShellBlockedHook({
    ctx, runRef, taskId: record.task.taskId, workspace,
    binding: bindingOf(record),
    reviews: reads as never,
    requests: countingRequests,
    recognizer,
  });
  const tool = createCommandRerunTools({
    requests,
    context: ctx,
    task: record.task,
    requestIdForCall: call => `b2-tool-request:${call.callId}`,
  }).create({} as never)[0]!;
  let answerSeq = 0;
  // L19a: the answer is SAVED through the decision coordinator (the service
  // behind `decisions/answer`) FIRST, and only the saved answer's Session
  // message is applied to the CRR owner — never a hand-built answer ref.
  const answer: B2BlockedWorld['answer'] = async (selection, requestRef, revision) => {
    answerSeq += 1;
    const card = await crrCardOf(world);
    const resolved = await world.decisionActions.resolveDecision(world.fixture.ctx, {
      input: { source: card.source, selection: { kind: 'option', optionId: selection },
        text: '', annotations: [] },
      meta: { requestId: `b2-crr-answer-request-${String(answerSeq)}`, expected: card.source.pins },
    });
    if (resolved.status !== 'ready' || resolved.value.state !== 'applied'
      || resolved.value.action === null || resolved.value.action.status !== 'committed') {
      throw new Error(`B2 blocked fixture: the CRR answer did not apply: ${JSON.stringify(resolved)}`);
    }
    return resolved.value.action as unknown as Awaited<ReturnType<typeof requests.applyAnswer>>;
  };
  return {
    binding: bindingOf(record), ctx, runRef, workspace,
    requests, listCalls, recordReads, packageReads, taskReviewCalls, crrEvents, counts,
    hook, tool, answer,
    failNextCrrCommit: () => { faults.crrCommit += 1; },
    readRecord: async () => {
      const read = await world.reviews.readReview(ctx, { ref: record.ref });
      if (read.status !== 'ready') throw new Error(JSON.stringify(read));
      return read.value;
    },
    listRequests: async (readCtx: CoreCallContext) => {
      const page = await requests.listRequests(readCtx, { workspace,
        filter: { goalId: record.task.goalId, taskId: record.task.taskId }, page: { limit: 200 } });
      if (page.status !== 'ready') throw new Error(JSON.stringify(page));
      return page.value.items;
    },
  };
}

export async function openB2BlockedWorld(
  kind: 'memory' | 'sqlite',
  options: {
    taskId?: string;
    command?: string;
    cwd?: string | null;
    files?: Record<string, string>;
    /** Optional wrapper around the production Task-closure reader (counts reads only). */
    readTaskClosure?: (inner: B2TaskClosureReader) => B2TaskClosureReader;
  } = {},
): Promise<B2BlockedWorld> {
  const command = options.command ?? 'cd app && npm run db:migrate';
  const cwd = options.cwd ?? null;
  const files = options.files ?? {
    'app/package.json': JSON.stringify({ scripts: { 'db-migrate': 'prisma migrate deploy', 'migrate:prod': 'prisma migrate deploy' } }),
    'package.json': JSON.stringify({ scripts: { 'migrate:prod': 'prisma migrate deploy' } }),
  };
  const callId = 'b2-blocked-call-1';
  const blocked = await openK3BlockedCommandWorld(kind, {
    ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
    commands: { [callId]: { command, cwd } },
    files,
  });
  // The record is the REAL attested one whose item and command facts come from
  // the Kernel of the seeded Work Run; `②` writes the blocked commands.
  const record = await blocked.answer(blocked.record, 'skip_as_done', { text: '跳过：已经做过了' });
  if (record.blockedCommands.length === 0) {
    throw new Error('B2 blocked fixture: ② wrote no blockedCommands');
  }
  const built = await openB2HookWorld(blocked.world, record, {
    files,
    claim: blocked.claim,
    ...(options.readTaskClosure === undefined ? {} : { readTaskClosure: options.readTaskClosure }),
  });
  return { ...built, blocked, record, close: () => blocked.close() };
}

/** Drive the hook exactly as the Kernel's `before_tool` seam does. */
export async function runHook(hook: HookPort, call: ToolCall) {
  if (hook.point !== 'before_tool') throw new Error('the shell hook is not a before_tool hook');
  return await hook.execute({ point: 'before_tool', call } as never, { signal: new AbortController().signal });
}

/** Drive the `request_command_rerun` tool definition with the scripted arguments. */
export async function runTool(
  tool: B2BlockedWorld['tool'],
  input: Record<string, unknown>,
  callId = nextCall(),
) {
  const call: ToolCall = { schemaVersion: 1, callId, name: tool.name,
    arguments: input as unknown as ToolCall['arguments'] };
  return await tool.handler.execute(call, { signal: new AbortController().signal });
}
