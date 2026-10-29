/**
 * A.2 step 6: the seeded invariant fuzz (tests/state/invariants-fuzz.test.ts; docs/refactor/STATE-MACHINES-SPEC.md
 * §15.2 "第 6 步" row `tests/state/invariants-fuzz.test.ts`, §11.11 "调用点").
 *
 * - `HostFuzz`, the Host world: one real Host over HTTP on one SQLite ledger and Kernel store
 *   (tests/scenarios/harness.ts host mode), the AG2b Goal with two required work Tasks and the gate. A seeded PRNG
 *   chooses every operation from those the last checked world allows; the model replies are placeholders the fuzz
 *   fills in while each model call is made (`duringReply`), from the same PRNG, so a seed replays the same sequence
 *   (the world's Run, round and message lists are put in commit order first: their ids are random).
 * - `AgentFuzz`, the agent-grant world: the R3e evidence fixture (it holds the B2 execution fixture) on SQLite with
 *   Agent Runs entered under `AGENT_GRANT` (`requeue_task`, `reverify_round` and the plan-write tools; GAP-46: no
 *   Runtime starts with them), the production requeue, plan, control and evidence owners over its records, and
 *   two-writer races in one read window (`commitBarrier`).
 *
 * In both, after every operation that changes records the §11 invariants run on the whole store
 * (`InvariantGate`: `checkAllInvariants` with the step's `FuzzStep` and the previous world, `legacy` findings
 * included); a refusal or a replay outside a Turn must leave the ledger unwritten (`quietRefusal`, `ledgerWrites`);
 * the operations assert what the spec names for them beyond the invariants (the human-stop fence `fenceProblem`,
 * guard 9 `guard9Fenced`, the forged continuation, GOAL-05, ND-8 `mechanicalRetry`, the races); a violation throws
 * with the seed and the operation list. `OpCounts` and `tallyWorld` record what actually ran.
 *
 * Scripted model replies only; no real model is called.
 */
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SessionRef } from '../../../src/app/core-http-types.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult, WorkflowStepReceipt } from '../../../src/business/workflow/contracts.js';
import type { ActorRef } from '../../../src/contracts/command-event.js';
import type { ControlIntentKindV1, ControlIntentSnapshotV1 } from '../../../src/contracts/control-intent.js';
import type { CoreCallContext } from '../../../src/contracts/core/call-context.js';
import type { VersionPin } from '../../../src/contracts/core/identity.js';
import type { TaskClaim } from '../../../src/contracts/core/task-claim.js';
import type { RunRef, RunSnapshot, RuntimeEventV1, TaskTriple } from '../../../src/contracts/dispatch.js';
import { canonicalJson } from '../../../src/contracts/fingerprint.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot, RuntimeTask } from '../../../src/contracts/plan.js';
import {
  GOAL_FAN_OUT_ACTOR, WORKFLOW_AUTOMATION_ACTOR, reworkActorClassOf,
  type ResumeOnStartupMode, type TaskAutomationPolicyV1, type TaskRequeueTriggerV1,
} from '../../../src/contracts/task-requeue.js';
import type { CheckProcessObservation, RoundSnapshot } from '../../../src/contracts/verification.js';
import { createSqliteRecordBackend } from '../../../src/core/record-store/sqlite-record-store.js';
import { createProjectBootstrapServices } from '../../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { createRoleConfigurationService } from '../../../src/core/work-graph/configuration/role-memory-service.js';
import type { EvidencePort, ReverifyRoundInput } from '../../../src/core/work-graph/model/evidence-contracts.js';
import { createEvidenceService } from '../../../src/core/work-graph/evidence/evidence-service.js';
import type { MaterialPort } from '../../../src/core/work-graph/model/material-contracts.js';
import { createMaterialService } from '../../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../../src/core/work-graph/materials/record-readers.js';
import { CONTROL_RECORD_SCHEMAS } from '../../../src/core/work-graph/persistence/control-record-codecs.js';
import { plainSessionRefToAggregate } from '../../../src/core/work-graph/sessions/session-record-codecs.js';
import { isPausedInterrupted } from '../../../src/core/work-graph/state/run-machine.js';
import { deriveReworkClass, reworkFenceOf, type ReworkFence } from '../../../src/core/work-graph/state/task-failure.js';
import { isFinalizedNonPass, roundChainHead } from '../../../src/core/work-graph/state/verification-machine.js';
import type { RequeueTaskInput } from '../../../src/core/work-graph/model/claim-contracts.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../../src/core/work-graph/tasks/completion-record-codecs.js';
import type { GraphWrite } from '../../../src/core/work-graph/model/task-contracts.js';
import type { ControlObservationPort, RunControlPort } from '../../../src/core/work-graph/tasks/control-contracts.js';
import { createRunControlService } from '../../../src/core/work-graph/tasks/control-service.js';
import type {
  AuthorizeConfiguration, ExecutionEntryPort, KernelExecutionBinding,
} from '../../../src/core/work-graph/model/execution-entry-contracts.js';
import { createExecutionEntryService } from '../../../src/core/work-graph/tasks/execution-entry-service.js';
import type { PlanChangeReason, PlanProposal, PlanTaskPort } from '../../../src/core/work-graph/model/plan-contracts.js';
import { createPlanService } from '../../../src/core/work-graph/tasks/plan-service.js';
import { createInitializationBindingReader } from '../../../src/core/work-graph/tasks/goal-confirm-service.js';
import type { PlanDelegatedWriteDependencies } from '../../../src/core/work-graph/tasks/plan-write-admission.js';
import { createTaskRequeueService } from '../../../src/core/work-graph/tasks/requeue-service.js';
import { createRunStateReader } from '../../../src/core/work-graph/tasks/run-state-service.js';
import { VerificationWorkspaceReader } from '../../../src/core/workspace/verification-workspace-reader.js';
import type { ModelRequest } from '../../../vendor/coding-agent/dist/public-api.js';
import { moveKernelAside } from '../../helpers/A2-restart-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_GATE_TASK_ID, AG2B_GOAL_REF, AG2B_QUERY_BUDGET, AG2B_QUERY_ROLE, AG2B_QUERY_ROLE_BINDING, AG2B_RESULT_FILE,
  AG2B_RESULT_TEXT, AG2B_RUNTIME_BUDGET, AG2B_SCOPE, AG2B_WORK_TASK_ID, createAG2bSession, graphWrite, plain,
} from '../../helpers/AG2b-collaboration-fixture.js';
import { B2_AT, B2_HOST, type B2ExecutionFixture } from '../../helpers/B2-execution-fixture.js';
import type { ScriptedReply } from '../../helpers/B2-runtime-fixture.js';
import { createR3eEvidenceFixture, R3E_HOST, type R3eEvidenceFixture } from '../../helpers/R3e-evidence-fixture.js';
import {
  checkAllInvariants, invariantStoreOf, legacyFindings, platformRecordSchemas, readInvariantWorld, type FuzzStep, type FuzzStepKind,
  type InvariantWorld,
} from '../../state/invariants.js';
import { hostCtx, openHostScenario, stepOfReceipt, workRunCtx, type HostScenario, type Platform } from '../harness.js';
import { authorizeWithoutBegin, openWorkRoot, ownerStep } from './common.js';

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

/** A seeded PRNG (mulberry32): the only source of randomness of a fuzz run. */
export type Rng = {
  next(): number;
  /** An integer in [low, high]. */
  int(low: number, high: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** One value by weight; entries of weight 0 are never chosen. */
  weighted<T>(entries: ReadonlyArray<readonly [number, T]>): T;
};

export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (low, high) => low + Math.floor(next() * (high - low + 1)),
    chance: (probability) => next() < probability,
    pick: (items) => {
      if (items.length === 0) throw new Error('fuzz: pick from an empty list');
      return items[Math.floor(next() * items.length)]!;
    },
    weighted: (entries) => {
      const live = entries.filter(([weight]) => weight > 0);
      const total = live.reduce((sum, [weight]) => sum + weight, 0);
      if (total <= 0) throw new Error('fuzz: no entry has a weight');
      let point = next() * total;
      for (const [weight, value] of live) {
        point -= weight;
        if (point < 0) return value;
      }
      return live.at(-1)![1];
    },
  };
}

// ---------------------------------------------------------------------------
// Counting and the invariant check
// ---------------------------------------------------------------------------

/** Operation counts by key (`<family>:<detail>:<outcome>`): what actually ran, never what was planned. */
export class OpCounts {
  readonly byKey = new Map<string, number>();
  add(key: string, by = 1): void { this.byKey.set(key, (this.byKey.get(key) ?? 0) + by); }
  merge(other: OpCounts): void { for (const [key, count] of other.byKey) this.add(key, count); }
  sorted(): Record<string, number> { return Object.fromEntries([...this.byKey].sort(([a], [b]) => a.localeCompare(b))); }
}

/** One owner or route answer reduced to a counting outcome: `committed`, `refused:<code>`, `rejected:<code>`, a `:replayed` suffix. */
export function outcomeOf(answer: unknown): string {
  const body = (answer ?? {}) as { status?: unknown; code?: unknown; replayed?: unknown; value?: unknown };
  const value = (body.value ?? {}) as { kind?: unknown; refusal?: { code?: unknown } };
  if (body.status === 'committed') {
    const replay = body.replayed === true ? ':replayed' : '';
    if (value.kind === 'refused') return `refused:${String(value.refusal?.code)}${replay}`;
    return `committed${replay}`;
  }
  if (body.status === 'rejected') return `rejected:${String(body.code)}`;
  return String(body.status);
}

/** The reason of a rejection, shortened for the operation log; empty for anything else. */
export function reasonOf(answer: unknown): string {
  const body = (answer ?? {}) as { status?: unknown; reason?: unknown };
  return body.status === 'rejected' && typeof body.reason === 'string' ? ` (${body.reason.slice(0, 110)})` : '';
}

/**
 * The §11.11 check over one SQLite store: reads the world in one window, runs I-1..I-22 against it with
 * the previous world and the step, counts `legacy` findings as failures (every fuzz store starts empty)
 * and throws with the seed and the operation list (`replay()`) on any finding. A check without a step
 * when the ledger took no write since the last check is skipped: the world it would read is the one
 * already checked (the invariant world is read from the ledger alone, and every commit writes an
 * idempotency row), so every clause would answer as before.
 */
export class InvariantGate {
  world: InvariantWorld | undefined = undefined;
  checks = 0;
  /** Checks skipped because nothing was written since the last one. */
  skipped = 0;
  /** Milliseconds spent reading and checking, and reading alone. */
  spent = 0;
  reading = 0;
  /** `ledgerWrites` taken just before the last checked world was read. */
  private mark = -1;
  constructor(private readonly directory: string, private readonly projectId: string, private readonly replay: () => string) {}

  async check(label: string, step?: FuzzStep): Promise<InvariantWorld> {
    const started = performance.now();
    const ledgerPath = join(this.directory, 'ledger.sqlite');
    const mark = ledgerWrites(ledgerPath);
    if (step === undefined && this.world !== undefined && mark === this.mark) {
      this.skipped += 1;
      return this.world;
    }
    const world = await readInvariantWorld(invariantStoreOf(this.directory), this.projectId);
    this.reading += Math.round(performance.now() - started);
    const findings = [...checkAllInvariants(world, this.world, step), ...legacyFindings(world, this.world, step)];
    this.checks += 1;
    this.spent += Math.round(performance.now() - started);
    if (findings.length > 0) {
      const lines = findings.map((finding) => `  ${finding.invariant}${finding.legacy === true ? ' (legacy)' : ''} ${finding.ref}: ${finding.message}`);
      throw new Error(`invariant violation after ${label}${step === undefined ? '' : ` (step ${step.kind}, actor ${step.actor.kind}:${step.actor.id})`}:\n`
        + `${lines.join('\n')}\n${this.replay()}`);
    }
    orderWorld(world, ledgerPath);
    this.mark = mark;
    this.world = world;
    for (const run of world.runs) this.seen.add(`run:${run.status}:${String(run.outcome)}`);
    for (const state of world.taskStates) this.seen.add(`task:${String(state.phase)}${state.cause === null ? '' : `/${state.cause.code}`}`);
    for (const goal of world.goals) this.seen.add(`goal:${goal.desiredState}`);
    return world;
  }

  /** States some checked world held (Run status and outcome, Task phase and cause, Goal desired state): transient ones included. */
  readonly seen = new Set<string>();
}

/**
 * Puts a world's Runs, rounds and messages in commit order (their `TaskClaimed`, round-open or reverify, and
 * `SessionMessageSent` events): the read window lists records by key, and these ids are random, so a seed picks from
 * these lists in the same order on every replay only once they are sorted. The checkers never depend on the order.
 */
function orderWorld(world: InvariantWorld, ledgerPath: string): void {
  const firstSeq = (types: readonly string[], idOf: (subject: Record<string, unknown>) => unknown): Map<string, number> => {
    const order = new Map<string, number>();
    for (const event of world.events) {
      if (!types.includes(event.eventType)) continue;
      const id = String(idOf(JSON.parse(event.subject) as Record<string, unknown>));
      if (!order.has(id)) order.set(id, event.seq);
    }
    return order;
  };
  const byOrder = (order: Map<string, number>) => (left: string, right: string): number =>
    (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right);
  const claimed = byOrder(firstSeq(['TaskClaimed'], (subject) => subject['runId']));
  world.runs.sort((left, right) => claimed(left.ref.runId, right.ref.runId));
  const opened = byOrder(firstSeq(['VerificationRoundOpened', 'VerificationRoundReverified'], (subject) => subject['roundId']));
  world.rounds.sort((left, right) => opened(left.ref.roundId, right.ref.roundId));
  const sent = messagesInSendOrder(ledgerPath);
  world.messages.sort((left, right) => (sent.get(left.ref.messageId) ?? Number.MAX_SAFE_INTEGER) - (sent.get(right.ref.messageId) ?? Number.MAX_SAFE_INTEGER)
    || left.ref.messageId.localeCompare(right.ref.messageId));
}

/** The ledger row of each message's `SessionMessageSent` event, by message id (a ledger without messages reads empty). */
function messagesInSendOrder(ledgerPath: string): Map<string, number> {
  const order = new Map<string, number>();
  const database = new DatabaseSync(ledgerPath, { readOnly: true });
  try {
    const rows = database.prepare(`SELECT id, event_json FROM events WHERE event_json LIKE '%"eventType":"SessionMessageSent"%' ORDER BY id`)
      .all() as Array<{ id: number; event_json: string }>;
    for (const row of rows) {
      const messageId = /"messageId":"([^"]+)"/.exec(row.event_json)?.[1];
      if (messageId !== undefined && !order.has(messageId)) order.set(messageId, Number(row.id));
    }
  } finally {
    database.close();
  }
  return order;
}

/** The §11.11 step kind of a rework answer: `done` when it committed, the refusal step for a committed refusal, else null (nothing written). */
export function reworkStepKind(answer: unknown, done: FuzzStepKind): FuzzStepKind | null {
  const body = (answer ?? {}) as { status?: unknown; value?: { kind?: unknown } };
  if (body.status !== 'committed') return null;
  return body.value?.kind === 'refused' ? 'task_rework_refused' : done;
}

// ---------------------------------------------------------------------------
// The human-stop fence and the rework admission as a checked world shows them
// ---------------------------------------------------------------------------

/** The pointer intent of a Run in a checked world (null without a pointer). */
export function pointerIntentIn(world: InvariantWorld, run: RunSnapshot): ControlIntentSnapshotV1 | null {
  const ref = run.controlState?.intentRef;
  return ref === undefined ? null : world.intents.find((intent) => intent.ref.intentId === ref.intentId) ?? null;
}

/** The GoalPhase pin a Goal control requires (HANDOFF decision 29): the GoalPhase as the checked world read it, 0 = none stored. */
function goalPhasePinIn(world: InvariantWorld, goalRef: { projectId: string; goalId: string }): VersionPin {
  const phase = world.goalPhases.find((candidate) => candidate.ref.projectId === goalRef.projectId && candidate.ref.goalId === goalRef.goalId);
  return { ref: { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId }, revision: phase?.revision ?? 0 };
}

/** `reworkFenceOf` of a Run in a checked world (§4 hard limit 3: the human-stop fence). */
export function fenceIn(world: InvariantWorld, run: RunSnapshot): ReworkFence {
  return reworkFenceOf(run, pointerIntentIn(world, run));
}

/** The head of a Run's work chain in a checked world. */
function workHeadIn(world: InvariantWorld, run: RunSnapshot): ReturnType<typeof roundChainHead> {
  return roundChainHead(world.rounds.filter((round) => round.identity.scope.gateSubject === undefined
    && round.ref.goalId === run.ref.goalId && round.ref.taskId === run.task.taskId && round.ref.runId === run.ref.runId));
}

/** The disposition of a Task in the Goal's active Plan (null when the Task is not in it). */
function dispositionIn(world: InvariantWorld, goalId: string, taskId: string): string | null {
  const active = world.goals.find((goal) => goal.ref.goalId === goalId)?.activePlanRevision ?? null;
  const plan = active === null ? undefined : world.plans.find((candidate) => candidate.ref.planId === active.planId);
  return plan?.tasks.find((task) => task.taskId === taskId)?.disposition ?? null;
}

/**
 * Whether a requeue of `run` reaches the actor × class matrix (§4.3 steps 1–5, `requeue-service.ts`) when its pins
 * are read from `world`: the Goal active, the Run the Task's selected Run, ended with a known outcome and not covered,
 * the Task an active work Task that is not verifying, the head finalized and the class derivable. Then the
 * human-stop fence decides first: a system or agent request on a fenced Run is `forbidden`.
 */
export function requeueReachesFence(world: InvariantWorld, run: RunSnapshot): boolean {
  const goal = world.goals.find((candidate) => candidate.ref.goalId === run.ref.goalId);
  const state = world.taskStates.find((candidate) => candidate.goalId === run.ref.goalId && candidate.taskId === run.task.taskId);
  if (goal?.desiredState !== 'active' || state === undefined || state.taskKind !== 'work') return false;
  if (state.selectedRunRef?.runId !== run.ref.runId || state.coveringRequeueRef !== null) return false;
  // An unresolved end (outcome unknown, quarantined, unreconciled) derives FC-2 below.
  if (run.status !== 'ended' || run.outcome === null || run.outcome === 'outcome_unknown') return false;
  if (state.phase === 'verifying' || state.phase === 'satisfied' || state.phase === null) return false;
  if (dispositionIn(world, run.ref.goalId, run.task.taskId) !== 'active') return false;
  const head = workHeadIn(world, run);
  if (head.kind === 'invalid' || (head.kind === 'head' && head.head.status === 'open')) return false;
  return deriveReworkClass(run, pointerIntentIn(world, run), head).kind === 'class';
}

/**
 * Whether a reverify of `round` reaches the actor × class matrix (VR-14 steps 3–5): the round is the finalized non-PASS
 * head of its chain, a work chain's subject Run is not covered by a TaskRequeue, the Goal is active and the subject
 * Task is active in the Goal's active Plan.
 */
export function reverifyReachesFence(world: InvariantWorld, round: RoundSnapshot): boolean {
  const goal = world.goals.find((candidate) => candidate.ref.goalId === round.ref.goalId);
  if (goal?.desiredState !== 'active' || dispositionIn(world, round.ref.goalId, round.ref.taskId) !== 'active') return false;
  const gate = round.identity.scope.gateSubject !== undefined;
  const chain = world.rounds.filter((candidate) => candidate.ref.goalId === round.ref.goalId && candidate.ref.taskId === round.ref.taskId
    && (gate ? candidate.identity.scope.gateSubject !== undefined
      : candidate.identity.scope.gateSubject === undefined && candidate.ref.runId === round.ref.runId));
  const head = roundChainHead(chain);
  if (head.kind !== 'head' || head.head.ref.roundId !== round.ref.roundId || !isFinalizedNonPass(head.head)) return false;
  return gate || !world.requeues.some((requeue) => requeue.afterRunRef.runId === round.subjectRunRef.runId);
}

/**
 * §11.11 and §4 hard limit 3 on one answer: a rework by the automation, the Goal fan-out actor or an Agent of a Run a
 * person stopped (fence `human_only`), or that a Goal pause stopped (`human_or_goal_resume`, except the well-formed
 * Goal-resume continuation), commits nothing, neither a TaskRequeue or successor round nor a policy refusal; when no
 * earlier precondition refuses the request (`reachesFence`), the answer is `forbidden`. Answers the problem, or null.
 */
export function fenceProblem(input: { cls: 'human' | 'system' | 'agent'; fence: ReworkFence; continuation: boolean;
  reachesFence: boolean; answer: unknown }): string | null {
  if (input.cls === 'human' || input.fence === 'none') return null;
  if (input.fence === 'human_or_goal_resume' && input.continuation) return null;
  const outcome = outcomeOf(input.answer);
  if (!outcome.startsWith('rejected:')) return `a ${input.cls} rework of a ${input.fence} Run must commit nothing, got ${outcome}`;
  if (input.reachesFence && outcome !== 'rejected:forbidden') {
    return `a ${input.cls} rework of a ${input.fence} Run that reaches the fence must be forbidden, got ${outcome}${reasonOf(input.answer)}`;
  }
  return null;
}

/** A refusal record at one revision (the key of `HostFuzz.refusalsSeenAt`). */
function refusalKey(refusal: InvariantWorld['refusals'][number]): string {
  return `${canonicalJson(refusal.ref as never)}@${refusal.revision}`;
}

/** The kind of a `forbidden` rework refusal, from its reason (for counting only). */
export function forbiddenKind(answer: unknown): string {
  const reason = String((answer as { reason?: unknown } | null)?.reason ?? '');
  if (/stopped this work|paused task can only be continued/.test(reason)) return 'fence';
  if (/fan-out actor only continues/.test(reason)) return 'fan-out-actor';
  if (/only Tasks of its own Goal/.test(reason)) return 'other-goal';
  if (/cancelled task is requeued only/.test(reason)) return 'cancelled-class';
  if (/not in the entered phase|no formal V2 entry authorization/.test(reason)) return 'writer-not-entered';
  if (/requeue_task|reverify_round|grant|admit/i.test(reason)) return 'grant';
  return 'other';
}

/** The epoch of a Goal fan-out pause from its deterministic reason (`goal:<goalId>:pause@<epoch>`, `goalFanOutReason`); null otherwise. */
export function fanOutPauseEpoch(intent: ControlIntentSnapshotV1 | null): number | null {
  if (intent === null || intent.kind !== 'pause' || intent.requestedBy.kind !== GOAL_FAN_OUT_ACTOR.kind
    || intent.requestedBy.id !== GOAL_FAN_OUT_ACTOR.id) return null;
  const epoch = /:pause@(\d+)$/.exec(intent.reason ?? '')?.[1];
  return epoch === undefined ? null : Number(epoch);
}

/**
 * Counts what the final world holds, so the coverage report names facts rather than intentions: Run outcomes,
 * requeues and reverifies by operator class, refusals by operation and code, control intents by kind and status,
 * disposition changes by adopter class, interrupted checks, messages by status, and the ledger's event types.
 */
export function tallyWorld(counts: OpCounts, world: InvariantWorld, eventTypes: readonly string[]): void {
  for (const run of world.runs) counts.add(`fact:run:${run.status}:${String(run.outcome)}`);
  for (const run of world.runs) {
    if (run.reconciliation?.observation.kind === 'interrupted_clean') {
      counts.add(`fact:run:interrupted_clean:${run.reconciliation.observation.pausedIntentRef === null ? 'plain' : 'paused'}:${String(run.outcome)}`);
    }
    if (run.requeueRef !== undefined && run.inputBinding?.continuationBriefDigest !== undefined) counts.add('fact:run:brief-bound');
    if (run.consumedWait !== undefined) counts.add('fact:run:consumed-wait');
  }
  for (const requeue of world.requeues) {
    const cls = reworkActorClassOf(null, requeue.requestedBy) ?? 'human';
    counts.add(`fact:requeue:${cls}:${requeue.failureClass}:${requeue.interruption ?? 'none'}${requeue.trigger === undefined ? '' : ':goal_resume'}`);
  }
  for (const refusal of world.refusals) counts.add(`fact:refusal:${refusal.ref.operation}:${refusal.code}@${refusal.revision}`);
  for (const round of world.rounds) {
    const gate = round.identity.scope.gateSubject !== undefined ? 'gate' : 'work';
    counts.add(`fact:round:${gate}:${round.status}:${String(round.outcome)}`);
    const reverify = round.chain?.reverify ?? null;
    if (reverify !== null) counts.add(`fact:reverify:${gate}:${reverify.actorClass}:${reverify.exemption}`);
    for (const check of round.checks) if (check.phase === 'interrupted') counts.add(`fact:check:interrupted:${String(check.incompleteCause)}`);
  }
  for (const intent of world.intents) counts.add(`fact:intent:${intent.kind}:${intent.status}`);
  for (const plan of world.plans) {
    if (plan.schemaVersion !== 2) continue;
    for (const entry of plan.dispositionRecord?.entries ?? []) {
      if (entry.setIn.planId !== plan.ref.planId) continue;
      const cls = reworkActorClassOf(null, entry.actor) ?? 'human';
      counts.add(`fact:disposition:${cls}:${entry.from}->${entry.to}${entry.traced ? ':traced' : ''}`);
    }
  }
  for (const message of world.messages) counts.add(`fact:message:${message.status}${message.waitAfterSend === true ? ':wait' : ''}`);
  for (const goal of world.goals) counts.add(`fact:goal:${goal.desiredState}`);
  for (const phase of world.goalPhases) counts.add(`fact:goal-phase:${phase.phase}`);
  for (const type of eventTypes) counts.add(`event:${type}`);
}

// ---------------------------------------------------------------------------
// The Host world
// ---------------------------------------------------------------------------

/** The second required work Task of the fuzz Goal. */
export const FUZZ_WORK_2 = 'ag2b-work-2';
const BASE_WORK_IDS = [AG2B_WORK_TASK_ID, FUZZ_WORK_2];
const PLACEHOLDER_REPLIES = 3000;
const QUERY_REPLIES = 400;

/**
 * The registered check (Host startup): PASS iff the result file holds the result text, else exit 3 (FAIL);
 * a process that finds the hold marker (under `.cache`, outside the verification source digest) takes it and
 * waits for the release marker (at most 8 s): the C-01 crash point of exactly that check.
 */
export const FUZZ_HOLD_MARKER = '.cache/fuzz-hold-check';
export const FUZZ_RELEASE_MARKER = '.cache/fuzz-release-check';
export const FUZZ_CHECK_COMMAND = `node -e "const fs=require('node:fs');if(fs.existsSync('${FUZZ_HOLD_MARKER}')){fs.rmSync('${FUZZ_HOLD_MARKER}');`
  + `fs.rmSync('${FUZZ_RELEASE_MARKER}',{force:true});const t=Date.now();const w=setInterval(()=>{`
  + `if(fs.existsSync('${FUZZ_RELEASE_MARKER}')||Date.now()-t>8000){clearInterval(w)}},50)}`
  + `else{let text='';try{text=fs.readFileSync('${AG2B_RESULT_FILE}','utf8')}catch{}if(text.trim()!=='${AG2B_RESULT_TEXT}'){process.exit(3)}`
  + `console.log('AG2B_CHECK_OK')}"`;
/** The same check in other words (another configuration revision when a restart registers it, LA-4). */
export const FUZZ_CHECK_COMMAND_ALT = FUZZ_CHECK_COMMAND.replace(`console.log('AG2B_CHECK_OK')`, `console.log('AG2B_CHECK_OK (alt)')`);

type MutableReply = { kind: 'text' | 'calls'; text: string; calls: Array<{ callId: string; name: string; args: Record<string, unknown> }> };

/** The Kernel Turn the fuzz is in (a `start`, a re-entry, a crash point) or a background Turn. */
type Turn = {
  runRef: RunRef | null;
  taskId: string | null;
  calls: number;
  /**
   * `normal`: random replies and in-Turn operations; `exhaust`: tool calls until the Run budget runs out; `quiet`:
   * replies only; `goal-pause` / `goal-cancel` / `person-pause` / `person-cancel`: the first call pauses or cancels
   * the Goal (the fan-out) or the Run (a person) and answers with a tool group, so the control lands at the next safe
   * point; `person-pause-final`: the first call pauses the Run and answers with the final text, so the Turn completes
   * with the person's pause as its pointer.
   */
  mode: 'normal' | 'exhaust' | 'quiet' | 'goal-pause' | 'goal-cancel' | 'person-pause' | 'person-cancel' | 'person-pause-final';
};

/** The Turn modes whose first model call is a control (see `Turn.mode`). */
const CONTROL_FIRST: ReadonlySet<Turn['mode']> = new Set(['goal-pause', 'goal-cancel', 'person-pause', 'person-cancel', 'person-pause-final']);

/** The Task a Workflow perform reworks (`requeue_task`, `reverify_round`); null for any other perform. */
function reworkedTaskOf(input: WorkflowAdvanceInput | null): string | null {
  if (input === null || input.kind !== 'perform') return null;
  const request = input.operation.request as { input?: { taskRef?: { taskId?: string }; predecessorRoundRef?: { taskId?: string } } };
  if (input.operation.kind === 'requeue_task') return request.input?.taskRef?.taskId ?? null;
  if (input.operation.kind === 'reverify_round') return request.input?.predecessorRoundRef?.taskId ?? null;
  return null;
}

type AdvanceValue = Extract<WorkflowAdvanceResult, { status: 'ready' }>['value'];
type Answer = Record<string, unknown>;
type OperatorClass = 'human' | 'system';

export type HostFuzzOptions = {
  seed: number;
  /** Operations to run (an `advance` of several Workflow performs counts once). */
  operations: number;
  /** A Host started with `{kind:'system'}` (§11.11: it is still an operator). */
  systemHostActor?: boolean;
};

/** One Host fuzz run: open, run `operations` seeded operations, tally. */
export class HostFuzz {
  readonly counts = new OpCounts();
  /** Milliseconds spent per operation name (for keeping the file within its time budget). */
  readonly timings = new OpCounts();
  readonly log: string[] = [];
  readonly gate: InvariantGate;
  private turn: Turn | null = null;
  private workCalls = 0;
  private operation = 0;
  private sequence = 0;
  private recipient: SessionRef | null = null;
  private readonly performed: WorkflowAdvanceInput[] = [];
  private agentPlatformOpen: Promise<Platform> | null = null;
  /** Set while a crash restart abandons the Host: a model call it makes then is the crash point, never an operation. */
  private crashing = false;
  /** The check command the live Host registered (the two equivalent commands alternate at restarts). */
  private checkCommand = FUZZ_CHECK_COMMAND;
  /** How often a restart registered the other check command (a new check configuration revision, LA-4). */
  private configurationChanges = 0;
  /** The configuration-change count when each refusal revision was first seen (key `<refusal ref>@<revision>`). */
  private readonly refusalsSeenAt = new Map<string, number>();
  /** The model call indexes a crash point held (the harness holds an index once). */
  private readonly heldCalls = new Set<number>();
  /** The directed operations each seed runs once (see `forced`). */
  private readonly done = new Set<'guard9-cycle' | 'human-stop-cycle' | 'goal-cancel'>();
  /**
   * GOAL-08 (§2 `goal_completed`): `complete_goal` performs the Workflow proposed and the fuzz sent at once that were refused
   * `revision_conflict` (nothing wrote between the Workflow's read and the perform, so the Workflow pinned a wrong revision).
   */
  readonly goalCompletionConflicts: string[] = [];

  private constructor(readonly options: HostFuzzOptions, readonly rng: Rng, readonly h: HostScenario,
    private readonly replies: MutableReply[]) {
    this.gate = new InvariantGate(h.database, AG2B_SCOPE.projectId, () => this.replayText());
  }

  static async open(options: HostFuzzOptions): Promise<HostFuzz> {
    const rng = seededRng(options.seed);
    const replies: MutableReply[] = Array.from({ length: PLACEHOLDER_REPLIES }, () => ({ kind: 'text', text: 'fuzz placeholder', calls: [] }));
    let fuzz: HostFuzz | undefined;
    const automation: TaskAutomationPolicyV1 = { schemaVersion: 1, autoReworkLimit: rng.int(0, 4),
      resumeOnStartup: rng.weighted([[0.5, 'auto'], [0.25, 'ask'], [0.25, 'off']] as const) };
    const h = await openHostScenario({
      workIds: BASE_WORK_IDS, check: { command: FUZZ_CHECK_COMMAND }, automation,
      ...(options.systemHostActor === true ? { actor: { kind: 'system', id: 'fuzz-system-host' } } : {}),
      script: {
        replies: replies as unknown as ScriptedReply[],
        queryReplies: Array.from({ length: QUERY_REPLIES }, (_, index) => ({ kind: 'text' as const, text: `fuzz consultation answer ${index}` })),
        duringReply: async (index, request) => { await fuzz?.onModelCall(index, request); },
      },
    });
    fuzz = new HostFuzz(options, rng, h, replies);
    // Most seeds start with the result file right, so checks PASS until the workspace changes and the gate is reached.
    const passing = rng.chance(0.7);
    if (passing) await writeFile(join(h.root, AG2B_RESULT_FILE), `${AG2B_RESULT_TEXT}\n`);
    fuzz.record(`opened: work Tasks ${BASE_WORK_IDS.join(', ')} and the gate; automation ${JSON.stringify(automation)}`
      + `${options.systemHostActor === true ? '; Host actor system:fuzz-system-host' : ''}; result file ${passing ? 'right' : 'absent'}`);
    await fuzz.gate.check('seeded');
    await fuzz.addRecipient();
    return fuzz;
  }

  // -------------------------------------------------------------------------
  // The loop
  // -------------------------------------------------------------------------

  private replayText(): string {
    return `replay: seed ${this.options.seed}${this.options.systemHostActor === true ? ' (system Host actor)' : ''}, operation ${this.operation};`
      + ` operations so far:\n${this.log.map((line) => `  ${line}`).join('\n')}`;
  }

  private record(line: string): void { this.log.push(`#${this.operation} ${line}`); }

  private requestId(what: string): string { return `fuzz-${this.options.seed}-${what}-${++this.sequence}`; }

  private policy(): TaskAutomationPolicyV1 { return this.h.automationPolicy(); }

  private world(): InvariantWorld {
    const world = this.gate.world;
    if (world === undefined) throw new Error('fuzz: no world was checked yet');
    return world;
  }

  /** Runs the seeded operations; every write is followed by the invariant check of what it wrote. Then tallies the store. */
  async run(): Promise<void> {
    while (this.operation < this.options.operations) {
      this.operation += 1;
      const [name, operation] = this.choose();
      const started = performance.now();
      await operation();
      this.timings.add(name, Math.round(performance.now() - started));
      this.counts.add(`op:${name}`);
    }
    await this.h.drainAbandoned();
    const world = await this.gate.check('final (abandoned Hosts drained)');
    tallyWorld(this.counts, world, this.h.ledgerEventTypes());
    for (const state of this.gate.seen) this.counts.add(`seen:${state}`);
  }

  /**
   * The directed operations every seed runs once, at a fixed point of its operation list: the guard 9 cycle at the
   * first operation from the third on with the Goal active, the human-stop cycle at the first one from the middle on
   * with the Goal active, and a person's Goal cancel three operations before the end (§11.11 "Goal 的取消"). Null
   * when none is due.
   */
  private forced(): readonly [string, () => Promise<void>] | null {
    const goal = this.world().goals[0];
    const active = goal?.desiredState === 'active';
    const due = (name: 'guard9-cycle' | 'human-stop-cycle' | 'goal-cancel', when: boolean): boolean => {
      if (this.done.has(name) || !when) return false;
      this.done.add(name);
      return true;
    };
    if (due('goal-cancel', this.operation === this.options.operations - 3 && goal?.desiredState !== 'cancelled')) {
      return ['goal-cancel', () => this.opGoalCancel()];
    }
    if (due('guard9-cycle', this.operation >= 3 && active)) return ['guard9-cycle', () => this.opGuard9Cycle()];
    if (due('human-stop-cycle', this.operation >= Math.floor(this.options.operations / 2) && active)) {
      return ['human-stop-cycle', () => this.opHumanStopCycle()];
    }
    return null;
  }

  /** The operation menu over the last checked world (weight 0 for what does not apply). */
  private choose(): readonly [string, () => Promise<void>] {
    const directed = this.forced();
    if (directed !== null) return directed;
    const world = this.world();
    const goal = world.goals[0];
    const active = goal?.desiredState === 'active';
    const paused = goal?.desiredState === 'paused';
    const ended = world.runs.filter((run) => run.status === 'ended');
    const live = world.runs.filter((run) => run.status !== 'ended');
    const heads = this.reverifiableHeads();
    const open = this.openHeads(heads);
    const waits = world.messages.filter((message) => message.status !== 'responded' && message.waitAfterSend === true);
    const late = this.operation > this.options.operations - 4;
    const entries: Array<readonly [number, readonly [string, () => Promise<void>]]> = [
      [active ? 34 : 6, ['advance', () => this.opAdvance()]],
      [active ? 4 : 0, ['crash-mid-turn', () => this.opCrashMidTurn()]],
      [active ? 2 : 0, ['crash-mid-check', () => this.opCrashMidCheck()]],
      [live.length > 0 ? 7 : 2, ['run-control', () => this.opRunControl()]],
      [ended.length > 0 ? 7 : 0, ['requeue-human', async () => { await this.opRequeue('human'); }]],
      [ended.length > 0 ? 4 : 0, ['requeue-system', async () => { await this.opRequeue('system'); }]],
      [ended.length > 0 ? 2 : 0, ['requeue-agent', () => this.opAgentRequeue()]],
      [open.length > 0 ? 8 : heads.length > 0 ? 1 : 0, ['reverify-human', () => this.opReverify('human')]],
      [open.length > 0 ? 4 : heads.length > 0 ? 1 : 0, ['reverify-system', () => this.opReverify('system')]],
      [3, ['cap', () => this.opCap()]],
      [4, ['w16', async () => { await this.opW16(); }]],
      [active ? 3 : paused ? 12 : 0, ['goal', () => this.opGoal(late)]],
      [5, ['workspace', () => this.opWorkspace()]],
      [waits.length > 0 ? 6 : 0, ['reply', () => this.opReply()]],
      [3, ['restart', () => this.opRestart()]],
      [this.performed.length > 0 ? 2 : 0, ['replay', () => this.opReplay()]],
      [active ? 2 : 0, ['fan-out-cycle', () => this.opFanOutCycle()]],
      [active ? 2 : 0, ['pause-cycle', () => this.opPauseCycle()]],
      [active ? 1 : 0, ['human-stop-cycle', () => this.opHumanStopCycle()]],
      [active ? 1 : 0, ['guard9-cycle', () => this.opGuard9Cycle()]],
      [active && this.gateIsNext() ? 24 : 0, ['gate-cycle', () => this.opGateCycle()]],
      [live.some((run) => run.status === 'running') ? 2 : 0, ['kernel-lost', () => this.opKernelLost()]],
      [world.runs.some((run) => run.outcome === 'outcome_unknown') ? 6 : 0, ['attest', () => this.opAttest()]],
      [active ? 2 : 0, ['authorize-only', () => this.opAuthorizeOnly()]],
    ];
    return this.rng.weighted(entries);
  }

  // -------------------------------------------------------------------------
  // Model calls (the placeholders are filled in here)
  // -------------------------------------------------------------------------

  /** `duringReply`: decides the reply of work model call `index` and, inside a Turn, may act on the platform first. */
  async onModelCall(index: number, _request: ModelRequest): Promise<void> {
    this.workCalls = Math.max(this.workCalls, index + 1);
    const reply = this.replies[index];
    if (reply === undefined) throw new Error(`fuzz: model call ${index} has no placeholder`);
    const turn = this.turn ?? { runRef: null, taskId: null, calls: 0, mode: 'quiet' as const };
    turn.calls += 1;
    if (turn.mode === 'exhaust') {
      this.counts.add('model:exhaust-read');
      setCalls(reply, [{ callId: `fuzz-${index}-read`, name: 'read', args: { path: 'src/module.ts' } }]);
      return;
    }
    if (CONTROL_FIRST.has(turn.mode) && turn.calls === 1 && turn.runRef !== null) {
      await this.gate.check(`mid-Turn (model call ${index})`);
      if (turn.mode === 'goal-pause') await this.goalControl('pause', 'in-Turn Goal pause');
      else if (turn.mode === 'goal-cancel') await this.goalControl('cancel', 'in-Turn Goal cancel');
      else await this.submitControl(turn.runRef, turn.mode === 'person-cancel' ? 'cancel' : 'pause', `a person ${turn.mode} during the Turn`);
      if (turn.mode === 'person-pause-final') {
        reply.kind = 'text';
        reply.text = `fuzz Turn ends at call ${index} with the pause queued`;
        reply.calls = [];
      } else {
        setCalls(reply, [{ callId: `fuzz-${index}-read`, name: 'read', args: { path: 'src/module.ts' } }]);
      }
      return;
    }
    if (turn.mode === 'normal' && !this.crashing && turn.runRef !== null && this.rng.chance(0.3)) await this.inTurnOperation(turn.runRef, index);
    const choice = turn.calls > 4 ? 'final' : this.rng.weighted<'read' | 'notes' | 'final' | 'wait'>([
      [3, 'read'], [1, 'notes'], [4, 'final'], [turn.mode === 'normal' && this.recipient !== null ? 1 : 0, 'wait']]);
    this.counts.add(`model:${choice}`);
    switch (choice) {
      case 'read':
        setCalls(reply, [{ callId: `fuzz-${index}-read`, name: 'read', args: { path: 'src/module.ts' } }]);
        return;
      case 'notes':
        setCalls(reply, [{ callId: `fuzz-${index}-notes`, name: 'edit',
          args: { mode: 'create', path: `src/fuzz-notes-${this.options.seed}-${index}.txt`, newText: `fuzz notes ${index}\n` } }]);
        return;
      case 'wait': {
        const recipient = this.recipient!;
        setCalls(reply, [{ callId: `fuzz-${index}-send`, name: 'send_session_message', args: {
          recipient: { projectId: recipient.projectId, sessionId: recipient.sessionId },
          text: `fuzz question ${index}: which marker does src/module.ts export?`, intent: 'inquiry', needsReply: true, waitAfterSend: true } }]);
        return;
      }
      case 'final':
        reply.kind = 'text';
        reply.text = `fuzz Turn ends at call ${index}`;
        reply.calls = [];
        return;
    }
  }

  /**
   * One platform operation while the Turn's model call runs (the Run is entered): a control of this Run, a Goal pause,
   * or rework elsewhere. The store is checked first: the Turn wrote since the last check, and the pins come from it.
   */
  private async inTurnOperation(runRef: RunRef, index: number): Promise<void> {
    await this.gate.check(`mid-Turn (model call ${index})`);
    const kind = this.rng.weighted<string>([[3, 'pause'], [2, 'cancel'], [3, 'steer'], [1, 'goal-pause'], [2, 'agent-requeue'],
      [2, 'human-requeue'], [1, 'human-reverify']]);
    this.record(`  in-Turn (model call ${index}, Run ${runRef.runId}): ${kind}`);
    switch (kind) {
      case 'pause':
      case 'cancel':
      case 'steer':
        await this.submitControl(runRef, kind, `in-Turn ${kind}`);
        return;
      case 'goal-pause':
        await this.goalControl('pause', 'in-Turn Goal pause');
        return;
      case 'agent-requeue':
        await this.agentRequeue(runRef, '  ');
        return;
      case 'human-requeue':
        await this.opRequeue('human', '  ');
        return;
      case 'human-reverify':
        await this.opReverify('human', '  ');
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Workflow steps
  // -------------------------------------------------------------------------

  private select(taskId: string | undefined): WorkflowAdvanceInput {
    return { schemaVersion: 1, goalRef: AG2B_GOAL_REF, flowId: `fuzz-${this.options.seed}-${this.operation}`, sessionHint: null,
      kind: 'select_work', ...(taskId === undefined ? {} : { taskId }) };
  }

  private activePlan(world: InvariantWorld = this.world()): PlanRevisionSnapshot | null {
    const active = world.goals[0]?.activePlanRevision ?? null;
    return active === null ? null : world.plans.find((plan) => plan.ref.planId === active.planId) ?? null;
  }

  private taskIds(kind?: 'work'): string[] {
    const plan = this.activePlan();
    if (plan === null) return kind === 'work' ? [...BASE_WORK_IDS] : [...BASE_WORK_IDS, AG2B_GATE_TASK_ID];
    return plan.tasks.filter((task) => kind === undefined || task.taskKind === kind).map((task) => task.taskId);
  }

  /**
   * One `workflow/advance` call; a receipt is checked with its §11.11 step (`stepOfReceipt`). Out of a Turn (nothing
   * runs in the background then), a perform the route or its owner refused, or one that replayed an earlier receipt
   * (W-23), must write nothing (`start` and `run_check` excepted: their first commits stand when a later step is
   * refused). A Workflow rework of a Task whose refusal is not stale is a mechanical retry (ND-8, §13.5) and fails the
   * run. A `complete_goal` the Workflow proposed and the fuzz sent at once (`sentAtOnce`) refused `revision_conflict`
   * is recorded (`goalCompletionConflicts`, GOAL-08).
   */
  private async advanceCall(input: WorkflowAdvanceInput, label: string, sentAtOnce = true): Promise<AdvanceValue | null> {
    const quiet = this.turn === null && input.kind === 'perform' && input.operation.kind !== 'start' && input.operation.kind !== 'run_check';
    const ledger = join(this.h.database, 'ledger.sqlite');
    const before = quiet ? ledgerWrites(ledger) : 0;
    const mechanical = sentAtOnce ? this.mechanicalRetry(input) : null;
    const result = await this.h.answer('workflow/advance', plain(AG2B_SCOPE, input)) as WorkflowAdvanceResult;
    const written = quiet ? ledgerWrites(ledger) - before : 0;
    const quietProblem = (outcome: string): void => {
      if (!quiet || !(outcome.startsWith('rejected:') || outcome.endsWith(':replayed'))) return;
      if (written !== 0) throw new Error(`${label}: ${outcome} yet ${written} ledger write(s) were made\n${this.replayText()}`);
      this.counts.add(`zero-write-perform:${outcome.endsWith(':replayed') ? 'replayed' : 'refused'}`);
    };
    if (result.status !== 'ready') {
      this.counts.add(`wf:${input.kind === 'perform' ? input.operation.kind : 'select'}:rejected:${result.code}`);
      this.record(`${label}: ${result.code} ${result.reason.slice(0, 100)}`);
      quietProblem(`rejected:${result.code}`);
      await this.gate.check(`${label} (refused)`);
      return null;
    }
    const receipt = result.value.receipt;
    if (receipt !== null) {
      const outcome = outcomeOf(receipt.result);
      this.counts.add(`wf:${receipt.kind}:${outcome}`);
      this.record(`${label}: ${receipt.kind} ${outcome}${receiptDetail(receipt)}`);
      quietProblem(outcome);
      if (receipt.kind === 'complete_goal' && sentAtOnce) {
        this.counts.add(`goal-completion:${outcome}`);
        if (outcome === 'rejected:revision_conflict') this.goalCompletionConflicts.push(`operation ${this.operation}: ${label}`);
      }
      if (mechanical !== null && !outcome.startsWith('rejected:')) {
        throw new Error(`${label}: the Workflow reworked again after a refusal that is not stale (ND-8): ${mechanical}; `
          + `${receipt.kind} ${outcome}\n${this.replayText()}`);
      }
      if (mechanical === null && (receipt.kind === 'requeue_task' || receipt.kind === 'reverify_round')) this.counts.add(`wf-rework:${outcome}`);
      await this.gate.check(label, stepOfReceipt(receipt, this.h.stepActor(), this.policy(), label));
    } else if (result.value.state !== 'advance') {
      this.counts.add(`wf:select:${result.value.state}`);
      this.record(`${label}: ${result.value.state} ${(result.value.reason ?? '').slice(0, 110)}`);
    }
    return result.value;
  }

  /**
   * ND-8 (§13.2 point 8, §13.5, §13.7 point 8): the Workflow's `requeue_task` or `reverify_round` of a subject that has
   * a refusal record retries only once that refusal is stale: the Goal ended more Runs since it was written
   * (`goalEndedRunsAtRefusal`), or it stored a check configuration revision and the configuration changed since (LA-4).
   * A workspace edit alone never makes it stale (GAP-47). A cap refusal is left out: the automation goes on once the cap
   * is raised (§13.7 point 7). Answers what makes the proposed retry mechanical, else null.
   */
  private mechanicalRetry(input: WorkflowAdvanceInput): string | null {
    if (input.kind !== 'perform' || (input.operation.kind !== 'requeue_task' && input.operation.kind !== 'reverify_round')) return null;
    const request = input.operation.request as { input?: { afterRunRef?: RunRef; predecessorRoundRef?: { roundId: string } } };
    const operation = input.operation.kind === 'requeue_task' ? 'requeue' : 'reverify';
    const subjectId = operation === 'requeue' ? request.input?.afterRunRef?.runId : request.input?.predecessorRoundRef?.roundId;
    const world = this.world();
    const refusal = world.refusals.find((candidate) => candidate.ref.operation === operation && candidate.ref.subjectId === subjectId);
    if (refusal === undefined || refusal.code === 'auto_rework_cap_reached') return null;
    const ended = world.runs.filter((run) => run.ref.goalId === refusal.ref.goalId && run.status === 'ended').length;
    const seenAt = this.refusalsSeenAt.get(refusalKey(refusal)) ?? this.configurationChanges;
    const stale = ended > refusal.goalEndedRunsAtRefusal || (refusal.configurationRevision !== null && this.configurationChanges > seenAt);
    this.counts.add(`wf-rework:after-refusal:${refusal.code}:${stale ? 'stale' : 'not-stale'}`);
    return stale ? null : `${operation} refusal ${refusal.code}@${refusal.revision} of ${String(subjectId)} is not stale `
      + `(the Goal's ended Runs ${ended}, ${refusal.goalEndedRunsAtRefusal} at the refusal; configuration unchanged)`;
  }

  /** Performs `input`; a `start` runs its Kernel Turn with the fuzz in it (replies and in-Turn operations). */
  private async perform(input: WorkflowAdvanceInput, label: string): Promise<AdvanceValue | null> {
    if (input.kind !== 'perform') return this.advanceCall(input, label);
    this.performed.push(structuredClone(input));
    if (input.operation.kind !== 'start') return this.advanceCall(input, label);
    const claim = (input.operation.request as { prepared?: { claim?: { runRef?: RunRef; task?: TaskTriple } } }).prepared?.claim;
    const mode = this.rng.chance(0.06) ? 'exhaust' as const : 'normal' as const;
    this.turn = { runRef: claim?.runRef ?? null, taskId: claim?.task?.taskId ?? null, calls: 0, mode };
    if (mode === 'exhaust') this.record(`  the Turn of Run ${claim?.runRef?.runId ?? '?'} reads until its budget is exhausted`);
    try {
      return await this.advanceCall(input, label);
    } finally {
      this.turn = null;
    }
  }

  /** `select_work` (a random Task or the Goal level), then up to six performs following `next`. */
  private async opAdvance(): Promise<void> {
    const taskId = this.rng.pick<string | undefined>([undefined, ...this.taskIds()]);
    const steps = this.rng.int(1, 6);
    let next: WorkflowAdvanceInput | null = this.select(taskId);
    for (let step = 0; step <= steps && next !== null; step += 1) {
      const value: AdvanceValue | null = await this.perform(next, `advance ${taskId ?? 'goal'} #${step}`);
      if (value === null || value.state === 'completed') return;
      next = value.next;
    }
  }

  /** Drives `taskId` until its next request is a perform of `kind` (each step checked); null when it does not get there. */
  private async advanceTo(taskId: string | undefined, kind: string, guard = 10): Promise<WorkflowAdvanceInput | null> {
    let next: WorkflowAdvanceInput | null = this.select(taskId);
    for (let step = 0; step < guard && next !== null; step += 1) {
      if (next.kind === 'perform' && next.operation.kind === kind) return next;
      const value: AdvanceValue | null = await this.perform(next, `advance ${taskId ?? 'goal'} to ${kind} #${step}`);
      if (value === null || value.state === 'completed') return null;
      next = value.next;
    }
    return null;
  }

  /**
   * The next perform of `kind` from the Goal level, else from the work Tasks in a seeded order (at most three
   * selections; the steps on the way are performed and checked). Answers the request and the Task it names.
   */
  private async reach(kind: 'start' | 'run_check', preferred: ReadonlySet<string> = new Set()):
  Promise<{ input: Extract<WorkflowAdvanceInput, { kind: 'perform' }>; taskId: string } | null> {
    const tasks = [...this.taskIds(kind === 'start' ? 'work' : undefined)];
    for (let index = tasks.length - 1; index > 0; index -= 1) {
      const other = this.rng.int(0, index);
      [tasks[index], tasks[other]] = [tasks[other]!, tasks[index]!];
    }
    // The preferred Tasks first (the same draws: without preferred Tasks the order is the one of every other caller).
    const order = [...tasks.filter((taskId) => preferred.has(taskId)), undefined, ...tasks.filter((taskId) => !preferred.has(taskId))];
    for (const taskId of order.slice(0, 3)) {
      const input = await this.advanceTo(taskId, kind);
      if (input === null || input.kind !== 'perform') continue;
      const request = input.operation.request as { prepared?: { claim?: { task?: TaskTriple } }; subject?: TaskTriple };
      return { input, taskId: request.prepared?.claim?.task?.taskId ?? taskId ?? 'goal' };
    }
    return null;
  }

  /** The Run a `start` request enters. */
  private static runOf(start: WorkflowAdvanceInput): RunRef | null {
    if (start.kind !== 'perform') return null;
    return (start.operation.request as { prepared?: { claim?: { runRef?: RunRef } } }).prepared?.claim?.runRef ?? null;
  }

  /** Re-sends a Workflow perform the fuzz sent before (the same request identity, W-23): a replay or a refusal. */
  private async opReplay(): Promise<void> {
    const input = this.rng.pick(this.performed);
    if (input.kind !== 'perform' || input.operation.kind === 'start') {
      // A replayed `start` re-enters a Turn; the operator's re-entry covers that path (`reenter`).
      this.counts.add('replay:start-skipped');
      return;
    }
    this.counts.add(`replay:${input.operation.kind}`);
    await this.advanceCall(input, `replay ${input.operation.kind}`, false);
  }

  // -------------------------------------------------------------------------
  // Crash points and restarts (§12.1, §12.10)
  // -------------------------------------------------------------------------

  /** Holds the first model call of a `start`, may control the Run while it is held, then abandons the Host (a crash). */
  private async opCrashMidTurn(): Promise<void> {
    const reached = await this.reach('start');
    if (reached === null) {
      this.counts.add('crash-mid-turn:no-start');
      return;
    }
    const { input: start, taskId } = reached;
    const runRef = HostFuzz.runOf(start);
    if (this.heldCalls.has(this.workCalls)) {
      this.counts.add('crash-mid-turn:call-held-before');
      return;
    }
    this.heldCalls.add(this.workCalls);
    const held = this.h.holdReply(this.workCalls);
    this.performed.push(structuredClone(start));
    this.turn = { runRef, taskId, calls: 0, mode: 'quiet' };
    this.record(`crash-mid-turn ${taskId}: start with model call ${this.workCalls} held`);
    const inFlight = this.h.answer('workflow/advance', plain(AG2B_SCOPE, start)).catch(() => undefined);
    // A start that is refused, or that ends before its first model call, never reaches the hold: check what it wrote.
    const reachedCall = await Promise.race([held.reached.then(() => true), inFlight.then(() => false)]);
    this.turn = null;
    if (!reachedCall) {
      // The next work call goes through when it comes (a call index is held once: `heldCalls`).
      held.release();
      this.counts.add('crash-mid-turn:no-model-call');
      this.record('  the start ended before its first model call');
      await this.gate.check('start without a model call', ownerStep('entry_authorized', this.h.stepActor(), this.policy(), 'crash-mid-turn start'));
      return;
    }
    // The start committed the authorization, the begin and the entry before the held call (RUN-02..05).
    await this.gate.check('Turn held at a model call', ownerStep('entry_authorized', this.h.stepActor(), this.policy(), 'crash-mid-turn start'));
    if (runRef !== null) {
      const controls = this.rng.weighted<ReadonlyArray<ControlIntentKindV1>>([[3, []], [2, ['cancel']], [2, ['steer']], [1, ['pause']],
        [1, ['steer', 'cancel']]]);
      for (const kind of controls) await this.submitControl(runRef, kind, `held ${kind}`);
    }
    this.counts.add('crash-mid-turn:held');
    // The crashed Host never answers its held call: fail it and let the start return before the Host is drained (an idle
    // connection closes at once; a busy one would hold the close until its keep-alive ends).
    await this.restart(true, 'crash mid-Turn', async () => { held.fail('fuzz: the crashed Host never answers this call'); await inFlight; });
  }

  /** Makes the next check process hold, sends its `run_check` and abandons the Host while it executes (C-01). */
  private async opCrashMidCheck(): Promise<void> {
    const reached = await this.reach('run_check');
    if (reached === null) {
      this.counts.add('crash-mid-check:no-check');
      return;
    }
    const { input: runCheck, taskId } = reached;
    const marker = join(this.h.root, FUZZ_HOLD_MARKER);
    await mkdir(join(this.h.root, '.cache'), { recursive: true });
    await writeFile(marker, 'hold\n');
    this.performed.push(structuredClone(runCheck));
    this.record(`crash-mid-check ${taskId}: run_check with the check process held`);
    const inFlight = this.h.answer('workflow/advance', plain(AG2B_SCOPE, runCheck)).catch(() => undefined);
    for (let poll = 0; poll < 100 && existsSync(marker); poll += 1) await sleep(50);
    if (existsSync(marker)) {
      // No check process started (the begin was refused): nothing is held; take the marker back.
      await rm(marker, { force: true });
      await inFlight;
      this.counts.add('crash-mid-check:not-begun');
      await this.gate.check('run_check without a held process', ownerStep('check_begun', this.h.stepActor(), this.policy(), 'run_check'));
      return;
    }
    this.counts.add('crash-mid-check:held');
    await this.gate.check('check process held', ownerStep('check_begun', this.h.stepActor(), this.policy(), 'run_check held'));
    await this.restart(true, 'crash mid-check', async () => {
      // The held process may end now; the abandoned Host's late result is refused by the interruption the reconcile wrote (VR-04).
      await writeFile(join(this.h.root, FUZZ_RELEASE_MARKER), 'release\n');
      await inFlight;
    });
  }

  private async opRestart(): Promise<void> {
    await this.restart(this.rng.chance(0.4), 'restart');
  }

  /**
   * C4 (A8-3l, C3-paused-continue-brief): a person pauses the Run in its first model call, which answers with a tool
   * group, so the pause lands at the next safe point; a steer may follow; the Host restarts (RUN-24, the Run ends
   * paused-interrupted); the automation's and an Agent's continuation are refused (I-17), and a person's 继续 is a
   * requeue of class `interrupted`/`paused`. Each step is its own commit and its own check.
   */
  private async opPauseCycle(): Promise<void> {
    const reached = await this.reach('start');
    if (reached === null) {
      this.counts.add('pause-cycle:no-start');
      return;
    }
    const { input: start, taskId } = reached;
    const runRef = HostFuzz.runOf(start);
    this.performed.push(structuredClone(start));
    this.record(`pause cycle ${taskId}: a person pauses Run ${runRef?.runId ?? '?'} during its Turn`);
    this.turn = { runRef, taskId, calls: 0, mode: 'person-pause' };
    try {
      await this.advanceCall(start, 'pause cycle start');
    } finally {
      this.turn = null;
    }
    const run = runRef === null ? undefined : this.world().runs.find((candidate) => candidate.ref.runId === runRef.runId);
    if (run?.status !== 'running') return;
    this.counts.add('pause-cycle:paused');
    if (this.rng.chance(0.5)) await this.submitControl(run.ref, 'steer', 'steer while paused');
    // RUN-23 (LA-7): a cancel left queued on the paused Run (never delivered) is the restart's cancel of a clean Turn.
    if (this.rng.chance(0.3)) await this.submitControl(run.ref, 'cancel', 'cancel left queued on the paused Run');
    if (this.rng.chance(0.25)) {
      // W-14: the Kernel store is lost with the crashed Host; the paused Run ends outcome_unknown (RUN-20), attested later.
      await moveKernelAside(this.h.database);
      this.counts.add('kernel-lost');
      this.record('  the Kernel store is lost with the Host');
      await this.restart(true, 'pause cycle restart, Kernel store lost');
    } else {
      await this.restart(this.rng.chance(0.5), 'pause cycle restart');
    }
    const ended = this.world().runs.find((candidate) => candidate.ref.runId === run.ref.runId);
    if (ended?.status !== 'ended') return;
    if (this.rng.chance(0.5)) await this.opRequeue('system', '  ', ended);
    if (this.rng.chance(0.3)) await this.agentRequeue(this.rng.pick(this.world().runs).ref, '  ', ended);
    if (this.rng.chance(0.7)) await this.opRequeue('human', '  ', ended);
  }

  /**
   * C8 hard limit 3 (§11.11: a system or agent rework of work a person stopped commits nothing; scenario
   * C8-human-stop-respected): a person stops a Run during its Turn, with a cancel that lands at the next safe point,
   * or with a pause the Turn outlives (it completes with the pause as its pointer; the result file is made wrong first
   * now and then, so its round FAILs). A Run left paused at a safe point is ended by a restart (RUN-24). Then the
   * Workflow is driven on the Task until it waits and must never propose `requeue_task` or `reverify_round` for it
   * (verification goes on), the automation's requeue of the Run and its reverify of the Run's round are refused
   * (`opRequeue`, `opReverify`: `forbidden`, nothing written), and the Workflow is driven again. When no work Task can
   * start, a person's W16 adds a carrier to stop.
   */
  private async opHumanStopCycle(): Promise<void> {
    let reached = await this.reach('start');
    if (reached === null && this.world().goals[0]?.desiredState === 'active') {
      const before = new Set(this.taskIds('work'));
      await this.opW16({ cls: 'human' });
      reached = await this.reach('start', new Set(this.taskIds('work').filter((taskId) => !before.has(taskId))));
    }
    if (reached === null) {
      this.counts.add('human-stop-cycle:no-start');
      return;
    }
    const { input: start, taskId } = reached;
    const runRef = HostFuzz.runOf(start);
    const stop = this.rng.pick(['cancel', 'pause'] as const);
    if (stop === 'pause' && this.rng.chance(0.6)) await writeFile(join(this.h.root, AG2B_RESULT_FILE), `not the result (human stop ${this.operation})\n`);
    this.performed.push(structuredClone(start));
    this.record(`human-stop cycle ${taskId}: a person ${stop}s Run ${runRef?.runId ?? '?'} during its Turn`);
    this.turn = { runRef, taskId, calls: 0, mode: stop === 'cancel' ? 'person-cancel' : 'person-pause-final' };
    try {
      await this.advanceCall(start, 'human-stop cycle start');
    } finally {
      this.turn = null;
    }
    const find = (): RunSnapshot | undefined => runRef === null ? undefined : this.world().runs.find((candidate) => candidate.ref.runId === runRef.runId);
    if (find() !== undefined && find()!.status !== 'ended') await this.restart(this.rng.chance(0.5), 'human-stop cycle restart');
    const run = find();
    if (run?.status !== 'ended') {
      this.counts.add('human-stop-cycle:not-ended');
      return;
    }
    const fence = fenceIn(this.world(), run);
    this.counts.add(`human-stop-cycle:${stop}:${String(run.outcome)}:${fence}`);
    if (fence === 'none') return;
    await this.driveWithoutRework(taskId, 'human-stop cycle');
    const ended = find() ?? run;
    if (this.world().taskStates.find((state) => state.taskId === taskId)?.selectedRunRef?.runId === ended.ref.runId) {
      await this.opRequeue('system', '  ', ended);
    }
    const head = workHeadIn(this.world(), ended);
    if (head.kind === 'head' && isFinalizedNonPass(head.head)) await this.opReverify('system', '  ', head.head);
    await this.driveWithoutRework(taskId, 'human-stop cycle, after the refusals');
    this.counts.add('human-stop-cycle:done');
  }

  /**
   * Drives the Workflow on `taskId` (at most eight steps, stopping before a `start`) and fails when it proposes or
   * performs a rework of that Task (`requeue_task`, `reverify_round`): a person stopped its work (C8 hard limit 3).
   */
  private async driveWithoutRework(taskId: string, label: string): Promise<void> {
    let next: WorkflowAdvanceInput | null = this.select(taskId);
    for (let step = 0; step < 8 && next !== null; step += 1) {
      if (reworkedTaskOf(next) === taskId) {
        throw new Error(`${label}: the Workflow proposes ${next.kind === 'perform' ? next.operation.kind : '?'} for ${taskId}, `
          + `whose work a person stopped (C8 hard limit 3)\n${this.replayText()}`);
      }
      if (next.kind === 'perform' && next.operation.kind === 'start') break;
      const value: AdvanceValue | null = await this.perform(next, `${label}: advance ${taskId} #${step}`);
      if (value === null || value.state !== 'advance') {
        this.counts.add(`no-rework-drive:${value?.state ?? 'refused'}`);
        return;
      }
      next = value.next;
    }
  }

  /**
   * Guard 9 (§3.3 PLAN-05 守卫 9, LA-3; §11.11 "新的 active 载体"): a person pauses the selected Run of every active
   * work carrier of the obligation (a carrier without a Run is claimed first through the Workflow; one whose Run ended
   * unfenced makes the cycle inapplicable), then the automation adopts a W16 that only adds a carrier: refused
   * `forbidden`, nothing written (judged in `opW16`). Then a person resumes the paused Runs now and then.
   */
  private async opGuard9Cycle(): Promise<void> {
    const plan = this.activePlan();
    if (plan === null) return;
    const goalId = AG2B_GOAL_REF.goalId;
    const work = new Set(plan.tasks.filter((task) => task.taskKind === 'work' && task.disposition === 'active').map((task) => task.taskId));
    const carriers = [...new Set(plan.obligations.flatMap((obligation) => obligation.taskIds))].filter((taskId) => work.has(taskId));
    const paused: RunRef[] = [];
    for (const taskId of carriers) {
      if (carrierFence(this.world(), goalId, taskId) !== 'none') continue;
      const selected = (): RunSnapshot | undefined => {
        const ref = this.world().taskStates.find((state) => state.taskId === taskId)?.selectedRunRef ?? null;
        return ref === null ? undefined : this.world().runs.find((run) => run.ref.runId === ref.runId);
      };
      if (selected() === undefined && await this.advanceTo(taskId, 'start') === null) {
        this.counts.add('guard9-cycle:not-claimed');
        return;
      }
      const run = selected();
      if (run === undefined || run.status === 'ended') {
        this.counts.add('guard9-cycle:carrier-ended');
        return;
      }
      await this.submitControl(run.ref, 'pause', 'guard 9: a person stops this carrier');
      if (carrierFence(this.world(), goalId, taskId) === 'none') {
        this.counts.add('guard9-cycle:not-fenced');
        return;
      }
      paused.push(run.ref);
    }
    this.counts.add('guard9-cycle:all-fenced');
    this.record(`guard 9 cycle: every active carrier (${carriers.join(', ')}) is fenced; the automation adds a carrier`);
    await this.opW16({ cls: 'system' });
    for (const ref of paused) await this.submitControl(ref, 'resume', 'guard 9: a person resumes this carrier');
  }

  /**
   * §11.11 "Goal 的取消": a person cancels the Goal three operations before the end, during a Turn when a work Task can
   * start (so the cancel's fan-out lands on an entered Run), else at once; a Goal completed for its active Plan is first
   * given a new carrier by a person's W16 (a completed Goal has no work to stop). Then a person's requeue is `busy`, the
   * Workflow claims nothing, and a person's W16 is `invalid` (S17), each writing nothing.
   */
  private async opGoalCancel(): Promise<void> {
    if (this.world().goalPhases.some((phase) => phase.phase === 'COMPLETED' && phase.planRef.planId === this.activePlan()?.ref.planId)) {
      await this.opW16({ cls: 'human' });
    }
    const reached = this.world().goals[0]?.desiredState === 'active' ? await this.reach('start') : null;
    if (reached !== null) {
      const runRef = HostFuzz.runOf(reached.input);
      this.performed.push(structuredClone(reached.input));
      this.record(`Goal cancel during the Turn of Run ${runRef?.runId ?? '?'} (${reached.taskId})`);
      this.turn = { runRef, taskId: reached.taskId, calls: 0, mode: 'goal-cancel' };
      try {
        await this.advanceCall(reached.input, 'Goal cancel start');
      } finally {
        this.turn = null;
      }
    }
    if (this.world().goals[0]?.desiredState !== 'cancelled') {
      this.record('Goal cancel (operator)');
      await this.goalControl('cancel', 'operator cancel');
    }
    if (this.world().goals[0]?.desiredState !== 'cancelled') {
      this.counts.add('goal-cancel:not-cancelled');
      return;
    }
    this.counts.add(`goal-cancel:cancelled${reached === null ? '' : ':in-Turn'}`);
    const world = this.world();
    const ended = world.runs.filter((run) => run.status === 'ended');
    if (ended.length > 0) {
      // Every rework needs an active Goal (§4.3 step 4: `busy`, "resume the Goal first"); a request short of that step
      // is refused for its own reason. Either way nothing is written (`quietRefusal`).
      const target = this.rng.pick(ended);
      const reaches = requeueReachesFence({ ...world, goals: world.goals.map((goal) => ({ ...goal, desiredState: 'active' as const })) }, target);
      const outcome = await this.opRequeue('human', '  ', target);
      this.counts.add(`goal-cancel:requeue:${outcome}`);
      if (!outcome.startsWith('rejected:') || (reaches && outcome !== 'rejected:busy')) {
        throw new Error(`a person's requeue on a cancelled Goal must be refused${reaches ? ' busy' : ''}, got ${outcome}\n${this.replayText()}`);
      }
    }
    const claims = this.world().events.filter((event) => event.eventType === 'TaskClaimed').length;
    await this.driveWithoutClaim('after the Goal cancel');
    if (this.world().events.filter((event) => event.eventType === 'TaskClaimed').length !== claims) {
      throw new Error(`a Task was claimed on a cancelled Goal\n${this.replayText()}`);
    }
    const outcome = await this.opW16({ cls: 'human' });
    this.counts.add(`goal-cancel:w16:${outcome}`);
    if (outcome !== 'rejected:invalid' && outcome !== 'proposal:rejected:invalid') {
      throw new Error(`S17: a W16 on a cancelled Goal must be invalid, got ${outcome}\n${this.replayText()}`);
    }
  }

  /** Drives the Workflow from the Goal level (at most four steps) and fails when it proposes a claim or a start. */
  private async driveWithoutClaim(label: string): Promise<void> {
    let next: WorkflowAdvanceInput | null = this.select(undefined);
    for (let step = 0; step < 4 && next !== null; step += 1) {
      if (next.kind === 'perform' && (next.operation.kind === 'claim_task' || next.operation.kind === 'start')) {
        throw new Error(`${label}: the Workflow proposes ${next.operation.kind} on a cancelled Goal\n${this.replayText()}`);
      }
      const value: AdvanceValue | null = await this.perform(next, `${label}: advance #${step}`);
      if (value === null || value.state !== 'advance') {
        this.counts.add(`goal-cancel:workflow:${value?.state ?? 'refused'}`);
        return;
      }
      next = value.next;
    }
  }

  /**
   * The Goal fan-out cycle (G-04, GOAL-29; A7-G4): the Goal is paused while a Turn runs, so the fan-out pause lands at
   * the Turn's next safe point; the Host restarts (the Run ends paused-interrupted, RUN-24); a person's 继续 or the
   * automation's requeue may come while the Goal is paused (`busy` / `forbidden`); the person resumes the Goal and the
   * fan-out continues the Task (GOAL-29). Each step is its own commit and its own check.
   */
  private async opFanOutCycle(): Promise<void> {
    const reached = await this.reach('start');
    if (reached === null) {
      this.counts.add('fan-out-cycle:no-start');
      return;
    }
    const { input: start, taskId } = reached;
    const runRef = HostFuzz.runOf(start);
    this.performed.push(structuredClone(start));
    this.record(`fan-out cycle ${taskId}: the Goal is paused during the Turn of Run ${runRef?.runId ?? '?'}`);
    this.turn = { runRef, taskId, calls: 0, mode: 'goal-pause' };
    try {
      await this.advanceCall(start, 'fan-out cycle start');
    } finally {
      this.turn = null;
    }
    if (this.world().goals[0]?.desiredState !== 'paused') return;
    this.counts.add('fan-out-cycle:paused');
    await this.restart(this.rng.chance(0.5), 'fan-out cycle restart');
    const run = runRef === null ? undefined : this.world().runs.find((candidate) => candidate.ref.runId === runRef.runId);
    if (run !== undefined && run.status === 'ended') {
      if (this.rng.chance(0.5)) await this.opRequeue('human', '  ', run);
      if (this.rng.chance(0.4)) await this.opRequeue('system', '  ', run);
    }
    if (this.world().goals[0]?.desiredState !== 'paused') return;
    const ended = run === undefined ? undefined : this.world().runs.find((candidate) => candidate.ref.runId === run.ref.runId);
    if (ended?.status === 'ended' && this.rng.chance(0.5)) {
      // The person's resume through the owner alone (GOAL-05; no fan-out runs), then the GOAL-29 continuation forged
      // as the fan-out actor, with the right epochs or wrong ones (TASK-27; `opRequeue`).
      await this.ownerGoalResume();
      const fresh = this.world().runs.find((candidate) => candidate.ref.runId === ended.ref.runId) ?? ended;
      await this.opRequeue('system', '  ', fresh, true);
      return;
    }
    this.record('fan-out cycle: Goal resume (operator)');
    await this.goalControl('resume', 'operator resume (fan-out cycle)');
    await this.settle('the Goal resume fan-out');
    await this.gate.check('fan-out cycle settled');
  }

  /** A person resumes the Goal through its owner alone (`goals.setGoalControl` with the Host actor): GOAL-05 commits and no fan-out runs. */
  private async ownerGoalResume(): Promise<void> {
    const world = this.world();
    const goal = world.goals[0]!;
    const direct = await this.h.direct();
    const answer = await this.quietRefusal('owner Goal resume', () => direct.goals.setGoalControl(hostCtx(this.h.stepActor()), {
      meta: { requestId: this.requestId('goal-resume-owner'),
        expected: [{ ref: AG2B_GOAL_REF, revision: goal.revision }, goalPhasePinIn(world, AG2B_GOAL_REF)] },
      input: { goalRef: AG2B_GOAL_REF, control: 'resume', reason: 'fuzz owner resume (no fan-out)' } }));
    this.counts.add(`goal:resume-owner:${outcomeOf(answer)}`);
    this.record(`  Goal resume through the owner (no fan-out): ${outcomeOf(answer)}${reasonOf(answer)}`);
    await this.gate.check('owner Goal resume');
  }

  /** Every required work Task of the active Plan is satisfied (or carries no work) and the gate is not: the gate check comes next. */
  private gateIsNext(): boolean {
    const world = this.world();
    const plan = this.activePlan(world);
    if (plan === null) return false;
    const phase = (taskId: string): string | null => world.taskStates.find((state) => state.taskId === taskId)?.phase ?? null;
    const required = plan.tasks.filter((task) => task.requirementLevel === 'required'
      && task.disposition !== 'cancelled' && task.disposition !== 'superseded');
    const work = required.filter((task) => task.taskKind === 'work');
    return work.length > 0 && work.every((task) => phase(task.taskId) === 'satisfied')
      && required.some((task) => task.taskKind === 'gate' && phase(task.taskId) !== 'satisfied');
  }

  /**
   * The gate path (C5, GV-*): with the required work satisfied, the result file is made wrong, so the gate's check FAILs
   * and the automation's `reverify_round{onlyIfSourceChanged}` is refused `source_unchanged` (or reverifies, when the
   * source moved); then a person or the automation reverifies the gate head, now and then after the file is right again
   * (VR-14 on the gate chain anchored on its producer Run).
   */
  private async opGateCycle(): Promise<void> {
    await writeFile(join(this.h.root, AG2B_RESULT_FILE), `not the result (gate cycle ${this.operation})\n`);
    this.record('gate cycle: the result file is wrong before the gate check');
    let next: WorkflowAdvanceInput | null = this.select(undefined);
    for (let step = 0; step < 8 && next !== null; step += 1) {
      const value: AdvanceValue | null = await this.perform(next, `gate cycle #${step}`);
      if (value === null || value.state !== 'advance') break;
      next = value.next;
    }
    const head = this.reverifiableHeads().find((round) => round.identity.scope.gateSubject !== undefined) ?? null;
    if (head === null) {
      this.counts.add('gate-cycle:no-gate-head');
      return;
    }
    this.counts.add('gate-cycle:gate-head');
    if (this.rng.chance(0.5)) {
      await writeFile(join(this.h.root, AG2B_RESULT_FILE), `${AG2B_RESULT_TEXT}\n`);
      this.record('  the result file is right again');
    }
    await this.opReverify(this.rng.chance(0.6) ? 'human' : 'system', '  ', head);
  }

  /**
   * The Kernel store is lost with a crashed Host while a Run is entered (W-14): its files are moved aside, the Host is
   * abandoned and the next start finds no Kernel (RUN-20, `outcome_unknown`; the Session stays held). A new Kernel
   * store is created for the work after it; `opAttest` resolves the unknown ends (RUN-22).
   */
  private async opKernelLost(): Promise<void> {
    const entered = this.world().runs.filter((run) => run.status === 'running');
    if (entered.length === 0) {
      this.counts.add('kernel-lost:no-entered-run');
      return;
    }
    await moveKernelAside(this.h.database);
    this.counts.add('kernel-lost');
    this.record(`Kernel store lost with entered Run(s) ${entered.map((run) => run.ref.runId).join(', ')}`);
    await this.restart(true, 'Kernel store lost');
  }

  /** RUN-22: a person attests the end of an `outcome_unknown` Run (`executions/resolve-unknown`), with a blank reason now and then. */
  private async opAttest(): Promise<void> {
    const unknown = this.world().runs.filter((run) => run.outcome === 'outcome_unknown');
    if (unknown.length === 0) return;
    const run = this.rng.pick(unknown);
    const reason = this.rng.chance(0.15) ? '   ' : 'fuzz: checked the workspace by hand';
    const answer = await this.quietRefusal('attestation', () => this.h.answer('executions/resolve-unknown', graphWrite(AG2B_SCOPE, { runRef: run.ref, reason },
      this.requestId('attest'), [{ ref: run.ref, revision: run.revision }])));
    const outcome = outcomeOf(answer);
    this.counts.add(`attest:${outcome}`);
    this.record(`attest the end of Run ${run.ref.runId}${reason.trim() === '' ? ' (blank reason)' : ''}: ${outcome}${reasonOf(answer)}`);
    await this.gate.check('attestation', ownerStep('other', this.h.stepActor(), this.policy(), 'attestation'));
  }

  /**
   * W-02 / W-03: the Workflow's `start` is sent through another composition root and stopped right after the entry
   * authorization commit (RUN-02), before the begin: the Run is Authorized and never reaches the Kernel. A restart may
   * follow; the start-up re-drive or the next advance re-authorizes or begins it from the persisted binding (I-19).
   * A requeued Task with no Run yet goes first, so the sequence is §11.11's last item: requeue → claim → prepare →
   * authorize (the continuation brief bound) → restart → re-drive.
   */
  private async opAuthorizeOnly(): Promise<void> {
    const reached = await this.reach('start', this.requeuedTaskIds());
    if (reached === null || reached.input.operation.kind !== 'start') {
      this.counts.add('authorize-only:no-start');
      return;
    }
    const request = reached.input.operation.request;
    const { answer } = await authorizeWithoutBegin(this.h, request.prepared, request.requestId,
      { consumerId: request.consumerId, policy: this.policy() });
    this.record(`authorize-only ${reached.taskId}: start stopped after the authorization: ${outcomeOf(answer)}${reasonOf(answer)}`);
    const world = await this.gate.check('authorized, not begun', ownerStep('entry_authorized', this.h.stepActor(), this.policy(), 'authorize-only'));
    const run = world.runs.filter((candidate) => candidate.task.taskId === reached.taskId).at(-1);
    const brief = run?.requeueRef !== undefined && run.inputBinding?.continuationBriefDigest !== undefined;
    this.counts.add(`authorize-only:${outcomeOf(answer)}${brief ? ':brief-bound' : ''}`);
    if (brief) this.record(`  the authorized Run ${run.ref.runId} is the requeue's: its continuation brief is bound`);
    // With the brief bound the restart and the start-up re-drive always follow (the same draws are made).
    if (this.rng.chance(0.6) || brief) {
      const redrives = this.counts.byKey.get('redrive:started') ?? 0;
      await this.restart(this.rng.chance(0.5), 'restart after an authorization', undefined, brief ? 'auto' : undefined);
      if (brief) this.counts.add(`brief-sequence:restarted${(this.counts.byKey.get('redrive:started') ?? 0) > redrives ? ':redriven' : ''}`);
    }
  }

  /** The Tasks whose latest Run a TaskRequeue covers (the requeue's Run is not claimed yet). */
  private requeuedTaskIds(): Set<string> {
    const world = this.world();
    const latest = new Map<string, string>();
    for (const run of world.runs) latest.set(run.task.taskId, run.ref.runId);
    return new Set(world.requeues.filter((requeue) => latest.get(requeue.task.taskId) === requeue.afterRunRef.runId)
      .map((requeue) => requeue.task.taskId));
  }

  /**
   * §12.1: stops the Host (a clean close, or a crash that abandons it) and starts a new one on the same files with
   * `resumeOnStartup` chosen at random (unless given; drawn either way); checks the store after the reconcile, after
   * the abandoned Host is drained, and after the start-up re-drive settled (LA-6).
   */
  private async restart(crash: boolean, label: string, beforeDrain?: () => Promise<void>,
    resumeOnStartup?: ResumeOnStartupMode): Promise<void> {
    const drawn = this.rng.weighted([[0, 'auto'], [0.5, 'ask'], [0.5, 'off']] as const);
    const automation: TaskAutomationPolicyV1 = { ...this.policy(), resumeOnStartup: resumeOnStartup ?? drawn };
    await this.closeAgentPlatform();
    this.crashing = crash;
    let report: Awaited<ReturnType<HostScenario['restart']>>;
    const started = performance.now();
    try {
      // LA-4: now and then the restart registers the other (equivalent) check command, a new configuration revision.
      const check = this.rng.chance(0.25) ? (this.checkCommand === FUZZ_CHECK_COMMAND ? FUZZ_CHECK_COMMAND_ALT : FUZZ_CHECK_COMMAND) : this.checkCommand;
      // The refusals written so far predate this configuration (ND-8 staleness, `mechanicalRetry`).
      for (const refusal of this.world().refusals) if (!this.refusalsSeenAt.has(refusalKey(refusal))) this.refusalsSeenAt.set(refusalKey(refusal), this.configurationChanges);
      if (check !== this.checkCommand) {
        this.counts.add('restart:check-configuration-changed');
        this.configurationChanges += 1;
      }
      this.checkCommand = check;
      report = await this.h.restart({ crash, automation, invariants: false, check: { command: check } });
    } finally {
      this.crashing = false;
    }
    this.timings.add('restart:host', Math.round(performance.now() - started));
    const runs = report.report?.runs ?? [];
    const checks = report.report?.checks ?? [];
    this.counts.add(`restart:${crash ? 'crash' : 'clean'}:${report.leaseRow}`);
    for (const row of runs) this.counts.add(`reconcile:run:${row.row}:${row.status}`);
    for (const row of checks) this.counts.add(`reconcile:check:${JSON.stringify((row as { row?: unknown }).row ?? 'row')}`);
    this.record(`${label}: ${crash ? 'crash' : 'clean'} restart (${report.leaseRow}), resumeOnStartup ${String(automation.resumeOnStartup)}, `
      + `runs [${runs.map((row) => `${row.row}/${row.status}`).join(', ')}], checks ${checks.length}, re-drive ${report.report?.redriveGoals.length ?? 0}`);
    await this.gate.check(`${label}: after the reconcile`);
    if (crash) {
      await beforeDrain?.();
      const draining = performance.now();
      await this.h.drainAbandoned();
      this.timings.add('restart:drain', Math.round(performance.now() - draining));
      await this.gate.check(`${label}: abandoned Host drained`);
    }
    if (automation.resumeOnStartup === 'auto' && (report.report?.redriveGoals.length ?? 0) + (report.report?.interruptedGoals.length ?? 0) > 0) {
      this.counts.add('redrive:started');
      const settling = performance.now();
      await this.settle('the start-up re-drive');
      this.timings.add('restart:settle', Math.round(performance.now() - settling));
      await this.gate.check(`${label}: re-drive settled`);
    }
  }

  /**
   * Waits for background work to stop (the start-up re-drive's collaboration driver, a Goal resume's re-entry): the
   * driver not running and the ledger, Kernel and model counts unchanged over two reads 150 ms apart. A driver left
   * waiting for a reply is stopped (it only waits on).
   */
  private async settle(what: string): Promise<void> {
    const previous = this.turn;
    this.turn = { runRef: null, taskId: null, calls: 0, mode: 'quiet' };
    try {
      let last = '';
      for (let poll = 0; poll < 160; poll += 1) {
        await sleep(150);
        const counts = this.h.counts();
        const driver = await this.h.answer('workflow/driver-read', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
        const state = (driver['value'] as { state?: string } | undefined)?.state ?? String(driver['status']);
        const now = `${counts.ledgerEvents}/${counts.modelCalls}/${counts.kernelRecords}/${state}`;
        if (now === last && state !== 'running' && state !== 'stopping') {
          if (state === 'waiting_for_reply') {
            await this.h.answer('workflow/driver-stop', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
            this.counts.add('settle:stopped-waiting-for-reply');
            last = '';
            continue;
          }
          this.record(`  settled: ${what} (driver ${state})`);
          return;
        }
        last = now;
      }
      throw new Error(`fuzz: ${what} did not settle\n${this.replayText()}`);
    } finally {
      this.turn = previous;
    }
  }

  // -------------------------------------------------------------------------
  // Run controls
  // -------------------------------------------------------------------------

  /**
   * Sends one owner write. A refusal out of a Turn (nothing runs in the background then) must write nothing (§11.11:
   * every refused combination commits nothing), and so must a replay of an earlier receipt: the ledger takes no
   * write (`ledgerWrites`).
   */
  private async quietRefusal<T>(what: string, write: () => Promise<T>): Promise<T> {
    const quiet = this.turn === null;
    const ledger = join(this.h.database, 'ledger.sqlite');
    const before = quiet ? ledgerWrites(ledger) : 0;
    const answer = await write();
    const outcome = outcomeOf(answer);
    if (quiet && (outcome.startsWith('rejected:') || outcome.endsWith(':replayed'))) {
      const written = ledgerWrites(ledger) - before;
      if (written !== 0) throw new Error(`${what}: ${outcome}${reasonOf(answer)} yet ${written} ledger write(s) were made\n${this.replayText()}`);
      this.counts.add(`zero-write-refusal:checked`);
    }
    return answer;
  }

  private async submitControl(runRef: RunRef, kind: ControlIntentKindV1, what: string): Promise<Answer> {
    const run = this.world().runs.find((candidate) => candidate.ref.runId === runRef.runId);
    const answer = await this.quietRefusal(`control ${kind}`, () => this.h.answer('controls/submit', graphWrite(AG2B_SCOPE, { runRef, kind, reason: `fuzz ${what}` },
      this.requestId(`control-${kind}`), run === undefined ? [] : [{ ref: runRef, revision: run.revision }])));
    const outcome = outcomeOf(answer);
    this.counts.add(`control:${kind}:${outcome}`);
    this.record(`  control ${kind} on Run ${runRef.runId}: ${outcome}${reasonOf(answer)}`);
    await this.gate.check(`control ${kind} ${outcome}`);
    return answer;
  }

  /** A pause, resume, cancel or steer of a Run (claimed, entered, paused at a safe point, yielded or ended), delivered and re-entered as the workbench does. */
  private async opRunControl(): Promise<void> {
    const world = this.world();
    const live = world.runs.filter((run) => run.status !== 'ended' || run.outcome === 'yielded');
    const pool = live.length > 0 && this.rng.chance(0.85) ? live : world.runs;
    if (pool.length === 0) return;
    const run = this.rng.pick(pool);
    // A Run whose pointer is a pause is resumed most of the time (else a resume is only ever refused).
    const kind = run.controlState?.desiredState === 'paused' && this.rng.chance(0.6) ? 'resume' as const
      : this.rng.pick<ControlIntentKindV1>(['pause', 'resume', 'cancel', 'steer']);
    this.record(`run-control ${kind} on Run ${run.ref.runId} (${run.status} ${String(run.outcome)})`);
    const answer = await this.submitControl(run.ref, kind, 'operator');
    if (answer['status'] !== 'committed' || run.status !== 'running' || (kind !== 'resume' && kind !== 'cancel')) return;
    const intent = ((answer['value'] ?? {}) as { intent?: { ref?: unknown; status?: string } }).intent;
    if (intent?.status !== 'queued') return;
    // A queued resume or cancel of an entered Run: deliver it, and re-enter the original Turn on a resume.
    if (this.rng.chance(0.25)) {
      this.counts.add(`deliver:${kind}:left-queued`);
      return;
    }
    const delivered = await this.h.answer('controls/deliver', plain(AG2B_SCOPE, { intentRef: intent.ref }));
    const status = ((delivered['value'] ?? {}) as { status?: string }).status ?? outcomeOf(delivered);
    this.counts.add(`deliver:${kind}:${status}`);
    this.record(`  deliver ${kind}: ${status}`);
    await this.gate.check(`deliver ${kind}`);
    if (kind === 'resume' && status === 'queued') await this.reenter(run.ref);
  }

  /** `executions/start` of an entered Run's original Turn (a person's resume re-entry), with the fuzz in the Turn. */
  private async reenter(runRef: RunRef): Promise<void> {
    const read = await this.h.answer('executions/read', plain(AG2B_SCOPE, runRef));
    if (read['status'] !== 'ready') return;
    const record = read['value'] as { run: RunSnapshot; outbox: { claim: unknown } };
    const authorization = record.run.executionAuthorization;
    if (record.run.envelope === null || record.run.inputBinding === undefined || authorization === undefined || !('consumerId' in authorization)) return;
    this.turn = { runRef, taskId: record.run.task.taskId, calls: 0, mode: 'normal' };
    try {
      const answer = await this.h.answer('executions/start', plain(AG2B_SCOPE, {
        prepared: { kind: 'task', claim: record.outbox.claim, envelope: record.run.envelope, inputBinding: record.run.inputBinding },
        consumerId: authorization.consumerId, requestId: this.requestId('reenter') }));
      const run = ((answer['value'] ?? {}) as { run?: { status?: string; outcome?: string | null } }).run;
      this.counts.add(`reenter:${outcomeOf(answer)}`);
      this.record(`  re-enter Run ${runRef.runId}: ${outcomeOf(answer)} → ${String(run?.status)} ${String(run?.outcome)}`);
    } finally {
      this.turn = null;
    }
    await this.gate.check('re-entered Turn');
  }

  // -------------------------------------------------------------------------
  // Rework: requeue and reverify by the three operator classes
  // -------------------------------------------------------------------------

  private actorFor(cls: OperatorClass): ActorRef {
    return cls === 'human' ? { ...this.h.stepActor() } : { ...WORKFLOW_AUTOMATION_ACTOR };
  }

  /**
   * Mostly the selected ended Run of a work Task that no TaskRequeue covers yet; otherwise any ended Run (a covered or
   * stale `afterRunRef`, which the owner refuses).
   */
  private requeueTarget(): RunSnapshot | null {
    const world = this.world();
    const ended = world.runs.filter((run) => run.status === 'ended');
    if (ended.length === 0) return null;
    if (this.rng.chance(0.85)) {
      const selected = world.taskStates.filter((state) => state.taskKind === 'work' && state.selectedRunRef !== null
        && state.coveringRequeueRef === null)
        .map((state) => world.runs.find((run) => run.ref.runId === state.selectedRunRef!.runId))
        .filter((run): run is RunSnapshot => run !== undefined && run.status === 'ended');
      if (selected.length > 0) return this.rng.pick(selected);
    }
    return this.rng.pick(ended);
  }

  /**
   * The Goal-resume trigger the fuzz forges as `GOAL_FAN_OUT_ACTOR` (TASK-27, GOAL-29): well formed, naming the Goal's
   * current resume epoch and the epoch of the target's fan-out pause (`right`), a resume epoch that moved on
   * (`stale-resume`, refused `revision_conflict`), or another pause epoch (`wrong-pause`, refused `invalid`). A target
   * that no fan-out pause stopped takes the epoch before the current one.
   */
  private forgedTrigger(target: RunSnapshot): { trigger: TaskRequeueTriggerV1; variant: 'right' | 'stale-resume' | 'wrong-pause' } {
    const world = this.world();
    const resumedEpoch = world.goals[0]!.desiredStateRevision ?? 1;
    const pausedEpoch = fanOutPauseEpoch(pointerIntentIn(world, target)) ?? Math.max(1, resumedEpoch - 1);
    const variant = this.rng.weighted<'right' | 'stale-resume' | 'wrong-pause'>([[3, 'right'], [1, 'stale-resume'], [1, 'wrong-pause']]);
    return { variant, trigger: { kind: 'goal_resume', goalRef: { ...AG2B_GOAL_REF },
      resumedEpoch: variant === 'stale-resume' ? resumedEpoch - 1 : resumedEpoch, pausedEpoch: variant === 'wrong-pause' ? pausedEpoch + 1 : pausedEpoch } };
  }

  /**
   * A requeue by a person (`tasks/requeue`) or the automation (`claims.requeueTask` as `WORKFLOW_AUTOMATION_ACTOR`,
   * pinned to the refusal record most of the time, as the Workflow pins it), with a note or a larger budget now and
   * then; one in seven automation requests (every one with `forge`) is the GOAL-29 continuation forged as
   * `GOAL_FAN_OUT_ACTOR` (`forgedTrigger`). Out of a Turn the answer is judged: the human-stop fence (`fenceProblem`),
   * the fan-out actor on a Run no fan-out pause stopped (`forbidden`, TASK-27), and the forged trigger's epochs on a
   * fan-out-paused Run (the right ones continue it, a moved resume epoch is `revision_conflict`, another pause epoch `invalid`).
   */
  private async opRequeue(cls: OperatorClass, indent = '', explicit: RunSnapshot | null = null, forge = false): Promise<string> {
    const target = explicit ?? this.requeueTarget();
    if (target === null) return 'no-target';
    const world = this.world();
    const goal = world.goals[0]!;
    const extras: Record<string, unknown> = {};
    if (cls === 'human' && this.rng.chance(0.25)) extras['note'] = `fuzz note ${this.sequence}: the check output says the result file is missing`;
    const message = world.messages.find((candidate) => candidate.status === 'responded');
    if (message !== undefined && this.rng.chance(0.15)) extras['newInputRefs'] = [{ kind: 'session_message', ref: message.ref }];
    if (this.rng.chance(0.2)) extras['budget'] = { tokenBudget: target.budget.tokenBudget * 2, deadline: target.budget.deadline };
    const forged = cls === 'system' && (this.rng.chance(0.15) || forge);
    const forgery = forged ? this.forgedTrigger(target) : null;
    if (forgery !== null) extras['trigger'] = forgery.trigger;
    const fence = fenceIn(world, target);
    const reaches = this.turn === null && requeueReachesFence(world, target);
    const fanOutPaused = isPausedInterrupted(target) && fanOutPauseEpoch(pointerIntentIn(world, target)) !== null;
    const refusal = world.refusals.find((candidate) => candidate.ref.operation === 'requeue' && candidate.ref.subjectId === target.ref.runId);
    const expected = [{ ref: AG2B_GOAL_REF, revision: goal.revision }, { ref: target.ref, revision: target.revision },
      ...(cls === 'system' && this.rng.chance(0.7) ? [{ ref: { aggregateType: 'TaskReworkRefusal', projectId: AG2B_SCOPE.projectId,
        goalId: AG2B_GOAL_REF.goalId, taskId: target.task.taskId, operation: 'requeue', subjectId: target.ref.runId },
      revision: refusal?.revision ?? 0 }] : [])];
    const request = { input: { taskRef: { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: target.task.taskId },
      afterRunRef: target.ref, reason: `fuzz ${cls} requeue`, ...extras }, meta: { requestId: this.requestId(`requeue-${cls}`), expected } };
    const actor: ActorRef = forged ? { ...GOAL_FAN_OUT_ACTOR } : this.actorFor(cls);
    const direct = cls === 'human' ? null : await this.h.direct();
    const answer = await this.quietRefusal(`${cls} requeue`, async () => direct === null
      ? await this.h.answer('tasks/requeue', { scope: AG2B_SCOPE, request })
      : await direct.claims.requeueTask!(hostCtx(actor as Extract<ActorRef, { kind: 'human' | 'system' }>), request as never));
    const outcome = outcomeOf(answer);
    const who = forgery !== null ? `fan-out (forged ${forgery.variant} trigger)` : cls;
    const label = `${who} requeue of Run ${target.ref.runId} (${target.task.taskId}, ${String(target.outcome)}, fence ${fence})`
      + `${Object.keys(extras).length > 0 ? ` +${Object.keys(extras).join('+')}` : ''}`;
    this.counts.add(`requeue:${forged ? 'fan-out-forged' : cls}:${outcome}`);
    if (outcome === 'rejected:forbidden') this.counts.add(`forbidden:requeue:${cls}:${forbiddenKind(answer)}`);
    if (fence !== 'none') this.counts.add(`fence:requeue:${forged ? 'fan-out-forged' : cls}:${fence}:${outcome}`);
    this.record(`${indent}${label}: ${outcome}${reasonOf(answer)}`);
    const problem = this.turn !== null ? null : forgery !== null ? this.forgeryProblem(forgery.variant, fence, fanOutPaused, reaches, answer)
      : fenceProblem({ cls, fence, continuation: false, reachesFence: reaches, answer });
    if (problem !== null) throw new Error(`${label}: ${problem}\n${this.replayText()}`);
    const kind = reworkStepKind(answer, 'task_requeued');
    await this.gate.check(label, kind === null ? undefined : ownerStep(kind, actor, this.policy(), label));
    return outcome;
  }

  /**
   * The forged GOAL-29 continuation (`GOAL_FAN_OUT_ACTOR` with a well-formed `goal_resume` trigger) where the request
   * reaches the actor × class matrix: on a Run a person stopped the fence refuses it, on any Run no fan-out pause
   * stopped the fan-out actor is refused (TASK-27), both `forbidden`; on a fan-out-paused Run the trigger's epochs
   * decide (TASK-27, GOAL-29): the right ones continue it, a moved resume epoch is `revision_conflict`, another pause
   * epoch `invalid`. Anything short of the matrix commits nothing.
   */
  private forgeryProblem(variant: 'right' | 'stale-resume' | 'wrong-pause', fence: ReworkFence, fanOutPaused: boolean,
    reaches: boolean, answer: unknown): string | null {
    const outcome = outcomeOf(answer);
    this.counts.add(`forged:${variant}:${fanOutPaused ? 'fan-out-paused' : `fence-${fence}`}:${outcome}`);
    if (!fanOutPaused) {
      if (!outcome.startsWith('rejected:')) return `the fan-out actor continued a Run no fan-out pause stopped (fence ${fence}): ${outcome}`;
      return reaches && outcome !== 'rejected:forbidden' ? `the fan-out actor on a Run no fan-out pause stopped must be forbidden, got ${outcome}` : null;
    }
    if (!reaches) return outcome.startsWith('rejected:') ? null : `a forged continuation short of the matrix committed: ${outcome}`;
    const expected = variant === 'right' ? 'committed' : variant === 'stale-resume' ? 'rejected:revision_conflict' : 'rejected:invalid';
    return outcome === expected ? null : `a forged ${variant} continuation of a fan-out-paused Run must answer ${expected}, got ${outcome}${reasonOf(answer)}`;
  }

  /** An Agent requeue out of a Turn: the identity of a Run (ended, or claimed and not entered) is refused before any write. */
  private async opAgentRequeue(): Promise<void> {
    const runs = this.world().runs;
    if (runs.length === 0) return;
    await this.agentRequeue(this.rng.pick(runs).ref, '');
  }

  /**
   * An Agent's requeue: the Run `writer` (the entered one inside a Turn) asks through the delegated-write admission of a
   * composition root with the Host's Runtime grant. That grant has no `requeue_task` (GAP-46), so the answer is a refusal
   * with nothing written; the committed Agent requeue is the agent-grant world's (tests/state/invariants-fuzz.test.ts).
   */
  private async agentRequeue(writer: RunRef, indent: string, explicit: RunSnapshot | null = null): Promise<void> {
    const target = explicit ?? this.requeueTarget();
    if (target === null) return;
    const goal = this.world().goals[0]!;
    const fence = fenceIn(this.world(), target);
    const platform = await this.agentPlatform();
    const answer = await this.quietRefusal('agent requeue', () => platform.claims.requeueTask!(workRunCtx(writer), { input: { taskRef: { projectId: AG2B_SCOPE.projectId,
      goalId: AG2B_GOAL_REF.goalId, taskId: target.task.taskId }, afterRunRef: target.ref, reason: 'fuzz agent requeue' },
    meta: { requestId: this.requestId('requeue-agent'), expected: [{ ref: AG2B_GOAL_REF, revision: goal.revision },
      { ref: target.ref, revision: target.revision }] } }));
    const outcome = outcomeOf(answer);
    this.counts.add(`requeue:agent:${outcome}`);
    if (outcome === 'rejected:forbidden') this.counts.add(`forbidden:requeue:agent:${forbiddenKind(answer)}`);
    if (fence !== 'none') this.counts.add(`fence:requeue:agent:${fence}:${outcome}`);
    this.record(`${indent}agent (Run ${writer.runId}) requeue of Run ${target.ref.runId} (fence ${fence}): ${outcome}`
      + `${answer.status === 'rejected' ? ` (${answer.reason.slice(0, 80)})` : ''}`);
    // The Host grant refuses every Agent first (GAP-46), so only the commit-nothing half of the fence is asserted here.
    const problem = this.turn !== null ? null : fenceProblem({ cls: 'agent', fence, continuation: false, reachesFence: false, answer });
    if (problem !== null) throw new Error(`agent requeue of Run ${target.ref.runId}: ${problem}\n${this.replayText()}`);
    const kind = reworkStepKind(answer, 'task_requeued');
    await this.gate.check('agent requeue', kind === null ? undefined
      : ownerStep(kind, { kind: 'agent', id: `run:${writer.runId}`, runRef: writer }, this.policy(), 'agent requeue'));
  }

  /** The chain heads a reverify may name: every finalized non-PASS head (work and gate chains). */
  private reverifiableHeads(): RoundSnapshot[] {
    const chains = new Map<string, RoundSnapshot[]>();
    for (const round of this.world().rounds) {
      const key = round.identity.scope.gateSubject !== undefined ? `gate:${round.ref.taskId}` : `work:${round.ref.taskId}:${round.ref.runId}`;
      chains.set(key, [...(chains.get(key) ?? []), round]);
    }
    const heads: RoundSnapshot[] = [];
    for (const chain of chains.values()) {
      const head = roundChainHead(chain);
      if (head.kind === 'head' && isFinalizedNonPass(head.head)) heads.push(head.head);
    }
    return heads;
  }

  /** The heads a reverify can still grow: gate heads, and work heads whose subject Run no TaskRequeue covers (VR-09). */
  private openHeads(heads: readonly RoundSnapshot[]): RoundSnapshot[] {
    const requeues = this.world().requeues;
    return heads.filter((head) => head.identity.scope.gateSubject !== undefined
      || !requeues.some((requeue) => requeue.afterRunRef.runId === head.subjectRunRef.runId));
  }

  /** A reverify by a person (`verification/reverify`) or the automation (`evidence.reverifyRound`), with or without a note or a source condition. */
  private async opReverify(cls: OperatorClass, indent = '', explicit: RoundSnapshot | null = null): Promise<void> {
    const heads = this.reverifiableHeads();
    const world = this.world();
    // Mostly a head no TaskRequeue closed (a covered work chain no longer grows, VR-09), else any round.
    const open = this.openHeads(heads);
    const pool = open.length > 0 && this.rng.chance(0.85) ? open : heads;
    const round = explicit ?? (pool.length > 0 && this.rng.chance(0.9) ? this.rng.pick(pool) : world.rounds.length > 0 ? this.rng.pick(world.rounds) : null);
    if (round === null) return;
    const input: Record<string, unknown> = { predecessorRoundRef: round.ref, reason: `fuzz ${cls} reverify` };
    if (this.rng.chance(0.3)) input['onlyIfSourceChanged'] = true;
    const message = world.messages.find((candidate) => candidate.status === 'responded');
    if (cls === 'human' && message !== undefined && this.rng.chance(0.2)) {
      // ND-9: a responded session message as a new input of the successor's key.
      input['newInputRefs'] = [{ kind: 'session_message', ref: message.ref }];
    }
    if (cls === 'human' && this.rng.chance(0.25)) input['note'] = `fuzz reverify note ${this.sequence}`;
    const refusal = world.refusals.find((candidate) => candidate.ref.operation === 'reverify' && candidate.ref.subjectId === round.ref.roundId);
    const expected = [{ ref: round.ref, revision: round.revision },
      ...(this.rng.chance(0.6) ? [{ ref: { aggregateType: 'TaskReworkRefusal', projectId: round.ref.projectId, goalId: round.ref.goalId,
        taskId: round.ref.taskId, operation: 'reverify', subjectId: round.ref.roundId }, revision: refusal?.revision ?? 0 }] : [])];
    const request = { input, meta: { requestId: this.requestId(`reverify-${cls}`), expected } };
    const actor = this.actorFor(cls);
    // The human-stop fence of a work round is its subject Run's; a gate has none.
    const subject = world.runs.find((run) => run.ref.runId === round.subjectRunRef.runId);
    const fence: ReworkFence = round.identity.scope.gateSubject !== undefined || subject === undefined ? 'none' : fenceIn(world, subject);
    const reaches = this.turn === null && reverifyReachesFence(world, round);
    const direct = cls === 'human' ? null : await this.h.direct();
    const answer = await this.quietRefusal(`${cls} reverify`, async () => direct === null
      ? await this.h.answer('verification/reverify', { scope: AG2B_SCOPE, request })
      : await direct.evidence.reverifyRound!(hostCtx(actor as Extract<ActorRef, { kind: 'human' | 'system' }>), request as never));
    const outcome = outcomeOf(answer);
    const gate = round.identity.scope.gateSubject !== undefined ? 'gate' : 'work';
    const label = `${cls} reverify of ${gate} round ${round.ref.roundId} (${String(round.status)} ${String(round.outcome)})`
      + `${input['onlyIfSourceChanged'] === true ? ' onlyIfSourceChanged' : ''}${input['note'] === undefined ? '' : ' +note'}${input['newInputRefs'] === undefined ? '' : ' +newInputRefs'}`;
    this.counts.add(`reverify:${cls}:${gate}:${outcome}`);
    if (outcome === 'rejected:forbidden') this.counts.add(`forbidden:reverify:${cls}:${forbiddenKind(answer)}`);
    if (fence !== 'none') this.counts.add(`fence:reverify:${cls}:${fence}:${outcome}`);
    this.record(`${indent}${label}${fence === 'none' ? '' : ` (fence ${fence})`}: ${outcome}${reasonOf(answer)}`);
    const problem = this.turn !== null ? null : fenceProblem({ cls, fence, continuation: false, reachesFence: reaches, answer });
    if (problem !== null) throw new Error(`${label}: ${problem}\n${this.replayText()}`);
    const kind = reworkStepKind(answer, 'round_reverified');
    await this.gate.check(label, kind === null ? undefined : ownerStep(kind, actor, this.policy(), label));
  }

  // -------------------------------------------------------------------------
  // Settings, Plan, Goal, workspace, replies
  // -------------------------------------------------------------------------

  /** C8: `automation/save` with a random limit (0..10) and re-drive switch; later steps carry the new policy. */
  private async opCap(): Promise<void> {
    const policy: TaskAutomationPolicyV1 = { schemaVersion: 1, autoReworkLimit: this.rng.int(0, 10),
      resumeOnStartup: this.rng.weighted([[0.5, 'auto'], [0.25, 'ask'], [0.25, 'off']] as const) };
    await this.h.saveAutomation(policy);
    if (this.agentPlatformOpen !== null) (await this.agentPlatformOpen).registerAutomationPolicy(policy);
    this.counts.add('cap:saved');
    this.record(`cap: autoReworkLimit ${policy.autoReworkLimit}, resumeOnStartup ${String(policy.resumeOnStartup)}`);
  }

  /**
   * W16 by a person (the Host routes) or the automation (the owners as `WORKFLOW_AUTOMATION_ACTOR`): a disposition-only
   * change of one work Task (TASK-18/19; `superseded` adds its replacement), or a new active carrier of the obligation
   * (guard 9; always with `carrier`, which also fixes the adopter). `affectedTaskIds` is left out now and then (guard 6
   * refuses a traced change without it). A refused proposal or adoption writes nothing. Guard 9 (LA-3) is judged on
   * the checked world (`guard9Fenced`): an automatic adoption that gives an obligation a new active carrier while every
   * existing carrier is fenced commits nothing, and a carrier-only one (no disposition change, so guard 7 does not
   * decide first) on a Goal that is not cancelled is `forbidden`. Answers the adoption outcome.
   */
  private async opW16(carrier: { cls: OperatorClass } | null = null): Promise<string> {
    const world = this.world();
    const source = this.activePlan(world);
    if (source === null || source.schemaVersion !== 2) return 'no-plan';
    const cls = carrier?.cls ?? this.rng.weighted<OperatorClass>([[3, 'human'], [2, 'system']]);
    const draft = draftOf(source, `fuzz-plan-${this.options.seed}-${this.operation}-${this.sequence}`);
    const work = draft.tasks.filter((task) => task.taskKind === 'work');
    let change: string;
    let affected: string[] = [];
    if (carrier !== null || work.length === 0 || this.rng.chance(0.2)) {
      const added = `fuzz-carrier-${this.options.seed}-${this.operation}-${this.sequence}`;
      addCarrier(draft, added);
      change = `adds carrier ${added}`;
    } else {
      const task = this.rng.pick(work);
      const to = task.disposition !== 'active' && this.rng.chance(0.5) ? 'active' as const
        : this.rng.pick((['active', 'deferred', 'cancelled', 'superseded'] as const).filter((disposition) => disposition !== task.disposition));
      if (to === 'superseded') {
        const replacement = `fuzz-replacement-${this.options.seed}-${this.operation}`;
        addCarrier(draft, replacement);
        Object.assign(task, { disposition: 'superseded', replacedByTaskId: replacement });
        change = `${task.taskId} superseded by ${replacement}`;
      } else {
        const from = task.disposition;
        Object.assign(task, { disposition: to });
        delete (task as { replacedByTaskId?: string }).replacedByTaskId;
        change = `${task.taskId} ${from} → ${to}`;
      }
      affected = [task.taskId];
    }
    const listed = carrier !== null || this.rng.chance(0.85);
    const reason = { text: `fuzz W16: ${change}`, sources: [], ...(listed ? { affectedTaskIds: affected } : {}) };
    const expected = [{ ref: AG2B_GOAL_REF, revision: world.goals[0]!.revision }];
    const actor = this.actorFor(cls);
    const ctx = hostCtx(actor as Extract<ActorRef, { kind: 'human' | 'system' }>);
    const fenced = cls === 'system' && guard9Fenced(world, source, draft);
    const proposed = await this.quietRefusal(`${cls} W16 proposal`, async () => cls === 'human'
      ? await this.h.answer('plans/propose', graphWrite(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF, basedOn: source.ref, draft, reason },
        this.requestId('w16-propose'), expected))
      : await (await this.h.direct()).plans.proposePlan(ctx, { meta: { requestId: this.requestId('w16-propose'), expected },
        input: { goalRef: AG2B_GOAL_REF, basedOn: source.ref, draft, reason } }) as unknown as Answer);
    const proposal = (proposed['value'] ?? {}) as { ref?: unknown; revision?: number; issues?: unknown[] };
    if (proposed['status'] !== 'committed' || (proposal.issues ?? []).length > 0) {
      const outcome = proposed['status'] !== 'committed' ? outcomeOf(proposed) : 'issues';
      this.counts.add(`w16:${cls}:propose:${outcome}`);
      this.record(`W16 ${cls} ${change}: proposal ${outcome} ${JSON.stringify(proposal.issues ?? proposed['reason'] ?? '').slice(0, 140)}`);
      await this.gate.check(`W16 proposal ${outcome}`);
      return `proposal:${outcome}`;
    }
    const apply = { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] };
    const direct = cls === 'human' ? null : await this.h.direct();
    const applied = await this.quietRefusal(`${cls} W16`, async () => direct === null
      ? await this.h.answer('plans/apply', graphWrite(AG2B_SCOPE, apply, this.requestId('w16-apply'), expected))
      : await direct.plans.applyPlanChange(ctx, { meta: { requestId: this.requestId('w16-apply'), expected },
        input: apply } as never) as unknown as Answer);
    const outcome = outcomeOf(applied);
    this.counts.add(`w16:${cls}:${affected.length > 0 ? 'disposition' : 'carrier'}:${outcome}`);
    if (fenced) this.counts.add(`guard9:${cls}:${affected.length > 0 ? 'with-disposition' : 'carrier-only'}:${outcome}`);
    this.record(`W16 ${cls} ${change}${listed ? '' : ' (affectedTaskIds left out)'}${fenced ? ' (every existing carrier fenced)' : ''}: ${outcome}`
      + `${applied['status'] === 'committed' ? '' : ` ${String(applied['reason'] ?? '').slice(0, 140)}`}`);
    if (fenced && !outcome.startsWith('rejected:')) {
      throw new Error(`guard 9: the automation's W16 (${change}) committed while every existing carrier is fenced: ${outcome}\n${this.replayText()}`);
    }
    if (fenced && affected.length === 0 && world.goals[0]!.desiredState !== 'cancelled' && outcome !== 'rejected:forbidden') {
      throw new Error(`guard 9: the automation's carrier-only W16 must be forbidden, got ${outcome}${reasonOf(applied)}\n${this.replayText()}`);
    }
    await this.gate.check(`W16 ${outcome}`, applied['status'] === 'committed' ? ownerStep('plan_adopted', actor, this.policy(), 'W16') : undefined);
    return outcome;
  }

  private async goalControl(control: 'pause' | 'resume' | 'cancel', what: string): Promise<Answer> {
    const world = this.world();
    const goal = world.goals[0]!;
    const answer = await this.quietRefusal(`Goal ${control}`, () => this.h.answer('goals/control', graphWrite(AG2B_SCOPE,
      { goalRef: AG2B_GOAL_REF, control, reason: `fuzz ${what}` }, this.requestId(`goal-${control}`),
      [{ ref: AG2B_GOAL_REF, revision: goal.revision }, goalPhasePinIn(world, AG2B_GOAL_REF)])));
    const outcome = outcomeOf(answer);
    const fanOut = ((answer['value'] ?? {}) as { fanOut?: { runs?: Array<{ outcome: string }>; continuations?: Array<{ outcome: string }> } }).fanOut;
    const runs = fanOut?.runs ?? [];
    const continuations = fanOut?.continuations ?? [];
    for (const run of runs) this.counts.add(`goal-fan-out:${control}:${run.outcome}`);
    for (const continuation of continuations) this.counts.add(`goal-continuation:${continuation.outcome}`);
    this.counts.add(`goal:${control}:${outcome}`);
    this.record(`  Goal ${control}: ${outcome}${reasonOf(answer)}, fan-out [${runs.map((run) => run.outcome).join(', ')}], continuations [`
      + `${continuations.map((continuation) => continuation.outcome).join(', ')}]`);
    const requeued = continuations.some((continuation) => continuation.outcome === 'requeued');
    await this.gate.check(`Goal ${control}`, requeued ? ownerStep('task_requeued', GOAL_FAN_OUT_ACTOR, this.policy(), `Goal ${control}`) : undefined);
    return answer;
  }

  /**
   * A person pauses or resumes the Goal (GOAL-04/05, GOAL-29 after the resume); a cancel near the end only. Now and
   * then the automation, the Goal fan-out actor or an Agent asks to resume it instead: a Goal a person paused is
   * resumed only by a person (GOAL-05, LA-7; an Agent never controls a Goal), so the answer is `forbidden`, nothing is
   * written and the Goal keeps its revision and desired state.
   */
  private async opGoal(late: boolean): Promise<void> {
    const goal = this.world().goals[0]!;
    if (goal.desiredState === 'active') {
      const control = late && this.rng.chance(0.3) ? 'cancel' : 'pause';
      this.record(`Goal ${control} (operator)`);
      await this.goalControl(control, `operator ${control}`);
      return;
    }
    if (goal.desiredState !== 'paused') return;
    if (this.rng.chance(0.25)) {
      const who = this.rng.weighted<'system' | 'fan-out' | 'agent'>([[2, 'system'], [1, 'fan-out'], [this.world().runs.length > 0 ? 2 : 0, 'agent']]);
      const platform = who === 'agent' ? await this.agentPlatform() : await this.h.direct();
      const ctx: CoreCallContext = who === 'agent' ? workRunCtx(this.rng.pick(this.world().runs).ref)
        : hostCtx(who === 'system' ? { ...WORKFLOW_AUTOMATION_ACTOR } : { ...GOAL_FAN_OUT_ACTOR });
      const answer = await this.quietRefusal('Goal resume by a non-person', () => platform.goals.setGoalControl(ctx, { meta: { requestId: this.requestId('goal-resume-automatic'),
        expected: [{ ref: AG2B_GOAL_REF, revision: goal.revision }, goalPhasePinIn(this.world(), AG2B_GOAL_REF)] },
        input: { goalRef: AG2B_GOAL_REF, control: 'resume', reason: 'fuzz automatic resume' } }));
      const outcome = outcomeOf(answer);
      this.counts.add(`goal:resume-by-${who}:${outcome}`);
      this.record(`Goal resume by ${who}: ${outcome}${reasonOf(answer)}`);
      const after = (await this.gate.check('Goal resume by a non-person')).goals[0]!;
      const pausedByPerson = reworkActorClassOf(null, goal.desiredStateRequestedBy ?? { kind: 'human', id: 'unknown' }) === 'human';
      if (pausedByPerson && (outcome !== 'rejected:forbidden' || after.revision !== goal.revision || after.desiredState !== goal.desiredState)) {
        throw new Error(`GOAL-05 (LA-7): a resume by ${who} of a Goal a person paused answered ${outcome}; the Goal is now `
          + `${after.desiredState}@${after.revision} (was ${goal.desiredState}@${goal.revision})\n${this.replayText()}`);
      }
      return;
    }
    this.record('Goal resume (operator)');
    await this.goalControl('resume', 'operator resume');
    // A resumed entered Run re-enters its Turn on the fan-out driver's own signal: wait for it.
    await this.settle('the Goal resume fan-out');
    await this.gate.check('Goal resume settled');
  }

  /** The workspace changes: the result file right, wrong or gone, or an unrelated file (GAP-47: a change alone is no new basis). */
  private async opWorkspace(): Promise<void> {
    const what = this.rng.weighted<'pass' | 'fail' | 'remove' | 'touch'>([[4, 'pass'], [2, 'fail'], [1, 'remove'], [2, 'touch']]);
    const path = join(this.h.root, AG2B_RESULT_FILE);
    if (what === 'pass') await writeFile(path, `${AG2B_RESULT_TEXT}\n`);
    if (what === 'fail') await writeFile(path, `not the result ${this.operation}\n`);
    if (what === 'remove') await rm(path, { force: true });
    if (what === 'touch') await writeFile(join(this.h.root, 'src', 'fuzz-touched.txt'), `touched at ${this.operation}\n`);
    this.counts.add(`workspace:${what}`);
    this.record(`workspace: ${what}`);
  }

  /** Answers a wait message through the formal consultation (the query model), as its recipient. */
  private async opReply(): Promise<void> {
    const waits = this.world().messages.filter((message) => message.status !== 'responded' && message.waitAfterSend === true);
    const message = this.rng.pick(waits);
    const answer = await this.h.answer('workflow/consultation', plain(AG2B_SCOPE, { schemaVersion: 1, messageRef: message.ref,
      goalRef: AG2B_GOAL_REF, roleBinding: AG2B_QUERY_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET,
      consumerId: AG2B_CONSUMER_ID }));
    const state = ((answer['value'] ?? {}) as { state?: string }).state ?? outcomeOf(answer);
    this.counts.add(`reply:${state}`);
    this.record(`reply to message ${message.ref.messageId}: ${state}`);
    await this.gate.check('consultation reply');
  }

  /** Creates the wait recipient (a query-role Session linked to the first work Task) and checks the store. */
  private async addRecipient(): Promise<void> {
    const created = await createAG2bSession(this.h.host, this.requestId('recipient'), AG2B_QUERY_ROLE,
      [{ target: { kind: 'task', ref: { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: AG2B_WORK_TASK_ID } },
        relation: 'participates' }]);
    this.recipient = created.sessionRef;
    this.record(`recipient Session ${created.sessionRef.sessionId}`);
    await this.gate.check('recipient Session created');
  }

  // -------------------------------------------------------------------------
  // The Agent composition (the Host's Runtime grant, so the delegated-write admission is reached)
  // -------------------------------------------------------------------------

  private agentPlatform(): Promise<Platform> {
    this.agentPlatformOpen ??= openAgentPlatform(this.h, this.policy());
    return this.agentPlatformOpen;
  }

  private async closeAgentPlatform(): Promise<void> {
    const open = this.agentPlatformOpen;
    this.agentPlatformOpen = null;
    if (open !== null) await (await open).close().catch(() => undefined);
  }

  async dispose(): Promise<void> {
    await this.closeAgentPlatform();
  }
}

function setCalls(reply: MutableReply, calls: MutableReply['calls']): void {
  reply.kind = 'calls';
  reply.calls = calls;
  reply.text = '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function receiptDetail(receipt: WorkflowStepReceipt): string {
  const result = receipt.result as { status?: unknown; value?: Record<string, unknown> };
  if (result.status !== 'committed' && result.status !== 'ready') return '';
  const value = result.value ?? {};
  if (receipt.kind === 'start' || receipt.kind === 'observe') {
    const run = (value['run'] ?? {}) as { status?: unknown; outcome?: unknown };
    return ` → Run ${String(run.status)} ${String(run.outcome)}`;
  }
  if (receipt.kind === 'finalize_checks') return ` → ${String(value['outcome'])}`;
  return '';
}

// ---------------------------------------------------------------------------
// Plan drafts
// ---------------------------------------------------------------------------

type DraftV2 = Extract<PlanRevisionDraft, { schemaVersion: 2 }>;

/** The next future draft of an accepted v2 Plan (the draft fields only). */
export function draftOf(plan: PlanRevisionSnapshot, planId: string): DraftV2 {
  if (plan.schemaVersion !== 2) throw new Error('fuzz: the active Plan is a v2 Plan');
  return { schemaVersion: 2, planId, planRevision: plan.planRevision + 1, goalId: plan.goalRef.goalId,
    stages: structuredClone(plan.stages), tasks: structuredClone(plan.tasks), assignments: structuredClone(plan.assignments ?? []),
    obligations: structuredClone(plan.obligations), taskHierarchy: structuredClone(plan.taskHierarchy),
    executionDag: structuredClone(plan.executionDag), taskRelations: structuredClone(plan.taskRelations ?? []),
    inputRequirements: structuredClone(plan.inputRequirements ?? []) };
}

/** The fence of a carrier Task: its selected Run's (`reworkFenceOf`); a Task without a selected Run is not fenced. */
export function carrierFence(world: InvariantWorld, goalId: string, taskId: string): ReworkFence {
  const selected = world.taskStates.find((state) => state.goalId === goalId && state.taskId === taskId)?.selectedRunRef ?? null;
  const run = selected === null ? undefined : world.runs.find((candidate) => candidate.ref.runId === selected.runId);
  return run === undefined ? 'none' : fenceIn(world, run);
}

/**
 * Guard 9 (§3.3, LA-3) as a checked world shows it: the draft gives some obligation of the source Plan a new active
 * work carrier (a new Task, one newly listed, or one restored to `active`) while that obligation's active work
 * carriers in the source are non-empty and every one is fenced (`carrierFence`).
 */
export function guard9Fenced(world: InvariantWorld, source: PlanRevisionSnapshot, draft: DraftV2): boolean {
  const activeWork = (tasks: readonly RuntimeTask[]): Set<string> => new Set(tasks
    .filter((task) => task.taskKind === 'work' && task.disposition === 'active').map((task) => task.taskId));
  const sourceActive = activeWork(source.tasks);
  const targetActive = activeWork(draft.tasks);
  for (const obligation of source.obligations) {
    const next = draft.obligations.find((candidate) => candidate.obligationId === obligation.obligationId);
    if (next === undefined) continue;
    const existing = [...new Set(obligation.taskIds)].filter((taskId) => sourceActive.has(taskId));
    const added = [...new Set(next.taskIds)].filter((taskId) => targetActive.has(taskId) && !existing.includes(taskId));
    if (added.length === 0 || existing.length === 0) continue;
    if (existing.every((taskId) => carrierFence(world, source.goalRef.goalId, taskId) !== 'none')) return true;
  }
  return false;
}

/** Adds a required active work Task that carries every obligation (a new carrier, guard 9), with its builder assignment. */
export function addCarrier(draft: DraftV2, taskId: string): void {
  const task: RuntimeTask = { taskId, title: `Fuzz carrier ${taskId}`, requirementLevel: 'required', taskKind: 'work', disposition: 'active',
    phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' };
  draft.tasks.push(task);
  draft.assignments = [...(draft.assignments ?? []), { taskId, role: 'builder', instruction: `Perform the fuzz work ${taskId}` }];
  draft.obligations = draft.obligations.map((obligation) => ({ ...obligation, taskIds: [...obligation.taskIds, taskId] }));
}

// ---------------------------------------------------------------------------
// The Host's Runtime grant on another composition root (Agent admission; a stopped start is common.ts
// `authorizeWithoutBegin`)
// ---------------------------------------------------------------------------

/**
 * The composition root an Agent caller asks through: it has the Host's Runtime grant, so the Agent reaches
 * `authorizeDelegatedWrite`, which refuses `requeue_task` for want of the grant (GAP-46). Its model is never called.
 */
async function openAgentPlatform(h: HostScenario, policy: TaskAutomationPolicyV1): Promise<Platform> {
  const platform = await openWorkRoot(h);
  platform.registerAutomationPolicy(policy);
  return platform;
}

// ---------------------------------------------------------------------------
// The agent-grant world
// ---------------------------------------------------------------------------

/**
 * The grant of the Agent writers (§11.11 "经 W2 夹具授予 requeue_task … 然后直接调用 WorkGraph 所有者"): the B2 Host
 * permissions plus the rework and plan-write tools. No Runtime starts with `requeue_task` or `reverify_round`
 * (GAP-46), so the Agent Runs are entered through the formal entry writers with the fixture's explicit Kernel
 * binding, as the W2 fixture does.
 */
export const AGENT_GRANT = { ...B2_HOST.permissions, tools: ['read', 'requeue_task', 'reverify_round', 'propose_future_plan', 'apply_future_plan'] };

/** The R3e Goal's optional work Task whose Run is that Goal's Agent writer. */
const R3E_AGENT_TASK_ID = 'fuzz-r3e-agent-work';

type Entered = { claim: TaskClaim; consumerId: string; entryGeneration: number; kernel: KernelExecutionBinding };
type AgentCaller = 'human' | 'system' | 'agent' | 'agent-other-goal';
type Settled<T> = T | { status: 'thrown'; reason: string };

export type AgentFuzzOptions = { seed: number; operations: number };

/** An executed check the executor records (no process runs in this world): exit 0 passes, anything else fails. */
function observedCheck(exitCode: number): CheckProcessObservation {
  const text = exitCode === 0 ? 'FUZZ_CHECK_OK\n' : 'FUZZ_CHECK_FAILED\n';
  return { kind: 'executed', startedAt: B2_AT, finishedAt: B2_AT, exitCode, signal: null, timedOut: false, cancelled: false,
    stdout: { text, totalBytes: Buffer.byteLength(text), truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { workspaceRevision: 'fuzz-workspace-revision-1', changedPaths: [] }, sandboxProfileVersion: 'bwrap-m3-v4' };
}

/**
 * One agent-grant fuzz run on the R3e evidence fixture (SQLite), which holds the B2 execution fixture:
 * - Goal G1 with `implement-a` (the rework target, its first Run entered with the plain B2 grant), `implement-b` (its
 *   Run entered with `AGENT_GRANT`: the Agent writer of G1) and the gate; Goal G2's Run entered with `AGENT_GRANT` (an
 *   Agent of another Goal). G1's requirement kind has no registered check, so a round on the target finalizes with
 *   the requirement uncovered: its reverify reaches the fence and the policy steps, never a successor.
 * - The R3e Goal: its work Task's Run ended completed, under a static policy with registered checks, and an optional
 *   work Task whose Run is entered with `AGENT_GRANT` (the Agent writer that reverifies that chain, VR-14 step 2).
 * The requeue, plan, control and evidence owners are the production services over the fixture's records; the requeue
 * source capture is a digest the fuzz changes; the evidence owner's source is the R3e workspace, which the fuzz edits.
 */
export class AgentFuzz {
  readonly counts = new OpCounts();
  readonly log: string[] = [];
  readonly gate: InvariantGate;
  /** Each two-writer race: how many writers reached the commit and the two outcomes. */
  readonly raceOutcomes: Array<{ kind: 'requeue-w16' | 'requeue-refusal' | 'carrier-pause' | 'w16-control'; arrivals: number; first: string; second: string }> = [];
  private operation = 0;
  private sequence = 0;
  private policy: TaskAutomationPolicyV1;
  private sourceDigest = 'a'.repeat(64);
  private target: Entered | null = null;
  private targetClaim: TaskClaim;
  private agentWriter: Entered | null = null;
  private otherGoalWriter: Entered | null = null;
  private r3eWriter: Entered | null = null;
  private goalCancelDone = false;
  private readonly b2: B2ExecutionFixture;
  private readonly entry: ExecutionEntryPort;
  private readonly controls: RunControlPort & ControlObservationPort;
  private readonly plans: PlanTaskPort;
  private readonly delegatedWrites: PlanDelegatedWriteDependencies;
  private readonly materials: MaterialPort;
  private readonly evidence: EvidencePort;

  private constructor(readonly options: AgentFuzzOptions, readonly rng: Rng, readonly r3e: R3eEvidenceFixture) {
    const b2 = r3e.b2;
    this.b2 = b2;
    this.gate = new InvariantGate(b2.base.directory, b2.base.scope.projectId, () => this.replayText());
    this.policy = { schemaVersion: 1, autoReworkLimit: rng.pick([0, 0, 1, 2, 3]), resumeOnStartup: 'off' };
    this.targetClaim = b2.claim;
    const records = b2.base.records;
    const now = (): string => B2_AT;
    const eventId = (): string => `fuzz-agent-${options.seed}-event-${++this.sequence}`;
    const reads = createRunStateReader({ records });
    const roles = createRoleConfigurationService({ records, now, eventId });
    // The Host's current grant for the pinned configuration: the B2 permissions or `AGENT_GRANT` (a test double for the
    // Host callback, as tests/work-graph/A2-requeue-service.test.ts has it).
    const authorizeConfiguration: AuthorizeConfiguration = async (ctx, input) => {
      if (ctx.projectId !== b2.base.scope.projectId || ctx.workspaceId !== b2.base.scope.workspaceId
        || input.configurationRevision !== B2_HOST.configurationRevision
        || ![B2_HOST.permissions, AGENT_GRANT].some((permissions) => canonicalJson(permissions as never) === canonicalJson(input.permissions as never))
        || canonicalJson({ template: input.hostTemplate } as never) !== canonicalJson({ template: B2_HOST.hostTemplate } as never)) {
        return { status: 'rejected', code: 'forbidden', reason: 'the fuzz Host does not authorize this configuration' };
      }
      return { status: 'ready', value: { configurationRevision: B2_HOST.configurationRevision,
        permissions: structuredClone(input.permissions), hostTemplate: structuredClone(B2_HOST.hostTemplate) } };
    };
    const materialReads = createMaterialRecordReaders(records);
    this.materials = createMaterialService({ bodies: b2.bodies, authority: materialReads.authority, now });
    this.entry = createExecutionEntryService({ records, reads, roles, bodies: b2.bodies,
      authorizeConfiguration, now, eventId, newId: () => `fuzz-agent-${options.seed}-id-${++this.sequence}` });
    this.controls = createRunControlService({ records, authority: materialReads.authority, reads, now, eventId });
    this.delegatedWrites = { reads, roles, bodies: b2.bodies, authorizeConfiguration };
    this.plans = createPlanService({ records, bindings: createInitializationBindingReader({ records }),
      now, eventId, delegatedWrites: this.delegatedWrites });
    // The 5.9 evidence owner (as tests/work-graph/R3e-reverify.test.ts builds it): the R3e checks configuration for
    // this scope, the fuzz's automation policy and the Agent admission.
    this.evidence = createEvidenceService({ records, materials: r3e.materials, executions: reads,
      workspaceHost: r3e.workspaceHost, source: new VerificationWorkspaceReader(),
      configurationFor: (scope) => scope.projectId === r3e.scope.projectId && scope.workspaceId === r3e.scope.workspaceId ? r3e.configuration : undefined,
      automationPolicy: () => this.policy, now, newId: () => `fuzz-agent-${options.seed}-evidence-${++this.sequence}`,
      delegatedWrites: this.delegatedWrites });
  }

  static async open(options: AgentFuzzOptions): Promise<AgentFuzz> {
    // The control and completion records (ControlIntent, GoalPhase) join the fixture's schemas: controls and Goal control write them.
    const r3e = await createR3eEvidenceFixture('sqlite', { records: [...CONTROL_RECORD_SCHEMAS.records, ...COMPLETION_RECORD_SCHEMAS.records],
      events: [...CONTROL_RECORD_SCHEMAS.events, ...COMPLETION_RECORD_SCHEMAS.events],
      lookups: [...CONTROL_RECORD_SCHEMAS.lookups ?? [], ...COMPLETION_RECORD_SCHEMAS.lookups ?? []] });
    const b2 = r3e.b2;
    const fuzz = new AgentFuzz(options, seededRng(options.seed), r3e);
    try {
      await warmLookupIndexes(b2.base.ledgerPath);
      await fuzz.gate.check('seeded');
      await fuzz.openR3eWriter();
      fuzz.target = await fuzz.enter(b2.claim, B2_HOST.permissions, 'target-1');
      fuzz.record(`Run ${b2.claim.runRef.runId} of implement-a entered (plain grant)`);
      await fuzz.gate.check('target entered');
      const base = b2.base;
      const claimed = await base.service.claimTask(base.ctx, await base.buildRequest({ requestId: 'fuzz-agent-claim-b',
        input: { taskId: base.tasks.second.taskId, sessionRef: base.sessions.second } }));
      if (claimed.status !== 'committed') throw new Error(`fuzz: the Agent writer claim failed: ${JSON.stringify(claimed)}`);
      fuzz.agentWriter = await fuzz.enter(claimed.value, AGENT_GRANT, 'agent-writer');
      fuzz.record(`Agent writer Run ${claimed.value.runRef.runId} of implement-b entered (AGENT_GRANT)`);
      await fuzz.gate.check('Agent writer entered');
      fuzz.otherGoalWriter = await fuzz.enter(b2.secondClaim, AGENT_GRANT, 'agent-other-goal');
      fuzz.record(`Agent Run ${b2.secondClaim.runRef.runId} of Goal 2 entered (AGENT_GRANT)`);
      await fuzz.gate.check('other-Goal Agent entered');
    } catch (error) {
      await r3e.close();
      throw error;
    }
    return fuzz;
  }

  /**
   * The R3e Goal's Agent writer (as tests/work-graph/R3e-reverify.test.ts adds it): a W16 adds an optional work Task
   * under the static policy the R3e fixture activated; the B2 policy is then active again (so the B2 Goals' W16 pin the
   * policy their Plans were adopted under); the Task is claimed in its own Session and entered with `AGENT_GRANT`.
   */
  private async openR3eWriter(): Promise<void> {
    const r3e = this.r3e;
    const base = this.b2.base;
    const goal = await base.plans.queryGoal(r3e.ctx, r3e.goalRef);
    if (goal.status !== 'ready') throw new Error(`fuzz: the R3e Goal is not readable: ${JSON.stringify(goal)}`);
    const draft = futureDraftOf(r3e.plan, 'fuzz-r3e-plan-agent');
    draft.tasks.push({ taskId: R3E_AGENT_TASK_ID, title: 'Fuzz Agent work', requirementLevel: 'optional', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' });
    draft.assignments = [...(draft.assignments ?? []), { taskId: R3E_AGENT_TASK_ID, role: 'builder', instruction: 'Fuzz Agent work' }];
    const expected = [{ ref: r3e.goalRef, revision: goal.value.goal.revision }];
    const proposed = await base.plans.proposePlan(r3e.ctx, { meta: { requestId: 'fuzz-r3e-agent-propose', expected },
      input: { goalRef: r3e.goalRef, basedOn: r3e.plan.ref, draft, reason: { text: 'an Agent task', sources: [] } } });
    if (proposed.status !== 'committed' || proposed.value.issues.length > 0) throw new Error(`fuzz: the R3e Agent task proposal: ${JSON.stringify(proposed)}`);
    const applied = await base.plans.applyPlanChange(r3e.ctx, { meta: { requestId: 'fuzz-r3e-agent-apply', expected },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    if (applied.status !== 'committed') throw new Error(`fuzz: the R3e Agent task adoption: ${JSON.stringify(applied)}`);
    // The B2 policy back as the project's active policy.
    const b2Plan = this.world().plans.find((plan) => plan.ref.planId === base.planRef.planId);
    if (b2Plan === undefined) throw new Error('fuzz: the B2 Plan is not in the world');
    const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: base.scope.projectId };
    const active = await base.records.readMany([canonicalJson(activeRef as never)]);
    if (active.status !== 'ready' || active.value.records.length !== 1) throw new Error(`fuzz: the active policy pointer: ${JSON.stringify(active)}`);
    const bootstrap = createProjectBootstrapServices({ records: base.records, now: () => B2_AT, eventId: () => `fuzz-agent-${this.options.seed}-policy-${++this.sequence}` });
    const activated = await bootstrap.completionPolicies.activateCompletionPolicy(r3e.ctx, { meta: { requestId: 'fuzz-r3e-reactivate-b2-policy',
      expected: [{ ref: r3e.projectRef, revision: 1 }, { ref: activeRef, revision: active.value.records[0]!.revision }] },
    input: { target: structuredClone(b2Plan.effectiveCompletionPolicy) } });
    if (activated.status !== 'committed') throw new Error(`fuzz: the B2 policy reactivation: ${JSON.stringify(activated)}`);
    const session = await base.createSession('fuzz-r3e-agent-session');
    const goalNow = await base.plans.queryGoal(r3e.ctx, r3e.goalRef);
    const card = await base.sessionsPort.readSession(r3e.ctx, session);
    if (goalNow.status !== 'ready' || card.status !== 'ready') throw new Error('fuzz: the R3e Goal and the Session are readable');
    const claimed = await base.service.claimTask(r3e.ctx, { input: { goalRef: r3e.goalRef, planRef: applied.value.ref,
      taskId: R3E_AGENT_TASK_ID, sessionRef: session, roleBinding: base.roleBinding, budget: base.budget },
    meta: { requestId: 'fuzz-r3e-agent-claim', expected: [{ ref: r3e.goalRef, revision: goalNow.value.goal.revision },
      { ref: r3e.workspaceRef, revision: 1 }, { ref: plainSessionRefToAggregate(session), revision: card.value.record.revision }] } });
    if (claimed.status !== 'committed') throw new Error(`fuzz: the R3e Agent claim: ${JSON.stringify(claimed)}`);
    this.r3eWriter = await this.enter(claimed.value, AGENT_GRANT, 'r3e-agent');
    this.record(`R3e Agent writer Run ${claimed.value.runRef.runId} of ${R3E_AGENT_TASK_ID} entered (AGENT_GRANT); the B2 policy is active again`);
    await this.gate.check('R3e Agent writer entered');
  }

  async close(): Promise<void> { await this.r3e.close(); }

  private replayText(): string {
    return `replay: agent-grant world, seed ${this.options.seed}, operation ${this.operation}; operations so far:\n`
      + this.log.map((line) => `  ${line}`).join('\n');
  }

  private record(line: string): void { this.log.push(`#${this.operation} ${line}`); }

  private requestId(what: string): string { return `fuzz-agent-${this.options.seed}-${what}-${++this.sequence}`; }

  private world(): InvariantWorld {
    if (this.gate.world === undefined) throw new Error('fuzz: no world was checked yet');
    return this.gate.world;
  }

  /** Sends one owner write; a refusal must write nothing (§11.11): the ledger takes no write (`ledgerWrites`). */
  private async quietRefusal<T>(what: string, write: () => Promise<T>): Promise<T> {
    const before = ledgerWrites(this.b2.base.ledgerPath);
    const answer = await write();
    if ((answer as { status?: unknown }).status === 'rejected') {
      const written = ledgerWrites(this.b2.base.ledgerPath) - before;
      if (written !== 0) throw new Error(`${what}: refused (${outcomeOf(answer)}${reasonOf(answer)}) yet ${written} ledger write(s) were made\n${this.replayText()}`);
      this.counts.add('zero-write-refusal:checked');
    }
    return answer;
  }

  private hostCtx(actor: Extract<ActorRef, { kind: 'human' | 'system' }> | null = null): CoreCallContext {
    const base = this.b2.base;
    const principalActor = actor ?? (base.ctx.principal.kind === 'host' ? base.ctx.principal.actor : { kind: 'human' as const, id: 'unreachable' });
    return { projectId: base.scope.projectId, workspaceId: base.scope.workspaceId, principal: { kind: 'host', actor: principalActor },
      materialReader: { kind: 'host', projectId: base.scope.projectId, workspaceId: base.scope.workspaceId, actor: principalActor },
      signal: new AbortController().signal };
  }

  private workCtx(writer: Entered): CoreCallContext {
    return { projectId: this.b2.base.scope.projectId, workspaceId: writer.claim.workspaceId,
      principal: { kind: 'work_run', runRef: writer.claim.runRef, roleBinding: this.b2.base.roleBinding },
      materialReader: { kind: 'run', requester: writer.claim.runRef }, signal: new AbortController().signal };
  }

  /** The Agent writer of a Goal: G1's for G1 (and every other Goal but R3e's), R3e's for R3e. */
  private writerOf(goalId: string): Entered | null {
    return goalId === this.r3e.goalRef.goalId ? this.r3eWriter : this.agentWriter;
  }

  /** The context of a caller; an Agent's is the writer of `goalId` (`agent`) or of another Goal (`agent-other-goal`). */
  private ctxFor(caller: AgentCaller, goalId: string = this.b2.base.goalRef.goalId): CoreCallContext {
    if (caller === 'human') return this.hostCtx();
    if (caller === 'system') return this.hostCtx({ ...WORKFLOW_AUTOMATION_ACTOR });
    const own = this.writerOf(goalId);
    const writer = caller === 'agent' ? own : own === this.agentWriter ? this.otherGoalWriter : this.agentWriter;
    if (writer === null) throw new Error('fuzz: the Agent writers are entered at open');
    return this.workCtx(writer);
  }

  private actorFor(caller: AgentCaller, goalId: string = this.b2.base.goalRef.goalId): ActorRef {
    const principal = this.ctxFor(caller, goalId).principal;
    if (principal.kind === 'host') return { ...principal.actor };
    if (principal.kind !== 'work_run') throw new Error('fuzz: an Agent caller is a work Run');
    return { kind: 'agent', id: `run:${principal.runRef.runId}`, runRef: principal.runRef };
  }

  /** The formal authorize → begin → entered writers with `permissions` and the fixture's explicit Kernel binding. */
  private async enter(claim: TaskClaim, permissions: typeof AGENT_GRANT, kernelRunId: string): Promise<Entered> {
    const prepared = await this.b2.buildPrepared({ claim, permissions });
    const facts = await this.b2.read(claim);
    const kernel: KernelExecutionBinding = { adapterId: facts.session.kernel.adapterId, kernelSessionId: facts.session.kernel.kernelSessionId,
      runId: `fuzz-${this.options.seed}-${kernelRunId}`, turnId: `fuzz-${this.options.seed}-${kernelRunId}-turn` };
    const consumerId = `fuzz-consumer-${kernelRunId}`;
    const ctx = this.b2.base.ctx;
    const authorized = await this.entry.authorizeRuntimeEntry(ctx, { input: { prepared, consumerId },
      meta: { requestId: this.requestId(`${kernelRunId}-authorize`), expected: [await this.b2.pin(claim)] } });
    if (authorized.status !== 'committed') throw new Error(`fuzz: authorize ${kernelRunId}: ${JSON.stringify(authorized)}`);
    const begun = await this.entry.beginRuntimeEntry(ctx, { input: { permit: authorized.value, kernel },
      meta: { requestId: this.requestId(`${kernelRunId}-begin`), expected: [await this.b2.pin(claim)] } });
    if (begun.status !== 'committed') throw new Error(`fuzz: begin ${kernelRunId}: ${JSON.stringify(begun)}`);
    const entered = await this.entry.recordExecutionEntered(ctx, { input: {
      permit: { ...authorized.value, authorizationRevision: begun.value.authorization.revision }, enteredAt: B2_AT,
      kernelSource: { ...kernel, position: 3 }, history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null } },
    meta: { requestId: this.requestId(`${kernelRunId}-entered`), expected: [await this.b2.pin(claim)] } });
    if (entered.status !== 'committed') throw new Error(`fuzz: entered ${kernelRunId}: ${JSON.stringify(entered)}`);
    return { claim, consumerId, entryGeneration: authorized.value.entryGeneration, kernel };
  }

  /** Runs the seeded operations, each followed by the invariant check of what it wrote; then tallies the store. */
  async run(): Promise<void> {
    while (this.operation < this.options.operations) {
      this.operation += 1;
      const [name, operation] = this.choose();
      await operation();
      this.counts.add(`op:${name}`);
    }
    const world = await this.gate.check('final');
    tallyWorld(this.counts, world, []);
    for (const state of this.gate.seen) this.counts.add(`seen:${state}`);
  }

  private targetRun(): RunSnapshot | undefined {
    return this.world().runs.find((run) => run.ref.runId === this.targetClaim.runRef.runId);
  }

  /** The target Task is `active` in the active Plan. */
  private taskActive(): boolean {
    return dispositionIn(this.world(), this.b2.base.goalRef.goalId, this.targetClaim.task.taskId) === 'active';
  }

  /** Guard 9's race applies: a person stopped the target's selected Run, and the Agent writer's Run runs without a pointer. */
  private carrierRaceApplies(): boolean {
    const world = this.world();
    const writer = this.agentWriter;
    const target = this.targetRun();
    const writerRun = writer === null ? undefined : world.runs.find((run) => run.ref.runId === writer.claim.runRef.runId);
    return writerRun?.status === 'running' && writerRun.controlState === undefined && target !== undefined
      && fenceIn(world, target) !== 'none' && this.goalOf().desiredState !== 'cancelled';
  }

  private goalOf(goalId: string = this.b2.base.goalRef.goalId): InvariantWorld['goals'][number] {
    const goal = this.world().goals.find((candidate) => candidate.ref.goalId === goalId);
    if (goal === undefined) throw new Error(`fuzz: Goal ${goalId} is not in the world`);
    return goal;
  }

  /** The chains a round may be opened or finished on: the target's completed Run and the R3e subject's, with no head or an open one. */
  private verifiable(): RunSnapshot[] {
    const world = this.world();
    const runs = [this.targetRun(), world.runs.find((run) => run.ref.runId === this.r3e.subjectRunRef.runId)];
    return runs.filter((run): run is RunSnapshot => run !== undefined && run.status === 'ended' && run.outcome === 'completed'
      && !world.requeues.some((requeue) => requeue.afterRunRef.runId === run.ref.runId)).filter((run) => {
      const head = workHeadIn(world, run);
      return head.kind === 'none' || (head.kind === 'head' && head.head.status === 'open');
    });
  }

  /** The finalized non-PASS heads of the target's and the R3e subject's work chains (VR-14 predecessors). */
  private reverifiable(): RoundSnapshot[] {
    const world = this.world();
    const heads: RoundSnapshot[] = [];
    for (const run of world.runs) {
      if (run.task.taskId !== this.targetClaim.task.taskId && run.ref.runId !== this.r3e.subjectRunRef.runId) continue;
      const head = workHeadIn(world, run);
      if (head.kind === 'head' && isFinalizedNonPass(head.head)) heads.push(head.head);
    }
    return heads;
  }

  private choose(): readonly [string, () => Promise<void>] {
    if (!this.goalCancelDone && this.operation === this.options.operations - 3) {
      this.goalCancelDone = true;
      return ['goal-cancel', () => this.opGoalCancel()];
    }
    const run = this.targetRun();
    const running = run?.status === 'running';
    const ended = run?.status === 'ended';
    const covered = this.world().taskStates.find((state) => state.taskId === this.targetClaim.task.taskId)?.coveringRequeueRef ?? null;
    // A race is worth its barrier only when both writers can reach their commit: the selected Run ended, uncovered, the Goal and the Task active.
    const raceable = ended && covered === null && this.goalOf().desiredState === 'active' && this.taskActive();
    const carrierRace = this.carrierRaceApplies();
    const entries: Array<readonly [number, readonly [string, () => Promise<void>]]> = [
      [running ? 8 : 0, ['end-target', () => this.opEndTarget()]],
      [run !== undefined && run.status !== 'ended' ? 2 : 1, ['control', () => this.opControl()]],
      [raceable ? 3 : ended ? 6 : 1, ['requeue-human', async () => { await this.opRequeue('human'); }]],
      [raceable ? 2 : ended ? 4 : 1, ['requeue-system', async () => { await this.opRequeue('system'); }]],
      [raceable ? 10 : ended ? 8 : 2, ['requeue-agent', async () => { await this.opRequeue('agent'); }]],
      [ended ? 1 : 0, ['requeue-agent-other-goal', async () => { await this.opRequeue('agent-other-goal'); }]],
      [covered !== null ? 6 : 0, ['claim-requeued', () => this.opClaimRequeued()]],
      [2, ['goal', () => this.opGoal()]],
      [3, ['cap', async () => this.opCap()]],
      [2, ['source', async () => this.opSource()]],
      [raceable ? 2 : 4, ['w16', () => this.opW16(this.rng.pick<AgentCaller>(['human', 'system', 'agent', 'agent']))]],
      [raceable ? 3 : 0, ['race-requeue-w16', () => this.opRaceRequeueW16()]],
      [raceable ? 2 : 0, ['race-requeue-refusal', () => this.opRaceRequeueRefusal()]],
      [carrierRace ? 6 : 0, ['race-carrier-pause', () => this.opRaceCarrierPause()]],
      [carrierRace ? 3 : 0, ['guard9-sequential', () => this.opGuard9Sequential()]],
      [run !== undefined ? 2 : 0, ['race-w16-control', () => this.opRaceW16Control()]],
      [this.verifiable().length > 0 ? 7 : 0, ['verify', () => this.opVerify()]],
      [this.reverifiable().length > 0 ? 8 : 0, ['reverify', () => this.opReverify()]],
      [2, ['evidence-source', () => this.opEvidenceSource()]],
    ];
    return this.rng.weighted(entries);
  }

  /**
   * The target Run ends with a random Kernel terminal (crashed → `run_failed`, budget exhausted, completed); a
   * completed one is now and then paused by a person first (the pause queued on the entered Run stays its pointer, so
   * its rounds are fenced: an automatic reverify of them is `forbidden`).
   */
  private async opEndTarget(): Promise<void> {
    const target = this.target;
    if (target === null) return;
    const terminal = this.rng.weighted([
      [3, { eventType: 'run_crashed', payload: { kind: 'crashed', error: 'the build tool exited 2' } }],
      [2, { eventType: 'run_budget_exhausted', payload: { kind: 'budget_exhausted', exhaustedAt: B2_AT } }],
      [2, { eventType: 'run_completed', payload: { kind: 'completed', exitCode: 0 } }],
    ] as const);
    if (terminal.payload.kind === 'completed' && this.rng.chance(0.4)) {
      const pin = await this.b2.pin(target.claim);
      const paused = await this.quietRefusal('control pause', () => this.controls.submitControl(this.hostCtx(), { input: { runRef: target.claim.runRef,
        kind: 'pause', reason: 'fuzz: a person pauses before the Turn completes' }, meta: { requestId: this.requestId('control-pause-before-end'), expected: [pin] } }));
      this.counts.add(`control:pause:human:before-end:${outcomeOf(paused)}`);
      this.record(`control pause by human on Run ${target.claim.runRef.runId} before it completes: ${outcomeOf(paused)}${reasonOf(paused)}`);
      await this.gate.check('control pause before the end');
    }
    const kernel = target.kernel;
    const event = { eventType: terminal.eventType, schemaVersion: 1, eventId: this.requestId('terminal'), runRef: target.claim.runRef,
      sequence: 2, occurredAt: B2_AT, payload: terminal.payload } as RuntimeEventV1;
    const answer = await this.entry.recordRunResult(this.b2.base.ctx, { input: { claim: target.claim,
      entry: { consumerId: target.consumerId, entryGeneration: target.entryGeneration }, event,
      kernelSource: { ...kernel, position: 4 }, completedHistoryBoundary: { source: { ...kernel, position: 4 }, cursor: 'fuzz-boundary-4' },
      history: { kernel, startPosition: 2, observedThroughPosition: 4, endPosition: 4 } },
    meta: { requestId: this.requestId('result'), expected: [await this.b2.pin(target.claim)] } });
    this.counts.add(`end:${terminal.payload.kind}:${outcomeOf(answer)}`);
    this.record(`Run ${target.claim.runRef.runId} ends ${terminal.payload.kind}: ${outcomeOf(answer)}${reasonOf(answer)}`);
    if (answer.status === 'committed') this.target = null;
    await this.gate.check('Run result');
    // TD-6: the Agent of the Goal reworks the failure first half of the time (else a person or the automation mostly does).
    if (answer.status === 'committed' && terminal.payload.kind !== 'completed' && this.rng.chance(0.5)) await this.opRequeue('agent');
  }

  /**
   * A pause, cancel, steer or resume of the target Run by a person or, now and then, the automation (its stop is no
   * fence; a person's is, I-17): queued on an entered Run, applied at once on a claimed one (D-7).
   */
  private async opControl(): Promise<void> {
    const kind = this.targetRun()?.controlState?.desiredState === 'paused' && this.rng.chance(0.6) ? 'resume' as const
      : this.rng.pick<ControlIntentKindV1>(['pause', 'cancel', 'steer', 'resume']);
    const caller: AgentCaller = this.rng.chance(0.3) ? 'system' : 'human';
    const runRef = this.targetClaim.runRef;
    const pin = await this.b2.pin(this.targetClaim);
    const answer = await this.quietRefusal(`control ${kind}`, () => this.controls.submitControl(this.ctxFor(caller), { input: { runRef, kind, reason: `fuzz ${kind}` },
      meta: { requestId: this.requestId(`control-${kind}`), expected: [pin] } }));
    this.counts.add(`control:${kind}:${caller}:${outcomeOf(answer)}`);
    this.record(`control ${kind} by ${caller} on Run ${runRef.runId}: ${outcomeOf(answer)}${reasonOf(answer)}`);
    await this.gate.check(`control ${kind}`);
    if (this.target !== null && this.targetRun()?.status === 'ended') this.target = null;
  }

  private requeueService(records: B2ExecutionFixture['base']['records'] = this.b2.base.records) {
    const base = this.b2.base;
    return createTaskRequeueService({
      records, reads: createRunStateReader({ records }),
      workspaceHost: { async resolveRoot(workspace) {
        return workspace.workspaceId === base.scope.workspaceId
          ? { status: 'ready', value: { root: base.directory, workspaceRevision: 1 } }
          : { status: 'rejected', code: 'not_found', reason: 'not a registered workspace' };
      } },
      source: { captureDigest: async () => ({ status: 'ready', sourceDigest: this.sourceDigest }) },
      materials: this.materials,
      messages: { async readMessage() { return { status: 'not_found' }; } },
      delegatedWrites: this.delegatedWrites,
      automationPolicy: () => this.policy,
      now: () => B2_AT, eventId: () => `fuzz-agent-${this.options.seed}-requeue-${++this.sequence}`,
    });
  }

  /** A requeue request of the target's selected Run (or, now and then, an older one: a stale `afterRunRef`). */
  private requeueRequest(caller: AgentCaller, forced: RunSnapshot | null = null): GraphWrite<RequeueTaskInput> | null {
    const world = this.world();
    const runs = world.runs.filter((run) => run.task.taskId === this.targetClaim.task.taskId && run.status === 'ended');
    if (runs.length === 0) return null;
    const selected = this.targetRun();
    const after = forced ?? (selected?.status === 'ended' && this.rng.chance(0.85) ? selected : this.rng.pick(runs));
    const goal = this.goalOf(after.ref.goalId);
    const input: RequeueTaskInput = { taskRef: after.task, afterRunRef: after.ref, reason: `fuzz ${caller} requeue` };
    if (this.rng.chance(caller === 'human' ? 0.3 : 0.12)) input.budget = { tokenBudget: after.budget.tokenBudget * (this.rng.chance(0.7) ? 2 : 1), deadline: null };
    if (caller === 'human' && this.rng.chance(0.25)) input.note = `fuzz note ${this.sequence}`;
    const refusal = world.refusals.find((candidate) => candidate.ref.operation === 'requeue' && candidate.ref.subjectId === after.ref.runId);
    const expected = [{ ref: goal.ref, revision: goal.revision }, { ref: after.ref, revision: after.revision },
      ...(caller !== 'human' && this.rng.chance(0.7) ? [{ ref: { aggregateType: 'TaskReworkRefusal' as const, projectId: after.ref.projectId,
        goalId: after.ref.goalId, taskId: after.task.taskId, operation: 'requeue' as const, subjectId: after.ref.runId },
      revision: refusal?.revision ?? 0 }] : [])];
    return { input, meta: { requestId: this.requestId(`requeue-${caller}`), expected } };
  }

  /**
   * A requeue by a person, the automation, the Agent of G1 (with the grant: it commits) or an Agent of G2
   * (`forbidden`). The human-stop fence is judged on the answer (`fenceProblem`): a system or agent requeue of a Run a
   * person stopped commits nothing and, when it reaches the matrix, is `forbidden`. Answers the outcome.
   */
  private async opRequeue(caller: AgentCaller, forced: RunSnapshot | null = null): Promise<string> {
    const request = this.requeueRequest(caller, forced);
    if (request === null) return 'no-target';
    const world = this.world();
    const after = world.runs.find((run) => run.ref.runId === request.input.afterRunRef.runId);
    const fence = after === undefined ? 'none' : fenceIn(world, after);
    const reaches = after !== undefined && caller !== 'agent-other-goal' && requeueReachesFence(world, after);
    const answer = await this.quietRefusal(`${caller} requeue`, () => this.requeueService().requeueTask(this.ctxFor(caller), request));
    const outcome = outcomeOf(answer);
    const extras = `${request.input.budget === undefined ? '' : '+budget'}${request.input.note === undefined ? '' : '+note'}`;
    const cls = caller === 'agent-other-goal' ? 'agent' : caller;
    this.counts.add(`requeue:${caller}:${outcome}`);
    if (outcome === 'rejected:forbidden') this.counts.add(`forbidden:requeue:${cls}:${forbiddenKind(answer)}`);
    if (fence !== 'none') this.counts.add(`fence:requeue:${cls}:${fence}:${outcome}`);
    this.record(`${caller} requeue of Run ${request.input.afterRunRef.runId}${extras}${fence === 'none' ? '' : ` (fence ${fence})`}: ${outcome}${reasonOf(answer)}`);
    const problem = fenceProblem({ cls, fence, continuation: false, reachesFence: reaches, answer });
    if (problem !== null) throw new Error(`${caller} requeue of Run ${request.input.afterRunRef.runId}: ${problem}\n${this.replayText()}`);
    const kind = reworkStepKind(answer, 'task_requeued');
    await this.gate.check(`${caller} requeue`, kind === null ? undefined : ownerStep(kind, this.actorFor(caller), this.policy, `${caller} requeue`));
    return outcome;
  }

  /** TASK-03: the requeued target is claimed with its `requeueRef` in the first Session (with the pinned budget, mostly). */
  private async opClaimRequeued(): Promise<void> {
    const world = this.world();
    const requeueRef = world.taskStates.find((candidate) => candidate.taskId === this.targetClaim.task.taskId)?.coveringRequeueRef ?? null;
    if (requeueRef === null) return;
    const requeue = world.requeues.find((candidate) => candidate.ref.afterRunId === requeueRef.afterRunId);
    if (requeue === undefined) return;
    const base = this.b2.base;
    const planRef = this.goalOf().activePlanRevision ?? base.planRef;
    const budget = requeue.budget !== null && this.rng.chance(0.85) ? requeue.budget : base.budget;
    const request = await base.buildRequest({ requestId: this.requestId('claim-requeued'),
      input: { taskId: this.targetClaim.task.taskId, sessionRef: base.sessions.first, planRef, budget } });
    const answer = await this.quietRefusal('requeue claim', () => base.service.claimTask(base.ctx, { ...request, input: { ...request.input, requeueRef } }));
    this.counts.add(`claim-requeued:${outcomeOf(answer)}`);
    this.record(`claim implement-a with requeueRef ${requeueRef.afterRunId}: ${outcomeOf(answer)}${reasonOf(answer)}`);
    if (answer.status === 'committed') this.targetClaim = answer.value;
    await this.gate.check('requeue claim', answer.status === 'committed'
      ? ownerStep('task_claimed', this.actorFor('human'), this.policy, 'requeue claim') : undefined);
  }

  /**
   * A person pauses or resumes Goal G1 (rework needs an active Goal, I-9). Now and then the automation or an Agent asks
   * to resume it instead: a Goal a person paused is resumed only by a person (GOAL-05, LA-7; an Agent never controls a
   * Goal), so the answer is `forbidden`, nothing is written and the Goal keeps its revision and desired state.
   */
  private async opGoal(): Promise<void> {
    const base = this.b2.base;
    const goal = this.goalOf();
    if (goal.desiredState === 'cancelled') return;
    const control = goal.desiredState === 'active' ? 'pause' as const : 'resume' as const;
    const caller: AgentCaller = control === 'resume' && this.rng.chance(0.35) ? this.rng.pick<AgentCaller>(['system', 'system', 'agent']) : 'human';
    const answer = await this.quietRefusal(`Goal ${control}`, () => base.goals.setGoalControl(this.ctxFor(caller), { input: { goalRef: base.goalRef, control, reason: `fuzz ${control}` },
      meta: { requestId: this.requestId(`goal-${control}`),
        expected: [{ ref: base.goalRef, revision: goal.revision }, goalPhasePinIn(this.world(), base.goalRef)] } }));
    const outcome = outcomeOf(answer);
    this.counts.add(`goal:${control}:${caller}:${outcome}`);
    this.record(`Goal ${control} by ${caller}: ${outcome}${reasonOf(answer)}`);
    await this.gate.check(`Goal ${control}`);
    const after = this.goalOf();
    const pausedByPerson = reworkActorClassOf(null, goal.desiredStateRequestedBy ?? { kind: 'human', id: 'unknown' }) === 'human';
    if (caller !== 'human' && pausedByPerson
      && (outcome !== 'rejected:forbidden' || after.revision !== goal.revision || after.desiredState !== goal.desiredState)) {
      throw new Error(`GOAL-05 (LA-7): a resume by ${caller} of a Goal a person paused answered ${outcome}; the Goal is now `
        + `${after.desiredState}@${after.revision} (was ${goal.desiredState}@${goal.revision})\n${this.replayText()}`);
    }
  }

  /**
   * §11.11 "Goal 的取消" (agent-grant world): a person cancels G1 three operations before the end. Then a person's
   * requeue of the target is refused (`busy` when nothing else refuses it first), a claim of the target is refused, and
   * a person's W16 is `invalid` (S17); none writes anything.
   */
  private async opGoalCancel(): Promise<void> {
    const base = this.b2.base;
    const goal = this.goalOf();
    if (goal.desiredState === 'cancelled') return;
    const answer = await this.quietRefusal('Goal cancel', () => base.goals.setGoalControl(this.hostCtx(), { input: { goalRef: base.goalRef, control: 'cancel',
      reason: 'fuzz cancel' }, meta: { requestId: this.requestId('goal-cancel'), expected: [{ ref: base.goalRef, revision: goal.revision },
      goalPhasePinIn(this.world(), base.goalRef)] } }));
    this.counts.add(`goal:cancel:${outcomeOf(answer)}`);
    this.record(`Goal cancel by human: ${outcomeOf(answer)}${reasonOf(answer)}`);
    await this.gate.check('Goal cancel');
    if (this.goalOf().desiredState !== 'cancelled') return;
    const world = this.world();
    const selected = this.targetRun();
    if (selected?.status === 'ended') {
      const reaches = requeueReachesFence({ ...world, goals: world.goals.map((candidate) => ({ ...candidate, desiredState: 'active' as const })) }, selected);
      const requeued = await this.opRequeue('human', selected);
      this.counts.add(`goal-cancel:requeue:${requeued}`);
      if (!requeued.startsWith('rejected:') || (reaches && requeued !== 'rejected:busy')) {
        throw new Error(`a person's requeue on a cancelled Goal must be refused${reaches ? ' busy' : ''}, got ${requeued}\n${this.replayText()}`);
      }
    }
    const requeueRef = world.taskStates.find((candidate) => candidate.taskId === this.targetClaim.task.taskId)?.coveringRequeueRef ?? null;
    const request = await base.buildRequest({ requestId: this.requestId('claim-cancelled'),
      input: { taskId: this.targetClaim.task.taskId, sessionRef: base.sessions.first, planRef: this.goalOf().activePlanRevision ?? base.planRef } });
    const claimed = await this.quietRefusal('claim on a cancelled Goal', () => base.service.claimTask(base.ctx,
      requeueRef === null ? request : { ...request, input: { ...request.input, requeueRef } }));
    this.counts.add(`goal-cancel:claim:${outcomeOf(claimed)}`);
    this.record(`claim implement-a on the cancelled Goal: ${outcomeOf(claimed)}${reasonOf(claimed)}`);
    if (claimed.status !== 'rejected') throw new Error(`a claim on a cancelled Goal must be refused, got ${outcomeOf(claimed)}\n${this.replayText()}`);
    const done = await this.proposeAndApply('human', true);
    const outcome = done === null ? 'no-draft' : outcomeOf(done.answer);
    this.counts.add(`goal-cancel:w16:${outcome}`);
    this.record(`W16 by human on the cancelled Goal: ${outcome}${done === null ? '' : reasonOf(done.answer)}`);
    if (done !== null && outcome !== 'rejected:invalid') throw new Error(`S17: a W16 on a cancelled Goal must be invalid, got ${outcome}\n${this.replayText()}`);
    await this.gate.check('after the Goal cancel');
  }

  private opCap(): void {
    this.policy = { schemaVersion: 1, autoReworkLimit: this.rng.pick([0, 0, 1, 2, 3]), resumeOnStartup: 'off' };
    this.counts.add('cap:changed');
    this.record(`cap: autoReworkLimit ${this.policy.autoReworkLimit}`);
  }

  /** The source digest the requeue captures changes (a new source, or back to an earlier one). */
  private opSource(): void {
    this.sourceDigest = this.rng.pick(['a', 'b', 'c']).repeat(64);
    this.counts.add('source:changed');
    this.record(`source digest ${this.sourceDigest.slice(0, 4)}…`);
  }

  /** The verification source the evidence owner captures changes (the R3e workspace's input file: a new text, or back to an earlier one). */
  private async opEvidenceSource(): Promise<void> {
    const version = this.rng.pick(['v1', 'v2', 'v3']);
    await writeFile(join(this.r3e.workspaceRoot, 'src', 'input.txt'), `r3e verification source ${version}\n`);
    this.counts.add('evidence-source:changed');
    this.record(`verification source ${version}`);
  }

  /**
   * The draft that changes only one disposition: of `taskId`, else of implement-a (or now and then the gate), with or
   * without `affectedTaskIds`.
   */
  private w16Draft(taskId?: string): { source: PlanRevisionSnapshot; draft: DraftV2; reason: PlanChangeReason; change: string } | null {
    const world = this.world();
    const base = this.b2.base;
    const active = this.goalOf().activePlanRevision;
    const source = active === null ? undefined : world.plans.find((plan) => plan.ref.planId === active.planId);
    if (source === undefined) return null;
    const draft = futureDraftOf(source, `fuzz-agent-plan-${this.options.seed}-${++this.sequence}`);
    const changed = taskId ?? (this.rng.chance(0.85) ? this.targetClaim.task.taskId : base.tasks.gate.taskId);
    const task = draft.tasks.find((candidate) => candidate.taskId === changed);
    if (task === undefined) return null;
    // A Task that is not active goes back to active most of the time (else the rest of the run only meets task_not_active).
    const to = task.disposition !== 'active' && this.rng.chance(0.6) ? 'active' as const
      : this.rng.pick((['active', 'deferred', 'cancelled'] as const).filter((disposition) => disposition !== task.disposition));
    const from = task.disposition;
    Object.assign(task, { disposition: to });
    const listed = this.rng.chance(0.85);
    return { source, draft, change: `${changed} ${from} → ${to}${listed ? '' : ' (affectedTaskIds left out)'}`,
      reason: { text: `fuzz W16 ${changed} → ${to}`, sources: [], ...(listed ? { affectedTaskIds: [changed] } : {}) } };
  }

  /** Proposes the W16 draft (of `taskId`, see `w16Draft`) as `caller` and, unless `apply` is false, adopts it. */
  private async proposeAndApply(caller: AgentCaller, apply: boolean, taskId?: string):
  Promise<{ answer: unknown; change: string; proposal: PlanProposal | null } | null> {
    const prepared = this.w16Draft(taskId);
    if (prepared === null) return null;
    const base = this.b2.base;
    const expected = [{ ref: base.goalRef, revision: this.goalOf().revision }];
    const ctx = this.ctxFor(caller);
    const proposed = await this.quietRefusal(`W16 proposal by ${caller}`, () => this.plans.proposePlan(ctx, { meta: { requestId: this.requestId(`w16-${caller}-propose`), expected },
      input: { goalRef: base.goalRef, basedOn: prepared.source.ref, draft: prepared.draft, reason: prepared.reason } }));
    if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
      // A proposal with issues is recorded (PLAN-01) and never adopted; the outcome names it.
      const answer = proposed.status === 'committed' ? { status: 'issues' } : proposed;
      await this.gate.check('W16 proposal');
      return { answer, change: prepared.change, proposal: null };
    }
    await this.gate.check('W16 proposal');
    if (!apply) return { answer: proposed, change: prepared.change, proposal: proposed.value };
    const applied = await this.quietRefusal(`W16 by ${caller}`, () => this.plans.applyPlanChange(ctx, { meta: { requestId: this.requestId(`w16-${caller}-apply`), expected },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } }));
    return { answer: applied, change: prepared.change, proposal: proposed.value };
  }

  /** W16 that changes only a disposition, adopted by a person, the automation or the Agent of G1 (TASK-18/19, guard 7). */
  private async opW16(caller: AgentCaller): Promise<void> {
    const done = await this.proposeAndApply(caller, true);
    if (done === null) return;
    const outcome = outcomeOf(done.answer);
    this.counts.add(`w16:${caller}:${outcome}`);
    this.record(`W16 by ${caller}: ${done.change}: ${outcome}${reasonOf(done.answer)}`);
    await this.gate.check(`W16 by ${caller}`, outcome === 'committed' ? ownerStep('plan_adopted', this.actorFor(caller), this.policy, 'W16') : undefined);
  }

  /**
   * A W16 of G1 that only adds an active carrier of its obligation, adopted by `caller` through `plans` (the production
   * owner, or one racing through a barrier). Answers the adoption, or null when the proposal was refused or had issues.
   */
  private async proposeCarrier(caller: AgentCaller, label: string): Promise<{ proposal: PlanProposal; carrier: string; fenced: boolean } | null> {
    const world = this.world();
    const base = this.b2.base;
    const active = this.goalOf().activePlanRevision;
    const source = active === null ? undefined : world.plans.find((plan) => plan.ref.planId === active.planId);
    if (source === undefined) return null;
    const carrier = `fuzz-carrier-${this.options.seed}-${++this.sequence}`;
    const draft = futureDraftOf(source, `fuzz-agent-plan-${this.options.seed}-${++this.sequence}`);
    addCarrier(draft, carrier);
    const proposed = await this.quietRefusal(`${label} proposal`, () => this.plans.proposePlan(this.ctxFor(caller), {
      meta: { requestId: this.requestId('carrier-propose'), expected: [{ ref: base.goalRef, revision: this.goalOf().revision }] },
      input: { goalRef: base.goalRef, basedOn: source.ref, draft, reason: { text: `fuzz guard 9: adds carrier ${carrier}`, sources: [] } } }));
    await this.gate.check(`${label} proposal`);
    if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
      this.counts.add(`carrier-proposal:${proposed.status === 'committed' ? 'issues' : outcomeOf(proposed)}`);
      return null;
    }
    return { proposal: proposed.value, carrier, fenced: guard9Fenced(world, source, draft) };
  }

  /**
   * Adopts a carrier proposal as `caller` and judges guard 9 (LA-3): an automatic adoption while every existing carrier
   * is fenced commits nothing and is `forbidden`; a committed one is checked with its step (I-17's guard 9 clause).
   */
  private async adoptCarrier(caller: AgentCaller, prepared: { proposal: PlanProposal; carrier: string; fenced: boolean }, label: string): Promise<string> {
    const base = this.b2.base;
    const adopted = await this.quietRefusal(label, () => this.plans.applyPlanChange(this.ctxFor(caller), {
      meta: { requestId: this.requestId('carrier-apply'), expected: [{ ref: base.goalRef, revision: this.goalOf().revision }] },
      input: { proposalRef: prepared.proposal.ref, expectedProposalRevision: prepared.proposal.revision, decisionRefs: [] } }));
    const outcome = outcomeOf(adopted);
    const cls = caller === 'agent-other-goal' ? 'agent' : caller;
    this.counts.add(`w16:${cls}:carrier:${outcome}`);
    if (prepared.fenced) this.counts.add(`guard9:${cls}:carrier-only:${outcome}`);
    this.record(`${label}: ${caller} adds carrier ${prepared.carrier}${prepared.fenced ? ' (every existing carrier fenced)' : ''}: ${outcome}${reasonOf(adopted)}`);
    if (prepared.fenced && cls !== 'human' && outcome !== 'rejected:forbidden') {
      throw new Error(`guard 9: a ${cls} adoption adding carrier ${prepared.carrier} while every existing carrier is fenced must be forbidden, `
        + `got ${outcome}${reasonOf(adopted)}\n${this.replayText()}`);
    }
    await this.gate.check(label, adopted.status === 'committed' ? ownerStep('plan_adopted', this.actorFor(caller), this.policy, label) : undefined);
    return outcome;
  }

  /**
   * Guard 9 decided in sequence (LA-3): the target's selected Run is fenced (a person stopped it), a person pauses the
   * Agent writer's Run, the last unfenced active carrier of G1's obligation, and then the automation, or the Agent
   * writer itself, adopts a W16 that only adds a carrier: `forbidden`, nothing written (`adoptCarrier`).
   */
  private async opGuard9Sequential(): Promise<void> {
    const writer = this.agentWriter;
    if (writer === null || !this.carrierRaceApplies()) return;
    const paused = await this.quietRefusal('control pause', () => this.controls.submitControl(this.hostCtx(), { input: { runRef: writer.claim.runRef,
      kind: 'pause', reason: 'fuzz guard 9: a person stops the last carrier' }, meta: { requestId: this.requestId('guard9-pause'), expected: [this.pinOf(writer.claim.runRef)] } }));
    this.counts.add(`control:pause:human:${outcomeOf(paused)}`);
    this.record(`guard 9 in sequence: a person pauses the Agent writer's Run ${writer.claim.runRef.runId}: ${outcomeOf(paused)}${reasonOf(paused)}`);
    await this.gate.check('guard 9: the last carrier paused');
    const adopter = this.rng.weighted<AgentCaller>([[3, 'system'], [1, 'agent']]);
    const prepared = await this.proposeCarrier(adopter, 'guard 9 in sequence');
    if (prepared === null) return;
    if (!prepared.fenced) {
      this.counts.add('guard9-sequential:not-fenced');
      return;
    }
    const outcome = await this.adoptCarrier(adopter, prepared, 'guard 9 in sequence');
    this.counts.add(`guard9-sequential:${adopter}:${outcome}`);
  }

  /** The pin of a Run as the last checked world holds it. */
  private pinOf(runRef: RunRef): { ref: RunRef; revision: number } {
    const run = this.world().runs.find((candidate) => candidate.ref.runId === runRef.runId);
    if (run === undefined) throw new Error(`fuzz: Run ${runRef.runId} is not in the world`);
    return { ref: run.ref, revision: run.revision };
  }

  /**
   * The executor's round on a completed Run (VR-01..VR-07 through the evidence owner, as the Host's check runner does
   * it): the target's (G1's requirement kind has no registered check, so its round has no check and finalizes with
   * the requirement uncovered) or the R3e subject's (static checks). A round is opened when the chain has none, every
   * pending check begins and records an executed result (exit 1 mostly, so the round FAILs), then it finalizes.
   */
  private async opVerify(): Promise<void> {
    const runs = this.verifiable();
    if (runs.length === 0) return;
    const run = this.rng.pick(runs);
    const ctx = this.r3e.ctx;
    const chain = run.ref.goalId === this.r3e.goalRef.goalId ? 'r3e' : 'g1';
    const head = workHeadIn(this.world(), run);
    let round: RoundSnapshot;
    if (head.kind === 'head') {
      round = head.head;
    } else {
      const planRef = this.goalOf(run.ref.goalId).activePlanRevision;
      if (planRef === null) return;
      const opened = await this.quietRefusal('round open', () => this.evidence.openVerification(ctx, { input: { subjectRunRef: run.ref, subject: run.task, planRef },
        meta: { requestId: this.requestId('open'), expected: [] } }));
      this.counts.add(`verify:${chain}:open:${outcomeOf(opened)}`);
      this.record(`open a round on ${chain} Run ${run.ref.runId}: ${outcomeOf(opened)}${reasonOf(opened)}`);
      await this.gate.check('round open', opened.status === 'committed' ? ownerStep('round_opened', R3E_HOST, this.policy, 'round open') : undefined);
      if (opened.status !== 'committed') return;
      round = opened.value;
    }
    const exitCode = this.rng.chance(0.15) ? 0 : 1;
    for (const check of round.checks.filter((candidate) => candidate.phase === 'pending')) {
      const begun = await this.quietRefusal('check begin', () => this.evidence.beginCheck(ctx, { input: { roundRef: round.ref, checkId: check.checkId },
        meta: { requestId: this.requestId('begin'), expected: [{ ref: round.ref, revision: round.revision }] } }));
      this.counts.add(`verify:${chain}:begin:${outcomeOf(begun)}`);
      await this.gate.check('check begin', begun.status === 'committed' ? ownerStep('check_begun', R3E_HOST, this.policy, 'check begin') : undefined);
      // A begin refused for good (the source moved since the open, VD-8) ends the attempts: the round finalizes with
      // the remaining checks as gaps, as the Workflow's exit #3 does; a stale pin only waits.
      if (begun.status !== 'committed' && begun.code === 'revision_conflict') return;
      if (begun.status !== 'committed') break;
      const read = await this.evidence.readVerification(ctx, round.ref);
      if (read.status !== 'ready') return;
      const recorded = await this.quietRefusal('check result', () => this.evidence.recordCheckResult(ctx, { input: { roundRef: round.ref, checkId: check.checkId,
        invocationId: begun.value.invocationId, observation: observedCheck(exitCode) }, meta: { requestId: this.requestId('record'),
        expected: [{ ref: read.value.ref, revision: read.value.revision }] } }));
      this.counts.add(`verify:${chain}:record:${outcomeOf(recorded)}`);
      await this.gate.check('check result');
      if (recorded.status !== 'committed') return;
      round = recorded.value;
    }
    const finalized = await this.quietRefusal('round finalize', () => this.evidence.finalizeChecks(ctx, { input: { roundRef: round.ref },
      meta: { requestId: this.requestId('finalize'), expected: [{ ref: round.ref, revision: round.revision }] } }));
    const verdict = finalized.status === 'committed' ? finalized.value.snapshot.outcome : null;
    this.counts.add(`verify:${chain}:finalize:${outcomeOf(finalized)}:${String(verdict)}`);
    this.record(`round ${round.ref.roundId} on ${chain} Run ${run.ref.runId} (exit ${exitCode}): finalize ${outcomeOf(finalized)} → ${String(verdict)}${reasonOf(finalized)}`);
    await this.gate.check('round finalize');
    // TD-6: the Agent of the Goal reworks a failed round first half of the time.
    if (finalized.status === 'committed' && isFinalizedNonPass(finalized.value.snapshot) && this.rng.chance(0.5)) {
      await this.opReverify(finalized.value.snapshot, 'agent');
    }
  }

  /**
   * VR-14 by the three classes (§11.11 "work 链与 gate 链，三类操作者"): a reverify of a finalized non-PASS head, the
   * target's or the R3e subject's, by the Agent of the head's Goal (`reverify_round` granted: on the R3e chain it opens
   * a successor; on G1's the requirement stays uncovered, so it ends in a policy refusal), an Agent of another Goal
   * (`forbidden`), a person or the automation, with or without `onlyIfSourceChanged` and a note. The human-stop fence is
   * judged on the answer (`fenceProblem`): on a Run a person paused before it completed, a system or agent reverify
   * commits nothing and is `forbidden`. A cap of 0 makes the Agent's counted reverify a committed `auto_rework_cap_reached`.
   */
  private async opReverify(explicit: RoundSnapshot | null = null, by: AgentCaller | null = null): Promise<void> {
    const heads = this.reverifiable();
    if (heads.length === 0 && explicit === null) return;
    const round = explicit ?? this.rng.pick(heads);
    const world = this.world();
    const goalId = round.ref.goalId;
    const chain = goalId === this.r3e.goalRef.goalId ? 'r3e' : 'g1';
    const caller = by ?? this.rng.weighted<AgentCaller>([[5, 'agent'], [2, 'human'], [2, 'system'], [1, 'agent-other-goal']]);
    const cls = caller === 'agent-other-goal' ? 'agent' : caller;
    const input: ReverifyRoundInput = { predecessorRoundRef: round.ref, reason: `fuzz ${caller} reverify` };
    if (this.rng.chance(0.25)) input.onlyIfSourceChanged = true;
    if (caller === 'human' && this.rng.chance(0.2)) input.note = `fuzz reverify note ${this.sequence}`;
    const refusal = world.refusals.find((candidate) => candidate.ref.operation === 'reverify' && candidate.ref.subjectId === round.ref.roundId);
    const expected = [{ ref: round.ref, revision: round.revision },
      ...(caller !== 'human' && this.rng.chance(0.6) ? [{ ref: { aggregateType: 'TaskReworkRefusal' as const, projectId: round.ref.projectId,
        goalId, taskId: round.ref.taskId, operation: 'reverify' as const, subjectId: round.ref.roundId }, revision: refusal?.revision ?? 0 }] : [])];
    const subject = world.runs.find((run) => run.ref.runId === round.subjectRunRef.runId);
    const fence: ReworkFence = subject === undefined ? 'none' : fenceIn(world, subject);
    const reaches = caller !== 'agent-other-goal' && reverifyReachesFence(world, round);
    const answer = await this.quietRefusal(`${caller} reverify`, () => this.evidence.reverifyRound!(this.ctxFor(caller, goalId),
      { input, meta: { requestId: this.requestId(`reverify-${caller}`), expected } }));
    const outcome = outcomeOf(answer);
    this.counts.add(`reverify:${caller}:${chain}:${outcome}`);
    if (outcome === 'rejected:forbidden') this.counts.add(`forbidden:reverify:${cls}:${forbiddenKind(answer)}`);
    if (fence !== 'none') this.counts.add(`fence:reverify:${cls}:${fence}:${outcome}`);
    this.record(`${caller} reverify of ${chain} round ${round.ref.roundId}${input.onlyIfSourceChanged === true ? ' onlyIfSourceChanged' : ''}`
      + `${input.note === undefined ? '' : ' +note'}${fence === 'none' ? '' : ` (fence ${fence})`}: ${outcome}${reasonOf(answer)}`);
    const problem = fenceProblem({ cls, fence, continuation: false, reachesFence: reaches, answer });
    if (problem !== null) throw new Error(`${caller} reverify of round ${round.ref.roundId}: ${problem}\n${this.replayText()}`);
    if (caller === 'agent-other-goal' && outcome !== 'rejected:forbidden') {
      throw new Error(`an Agent of another Goal reverified round ${round.ref.roundId}: ${outcome}\n${this.replayText()}`);
    }
    const kind = reworkStepKind(answer, 'round_reverified');
    await this.gate.check(`${caller} reverify`, kind === null ? undefined : ownerStep(kind, this.actorFor(caller, goalId), this.policy, `${caller} reverify`));
  }

  /**
   * §3.3 point 2 and the PLAN-05 test row, both writers in one read window (`commitBarrier`): a person's requeue of the
   * target and a W16 that changes only the target's disposition. W16 pins no TaskRequeue, so it commits; the requeue
   * pins Goal@rev, which W16 moves, so it commits only when its commit lands first, and behind W16 it is
   * `revision_conflict`. The losing requeue, retried once from a fresh read, is `invalid` (task_not_active) when the
   * W16 made the Task non-active, else it commits.
   */
  private async opRaceRequeueW16(): Promise<void> {
    const request = this.requeueRequest('human');
    if (request === null) return;
    const prepared = await this.proposeAndApply('human', false);
    if (prepared === null || prepared.proposal === null) {
      this.counts.add('race-requeue-w16:no-proposal');
      return;
    }
    const base = this.b2.base;
    const barrier = commitBarrier(base.records, this.rng.chance(0.5));
    const racedPlans = createPlanService({ records: barrier.records, bindings: createInitializationBindingReader({ records: barrier.records }),
      now: () => B2_AT,
      eventId: () => `fuzz-agent-${this.options.seed}-race-${++this.sequence}`, delegatedWrites: this.delegatedWrites });
    const proposal = prepared.proposal;
    const [requeued, adopted] = await Promise.all([
      barrier.settle(this.requeueService(barrier.records).requeueTask(this.hostCtx(), request)),
      barrier.settle(racedPlans.applyPlanChange(this.hostCtx(), { meta: { requestId: this.requestId('race-w16-apply'),
        expected: [{ ref: base.goalRef, revision: this.goalOf().revision }] },
      input: { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] } })),
    ]);
    this.counts.add(`race-requeue-w16:${barrier.arrivals()}:${outcomeOf(requeued)}|${outcomeOf(adopted)}`);
    this.record(`race: requeue of Run ${request.input.afterRunRef.runId} ∥ W16 ${prepared.change} (${barrier.arrivals()} at the commit${barrier.secondFirst ? ', the later one first' : ''}): `
      + `requeue ${outcomeOf(requeued)}${reasonOf(requeued)}, W16 ${outcomeOf(adopted)}${reasonOf(adopted)}`);
    this.raceOutcomes.push({ kind: 'requeue-w16', arrivals: barrier.arrivals(), first: outcomeOf(requeued), second: outcomeOf(adopted) });
    // §3.3 point 2: W16 pins no TaskRequeue, so a W16 that reached its commit beside the requeue commits whatever the order.
    if (barrier.arrivals() === 2 && adopted.status !== 'committed') {
      throw new Error(`requeue ∥ W16 race: W16 ${outcomeOf(adopted)}${reasonOf(adopted)} (it pins no TaskRequeue)\n${this.replayText()}`);
    }
    // ... and the requeue pins Goal@rev, which W16 moves (a committed refusal reuses the same read set, TASK-28): a
    // requeue or refusal that committed beside a W16 committed first.
    const adoptedPlanId = adopted.status === 'committed' ? (adopted.value as PlanRevisionSnapshot).ref.planId : null;
    const requeuedRunId = requeued.status === 'committed' ? request.input.afterRunRef.runId : null;
    const requeueEvent = outcomeOf(requeued).startsWith('refused:') ? 'TaskReworkRefused' : 'TaskRequeued';
    const [requeuedAt = null, adoptedAt = null] = eventOrder(base.ledgerPath, [[requeueEvent, requeuedRunId],
      ['PlanRevisionAccepted', adoptedPlanId]]);
    if (requeuedAt !== null && adoptedAt !== null && requeuedAt > adoptedAt) {
      throw new Error(`requeue ∥ W16 race: the requeue (${outcomeOf(requeued)}) committed after W16 moved the Goal revision it pins\n${this.replayText()}`);
    }
    // ... so behind W16 the requeue is refused as stale.
    if (barrier.arrivals() === 2 && requeued.status !== 'committed' && outcomeOf(requeued) !== 'rejected:revision_conflict') {
      throw new Error(`requeue ∥ W16 race: a requeue behind W16 must be revision_conflict, got ${outcomeOf(requeued)}${reasonOf(requeued)}\n${this.replayText()}`);
    }
    // Two writes in one step: no single step kind covers both; the cross-step clauses still run.
    await this.gate.check('race requeue ∥ W16');
    if (barrier.arrivals() !== 2 || requeued.status === 'committed') return;
    // The retry from a fresh read (new requestId, fresh pins).
    const after = this.world().runs.find((run) => run.ref.runId === request.input.afterRunRef.runId) ?? null;
    const active = this.taskActive();
    const retried = await this.opRequeue('human', after);
    this.counts.add(`race-requeue-w16:retry:${active ? 'active' : 'not-active'}:${retried}`);
    const committed = retried === 'committed' || retried.startsWith('refused:');
    if (active ? !committed : retried !== 'rejected:invalid') {
      throw new Error(`requeue ∥ W16 race: the retried requeue on a${active ? 'n active' : ' non-active'} Task must `
        + `${active ? 'commit' : 'be invalid'}, got ${retried}\n${this.replayText()}`);
    }
  }

  /** The requeue-or-refusal race on one afterRun (§13.3, I-18): a person's and the automation's request in one read window. */
  private async opRaceRequeueRefusal(): Promise<void> {
    const human = this.requeueRequest('human');
    const after = this.world().runs.find((run) => run.ref.runId === human?.input.afterRunRef.runId) ?? null;
    const system = after === null ? null : this.requeueRequest('system', after);
    if (human === null || system === null) return;
    const barrier = commitBarrier(this.b2.base.records, this.rng.chance(0.5));
    const service = this.requeueService(barrier.records);
    const [first, second] = await Promise.all([barrier.settle(service.requeueTask(this.hostCtx(), human)),
      barrier.settle(service.requeueTask(this.ctxFor('system'), system))]);
    this.counts.add(`race-requeue-refusal:${barrier.arrivals()}:${outcomeOf(first)}|${outcomeOf(second)}`);
    this.record(`race: human ∥ system requeue of Run ${human.input.afterRunRef.runId} (${barrier.arrivals()} at the commit${barrier.secondFirst ? ', the later one first' : ''}): `
      + `${outcomeOf(first)}${reasonOf(first)} | ${outcomeOf(second)}${reasonOf(second)}`);
    this.raceOutcomes.push({ kind: 'requeue-refusal', arrivals: barrier.arrivals(), first: outcomeOf(first), second: outcomeOf(second) });
    // §11.15 (I-18 table): of two writers on one afterRun that both reached the commit, exactly one commits; the other is revision_conflict.
    const committed = [first, second].filter((answer) => answer.status === 'committed').length;
    if (barrier.arrivals() === 2 && (committed !== 1 || ![first, second].some((answer) => outcomeOf(answer) === 'rejected:revision_conflict'))) {
      throw new Error(`requeue race: ${outcomeOf(first)} | ${outcomeOf(second)} (exactly one commit expected)\n${this.replayText()}`);
    }
    await this.gate.check('race human ∥ system requeue');
  }

  /**
   * The guard 9 race (§3 PLAN-05 守卫 9, lead decision LA-3; 5.10 IMPL §9.1): the automation adds a new active carrier of
   * the obligation whose other carrier (the target) a person stopped, while a person pauses the last unfenced carrier
   * (the Agent writer's Run) in the same read window. The adoption pins that carrier's selected Run and pointer, so it
   * may commit only ahead of the pause (it then saw an unfenced carrier); behind the pause it must be `revision_conflict`
   * ("并发的人工暂停/取消……会让采用 revision_conflict"). The commit order is read from the ledger's event rows. An adoption
   * that lost, retried from a fresh read, meets guard 9 itself: `forbidden` (`adoptCarrier`).
   */
  private async opRaceCarrierPause(): Promise<void> {
    const writer = this.agentWriter;
    if (writer === null || !this.carrierRaceApplies()) {
      this.counts.add('race-carrier-pause:not-applicable');
      return;
    }
    const prepared = await this.proposeCarrier('system', 'guard 9 race');
    if (prepared === null) return;
    const base = this.b2.base;
    const expected = [{ ref: base.goalRef, revision: this.goalOf().revision }];
    const barrier = commitBarrier(base.records, this.rng.chance(0.5));
    const now = (): string => B2_AT;
    const eventId = (): string => `fuzz-agent-${this.options.seed}-race9-${++this.sequence}`;
    const racedPlans = createPlanService({ records: barrier.records, bindings: createInitializationBindingReader({ records: barrier.records }),
      now, eventId, delegatedWrites: this.delegatedWrites });
    const racedControls = createRunControlService({ records: barrier.records, authority: createMaterialRecordReaders(barrier.records).authority,
      reads: createRunStateReader({ records: barrier.records }), now, eventId });
    const [adopted, paused] = await Promise.all([
      barrier.settle(racedPlans.applyPlanChange(this.ctxFor('system'), { meta: { requestId: this.requestId('race9-apply'), expected },
        input: { proposalRef: prepared.proposal.ref, expectedProposalRevision: prepared.proposal.revision, decisionRefs: [] } })),
      barrier.settle(racedControls.submitControl(this.hostCtx(), { input: { runRef: writer.claim.runRef, kind: 'pause', reason: 'fuzz guard 9 pause' },
        meta: { requestId: this.requestId('race9-pause'), expected: [await this.b2.pin(writer.claim)] } })),
    ]);
    const adoptedPlanId = adopted.status === 'committed' ? (adopted.value as PlanRevisionSnapshot).ref.planId : null;
    const pausedIntentId = paused.status === 'committed' ? (paused.value as { intent: { ref: { intentId: string } } }).intent.ref.intentId : null;
    const order = eventOrder(base.ledgerPath, [['PlanRevisionAccepted', adoptedPlanId], ['ControlIntentSubmitted', pausedIntentId]]);
    const outcome = `${outcomeOf(adopted)}|${outcomeOf(paused)}`;
    this.counts.add(`race-carrier-pause:${barrier.arrivals()}:${outcome}`);
    this.record(`race (guard 9): system adds carrier ${prepared.carrier} ∥ a person pauses the Agent writer's Run (${barrier.arrivals()} at the commit${barrier.secondFirst ? ', the later one first' : ''}): `
      + `adoption ${outcomeOf(adopted)}${reasonOf(adopted)}, pause ${outcomeOf(paused)}${reasonOf(paused)}, commit order ${JSON.stringify(order)}`);
    this.raceOutcomes.push({ kind: 'carrier-pause', arrivals: barrier.arrivals(), first: outcomeOf(adopted), second: outcomeOf(paused) });
    const adoptedAt = order[0] ?? null;
    const pausedAt = order[1] ?? null;
    if (adoptedAt !== null && pausedAt !== null && pausedAt < adoptedAt) {
      throw new Error(`guard 9 race: the automation's carrier adoption committed after a person paused the last unfenced carrier\n${this.replayText()}`);
    }
    await this.gate.check('race carrier ∥ pause');
    if (paused.status !== 'committed' || adopted.status === 'committed') return;
    // The adoption that lost, retried from a fresh read: every existing carrier is fenced now.
    const retry = await this.proposeCarrier('system', 'guard 9 race retry');
    if (retry !== null) this.counts.add(`guard9-race-retry:${retry.fenced ? 'fenced' : 'not-fenced'}:${await this.adoptCarrier('system', retry, 'guard 9 race retry')}`);
  }

  /**
   * PLAN-05 (§3 test row "TASK-19 与选中 Run 上的 submitControl 并发"): a W16 that changes only implement-a's
   * disposition (adopted by the automation or the Agent writer) and a person's pause or cancel of implement-a's
   * selected Run, in one read window (`commitBarrier`, both commit orders). When both reach their commit, exactly one
   * commits and the other is `revision_conflict`; the loser, retried once from a fresh read, is judged again (guards 3
   * and 7: an automatic adopter after a person's stop that landed is `forbidden` or `busy`). Today no Run state lets
   * both reach the commit (a Run that takes a control is unfinished, or a yielded wait whose pointer is not a cancel:
   * guards 1 and 3 refuse the W16 `busy` first; a Run that passes them refuses every control), so `arrivals` shows how
   * far each got (NOTES QUESTION Q4).
   */
  private async opRaceW16Control(): Promise<void> {
    const run = this.targetRun();
    if (run === undefined) return;
    const adopter = this.rng.pick<AgentCaller>(['system', 'agent']);
    const prepared = await this.proposeAndApply(adopter, false, this.targetClaim.task.taskId);
    if (prepared === null || prepared.proposal === null) {
      this.counts.add('race-w16-control:no-proposal');
      return;
    }
    const base = this.b2.base;
    const kind = this.rng.pick<ControlIntentKindV1>(['pause', 'cancel']);
    const barrier = commitBarrier(base.records, this.rng.chance(0.5));
    const now = (): string => B2_AT;
    const eventId = (): string => `fuzz-agent-${this.options.seed}-racew16c-${++this.sequence}`;
    const racedPlans = createPlanService({ records: barrier.records, bindings: createInitializationBindingReader({ records: barrier.records }),
      now, eventId, delegatedWrites: this.delegatedWrites });
    const racedControls = createRunControlService({ records: barrier.records, authority: createMaterialRecordReaders(barrier.records).authority,
      reads: createRunStateReader({ records: barrier.records }), now, eventId });
    const proposal = prepared.proposal;
    const applyRequest = (): Parameters<PlanTaskPort['applyPlanChange']>[1] => ({ meta: { requestId: this.requestId('race-w16c-apply'),
      expected: [{ ref: base.goalRef, revision: this.goalOf().revision }] },
    input: { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] } });
    const controlRequest = (): Parameters<RunControlPort['submitControl']>[1] => ({ input: { runRef: run.ref, kind, reason: `fuzz ${kind} ∥ W16` },
      meta: { requestId: this.requestId(`race-w16c-${kind}`), expected: [this.pinOf(run.ref)] } });
    const [adopted, controlled] = await Promise.all([
      barrier.settle(racedPlans.applyPlanChange(this.ctxFor(adopter), applyRequest())),
      barrier.settle(racedControls.submitControl(this.hostCtx(), controlRequest())),
    ]);
    const arrivals = barrier.arrivals();
    this.counts.add(`race-w16-control:${arrivals}:${outcomeOf(adopted)}|${outcomeOf(controlled)}`);
    this.record(`race: W16 by ${adopter} ${prepared.change} ∥ a person's ${kind} of Run ${run.ref.runId} (${run.status} ${String(run.outcome)}; `
      + `${arrivals} at the commit${barrier.secondFirst ? ', the later one first' : ''}): W16 ${outcomeOf(adopted)}${reasonOf(adopted)}, `
      + `${kind} ${outcomeOf(controlled)}${reasonOf(controlled)}`);
    this.raceOutcomes.push({ kind: 'w16-control', arrivals, first: outcomeOf(adopted), second: outcomeOf(controlled) });
    const committed = [adopted, controlled].filter((answer) => answer.status === 'committed').length;
    if (arrivals === 2 && (committed !== 1 || ![adopted, controlled].some((answer) => outcomeOf(answer) === 'rejected:revision_conflict'))) {
      throw new Error(`W16 ∥ control race: ${outcomeOf(adopted)} | ${outcomeOf(controlled)} (exactly one commit, the other revision_conflict)\n${this.replayText()}`);
    }
    await this.gate.check('race W16 ∥ control', adopted.status === 'committed' && controlled.status !== 'committed'
      ? ownerStep('plan_adopted', this.actorFor(adopter), this.policy, 'race W16 ∥ control') : undefined);
    if (arrivals !== 2) return;
    if (outcomeOf(adopted) === 'rejected:revision_conflict') {
      // Guards 3 and 7 decide again on the Run the person's control changed.
      const fresh = this.targetRun();
      const fenced = fresh !== undefined && fenceIn(this.world(), fresh) !== 'none';
      const retried = await this.quietRefusal('W16 retry', () => this.plans.applyPlanChange(this.ctxFor(adopter), applyRequest()));
      this.counts.add(`race-w16-control:retry-w16:${outcomeOf(retried)}`);
      this.record(`  W16 retried from a fresh read: ${outcomeOf(retried)}${reasonOf(retried)}`);
      if (fenced && !['rejected:forbidden', 'rejected:busy'].includes(outcomeOf(retried))) {
        throw new Error(`W16 ∥ control race: after a person's ${kind} landed, the ${adopter} W16 retried must be forbidden or busy, `
          + `got ${outcomeOf(retried)}\n${this.replayText()}`);
      }
      await this.gate.check('W16 retry', retried.status === 'committed' ? ownerStep('plan_adopted', this.actorFor(adopter), this.policy, 'W16 retry') : undefined);
    } else if (outcomeOf(controlled) === 'rejected:revision_conflict') {
      const retried = await this.quietRefusal('control retry', () => this.controls.submitControl(this.hostCtx(), controlRequest()));
      this.counts.add(`race-w16-control:retry-control:${outcomeOf(retried)}`);
      this.record(`  ${kind} retried from a fresh read: ${outcomeOf(retried)}${reasonOf(retried)}`);
      await this.gate.check('control retry');
    }
  }
}

/**
 * A write counter of a ledger, read with its own read-only connection: the last event row id plus the number of
 * commit receipts (every commit appends its events and one idempotency row; a replay appends nothing), so it grows
 * with every commit and stays put otherwise.
 */
export function ledgerWrites(ledgerPath: string): number {
  const database = new DatabaseSync(ledgerPath, { readOnly: true });
  try {
    const row = database.prepare('SELECT (SELECT COALESCE(MAX(id), 0) FROM events) AS events, (SELECT COUNT(*) FROM idempotency) AS commits')
      .get() as { events: number; commits: number };
    return Number(row.events) + Number(row.commits);
  } finally {
    database.close();
  }
}

/**
 * The ledger row id (commit order) of the first event of each `[eventType, id]` whose JSON names `id`, or of the last
 * one for `TaskReworkRefused` (a refusal record takes one event per revision); null for a null id or no such event.
 * Read with its own read-only connection.
 */
function eventOrder(ledgerPath: string, wanted: ReadonlyArray<readonly [string, string | null]>): Array<number | null> {
  const database = new DatabaseSync(ledgerPath, { readOnly: true });
  try {
    const rows = database.prepare('SELECT id, event_json FROM events ORDER BY id').all() as Array<{ id: number; event_json: string }>;
    return wanted.map(([eventType, id]) => {
      if (id === null) return null;
      const matches = (candidate: { event_json: string }): boolean => candidate.event_json.includes(`"eventType":"${eventType}"`) && candidate.event_json.includes(id);
      const row = eventType === 'TaskReworkRefused' ? rows.findLast(matches) : rows.find(matches);
      return row === undefined ? null : Number(row.id);
    });
  } finally {
    database.close();
  }
}

/**
 * Creates every lookup index the composition root registers on the fixture's ledger (DDL only, no record): the
 * invariant read opens its copy with all of them, and creating the missing ones on every copy would cost most of
 * each check. The same schema groups as `readInvariantWorld` reads with (tests/state/invariants.ts).
 */
async function warmLookupIndexes(ledgerPath: string): Promise<void> {
  const backend = createSqliteRecordBackend({ path: ledgerPath, schemas: platformRecordSchemas() });
  await backend.close();
}

/**
 * Two writers in one read window: each commit through `records` waits until both writers reached their commit, or the
 * other writer finished without one (`settle`). Then the commits go one after the other, the first arrival first, or
 * the second first when `secondFirst` (the seed picks), so both commit orders of the race occur. (The barrier of
 * `synchronizeB2Commits` keeps the arrival order and fails when the second writer never commits.)
 */
function commitBarrier(records: B2ExecutionFixture['base']['records'], secondFirst: boolean) {
  let arrivals = 0;
  const turns: Array<() => void> = [];
  let opened = false;
  /** Lets the waiting commits go: in the chosen order when both arrived, else the one there is. */
  const open = (): void => {
    if (opened) return;
    opened = true;
    const order = secondFirst && turns.length === 2 ? [turns[1]!, turns[0]!] : [...turns];
    order[0]?.();
    pending = order.slice(1);
  };
  let pending: Array<() => void> = [];
  const wrapped: B2ExecutionFixture['base']['records'] = { ...records, async commit(batch) {
    arrivals += 1;
    const turn = new Promise<void>((resolve) => { turns.push(resolve); });
    if (opened) turns.at(-1)?.();
    if (arrivals === 2) open();
    await turn;
    try {
      return await records.commit(batch);
    } finally {
      pending.shift()?.();
    }
  } };
  return {
    records: wrapped,
    secondFirst,
    arrivals: () => arrivals,
    async settle<T>(work: Promise<T>): Promise<Settled<T>> {
      try { return await work; } catch (error) { return { status: 'thrown', reason: String(error) }; } finally { open(); }
    },
  };
}

/** A v2 future draft of the active Plan (v1 or v2), as the W2 fixture's `futureDraftFor` builds it. */
function futureDraftOf(plan: PlanRevisionSnapshot, planId: string): DraftV2 {
  return { schemaVersion: 2, planId, planRevision: plan.planRevision + 1, goalId: plan.goalRef.goalId,
    stages: structuredClone(plan.stages), tasks: structuredClone(plan.tasks), assignments: structuredClone(plan.assignments ?? []),
    obligations: structuredClone(plan.obligations), taskHierarchy: structuredClone(plan.taskHierarchy),
    executionDag: structuredClone(plan.executionDag),
    taskRelations: plan.schemaVersion === 2 ? structuredClone(plan.taskRelations ?? []) : [],
    inputRequirements: plan.schemaVersion === 2 ? structuredClone(plan.inputRequirements ?? []) : [] };
}
