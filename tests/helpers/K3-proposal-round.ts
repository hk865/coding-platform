/**
 * K3 group 4 (spec L15/L16/L20, UCR-03/UCR-05/UCR-06/UCR-08, K3-16/K3-45;
 * rework item 5): the ONE shared fixture that reaches the K3
 * `awaiting_proposal` / `awaiting_approval` states through public production
 * steps only, over both `memory` and `sqlite`.
 *
 * Every transition goes through a production owner:
 *   - the record is created by the ONE real blocked-record path
 *     (`blockedRecord(..., { dispose: false })`: a real claim/prepare/Runtime
 *     start with the §5.1 shell seam, the production RUN-20/RUN-22 read of that
 *     Kernel Turn, then the Runtime's own end). No item, draft or event is an
 *     input; the record has exactly the one process item the Kernel produced;
 *   - a review or proposal round is claimed by the real `claimService.claimTask`
 *     (`input.review = { reviewRef, expectedRevision, phase }`, UCR-03), then
 *     prepared by the production `createExecutionPreparation` and ENTERED by the
 *     production Runtime's `port.startRun` (its own real Kernel identity and
 *     Turn positions; the scripted model is held at its first reply);
 *   - conclusions are written through `reviews.recordConclusion` (UCR-04) and
 *     proposals through `propose_safer_method` (the real tool definition, the
 *     scripted model) or `reviews.recordProposal` (UCR-05), both exposed;
 *   - a Run ends only through that same Runtime's own terminal: a completed
 *     end is the scripted model's gated final text reply, an unfinished end is
 *     a fault it throws in `beforeReply` (the Runtime records `run_crashed`);
 *     the test then reads the result back through `readExecution`;
 *   - the round is settled by the real `reviews.settleReview` (UCR-06/07/08).
 *
 * NO `newUnknownCallReview`, NO `transitionUnknownCallReview` and NO
 * hand-encoded record commit appears here. The D6 `readReviewDisplays`
 * dependency is wired exactly as `src/composition/create-platform.ts` does it:
 * the settlement owner reads the round Run's real envelope, parses the prepared
 * manifest with `readManifestFromEnvelope`, and returns each alias's real
 * `item.display`.
 *
 * Typical use:
 *
 * ```ts
 * const world = await openK3ReviewCardWorld(kind);       // (a) reuse, not copied
 * const round = await claimK3ReviewRound(world, record); // (c) real TASK-03r
 * ...
 * const state = await reachK3AwaitingProposal(world);    // (h) needs_decision
 * const settled = await runK3ReviewRound(world, record, { conclusions }); // (c)-(e)
 * ```
 *
 * API index (every step takes the opened world first; each throws on a refused
 * owner step and asserts the committed/readable result named in its JSDoc):
 *   createK3PendingReview(world, { taskId?, label?, command?, callId?, cwd? }) -> pending_review record
 *   claimK3ReviewRound(world, record, { phase? }) -> { record, claim, run, context }
 *   recordK3Conclusion(world, round, input)
 *   endK3RunCompleted(world, claim) / endK3RunUnfinished(world, claim)
 *   settleK3Review(world, record, { cause?, expectedRevision? })
 *   readK3ReviewCard(world, record) / answerK3Disposition(world, record, optionId)
 *   proposeK3SaferMethodWithTool(world, round, input) / writeK3Proposal(world, round, input)
 *   writeK3Proposals(world, round, { mode: 'tool' | 'owner' })
 *   runK3ReviewRound(world, record, { conclusions, end?, settle? })
 *   reachK3AwaitingProposal(world, options)
 */
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type {
  PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask,
} from '../../src/contracts/plan.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type {
  CrashSuspicionV1, SaferMethodProposalV1,
  UnknownCallReviewItemV1, UnknownCallReviewRef, UnknownCallReviewV1,
} from '../../src/contracts/unknown-call-review.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import { createKernelStoreRegistry, type KernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import {
  createUnknownCallReviewTools, type UnknownCallReviewToolsHandle,
} from '../../src/core/agent-runtime/unknown-call-review-tools.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { readManifestFromEnvelope } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { readGoalPlanWindow } from '../../src/core/work-graph/tasks/plan-readers.js';
import type { ToolCall, ToolResult } from '../../vendor/coding-agent/dist/public-api.js';
import { GOAL_B, PLAN_B2, T, WORKSPACE_SCOPE } from './S5-decision-fixture.js';
import { createScriptedModel } from './B2-runtime-fixture.js';
import { createK3_35Runtime } from './K3-35-runtime.js';
import { prepareContinuation } from './K3-35-prepare.js';
import {
  openK3ReviewCardWorld, type K3ReviewCardWorld,
} from './K3-review-card-fixture.js';

/** Re-exported so a test needs ONE import for the world and its steps (no copy). */
export { openK3ReviewCardWorld };
export type { K3ReviewCardWorld };

// --------------------------------------------------------------------------- //
// Per-world bookkeeping and the work_run context                              //
// --------------------------------------------------------------------------- //

const nextSequences = new WeakMap<K3ReviewCardWorld, number>();
const usedTasks = new WeakMap<K3ReviewCardWorld, Set<string>>();

/** A deterministic, per-world unique request id (owner identities include it). */
export function k3RequestId(world: K3ReviewCardWorld, prefix: string): string {
  const next = (nextSequences.get(world) ?? 0) + 1;
  nextSequences.set(world, next);
  return `k3-proposal-fixture:${prefix}:${String(next)}`;
}

function usedTaskSet(world: K3ReviewCardWorld): Set<string> {
  let used = usedTasks.get(world);
  if (used === undefined) { used = new Set(); usedTasks.set(world, used); }
  return used;
}

/**
 * The next unused K3 review task of the S5 world, or the named one (which it
 * reserves). An explicit task is never refused here: the claim owner decides
 * whether that Task can open another Run.
 */
function k3TakeTaskId(world: K3ReviewCardWorld, taskId?: string): string {
  const used = usedTaskSet(world);
  const chosen = taskId ?? world.tasks.find(task => !used.has(task));
  if (chosen === undefined) throw new Error('K3 proposal fixture: every K3 review task is already used');
  used.add(chosen);
  return chosen;
}

/**
 * The trusted `work_run` context of one claimed round. Mirrors the production
 * tool config: the round Run is the principal and the role binding comes from
 * the entered Run, never from the model.
 */
function k3WorkRunContext(
  world: K3ReviewCardWorld, claim: TaskClaim, run: RunSnapshot,
): CoreCallContext {
  return {
    projectId: world.fixture.base.scope.projectId,
    workspaceId: world.fixture.base.scope.workspaceId,
    principal: { kind: 'work_run', runRef: claim.runRef, roleBinding: run.roleBinding },
    materialReader: { kind: 'run', requester: claim.runRef },
    signal: world.fixture.ctx.signal,
  };
}

// --------------------------------------------------------------------------- //
// K3-35 (二)(三): a Task whose id has an exact byte length                    //
// --------------------------------------------------------------------------- //

/** A Task id of exactly `bytes` ASCII bytes: K3-35's 512 / 600-byte tasks fill with `t`. */
export function k3TaskIdOfBytes(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 1) {
    throw new Error(`K3 proposal fixture: a Task id needs a positive byte length, got ${String(bytes)}`);
  }
  return 't'.repeat(bytes);
}

type K3AdoptedPlan = {
  /** The committed, active Plan revision (the next `claimRun` uses its ref). */
  plan: PlanRevisionSnapshot;
  planRef: PlanRevisionRef;
};

/**
 * K3-35 (二)(三): adopt ONE real new Plan revision on Goal B through the same
 * Plan owner the K3 review-card world uses (`proposePlan` + `applyPlanChange`),
 * appending one `active` work Task whose `taskId` is exactly `taskId`. Nothing
 * is hand-seeded: the returned ref is the committed `PlanRevisionAccepted`.
 *
 * The task id has no contract length limit (the codecs require it non-empty),
 * which is what makes T = 512 and T = 600 reachable through public steps.
 */
export async function adoptK3PlanTask(world: K3ReviewCardWorld, taskId: string): Promise<K3AdoptedPlan> {
  if (taskId.length === 0) throw new Error('K3 proposal fixture: an adopted Task needs a non-empty taskId');
  const f = world.fixture;
  const window = await readGoalPlanWindow(f.records, GOAL_B);
  if (window.status !== 'ready' || window.plan === null) {
    throw new Error(`K3 proposal fixture: the active Plan is not readable: ${JSON.stringify(window)}`);
  }
  const base = window.plan;
  const goal = await f.b2.base.plans.queryGoal(f.ctx, GOAL_B);
  if (goal.status !== 'ready') {
    throw new Error(`K3 proposal fixture: Goal B is not readable: ${JSON.stringify(goal)}`);
  }
  const bytes = Buffer.byteLength(taskId, 'utf8');
  const task: RuntimeTask = {
    taskId, title: `K3-35 ${String(bytes)}-byte Task`, requirementLevel: 'required', taskKind: 'work',
    disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution',
  };
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `${base.planId}-k3t${String(bytes)}`, planRevision: base.planRevision + 1,
    goalId: GOAL_B.goalId,
    stages: structuredClone(base.stages),
    tasks: [...base.tasks.map(candidate => ({ ...candidate })), task],
    assignments: [...(base.assignments ?? []).map(entry => ({ ...entry })),
      { taskId, role: 'builder', instruction: `Execute ${taskId}` }],
    obligations: base.obligations.map(obligation => ({ ...obligation,
      taskIds: [...obligation.taskIds, taskId],
      verificationRequirements: obligation.verificationRequirements.map(requirement => ({ ...requirement })) })),
    taskHierarchy: structuredClone(base.taskHierarchy),
    executionDag: structuredClone(base.executionDag),
    ...(base.schemaVersion === 2 ? {
      taskRelations: [...(base.taskRelations ?? [])].map(relation => ({ ...relation })),
      inputRequirements: [...(base.inputRequirements ?? [])].map(requirement => ({ ...requirement })),
    } : {}),
  };
  const proposed = await f.b2.base.plans.proposePlan(f.ctx, { input: {
    goalRef: GOAL_B, basedOn: base.ref, draft,
    reason: { text: `K3-35 Task of ${String(bytes)} bytes`, sources: [] },
  }, meta: { requestId: `k3-proposal-adopt-plan-${String(bytes)}`,
    expected: [{ ref: GOAL_B, revision: goal.value.goal.revision }] } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
    throw new Error(`K3 proposal fixture: the ${String(bytes)}-byte Plan proposal failed: ${JSON.stringify(proposed)}`);
  }
  const applied = await f.b2.base.plans.applyPlanChange(f.ctx, { input: {
    proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [],
  }, meta: { requestId: `k3-proposal-adopt-plan-apply-${String(bytes)}`,
    expected: [{ ref: GOAL_B, revision: goal.value.goal.revision }] } });
  if (applied.status !== 'committed') {
    throw new Error(`K3 proposal fixture: the ${String(bytes)}-byte Plan adoption failed: ${JSON.stringify(applied)}`);
  }
  return { plan: applied.value, planRef: applied.value.ref };
}

// --------------------------------------------------------------------------- //
// The ONE real pending record (blocked record; no builder)                    //
// --------------------------------------------------------------------------- //

type K3PendingReviewOptions = {
  /** The K3 review task id; defaults to the next unused one. */
  taskId?: string;
  /** The Goal the blocked Run is claimed under; defaults to the world's `GOAL_B`. */
  goalRef?: GoalRef;
  /** The accepted Plan the blocked Run claims; defaults to `PLAN_B2`. */
  planRef?: PlanRevisionRef;
  /** A per-record label for the real request ids and Session. */
  label?: string;
  /** The command the scripted model declares; the Kernel and the draft own it. */
  command?: string;
  /** The Kernel tool call id the scripted model declares. */
  callId?: string;
  /** The command's cwd; absent means the tool's own default, not a test value. */
  cwd?: string | null;
};

/** The record JSON size the owner measures (L7 M3), never a second encoding. */
export function k3SerializedBytes(record: UnknownCallReviewV1): number {
  return Buffer.byteLength(JSON.stringify(record), 'utf8');
}

/**
 * The ONE real `pending_review` record of this fixture: `blockedRecord(...,
 * { dispose: false })` claims a Task, prepares and starts ONE real Run whose
 * scripted model declares the one `shell` call, lets the Kernel record it, runs
 * the production RUN-20/RUN-22 Host path over that Kernel Turn, releases the
 * §5.1 stand-in so the Runtime ends the Run, and returns the undisposed record.
 *
 * No item, draft, event, position or cursor is an input; the single item, its
 * Kernel identity, summary and `observed: pending` are all what the platform
 * produced. The record is the start of the public `settleReview` /
 * `answerDisposition` / `claimK3ReviewRound` chain.
 */
export async function createK3PendingReview(
  world: K3ReviewCardWorld, options: K3PendingReviewOptions = {},
): Promise<UnknownCallReviewV1> {
  const taskId = k3TakeTaskId(world, options.taskId);
  const label = options.label ?? `k3-pending-${taskId}`;
  const { blockedRecord } = await import('./B2-crr-world.js');
  const record = await blockedRecord(world, taskId, label, [{
    callId: options.callId ?? `k3-pending-call-${label}`,
    command: options.command ?? 'npm run build',
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  }], { dispose: false,
    ...(options.goalRef === undefined ? {} : { goalRef: options.goalRef }),
    ...(options.planRef === undefined ? {} : { planRef: options.planRef }) });
  if (record.items.length !== 1) {
    throw new Error(`K3 proposal fixture: the real pending record has ${String(record.items.length)} items, not 1`);
  }
  return record;
}

// --------------------------------------------------------------------------- //
// Reading, rounds, conclusions, run endings, settlement                       //
// --------------------------------------------------------------------------- //

/** Read the committed record by ref (or a record's own ref). */
export async function readK3Review(
  world: K3ReviewCardWorld, refOrRecord: UnknownCallReviewRef | UnknownCallReviewV1,
): Promise<UnknownCallReviewV1> {
  const ref: UnknownCallReviewRef = 'ref' in refOrRecord ? refOrRecord.ref : refOrRecord;
  const read = await world.reviews.readReview(world.fixture.ctx, { ref });
  if (read.status !== 'ready') throw new Error(`K3 proposal fixture: the record is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

// --------------------------------------------------------------------------- //
// The review/proposal Run entry: the REAL production prepare + Runtime entry   //
// --------------------------------------------------------------------------- //

/**
 * The Host layer-1 grant a review-purpose Run needs (L13): the two names and
 * the whole-workspace read-only access. `k3_35Configuration` builds the rest of
 * the Host grant from the same Runtime; the review round's own fixed tool set
 * still comes from `execution-preparation`'s `reviewPurpose` branch.
 */
const REVIEW_RUNTIME_TOOLS = ['read', 'run_readonly_command'] as const;

type K3RoundStart = {
  /** Opens the scripted model's first reply so the real start can finish. */
  openGate: () => void;
  /**
   * Decides the model's end before the gate opens: a final text reply (the
   * Runtime books `run_completed`) or a thrown fault in `beforeReply` (the
   * Runtime books `run_crashed`). The test never builds the event itself.
   */
  end: { mode: 'completed' | 'crashed'; error: string };
  /** The real `runtime.port.startRun` result (resolves when the Run ends). */
  started: Promise<ReadResult<TaskExecutionRecord>>;
};

/** Runtime state of a round Run started by `claimK3ReviewRound`, by Run id. */
const roundStarts = new Map<string, K3RoundStart>();

const kernelStoresOf = new WeakMap<K3ReviewCardWorld, Promise<KernelStoreRegistry>>();

/** The Host's real Kernel store registry over the world's `s5-kernel.sqlite`. */
function worldKernelStores(world: K3ReviewCardWorld): Promise<KernelStoreRegistry> {
  let stores = kernelStoresOf.get(world);
  if (stores === undefined) {
    stores = createKernelStoreRegistry({ entries: [{
      adapterId: 's5-kernel', storeKey: 's5-kernel-store', workspace: WORKSPACE_SCOPE,
      databasePath: join(world.fixture.base.directory, 's5-kernel.sqlite'),
    }] });
    kernelStoresOf.set(world, stores);
  }
  return stores;
}

/** The real Workspace revision the Runtime's `resolveRoot` must agree with. */
async function readWorkspaceRevision(world: K3ReviewCardWorld): Promise<number> {
  const read = await world.records.readMany([JSON.stringify({
    aggregateType: 'Workspace', projectId: WORKSPACE_SCOPE.projectId, workspaceId: WORKSPACE_SCOPE.workspaceId,
  })]);
  if (read.status !== 'ready') {
    throw new Error(`K3 proposal fixture: the Workspace is not readable: ${JSON.stringify(read)}`);
  }
  const record = read.value.records[0];
  if (record === undefined) throw new Error('K3 proposal fixture: the Workspace snapshot is missing');
  return (JSON.parse(record.json) as { revision: number }).revision;
}

/** Poll the real Execution read until the Run's V2 entry phase is `entered`. */
async function waitForEntered(
  world: K3ReviewCardWorld, runRef: TaskClaim['runRef'],
): Promise<RunSnapshot> {
  const reads = createRunStateReader({ records: world.records });
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const read = await reads.readExecution(world.fixture.ctx, runRef);
    if (read.status === 'ready') {
      const authorization = read.value.run.executionAuthorization;
      if (authorization !== undefined && 'schemaVersion' in authorization
        && authorization.schemaVersion === 2 && authorization.phase === 'entered') {
        return read.value.run;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`K3 proposal fixture: the round Run ${runRef.runId} did not enter within 5 seconds`);
}

export type K3Round = {
  /** The record AFTER UCR-03 wrote `activeRound` and the claim/entry committed. */
  record: UnknownCallReviewV1;
  claim: TaskClaim;
  run: RunSnapshot;
  /** The trusted `work_run` context of this round. */
  context: CoreCallContext;
};

type K3RoundOptions = {
  phase?: 'review' | 'proposal';
  /** The accepted Plan the round's claim follows; defaults to `PLAN_B2`. */
  planRef?: PlanRevisionRef;
  /** The Goal the round's claim follows; defaults to the world's `GOAL_B`. */
  goalRef?: GoalRef;
};

/**
 * Claim a REAL review (`phase: 'review'`, UCR-03) or proposal
 * (`phase: 'proposal'`, UCR-03/UCR-10) round through the real claim owner and
 * enter it through the production `prepareExecution` + Runtime `startRun`. It
 * asserts the claim committed, the Run entered (with the real Kernel identity
 * and Turn positions), and `activeRound.runRef` is this Run.
 */
export async function claimK3ReviewRound(
  world: K3ReviewCardWorld, record: UnknownCallReviewV1, options: K3RoundOptions = {},
): Promise<K3Round> {
  const phase = options.phase ?? 'review';
  const f = world.fixture;
  const session = await f.createS5Session(`k3-proposal-round-${phase}-${String(k3RequestId(world, 'session'))}`);
  const claim = await f.claimRun({ requestId: k3RequestId(world, `${phase}-round-claim`),
    goalRef: options.goalRef ?? GOAL_B, planRef: options.planRef ?? PLAN_B2, taskId: record.task.taskId, sessionRef: session,
    review: { reviewRef: record.ref, expectedRevision: record.revision, phase } });
  const claimed = await readK3Review(world, record.ref);
  if (claimed.activeRound === null || claimed.activeRound.runRef.runId !== claim.runRef.runId) {
    throw new Error('K3 proposal fixture: the claim did not record this Run as the active round');
  }
  if (claimed.activeRound.phase !== phase) {
    throw new Error(`K3 proposal fixture: the active round is ${claimed.activeRound.phase}, not ${phase}`);
  }
  // The round is entered by the production Runtime: prepare builds the real
  // manifest/envelope/binding (including the review section from the Run's
  // purpose), and startRun drives authorize / begin / recordExecutionEntered
  // with the real Kernel Turn's identity and positions.
  const kernelStores = await worldKernelStores(world);
  let openGate!: () => void;
  const gate = new Promise<void>(resolve => { openGate = resolve; });
  // The scripted model holds its first reply until the test ends the Run, so
  // the Run is genuinely entered/in flight when this function returns. The end
  // is the model's own: its final text reply, or a fault thrown in
  // `beforeReply` that the production Runtime records as `run_crashed`.
  const end: { mode: 'completed' | 'crashed'; error: string } = {
    mode: 'completed', error: 'the K3 proposal fixture ended this round as unfinished',
  };
  const model = createScriptedModel([
    { kind: 'text', text: 'K3 proposal fixture: the round Run finished.' },
  ], async (_request, round) => {
    await gate;
    if (round === 0 && end.mode === 'crashed') throw new Error(end.error);
  });
  const runtime = createK3_35Runtime(world, {
    model, tools: [...REVIEW_RUNTIME_TOOLS], writeScope: [], now: () => f.now(),
    eventId: () => k3RequestId(world, 'runtime-event'), newId: () => f.newId(), kernelStores,
    workspaceRevision: () => readWorkspaceRevision(world),
  });
  // L13 Host layer 1: a review-purpose Run's start admits the fixed tool set
  // only on a Host that grants `read` + `run_readonly_command` with full
  // read-only access. This declared grant is the Host input, not a Run fact.
  const resolveConfiguration = runtime.deps.host.resolveConfiguration.bind(runtime.deps.host);
  runtime.deps.host.resolveConfiguration = async (ctx, input) => {
    const configured = await resolveConfiguration(ctx, input);
    if (configured.status !== 'ready') return configured;
    return { status: 'ready', value: { ...configured.value,
      readonlyCommandAccess: configured.value.readonlyCommandAccess ?? 'all_except_denied' } };
  };
  const prepared = await prepareContinuation({ world, records: world.records, task: claim.task,
    runRef: claim.runRef, tools: [...REVIEW_RUNTIME_TOOLS], writeScope: [], now: () => f.now() });
  const started = runtime.runtime.port.startRun(world.fixture.ctx, {
    prepared: prepared.prepared, consumerId: `k3-proposal-runtime-${claim.runRef.runId}`,
    requestId: k3RequestId(world, 'runtime-start'),
  });
  roundStarts.set(claim.runRef.runId, { openGate, started, end });
  let run: RunSnapshot;
  try {
    run = await Promise.race([
      waitForEntered(world, claim.runRef),
      started.then(result => {
        const value = result.status === 'ready' ? result.value.run : null;
        throw new Error(`K3 proposal fixture: the round Run settled before it entered: ${JSON.stringify({
          status: result.status, runStatus: value?.status ?? null,
          authorization: value?.executionAuthorization ?? null,
        })}`);
      }),
    ]);
  } catch (error) {
    openGate();
    await started.catch(() => undefined);
    roundStarts.delete(claim.runRef.runId);
    throw error;
  }
  const current = await readK3Review(world, record.ref);
  if (current.activeRound === null || current.activeRound.runRef.runId !== claim.runRef.runId) {
    throw new Error('K3 proposal fixture: the entered Run is no longer the active round');
  }
  return { record: current, claim, run, context: k3WorkRunContext(world, claim, run) };
}

type K3ConclusionInput = {
  item: number;
  verdict: 'done' | 'not_done' | 'partial' | 'undetermined';
  evidence: string;
  crashSuspicion: CrashSuspicionV1;
  requestId?: string;
};

/** UCR-04 through the public `reviews.recordConclusion` owner; returns the committed record. */
export async function recordK3Conclusion(
  world: K3ReviewCardWorld, round: K3Round, input: K3ConclusionInput,
): Promise<UnknownCallReviewV1> {
  const result = await world.reviews.recordConclusion(round.context, {
    input: { reviewRef: round.record.ref, item: input.item, verdict: input.verdict,
      evidence: input.evidence, crashSuspicion: input.crashSuspicion },
    meta: { requestId: input.requestId ?? k3RequestId(world, `conclusion-${String(input.item)}`), expected: [] },
  });
  if (result.status !== 'committed') {
    throw new Error(`K3 proposal fixture: recordConclusion failed: ${JSON.stringify(result)}`);
  }
  return result.value;
}

type K3RunEndOptions = { error?: string };

/**
 * End the round's Run through the Runtime's own terminal and then read the
 * result back through the public execution read. The test only opens the model
 * gate; the final text reply or the thrown `beforeReply` fault is the end.
 */
async function finishK3RoundRun(
  world: K3ReviewCardWorld, claim: TaskClaim, outcome: 'completed' | 'crashed', start: K3RoundStart,
): Promise<RunSnapshot> {
  start.end.mode = outcome;
  start.openGate();
  try {
    const result = await start.started;
    if (result.status !== 'ready') {
      throw new Error(`K3 proposal fixture: the round Run did not finish: ${JSON.stringify(result)}`);
    }
    const read = await createRunStateReader({ records: world.records })
      .readExecution(world.fixture.ctx, claim.runRef);
    if (read.status !== 'ready') {
      throw new Error(`K3 proposal fixture: the ended Run is not readable: ${JSON.stringify(read)}`);
    }
    if (read.value.run.status !== 'ended' || read.value.run.outcome !== outcome) {
      throw new Error(`K3 proposal fixture: the Run did not end ${outcome}: ${JSON.stringify(read.value.run)}`);
    }
    return read.value.run;
  } finally {
    roundStarts.delete(claim.runRef.runId);
  }
}

/**
 * End the round's Run COMPLETED by releasing the scripted model's gated final
 * text reply and awaiting the production `startRun`; the returned snapshot is
 * the public `readExecution` result (the Runtime's own terminal, not a test
 * event).
 */
export async function endK3RunCompleted(
  world: K3ReviewCardWorld, claim: TaskClaim, _options: K3RunEndOptions = {},
): Promise<RunSnapshot> {
  const start = roundStarts.get(claim.runRef.runId);
  if (start === undefined) {
    throw new Error('K3 proposal fixture: only a Run started by claimK3ReviewRound can be ended here');
  }
  return await finishK3RoundRun(world, claim, 'completed', start);
}

/**
 * End the round's Run with a KNOWN, not-completed result by making the scripted
 * model throw in its next `beforeReply`: the production Runtime turns the fault
 * into `run_crashed` and books the real Kernel end itself. The result is read
 * back through `readExecution`; the fixture never records an event.
 */
export async function endK3RunUnfinished(
  world: K3ReviewCardWorld, claim: TaskClaim, options: K3RunEndOptions = {},
): Promise<RunSnapshot> {
  const start = roundStarts.get(claim.runRef.runId);
  if (start === undefined) {
    throw new Error('K3 proposal fixture: only a Run started by claimK3ReviewRound can be ended here');
  }
  if (options.error !== undefined) start.end.error = options.error;
  return await finishK3RoundRun(world, claim, 'crashed', start);
}

type K3SettleOptions = {
  cause?: 'round_ended' | 'review_unavailable';
  requestId?: string;
  /** Overrides the record pin (a test may deliberately send a stale one). */
  expectedRevision?: number;
};

/**
 * The production settlement owner over the SAME record store. The world's own
 * `reviews` has no D6 display reader; this owner reads every writing review
 * round's real prepared manifest exactly as `src/composition/create-platform.ts`
 * does (`readExecution(roundRunRef)` then `readManifestFromEnvelope({ bodies })`)
 * and returns the real per-alias `item.display`.
 */
function settlementOwner(world: K3ReviewCardWorld): ReturnType<typeof createUnknownCallReviewService> {
  let sequence = 0;
  const executionReader = createRunStateReader({ records: world.records });
  return createUnknownCallReviewService({
    records: world.records,
    reads: executionReader,
    readReviewDisplays: async (ctx, input) => {
      const read = await executionReader.readExecution(ctx, input.roundRunRef);
      if (read.status === 'not_found') return { status: 'not_found' };
      if (read.status === 'not_ready') {
        return { status: 'not_ready', observed: read.observed, required: read.required };
      }
      if (read.status === 'rejected') return read;
      const envelope = read.value.run.envelope;
      if (envelope === null) return { status: 'not_found' };
      const manifest = await readManifestFromEnvelope({ bodies: world.fixture.bodies },
        envelope as unknown as Record<string, unknown>, input.roundRunRef);
      if (!manifest.ok) return manifest.rejection;
      const items = manifest.value.manifest.unknownCallReview?.items ?? [];
      return { status: 'ready', value: new Map(items.map(item => [item.alias, item.display])) };
    },
    now: () => T,
    eventId: () => `k3-proposal-settle-event-${String(++sequence)}`,
  });
}

/**
 * Public `reviews.settleReview` (UCR-06/07/08); asserts the commit and returns
 * the committed record. `meta.expected` pins the record revision (the owner
 * reads the round Run revision itself and guards it).
 *
 * The world's own owner is used unless the record carries review-round
 * conclusions (D6 must read their prepared manifest); only then the same owner
 * is wired with the real manifest display reader above.
 */
export async function settleK3Review(
  world: K3ReviewCardWorld, record: UnknownCallReviewV1, options: K3SettleOptions = {},
): Promise<UnknownCallReviewV1> {
  const needsDisplayReader = record.items.some(item =>
    item.kind === 'process' && item.observed.by === 'review_round');
  const owner = needsDisplayReader ? settlementOwner(world) : world.reviews;
  const result = await owner.settleReview(world.fixture.ctx, {
    input: { reviewRef: record.ref, cause: options.cause ?? 'round_ended' },
    meta: { requestId: options.requestId ?? k3RequestId(world, 'settle'),
      expected: [{ ref: record.ref, revision: options.expectedRevision ?? record.revision }] },
  });
  if (result.status !== 'committed') {
    throw new Error(`K3 proposal fixture: settleReview failed: ${JSON.stringify(result)}`);
  }
  return result.value;
}

// --------------------------------------------------------------------------- //
// Disposition cards (the real `resolveDecision`)                              //
// --------------------------------------------------------------------------- //

type K3ReviewCard = {
  card: DecisionCardV1;
  key: string;
  availability: 'available' | 'not_available';
};

/**
 * The live card for this record revision, from the real card source. It follows
 * the source's own cursors, so a test that opened the world with a small
 * `pageLimit` (K3-20) still finds its card without depending on the first page.
 */
export async function readK3ReviewCard(
  world: K3ReviewCardWorld, record: UnknownCallReviewV1,
): Promise<K3ReviewCard> {
  const key = decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision });
  let cursor: string | undefined;
  for (let pages = 0; pages < 1_000; pages += 1) {
    const page = await world.cardSource.readPage(world.fixture.ctx, {
      workspace: WORKSPACE_SCOPE, goalRef: GOAL_B,
      page: { limit: 100, ...(cursor === undefined ? {} : { cursor }) },
    });
    if (page.status !== 'ready') {
      throw new Error(`K3 proposal fixture: the card page failed: ${JSON.stringify(page)}`);
    }
    const card = page.value.items.find(item => item.source.key === key);
    if (card !== undefined) return { card, key, availability: page.value.availability };
    if (page.value.nextCursor === null) {
      throw new Error(`K3 proposal fixture: the card ${key} is not on the source pages `
        + `(availability ${page.value.availability})`);
    }
    cursor = page.value.nextCursor;
  }
  throw new Error(`K3 proposal fixture: the card ${key} was not found in 1,000 pages`);
}

type K3AnswerOptions = {
  text?: string;
  requestId?: string;
};

/**
 * Answer one card option through the real `resolveDecision` (the K3-16
 * approval-application pattern) and return the committed record. It asserts
 * `state: 'applied'` and a committed action.
 */
export async function answerK3Disposition(
  world: K3ReviewCardWorld, record: UnknownCallReviewV1, optionId: string,
  options: K3AnswerOptions = {},
): Promise<UnknownCallReviewV1> {
  const { card } = await readK3ReviewCard(world, record);
  const result = await world.decisionActions.resolveDecision(world.fixture.ctx, {
    input: { source: card.source, selection: { kind: 'option', optionId },
      text: options.text ?? '', annotations: [] },
    meta: { requestId: options.requestId ?? k3RequestId(world, 'disposition-answer'),
      expected: card.source.pins },
  });
  if (result.status !== 'ready' || result.value.state !== 'applied') {
    throw new Error(`K3 proposal fixture: the disposition answer did not apply: ${JSON.stringify(result)}`);
  }
  const action = result.value.action as WriteResult<UnknownCallReviewV1>;
  if (action === null || action.status !== 'committed') {
    throw new Error(`K3 proposal fixture: the disposition action did not commit: ${JSON.stringify(action)}`);
  }
  return action.value;
}

// --------------------------------------------------------------------------- //
// Proposal writes: the real tool (scripted model) and the owner              //
// --------------------------------------------------------------------------- //

type K3ProposalInput = {
  item: number;
  command: string;
  cwd?: string | null;
  rationale: string;
  /** The Kernel tool call id (the scripted model's call identity). */
  callId?: string;
};

/** The real `propose_safer_method` tool definition, executed with the scripted arguments. */
async function proposeK3SaferMethodWithTool(
  world: K3ReviewCardWorld, round: K3Round, input: K3ProposalInput,
): Promise<ToolResult> {
  const handle: UnknownCallReviewToolsHandle = createUnknownCallReviewTools({
    reviews: world.reviews,
    context: round.context,
    reviewRef: round.record.ref,
    requestIdForCall: call => `k3-proposal-tool:${round.claim.runRef.runId}:${String(call.callId)}`,
    phase: 'proposal',
  });
  const definition = handle.create({} as never)[0];
  if (definition === undefined) throw new Error('K3 proposal fixture: propose_safer_method is not registered');
  const callId = input.callId ?? `k3-proposal-call-${String(input.item)}`;
  // L20 §2 `cwd?: string`: an absent directory is sent as absent (the owner
  // stores its internal null). A literal null is item 4's `invalid_arguments`,
  // so a null cwd from the item summary is omitted, not forwarded.
  const call: ToolCall = { schemaVersion: 1, callId, name: definition.name,
    arguments: { item: input.item, command: input.command,
      ...(typeof input.cwd === 'string' ? { cwd: input.cwd } : {}), rationale: input.rationale } };
  return await definition.handler.execute(call, { signal: new AbortController().signal });
}

/** UCR-05 through the public `reviews.recordProposal` owner; returns the committed record. */
export async function writeK3Proposal(
  world: K3ReviewCardWorld, round: K3Round, input: K3ProposalInput,
): Promise<UnknownCallReviewV1> {
  const result = await world.reviews.recordProposal(round.context, {
    input: { reviewRef: round.record.ref, item: input.item, command: input.command,
      cwd: input.cwd ?? null, rationale: input.rationale },
    meta: { requestId: k3RequestId(world, `proposal-${String(input.item)}`), expected: [] },
  });
  if (result.status !== 'committed') {
    throw new Error(`K3 proposal fixture: recordProposal failed: ${JSON.stringify(result)}`);
  }
  return result.value;
}

type K3ProposalWriteOptions = {
  mode?: 'tool' | 'owner';
  commandFor?: (item: UnknownCallReviewItemV1) => string;
  rationaleFor?: (item: UnknownCallReviewItemV1) => string;
  cwdFor?: (item: UnknownCallReviewItemV1) => string | null | undefined;
};

type K3ProposalsWritten = {
  record: UnknownCallReviewV1;
  proposals: SaferMethodProposalV1[];
  toolResults: ToolResult[];
};

/**
 * Write one proposal for EVERY `proposalTargets` item (alias order) using the
 * scripted `propose_safer_method` tool (default) or the public owner. It
 * asserts every write succeeded and every target now has a proposal.
 */
export async function writeK3Proposals(
  world: K3ReviewCardWorld, round: K3Round, options: K3ProposalWriteOptions = {},
): Promise<K3ProposalsWritten> {
  const mode = options.mode ?? 'tool';
  const targets = round.record.proposalTargets ?? [];
  if (targets.length === 0) throw new Error('K3 proposal fixture: the record has no proposalTargets');
  const toolResults: ToolResult[] = [];
  for (const callId of targets) {
    const item = round.record.items.find(candidate => candidate.callId === callId);
    if (item === undefined) throw new Error(`K3 proposal fixture: no item for proposal target ${callId}`);
    const command = options.commandFor?.(item) ?? `k3-safer -- ${item.summary.command ?? `echo ${String(item.alias)}`}`;
    const rationale = options.rationaleFor?.(item) ?? 'K3 proposal-round fixture: a safer replacement command';
    const cwd = options.cwdFor === undefined ? item.summary.cwd : options.cwdFor(item);
    const input = { item: item.alias, command, rationale,
      ...(cwd === undefined ? {} : { cwd }) };
    if (mode === 'tool') {
      const result = await proposeK3SaferMethodWithTool(world, round, {
        ...input, callId: `k3-proposal-${round.claim.runRef.runId}-${String(item.alias)}`,
      });
      toolResults.push(result);
      if (result.status !== 'success') {
        throw new Error(`K3 proposal fixture: propose_safer_method failed for ${JSON.stringify(input)}: ${JSON.stringify(result)}`);
      }
    } else {
      await writeK3Proposal(world, round, input);
    }
  }
  const record = await readK3Review(world, round.record.ref);
  const missing = targets.filter(callId => !record.proposals.some(proposal => proposal.callId === callId));
  if (missing.length > 0) {
    throw new Error(`K3 proposal fixture: no proposal was stored for ${missing.join(', ')}`);
  }
  return { record, proposals: record.proposals, toolResults };
}

// --------------------------------------------------------------------------- //
// Review-round convenience (conclusions + end + settle)                      //
// --------------------------------------------------------------------------- //

type K3ReviewRoundOptions = {
  conclusions: readonly {
    item: number;
    verdict: 'done' | 'not_done' | 'partial' | 'undetermined';
    evidence: string;
    crashSuspicion: CrashSuspicionV1;
  }[];
  end?: 'completed' | 'unfinished';
  settle?: boolean;
  /** The accepted Plan the round's claim follows; defaults to `PLAN_B2`. */
  planRef?: PlanRevisionRef;
  /** The Goal the round's claim follows; defaults to the world's `GOAL_B`. */
  goalRef?: GoalRef;
};

type K3ReviewRoundState = {
  record: UnknownCallReviewV1;
  claim: TaskClaim;
  run: RunSnapshot;
  settled: UnknownCallReviewV1 | null;
};

/**
 * The (c) chain: claim the real review round, record the scripted conclusions,
 * end the Run (completed by default, or the real `run_crashed` unfinished
 * result), then `settleReview{round_ended}`. `settled` is null when
 * `settle: false`.
 */
export async function runK3ReviewRound(
  world: K3ReviewCardWorld, record: UnknownCallReviewV1, options: K3ReviewRoundOptions,
): Promise<K3ReviewRoundState> {
  const round = await claimK3ReviewRound(world, record, {
    phase: 'review',
    ...(options.planRef === undefined ? {} : { planRef: options.planRef }),
    ...(options.goalRef === undefined ? {} : { goalRef: options.goalRef }),
  });
  for (const conclusion of options.conclusions) {
    await recordK3Conclusion(world, round, conclusion);
  }
  const current = await readK3Review(world, round.record.ref);
  const run = (options.end ?? 'completed') === 'completed'
    ? await endK3RunCompleted(world, round.claim)
    : await endK3RunUnfinished(world, round.claim);
  const settled = options.settle === false ? null : await settleK3Review(world, current);
  return { record: current, claim: round.claim, run, settled };
}

// --------------------------------------------------------------------------- //
// (h) One call to awaiting_proposal / awaiting_approval                      //
// --------------------------------------------------------------------------- //

type K3ReachOptions = {
  /** The K3 review task id; defaults to the next unused one. */
  taskId?: string;
  /** The Goal the record/round claims follow; defaults to the world's `GOAL_B`. */
  goalRef?: GoalRef;
  /** A per-record label for the real request ids and Session. */
  label?: string;
  /** The one process command the scripted model declares. */
  command?: string;
  /** The Kernel tool call id the scripted model declares. */
  callId?: string;
  /** The command's cwd; absent means the tool's own default. */
  cwd?: string | null;
  /** The accepted Plan the record/round claims follow; defaults to `PLAN_B2`. */
  planRef?: PlanRevisionRef;
  writeMode?: 'tool' | 'owner';
  dispositionText?: string;
  commandFor?: (item: UnknownCallReviewItemV1) => string;
  rationaleFor?: (item: UnknownCallReviewItemV1) => string;
};

type K3AwaitingProposalState = {
  /** The real `needs_decision` card record the safer-method answer was applied to. */
  dispositionRecord: UnknownCallReviewV1;
  /** The `awaiting_proposal` record with this round's `activeRound`. */
  proposalRecord: UnknownCallReviewV1;
  claim: TaskClaim;
  run: RunSnapshot;
  proposals: SaferMethodProposalV1[];
  toolResults: ToolResult[];
};

/**
 * (h) Reach `awaiting_proposal` from a real `needs_decision` card: create the
 * one real pending record, settle it `review_unavailable` through the public
 * owner, answer `safer_method` through `resolveDecision`, claim + enter the real
 * proposal round, and write the one proposal for the one proposal target
 * (scripted tool by default). Returns every stage.
 */
export async function reachK3AwaitingProposal(
  world: K3ReviewCardWorld, options: K3ReachOptions = {},
): Promise<K3AwaitingProposalState> {
  const created = await createK3PendingReview(world, {
    ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
    ...(options.goalRef === undefined ? {} : { goalRef: options.goalRef }),
    ...(options.planRef === undefined ? {} : { planRef: options.planRef }),
    ...(options.label === undefined ? {} : { label: options.label }),
    ...(options.command === undefined ? {} : { command: options.command }),
    ...(options.callId === undefined ? {} : { callId: options.callId }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  // The real pending record, settled through the real UCR owner (L16 3).
  const dispositionRecord = await settleK3Review(world, created, { cause: 'review_unavailable',
    requestId: k3RequestId(world, 'review-unavailable') });
  if (dispositionRecord.status !== 'needs_decision') {
    throw new Error(`K3 proposal fixture: expected needs_decision, got ${dispositionRecord.status}`);
  }
  const proposed = await answerK3Disposition(world, dispositionRecord, 'safer_method', {
    text: options.dispositionText ?? 'K3 proposal fixture: use a safer method',
  });
  if (proposed.status !== 'awaiting_proposal') {
    throw new Error(`K3 proposal fixture: the safer-method answer became ${proposed.status}`);
  }
  const round = await claimK3ReviewRound(world, proposed, {
    phase: 'proposal',
    ...(options.planRef === undefined ? {} : { planRef: options.planRef }),
    ...(options.goalRef === undefined ? {} : { goalRef: options.goalRef }),
  });
  const written = await writeK3Proposals(world, round, {
    mode: options.writeMode ?? 'tool',
    ...(options.commandFor === undefined ? {} : { commandFor: options.commandFor }),
    ...(options.rationaleFor === undefined ? {} : { rationaleFor: options.rationaleFor }),
  });
  return { dispositionRecord, proposalRecord: written.record, claim: round.claim, run: round.run,
    proposals: written.proposals, toolResults: written.toolResults };
}
