/**
 * Invariant checks of the state machines (spec §11; §11.11 and §15.1: they
 * live under `tests/state/` and never enter product code).
 *
 * - `runCombinationProblem`: the §6.1 record check the Run machine tests use
 *   (moved from `run-machine.ts` in A.2 step 4).
 * - `readInvariantWorld(store, projectId)`: one read window over every §11.0
 *   record kind of a SQLite platform ledger plus the event-log entries §11.11
 *   names, read through the registered record schemas and the owners' codecs,
 *   with `phase(t)` from `readCanonicalTaskFacts` over the same window.
 * - `checkI1..checkI22`: one checker per invariant under the §11 names, each
 *   `(world, prev?, step?) => InvariantViolation[]`; `checkAllInvariants`
 *   calls all of them and drops the findings §11 reports as `legacy`.
 * - `checkAttemptPairing`: the §5.1 D-14 pairing table (§5.6), shared by I-1
 *   (open Attempts) and I-6 (ended Attempts).
 *
 * Step-local clauses (I-3, I-12, I-17, I-18, I-20, I-21) run only when a
 * `FuzzStep` of the matching kind is given, and find the records the step
 * wrote by comparing `prev` with `world`; cross-step clauses (I-7, I-8, I-15,
 * I-18, I-19) run only when `prev` is given (§11.11).
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActorRef } from '../../src/contracts/command-event.js';
import {
  continuationBriefDigest, continuationBriefMarker, renderContinuationBriefZh, type ContinuationBriefV1,
} from '../../src/contracts/continuation-brief.js';
import type { ControlIntentKindV1, ControlIntentRef, ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import type { ExecutionRef } from '../../src/contracts/core/identity.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type {
  ExecutionAuthorizationV2, RunOutcome, RunRef, RunSnapshot, TaskAttemptSnapshot, TaskLeaseSnapshot,
} from '../../src/contracts/dispatch.js';
import { requirementKeyOf, type EvidenceSnapshot, type TaskEvidenceIndexSnapshot } from '../../src/contracts/evidence.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GoalPhaseSnapshot } from '../../src/contracts/goal-phase.js';
import type { GoalDesiredState, GoalSnapshot } from '../../src/contracts/ledger.js';
import type { Phase, PlanRevisionSnapshot, RuntimeTask, TaskKind } from '../../src/contracts/plan.js';
import type { QueryRunSnapshot } from '../../src/contracts/query-job.js';
import type { TaskReductionSnapshot } from '../../src/contracts/reduction.js';
import type { SessionAnomalyAnchorV1 } from '../../src/contracts/session-anomaly.js';
import type { TaskPhaseCauseV1 } from '../../src/contracts/task-failure.js';
import {
  GOAL_FAN_OUT_ACTOR, MAX_AUTO_REWORK_LIMIT, reworkActorClassOf, type ReworkActorClass, type TaskAutomationPolicyV1,
  type TaskRequeueRef, type TaskRequeueSnapshotV1, type TaskReworkRefusalSnapshotV1,
} from '../../src/contracts/task-requeue.js';
import { ROUND_CHAIN_MAX, type RoundSnapshot } from '../../src/contracts/verification.js';
import { loadPreparedManifest, rehydratePreparedExecution } from '../../src/core/agent-runtime/execution-preparation.js';
import { decodeStoredEventBody } from '../../src/core/record-store/record-codec.js';
import type { EncodedDomainEvent, EncodedRecord, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import { OBSERVED_ARCHITECTURE_RECORD_SCHEMAS } from '../../src/core/work-graph/architecture/architecture-record-codecs.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import {
  decodeSessionMessageRecord, SESSION_MESSAGE_RECORD_SCHEMAS,
} from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { ROLE_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/role-record-codecs.js';
import {
  decodeEvidenceSnapshot, decodeTaskEvidenceIndexSnapshot, decodeVerificationRoundSnapshot, EVIDENCE_RECORD_SCHEMAS,
  verificationRoundEventFromEvent,
} from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';
import {
  CONTROL_RECORD_SCHEMAS, controlIntentSubmittedEventFromEvent, decodeControlIntentSnapshot,
} from '../../src/core/work-graph/persistence/control-record-codecs.js';
import {
  EXECUTION_ENTRY_RECORD_SCHEMAS, executionEntryAuthorizedEventFromEvent,
} from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import { EXECUTION_HISTORY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-history-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import { UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import {
  decodeGoalCreatedEvent, decodeGoalDesiredStateChangedEvent, decodeGoalSnapshot,
} from '../../src/core/work-graph/persistence/record-codecs.js';
import { decodeQueryRunSnapshotRecord, QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import {
  decodeSessionAnomalyAnchor, SESSION_ANOMALY_RECORD_SCHEMAS,
} from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { decodeSessionRecord, SESSION_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import {
  decodeDispatchOutboxEntry, decodeTaskAttemptSnapshot, decodeTaskRequeueSnapshot, decodeTaskReworkRefusalSnapshot,
  TASK_CLAIM_RECORD_SCHEMAS, taskClaimedEventFromEvent, taskRequeuedEventFromEvent, taskReworkRefusedEventFromEvent,
} from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import type { TaskClaimOutbox } from '../../src/core/work-graph/model/claim-contracts.js';
import { COMPLETION_RECORD_SCHEMAS, decodeGoalPhaseSnapshot } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { decodePlanRevisionSnapshot, PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import {
  PLAN_GOVERNANCE_RECORD_SCHEMAS, PLAN_STATE_RECORD_SCHEMAS, readCanonicalTaskFacts,
} from '../../src/core/work-graph/tasks/plan-readers.js';
import { executionDefinitionsAgree, isBasisUnsupported, planTaskFacts } from '../../src/core/work-graph/tasks/plan-task-basis.js';
import { decodeRun } from '../../src/core/work-graph/materials/run-snapshot-decoder.js';
import { isPausedInterrupted, leaseOwnedByRun, runUnresolvedBlocker } from '../../src/core/work-graph/state/run-machine.js';
import { ownsOccupancy } from '../../src/core/work-graph/state/session-availability.js';
import {
  countEndedGoalRuns, deriveReworkClass, reworkFenceOf, stopRequesterOf, type ReworkFence,
  type VerifiedArchiveInterruptionV1,
} from '../../src/core/work-graph/state/task-failure.js';
import { unreachable } from '../../src/core/work-graph/state/transition.js';
import {
  chainEvidenceIds, isFinalizedNonPass, reverifyExemption, reverifyFailureClass, roundChainHead, roundOrdinalOf,
  type RoundChainHeadV1,
} from '../../src/core/work-graph/state/verification-machine.js';

function isAuthorizationV2(auth: ExecutionAuthorizationV2 | undefined): auth is ExecutionAuthorizationV2 {
  return auth !== undefined;
}

/**
 * §6.1 "其他 V2 组合视为损坏": the problem of a Run outside the eight machine
 * states, or `null`. A pre-B2 Run without an authorization is legacy history,
 * not damage. Every
 * record `transitionRun` produces passes it (§14.5); today's readers do not
 * cross-check (`record-readers.ts:313-314`), so it is the invariant check's tool.
 * Moved from `run-machine.ts` (A.2 step 4): no production path calls it.
 */
export function runCombinationProblem(record: RunSnapshot): string | null {
  const auth = record.executionAuthorization;
  if (auth !== undefined && !isAuthorizationV2(auth)) return null;
  const phase = isAuthorizationV2(auth) ? auth.phase : 'none';
  switch (record.status) {
    case 'starting':
      if (record.outcome !== null) return 'a starting Run has no outcome';
      return phase === 'none' || phase === 'authorized' || phase === 'entering' || phase === 'revoked'
        ? null : `a starting Run cannot carry the ${phase} entry phase`;
    case 'running':
      if (record.outcome !== null) return 'a running Run has no outcome';
      return phase === 'entered' || auth === undefined ? null : `a running Run cannot carry the ${phase} entry phase`;
    case 'ended': {
      const outcome = record.outcome;
      if (outcome === null) return 'an ended Run needs an outcome';
      if (outcome === 'failed') return 'the outcome failed has no writer';
      if (auth === undefined) return null;
      if (outcome === 'outcome_unknown') return phase === 'unknown' ? null : 'an outcome_unknown Run carries the unknown entry phase';
      if (outcome === 'yielded' && record.continuation === undefined) return 'a yielded Run carries its continuation';
      if (phase === 'settled') return null;
      // D-7: an un-entered stop ends a Run whose authorization was revoked (or never existed).
      return outcome === 'cancelled' && phase === 'revoked' ? null : `an ended Run cannot carry the ${phase} entry phase`;
    }
    default: return unreachable(record.status, 'Run status');
  }
}

// ------------------------------------------------------------------------ //
// World, findings and steps (§11.0, §11.11)                                 //
// ------------------------------------------------------------------------ //

export type InvariantId =
  | 'I-1' | 'I-2' | 'I-3' | 'I-4' | 'I-5' | 'I-6' | 'I-7' | 'I-8' | 'I-9' | 'I-10' | 'I-11'
  | 'I-12' | 'I-13' | 'I-14' | 'I-15' | 'I-16' | 'I-17' | 'I-18' | 'I-19' | 'I-20' | 'I-21' | 'I-22';

/** Slice 1 §5.1 additions; kept out of `INVARIANT_CHECKERS` so the §11 I-1..I-22 list stays frozen. */
export type Slice1InvariantId = 'S1-1' | 'S1-2' | 'S1-3' | 'S1-4' | 'S1-5' | 'S1-6';

/**
 * One finding: the invariant, the canonical key of the record it is about and
 * one sentence. `legacy` marks what §11 reports as `legacy` instead of a
 * violation (data written before the rule existed); `checkAllInvariants`
 * drops those and `legacyFindings` returns them.
 */
export type InvariantViolation = { invariant: InvariantId | Slice1InvariantId; ref: string; message: string; legacy?: true };

/** The operation a fuzz or scenario step committed (§11.11 `FuzzStep`). */
export type FuzzStepKind =
  | 'task_claimed' | 'entry_authorized' | 'task_requeued' | 'task_rework_refused' | 'round_opened' | 'check_begun'
  | 'round_reverified' | 'goal_completed' | 'plan_adopted' | 'other';

/** §11.11: the operation kind, its actor and the `automationPolicy()` in effect for the step. */
export type FuzzStep = {
  kind: FuzzStepKind;
  /** The operator, platform automation actor or Agent that performed the step (classified by `reworkActorClassOf`). */
  actor: ActorRef;
  automationPolicy: TaskAutomationPolicyV1;
  /** Printed with a failure (seed, step number, operation). */
  label?: string;
};

/** The event-log entries §11.11 reads (I-9, I-18). */
export type InvariantEventType =
  | 'GoalCreated' | 'GoalDesiredStateChanged' | 'TaskClaimed' | 'ExecutionEntryAuthorized' | 'VerificationRoundOpened'
  | 'VerificationCheckBegun' | 'VerificationRoundReverified' | 'TaskRequeued' | 'TaskReworkRefused' | 'ControlIntentSubmitted';

export type InvariantEvent = {
  /** The event row id: commit order. */
  seq: number;
  eventType: InvariantEventType;
  goalId: string;
  /** `GoalCreated` → `active`; `GoalDesiredStateChanged` → its `to`; otherwise null. */
  goalStateTo: GoalDesiredState | null;
  /** Canonical key of the record the event admits or writes (the claim's Run, the round, the requeue, the refusal, the intent). */
  subject: string;
  /** The Task the event admits or writes on (claim, authorization, round, check, requeue, refusal); otherwise null. */
  taskId: string | null;
  /** `TaskReworkRefused`: the refusal revision this event wrote; otherwise null. */
  revision: number | null;
  /** `ControlIntentSubmitted`: the intent kind; otherwise null. */
  controlKind: ControlIntentKindV1 | null;
};

/** `phase(t)`, `cause(t)` and `selected(t)` of one Task of a Goal's active Plan (`readCanonicalTaskFacts`). */
export type InvariantTaskState = {
  goalId: string;
  taskId: string;
  taskKind: TaskKind;
  /** null when the canonical read refused (`problem`). */
  phase: Phase | null;
  cause: TaskPhaseCauseV1 | null;
  selectedRunRef: RunRef | null;
  /** P4: the TaskRequeue covering the selected Run. */
  coveringRequeueRef: TaskRequeueRef | null;
  problem: string | null;
};

/** The saved task-execution manifest of a requeue Run (I-19); read only when the store names its artifact file. */
export type InvariantManifest = {
  runRef: RunRef;
  continuationBrief: ContinuationBriefV1 | null;
  input: string;
  /** Why the manifest could not be loaded; null when it was. */
  problem: string | null;
};

/** §11.0: every record of one project in one read window, plus the event-log entries and the projected Task states. */
export type InvariantWorld = {
  projectId: string;
  runs: RunSnapshot[];
  attempts: TaskAttemptSnapshot[];
  outboxes: TaskClaimOutbox[];
  leases: TaskLeaseSnapshot[];
  sessions: SessionRecord[];
  queryRuns: QueryRunSnapshot[];
  intents: ControlIntentSnapshotV1[];
  rounds: RoundSnapshot[];
  evidence: EvidenceSnapshot[];
  evidenceIndexes: TaskEvidenceIndexSnapshot[];
  messages: SessionMessage[];
  goals: GoalSnapshot[];
  goalPhases: GoalPhaseSnapshot[];
  reductions: TaskReductionSnapshot[];
  requeues: TaskRequeueSnapshotV1[];
  refusals: TaskReworkRefusalSnapshotV1[];
  plans: PlanRevisionSnapshot[];
  events: InvariantEvent[];
  taskStates: InvariantTaskState[];
  /** Slice 1: the immutable anomaly anchors in the window (none on legacy stores). */
  anchors?: SessionAnomalyAnchorV1[];
  /** Absent when the store named no artifact file. */
  manifests?: InvariantManifest[];
};

/** An empty world (hand-built worlds start here). */
export function emptyInvariantWorld(projectId: string): InvariantWorld {
  return { projectId, runs: [], attempts: [], outboxes: [], leases: [], sessions: [], queryRuns: [], intents: [], rounds: [],
    evidence: [], evidenceIndexes: [], messages: [], goals: [], goalPhases: [], reductions: [], requeues: [], refusals: [],
    plans: [], events: [], taskStates: [], anchors: [] };
}

// ------------------------------------------------------------------------ //
// Reading one window (§11.11 `readInvariantWorld`)                          //
// ------------------------------------------------------------------------ //

/** The SQLite files of one platform (`storage: { kind: 'sqlite', directory }`). */
export type InvariantStore = {
  /** `<directory>/ledger.sqlite`. */
  ledgerPath: string;
  /** `<directory>/artifacts.sqlite`; when given, the requeue Runs' manifests are read for I-19. */
  artifactsPath?: string;
};

/** The store of a platform created with `storage: { kind: 'sqlite', directory }`. */
export function invariantStoreOf(directory: string): InvariantStore {
  const artifactsPath = join(directory, 'artifacts.sqlite');
  return { ledgerPath: join(directory, 'ledger.sqlite'), ...(existsSync(artifactsPath) ? { artifactsPath } : {}) };
}

/**
 * The record schemas `createTargetPlatform` registers (`create-platform.ts`),
 * so the copy is read with the production codecs and every lookup the
 * canonical reader uses is registered (an unregistered lookup would read as
 * a confirmed absence). Exported for a second backend on a scenario ledger
 * (tests/scenarios/support/plan.ts `raceWindow`).
 */
export function platformRecordSchemas(): RecordBackendSchemas {
  const groups: RecordBackendSchemas[] = [materialRecordSchemas(), PLAN_RECORD_SCHEMAS, PLAN_STATE_RECORD_SCHEMAS,
    PLAN_GOVERNANCE_RECORD_SCHEMAS, SESSION_RECORD_SCHEMAS, SESSION_LIFECYCLE_RECORD_SCHEMAS, ROLE_RECORD_SCHEMAS,
    UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS,
    OBSERVED_ARCHITECTURE_RECORD_SCHEMAS, ARCHITECTURE_CATALOG_SCHEMAS, TASK_CLAIM_RECORD_SCHEMAS,
    EXECUTION_ENTRY_RECORD_SCHEMAS, MODEL_REQUEST_RECORD_SCHEMAS, SESSION_MESSAGE_RECORD_SCHEMAS,
    PROJECT_BOOTSTRAP_RECORD_SCHEMAS, CONTROL_RECORD_SCHEMAS, EVIDENCE_RECORD_SCHEMAS, QUERY_JOB_RECORD_SCHEMAS,
    COMPLETION_RECORD_SCHEMAS, SESSION_ANOMALY_RECORD_SCHEMAS];
  return {
    records: groups.flatMap((group) => group.records),
    events: [...groups.flatMap((group) => group.events), ...EXECUTION_HISTORY_RECORD_SCHEMAS.events],
    lookups: groups.flatMap((group) => group.lookups ?? []),
  };
}

/** The aggregate types of §11.0 (plus Evidence and TaskEvidenceIndex for I-3, I-7, I-13, I-15). */
const WORLD_AGGREGATE_TYPES: ReadonlySet<string> = new Set([
  'Run', 'TaskAttempt', 'DispatchOutboxEntry', 'TaskLease', 'Session', 'QueryRun', 'ControlIntent', 'VerificationRound',
  'Evidence', 'TaskEvidenceIndex', 'SessionMessage', 'Goal', 'GoalPhase', 'TaskReduction', 'TaskRequeue',
  'TaskReworkRefusal', 'PlanRevision', 'SessionAnomalyAnchor',
]);

const WORLD_EVENT_TYPES: ReadonlySet<string> = new Set<InvariantEventType>([
  'GoalCreated', 'GoalDesiredStateChanged', 'TaskClaimed', 'ExecutionEntryAuthorized', 'VerificationRoundOpened',
  'VerificationCheckBegun', 'VerificationRoundReverified', 'TaskRequeued', 'TaskReworkRefused', 'ControlIntentSubmitted',
]);

/**
 * One consistent copy of a live SQLite file (`VACUUM INTO` reads in one
 * transaction): the read window. The source is only read.
 */
function snapshotDatabase(source: string, target: string): void {
  const database = new DatabaseSync(source);
  try {
    database.exec('PRAGMA busy_timeout = 5000;');
    database.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  } finally {
    database.close();
  }
}

/**
 * §11.11: copies the ledger in one read transaction, then reads every §11.0
 * record of `projectId` through the registered schemas (`readMany`) and the
 * owners' decoders, the event-log entries of §11.11 through their event
 * decoders, `phase(t)` of each active-Plan Task through `readCanonicalTaskFacts`
 * on the same copy and, when `store.artifactsPath` is given, the manifests of
 * the requeue Runs. A record or event that does not decode throws: a damaged
 * store is not a world. The live files are never written.
 */
// S1-5 needs adjacent commits, not merely adjacent scenario observations: a
// restart may stop, anchor, drop, requeue and archive between two reads.
// Keep this reader metadata out of the exported world/signatures.
const slice1CommitCounts = new WeakMap<InvariantWorld, number>();

export async function readInvariantWorld(store: InvariantStore, projectId: string): Promise<InvariantWorld> {
  const scratch = await mkdtemp(join(tmpdir(), 'invariant-world-'));
  try {
    const ledger = join(scratch, 'ledger.sqlite');
    snapshotDatabase(store.ledgerPath, ledger);
    const rows = readLedgerRows(ledger, projectId);
    const backend = createSqliteRecordBackend({ path: ledger, schemas: platformRecordSchemas() });
    try {
      const read = await backend.records.readMany(rows.refKeys);
      if (read.status !== 'ready') throw new Error(`readInvariantWorld: the records are not readable: ${read.code}: ${read.reason}`);
      if (read.value.missing.length > 0) throw new Error(`readInvariantWorld: records vanished from the copy: ${read.value.missing.join(', ')}`);
      const world = decodeWorldRecords(projectId, read.value.records);
      const commitReader = new DatabaseSync(ledger, { readOnly: true });
      try {
        const row = commitReader.prepare('SELECT COUNT(*) AS n FROM idempotency').get() as { n: number };
        slice1CommitCounts.set(world, Number(row.n));
      } finally { commitReader.close(); }
      world.events = decodeWorldEvents(projectId, rows.events);
      world.taskStates = await readTaskStates(backend.records, world);
      if (store.artifactsPath !== undefined) world.manifests = await readManifests(store.artifactsPath, scratch, world);
      return world;
    } finally {
      await backend.close();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function readLedgerRows(path: string, projectId: string): { refKeys: string[]; events: { seq: number; json: string }[] } {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const keys = database.prepare('SELECT ref_key FROM snapshots ORDER BY ref_key').all() as { ref_key: string }[];
    const refKeys = keys.map((row) => row.ref_key).filter((refKey) => {
      const ref = JSON.parse(refKey) as { aggregateType?: unknown; projectId?: unknown };
      return typeof ref.aggregateType === 'string' && WORLD_AGGREGATE_TYPES.has(ref.aggregateType) && ref.projectId === projectId;
    });
    const events = (database.prepare('SELECT id, event_json FROM events ORDER BY id').all() as { id: number; event_json: string }[])
      .map((row) => ({ seq: Number(row.id), json: row.event_json }));
    return { refKeys, events };
  } finally {
    database.close();
  }
}

function decoded<T>(result: { status: 'decoded'; value: T } | { status: 'invalid'; reason: string }, refKey: string): T {
  if (result.status !== 'decoded') throw new Error(`readInvariantWorld: ${refKey} does not decode: ${result.reason}`);
  return result.value;
}

function decodeWorldRecords(projectId: string, records: readonly EncodedRecord[]): InvariantWorld {
  const world = emptyInvariantWorld(projectId);
  for (const record of records) {
    const aggregateType = (JSON.parse(record.refKey) as { aggregateType: string }).aggregateType;
    switch (aggregateType) {
      case 'Run': {
        const run = decodeRun(record);
        if (!run.ok) throw new Error(`readInvariantWorld: ${record.refKey} does not decode: ${run.reason}`);
        world.runs.push(run.value);
        break;
      }
      case 'TaskAttempt': world.attempts.push(decoded(decodeTaskAttemptSnapshot(record), record.refKey)); break;
      case 'DispatchOutboxEntry': world.outboxes.push(decoded(decodeDispatchOutboxEntry(record), record.refKey)); break;
      // TaskLease and TaskReduction have no decoder of their own: `readMany` already ran the registered
      // `PLAN_STATE_RECORD_SCHEMAS` validators, as every production reader of these records relies on.
      case 'TaskLease': world.leases.push(JSON.parse(record.json) as TaskLeaseSnapshot); break;
      case 'TaskReduction': world.reductions.push(JSON.parse(record.json) as TaskReductionSnapshot); break;
      case 'Session': world.sessions.push(decoded(decodeSessionRecord(record), record.refKey)); break;
      case 'QueryRun': world.queryRuns.push(decoded(decodeQueryRunSnapshotRecord(record), record.refKey)); break;
      case 'ControlIntent': world.intents.push(decoded(decodeControlIntentSnapshot(record), record.refKey)); break;
      case 'VerificationRound': world.rounds.push(decoded(decodeVerificationRoundSnapshot(record), record.refKey)); break;
      case 'Evidence': world.evidence.push(decoded(decodeEvidenceSnapshot(record), record.refKey)); break;
      case 'TaskEvidenceIndex': world.evidenceIndexes.push(decoded(decodeTaskEvidenceIndexSnapshot(record), record.refKey)); break;
      case 'SessionMessage': world.messages.push(decoded(decodeSessionMessageRecord(record), record.refKey)); break;
      case 'Goal': world.goals.push(decoded(decodeGoalSnapshot(record), record.refKey)); break;
      case 'GoalPhase': world.goalPhases.push(decoded(decodeGoalPhaseSnapshot(record), record.refKey)); break;
      case 'TaskRequeue': world.requeues.push(decoded(decodeTaskRequeueSnapshot(record), record.refKey)); break;
      case 'TaskReworkRefusal': world.refusals.push(decoded(decodeTaskReworkRefusalSnapshot(record), record.refKey)); break;
      case 'PlanRevision': world.plans.push(decoded(decodePlanRevisionSnapshot(record), record.refKey)); break;
      case 'SessionAnomalyAnchor': {
        const anchors = world.anchors ?? (world.anchors = []);
        anchors.push(decoded(decodeSessionAnomalyAnchor(record), record.refKey));
        break;
      }
      default: throw new Error(`readInvariantWorld: unexpected aggregate type ${aggregateType}`);
    }
  }
  return world;
}

/** One §11.11 event in its world form, or null when it belongs to another project. */
function worldEvent(seq: number, event: EncodedDomainEvent, projectId: string): InvariantEvent | null {
  const base = { seq, goalStateTo: null, revision: null, controlKind: null, taskId: null };
  const where = `event ${event.eventId} (${event.eventType})`;
  switch (event.eventType) {
    case 'GoalCreated': {
      const value = decoded(decodeGoalCreatedEvent(event), where);
      return value.projectId !== projectId ? null : { ...base, eventType: 'GoalCreated', goalId: value.aggregateId,
        goalStateTo: 'active', subject: refKey({ aggregateType: 'Goal', projectId, goalId: value.aggregateId }) };
    }
    case 'GoalDesiredStateChanged': {
      const value = decoded(decodeGoalDesiredStateChangedEvent(event), where);
      return value.goal.ref.projectId !== projectId ? null : { ...base, eventType: 'GoalDesiredStateChanged',
        goalId: value.goal.ref.goalId, goalStateTo: value.to, subject: refKey(value.goal.ref) };
    }
    case 'TaskClaimed': {
      const claim = decoded(taskClaimedEventFromEvent(event), where).claim;
      return claim.task.projectId !== projectId ? null
        : { ...base, eventType: 'TaskClaimed', goalId: claim.task.goalId, subject: refKey(claim.runRef), taskId: claim.task.taskId };
    }
    case 'ExecutionEntryAuthorized': {
      const claim = decoded(executionEntryAuthorizedEventFromEvent(event), where).permit.claim;
      return claim.task.projectId !== projectId ? null : { ...base, eventType: 'ExecutionEntryAuthorized',
        goalId: claim.task.goalId, subject: refKey(claim.runRef), taskId: claim.task.taskId };
    }
    case 'VerificationRoundOpened':
    case 'VerificationCheckBegun':
    case 'VerificationRoundReverified': {
      const value = decoded(verificationRoundEventFromEvent(event), where);
      return value.roundRef.projectId !== projectId ? null
        : { ...base, eventType: event.eventType, goalId: value.roundRef.goalId, subject: refKey(value.roundRef),
          taskId: value.roundRef.taskId };
    }
    case 'TaskRequeued': {
      const requeue = decoded(taskRequeuedEventFromEvent(event), where).requeue;
      return requeue.ref.projectId !== projectId ? null : { ...base, eventType: 'TaskRequeued', goalId: requeue.ref.goalId,
        subject: refKey(requeue.ref), taskId: requeue.ref.taskId };
    }
    case 'TaskReworkRefused': {
      const refusal = decoded(taskReworkRefusedEventFromEvent(event), where).refusal;
      return refusal.ref.projectId !== projectId ? null : { ...base, eventType: 'TaskReworkRefused', goalId: refusal.ref.goalId,
        subject: refKey(refusal.ref), revision: refusal.revision, taskId: refusal.ref.taskId };
    }
    case 'ControlIntentSubmitted': {
      const intent = decoded(controlIntentSubmittedEventFromEvent(event), where).submitted.intent;
      return intent.ref.projectId !== projectId ? null : { ...base, eventType: 'ControlIntentSubmitted',
        goalId: intent.runRef.goalId, subject: refKey(intent.ref), controlKind: intent.kind };
    }
    default: return null;
  }
}

function decodeWorldEvents(projectId: string, rows: readonly { seq: number; json: string }[]): InvariantEvent[] {
  const events: InvariantEvent[] = [];
  for (const row of rows) {
    const envelope = decodeStoredEventBody(row.json);
    if (envelope.status !== 'decoded') throw new Error(`readInvariantWorld: event row ${row.seq} does not decode: ${envelope.reason}`);
    if (!WORLD_EVENT_TYPES.has(envelope.value.event.eventType)) continue;
    const event = worldEvent(row.seq, envelope.value.event, projectId);
    if (event !== null) events.push(event);
  }
  return events;
}

/** `phase(t)`, `cause(t)`, `selected(t)` of every Task of each Goal's active Plan, from the canonical reader. */
async function readTaskStates(
  records: Parameters<typeof readCanonicalTaskFacts>[0], world: InvariantWorld,
): Promise<InvariantTaskState[]> {
  const states: InvariantTaskState[] = [];
  for (const goal of world.goals) {
    const active = goal.activePlanRevision;
    if (active === null) continue;
    const plan = world.plans.find((candidate) => sameRef(candidate.ref, active));
    if (plan === undefined) throw new Error(`readInvariantWorld: the active Plan of Goal ${goal.ref.goalId} is not in the window`);
    const read = await readCanonicalTaskFacts(records, goal.ref, plan);
    for (const task of plan.tasks) {
      const base = { goalId: goal.ref.goalId, taskId: task.taskId, taskKind: task.taskKind };
      const state = read.status === 'ready' ? read.value.byTaskId.get(task.taskId) : undefined;
      if (state === undefined) {
        states.push({ ...base, phase: null, cause: null, selectedRunRef: null, coveringRequeueRef: null,
          problem: read.status === 'ready' ? `task ${task.taskId} has no canonical state` : `${read.code}: ${read.reason}` });
        continue;
      }
      states.push({ ...base, phase: state.effectivePhase, cause: state.phaseCause, selectedRunRef: state.execution,
        coveringRequeueRef: state.requeueRef, problem: null });
    }
  }
  return states;
}

/** I-19's manifest clause: the saved manifest of each authorized requeue Run (`rehydratePreparedExecution`, `loadPreparedManifest`). */
async function readManifests(artifactsPath: string, scratch: string, world: InvariantWorld): Promise<InvariantManifest[]> {
  const copy = join(scratch, 'artifacts.sqlite');
  snapshotDatabase(artifactsPath, copy);
  const bodies = createSqliteRawArtifactStore(copy);
  const index = indexOf(world);
  const manifests: InvariantManifest[] = [];
  try {
    for (const run of world.runs) {
      if (run.requeueRef === undefined || run.inputBinding === undefined) continue;
      const outbox = index.outboxOf(run);
      const prepared = outbox === undefined ? null : rehydratePreparedExecution({ run, outbox });
      if (prepared === null) {
        manifests.push({ runRef: run.ref, continuationBrief: null, input: '', problem: 'the Run or its Outbox cannot be rehydrated' });
        continue;
      }
      const loaded = await loadPreparedManifest(bodies, prepared);
      manifests.push(loaded.status === 'ready'
        ? { runRef: run.ref, continuationBrief: loaded.value.manifest.continuationBrief ?? null, input: loaded.value.manifest.input,
          problem: null }
        : { runRef: run.ref, continuationBrief: null, input: '', problem: JSON.stringify(loaded) });
    }
  } finally {
    await bodies.close();
  }
  return manifests;
}

// ------------------------------------------------------------------------ //
// Notation helpers (§11.0)                                                  //
// ------------------------------------------------------------------------ //

/** Canonical key of a full ref (the RecordStore `ref_key`). */
export function refKey(ref: object): string {
  return canonicalJson(ref as unknown as JsonValue);
}

function sameRef(left: object | null | undefined, right: object | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return (left ?? null) === (right ?? null);
  }
  return refKey(left) === refKey(right);
}

/** Canonical equality of two JSON values (`undefined` fields dropped). */
function sameJson(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalJson(JSON.parse(JSON.stringify(left)) as JsonValue) === canonicalJson(JSON.parse(JSON.stringify(right)) as JsonValue);
}

/** `known(o)`. */
function known(outcome: RunOutcome | null): boolean {
  return outcome !== null && outcome !== 'outcome_unknown';
}

/** `unresolved(r)`. */
function unresolved(run: RunSnapshot): boolean {
  return run.status === 'starting' || run.status === 'running' || run.outcome === 'outcome_unknown';
}

/** `qUnresolved(q)`. */
function queryUnresolved(query: QueryRunSnapshot): boolean {
  const state = query.run.executionState;
  return state !== undefined && state.phase !== 'settled';
}

/** `actorClass(x)`: `reworkActorClassOf` on a recorded actor. */
function actorClassOf(actor: ActorRef): ReworkActorClass {
  return reworkActorClassOf(null, actor) ?? 'human';
}

function isGoalFanOut(actor: ActorRef): boolean {
  return actor.kind === GOAL_FAN_OUT_ACTOR.kind && actor.id === GOAL_FAN_OUT_ACTOR.id;
}

function isGateRound(round: RoundSnapshot): boolean {
  return round.identity.scope.gateSubject !== undefined;
}

function taskKey(goalId: string, taskId: string): string {
  return `${goalId}\u0000${taskId}`;
}

function runKey(ref: Pick<RunRef, 'goalId' | 'runId'>): string {
  return `${ref.goalId}\u0000${ref.runId}`;
}

function workChainKey(goalId: string, taskId: string, runId: string): string {
  return `${goalId}\u0000${taskId}\u0000${runId}`;
}

function taskOf(plan: PlanRevisionSnapshot, taskId: string): RuntimeTask | undefined {
  return plan.tasks.find((task) => task.taskId === taskId);
}

/** `pointer(r)`: none, the intent, or a pointer whose intent is not in the window. */
type PointerRead = { status: 'none' } | { status: 'found'; intent: ControlIntentSnapshotV1 } | { status: 'missing'; ref: ControlIntentRef };

/** The §11.0 lookups over one world, built once per world. */
type WorldIndex = {
  run(ref: Pick<RunRef, 'goalId' | 'runId'>): RunSnapshot | undefined;
  runsOfGoal(goalId: string): RunSnapshot[];
  runsOfTask(goalId: string, taskId: string): RunSnapshot[];
  attemptOf(run: RunSnapshot): TaskAttemptSnapshot | undefined;
  outboxOf(run: RunSnapshot): TaskClaimOutbox | undefined;
  /** `claimOf(r)`. */
  claimOf(run: RunSnapshot): TaskClaim | null;
  lease(goalId: string, taskId: string): TaskLeaseSnapshot | null;
  session(ref: { projectId: string; sessionId: string }): SessionRecord | undefined;
  intent(ref: ControlIntentRef): ControlIntentSnapshotV1 | undefined;
  pointer(run: RunSnapshot): PointerRead;
  /** `fence(r)`; `unknown` when the pointer intent is not in the window. */
  fence(run: RunSnapshot | null | undefined): ReworkFence | 'unknown';
  requeue(ref: TaskRequeueRef): TaskRequeueSnapshotV1 | undefined;
  /** `requeueOf(r)`. */
  requeueOf(run: Pick<RunSnapshot, 'ref'>): TaskRequeueSnapshotV1 | null;
  round(ref: object): RoundSnapshot | undefined;
  workChain(goalId: string, taskId: string, runId: string): RoundSnapshot[];
  gateChain(goalId: string, taskId: string): RoundSnapshot[];
  /** `head(r)`: the head of Run r's work chain. */
  head(run: RunSnapshot): RoundChainHeadV1;
  goal(goalId: string): GoalSnapshot | undefined;
  plan(ref: object): PlanRevisionSnapshot | undefined;
  /** `active(g)`. */
  activePlan(goalId: string): PlanRevisionSnapshot | null;
  taskState(goalId: string, taskId: string): InvariantTaskState | undefined;
  reduction(goalId: string, taskId: string): TaskReductionSnapshot | undefined;
  evidence(evidenceId: string): EvidenceSnapshot | undefined;
};

function group<T>(items: readonly T[], keyOf: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null) continue;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [item]);
    else list.push(item);
  }
  return groups;
}

/** The lookups of one world, built per checker call (never cached: a test may change a world between calls). */
function indexOf(world: InvariantWorld): WorldIndex {
  const runs = new Map(world.runs.map((run) => [runKey(run.ref), run]));
  const runsByGoal = group(world.runs, (run) => run.ref.goalId);
  const runsByTask = group(world.runs, (run) => taskKey(run.ref.goalId, run.task.taskId));
  const attempts = new Map(world.attempts.map((attempt) => [refKey(attempt.ref), attempt]));
  const outboxes = new Map(world.outboxes.map((outbox) => [refKey(outbox.ref), outbox]));
  const leases = new Map(world.leases.map((lease) => [taskKey(lease.ref.goalId, lease.ref.taskId), lease]));
  const sessions = new Map(world.sessions.map((session) => [`${session.ref.projectId}\u0000${session.ref.sessionId}`, session]));
  const intents = new Map(world.intents.map((intent) => [refKey(intent.ref), intent]));
  const requeues = new Map(world.requeues.map((requeue) => [refKey(requeue.ref), requeue]));
  const requeueByRun = new Map(world.requeues.map((requeue) => [runKey(requeue.afterRunRef), requeue]));
  const rounds = new Map(world.rounds.map((round) => [refKey(round.ref), round]));
  const workChains = group(world.rounds, (round) => isGateRound(round) ? null
    : workChainKey(round.ref.goalId, round.ref.taskId, round.ref.runId));
  const gateChains = group(world.rounds, (round) => isGateRound(round) ? taskKey(round.ref.goalId, round.ref.taskId) : null);
  const goals = new Map(world.goals.map((goal) => [goal.ref.goalId, goal]));
  const plans = new Map(world.plans.map((plan) => [refKey(plan.ref), plan]));
  const states = new Map(world.taskStates.map((state) => [taskKey(state.goalId, state.taskId), state]));
  const reductions = new Map(world.reductions.map((reduction) => [taskKey(reduction.ref.goalId, reduction.ref.taskId), reduction]));
  const evidence = new Map(world.evidence.map((snapshot) => [snapshot.ref.evidenceId, snapshot]));
  const outboxOf = (run: RunSnapshot): TaskClaimOutbox | undefined => outboxes.get(refKey({ aggregateType: 'DispatchOutboxEntry',
    projectId: run.ref.projectId, goalId: run.ref.goalId, taskId: run.task.taskId, attemptId: run.attemptId }));
  const intentOf = (ref: ControlIntentRef): ControlIntentSnapshotV1 | undefined => intents.get(refKey(ref));
  const pointer = (run: RunSnapshot): PointerRead => {
    const ref = run.controlState?.intentRef;
    if (ref === undefined) return { status: 'none' };
    const intent = intentOf(ref);
    return intent === undefined ? { status: 'missing', ref } : { status: 'found', intent };
  };
  const index: WorldIndex = {
    run: (ref) => runs.get(runKey(ref)),
    runsOfGoal: (goalId) => runsByGoal.get(goalId) ?? [],
    runsOfTask: (goalId, taskId) => runsByTask.get(taskKey(goalId, taskId)) ?? [],
    attemptOf: (run) => attempts.get(refKey({ aggregateType: 'TaskAttempt', projectId: run.ref.projectId, goalId: run.ref.goalId,
      taskId: run.task.taskId, attemptId: run.attemptId })),
    outboxOf,
    claimOf: (run) => outboxOf(run)?.claim ?? null,
    lease: (goalId, taskId) => leases.get(taskKey(goalId, taskId)) ?? null,
    session: (ref) => sessions.get(`${ref.projectId}\u0000${ref.sessionId}`),
    intent: intentOf,
    pointer,
    fence: (run) => {
      if (run === null || run === undefined) return 'none';
      const read = pointer(run);
      if (read.status === 'missing') return 'unknown';
      return reworkFenceOf(run, read.status === 'found' ? read.intent : null);
    },
    requeue: (ref) => requeues.get(refKey(ref)),
    requeueOf: (run) => requeueByRun.get(runKey(run.ref)) ?? null,
    round: (ref) => rounds.get(refKey(ref)),
    workChain: (goalId, taskId, runId) => workChains.get(workChainKey(goalId, taskId, runId)) ?? [],
    gateChain: (goalId, taskId) => gateChains.get(taskKey(goalId, taskId)) ?? [],
    head: (run) => roundChainHead(workChains.get(workChainKey(run.ref.goalId, run.task.taskId, run.ref.runId)) ?? []),
    goal: (goalId) => goals.get(goalId),
    plan: (ref) => plans.get(refKey(ref)),
    activePlan: (goalId) => {
      const active = goals.get(goalId)?.activePlanRevision ?? null;
      return active === null ? null : plans.get(refKey(active)) ?? null;
    },
    taskState: (goalId, taskId) => states.get(taskKey(goalId, taskId)),
    reduction: (goalId, taskId) => reductions.get(taskKey(goalId, taskId)),
    evidence: (evidenceId) => evidence.get(evidenceId),
  };
  return index;
}

function finding(invariant: InvariantId | Slice1InvariantId, ref: object | string, message: string): InvariantViolation {
  return { invariant, ref: typeof ref === 'string' ? ref : refKey(ref), message };
}

function legacy(invariant: InvariantId | Slice1InvariantId, ref: object | string, message: string): InvariantViolation {
  return { ...finding(invariant, ref, message), legacy: true };
}

/** The records of a kind present in `world` and absent from (or at another revision in) `prev`. */
function written<T extends { ref: object; revision: number }>(prev: readonly T[], next: readonly T[]): T[] {
  const before = new Map(prev.map((record) => [refKey(record.ref), record.revision]));
  return next.filter((record) => before.get(refKey(record.ref)) !== record.revision);
}

// ------------------------------------------------------------------------ //
// §5.1 D-14 pairing table (§5.6 `checkAttemptPairing`)                      //
// ------------------------------------------------------------------------ //

/**
 * The D-14 row of one Attempt (§5.1): Run status/outcome, the V2 entry phase,
 * the Outbox and, when the Lease names this Attempt, the Lease. An absent
 * authorization is not judged (legacy, and `none` where the table
 * allows it). Returns one problem sentence per broken column.
 */
export function checkAttemptPairing(
  run: RunSnapshot, attempt: TaskAttemptSnapshot, outbox: TaskClaimOutbox | null, lease: TaskLeaseSnapshot | null,
): string[] {
  const problems: string[] = [];
  const auth = run.executionAuthorization;
  const phase = isAuthorizationV2(auth) ? auth.phase : null;
  const namesThis = lease !== null && lease.holderRunId === run.ref.runId && lease.attemptId === attempt.ref.attemptId;
  const held = namesThis && lease.release === undefined;
  const id = attempt.ref.attemptId;
  if (outbox === null) problems.push(`Attempt ${id} has no Outbox`);
  const expectOutbox = (status: TaskClaimOutbox['status']): void => {
    if (outbox !== null && outbox.status !== status) problems.push(`Attempt ${id} (${attempt.status}) pairs with Outbox status ${status}, not ${outbox.status}`);
  };
  const expectPhase = (allowed: readonly ExecutionAuthorizationV2['phase'][]): void => {
    if (phase !== null && !allowed.includes(phase)) problems.push(`Attempt ${id} (${attempt.status}) pairs with entry phase ${allowed.join('/')}, not ${phase}`);
  };
  switch (attempt.status) {
    case 'claimed':
      if (run.status !== 'starting') problems.push(`claimed Attempt ${id} pairs with a starting Run, not ${run.status}`);
      expectPhase(['authorized', 'entering', 'revoked']);
      expectOutbox('pending');
      if (!held) problems.push(`claimed Attempt ${id} does not hold its Lease`);
      break;
    case 'started':
      if (run.status !== 'running') problems.push(`started Attempt ${id} pairs with a running Run, not ${run.status}`);
      expectPhase(['entered']);
      expectOutbox('entered');
      if (!held) problems.push(`started Attempt ${id} does not hold its Lease`);
      break;
    case 'ended':
      if (run.status !== 'ended') problems.push(`ended Attempt ${id} pairs with an ended Run, not ${run.status}`);
      if (attempt.endOutcome !== run.outcome) problems.push(`ended Attempt ${id} has outcome ${String(attempt.endOutcome)}, its Run ${String(run.outcome)}`);
      if (run.outcome === 'outcome_unknown') {
        expectPhase(['unknown']);
        if (attempt.startedAt !== null) expectOutbox('entered');
        else {
          // ATT-36/37 (L-2): never entered as far as the records know.
          expectOutbox('pending');
          if (run.startedAt !== null) problems.push(`Attempt ${id} ended unknown without startedAt, but its Run has one`);
        }
        if (!held) problems.push(`Attempt ${id} ended outcome_unknown and released its Lease (D-4)`);
      } else if (known(run.outcome)) {
        expectPhase(['settled', 'revoked']);
        expectOutbox('settled');
        if (held) problems.push(`Attempt ${id} ended ${String(run.outcome)} but still holds its Lease`);
      }
      break;
    default: return unreachable(attempt.status, 'Attempt status');
  }
  return problems;
}

// ------------------------------------------------------------------------ //
// I-1..I-9                                                                  //
// ------------------------------------------------------------------------ //

/** §11.1 I-1: at most one open Attempt per work Task, `phase(t)='running'` exactly then, paired per D-14. */
export function checkI1RunningPairing(world: InvariantWorld): InvariantViolation[] {
  const index = indexOf(world);
  const out: InvariantViolation[] = [];
  const open = group(world.attempts.filter((attempt) => attempt.status === 'claimed' || attempt.status === 'started'),
    (attempt) => taskKey(attempt.ref.goalId, attempt.ref.taskId));
  for (const attempts of open.values()) {
    const first = attempts[0]!;
    const task = { projectId: first.ref.projectId, goalId: first.ref.goalId, taskId: first.ref.taskId };
    if (attempts.length > 1) {
      out.push(finding('I-1', task, `Task ${task.taskId} has ${attempts.length} open Attempts (${attempts.map((a) => a.ref.attemptId).join(', ')})`));
    }
    for (const attempt of attempts) {
      const run = index.run({ goalId: attempt.ref.goalId, runId: attempt.runId });
      if (run === undefined) {
        out.push(finding('I-1', attempt.ref, `open Attempt ${attempt.ref.attemptId} names Run ${attempt.runId}, which is not in the window`));
        continue;
      }
      for (const problem of checkAttemptPairing(run, attempt, index.outboxOf(run) ?? null, index.lease(task.goalId, task.taskId))) {
        out.push(finding('I-1', attempt.ref, problem));
      }
    }
  }
  for (const state of world.taskStates) {
    if (state.taskKind !== 'work') continue;
    const count = open.get(taskKey(state.goalId, state.taskId))?.length ?? 0;
    const task = { projectId: world.projectId, goalId: state.goalId, taskId: state.taskId };
    if (state.phase === null) {
      out.push(finding('I-1', task, `phase(${state.taskId}) is not readable: ${state.problem ?? 'unknown'}`));
      continue;
    }
    if ((state.phase === 'running') !== (count === 1)) {
      out.push(finding('I-1', task, `Task ${state.taskId} projects ${state.phase} with ${count} open Attempt(s)`));
    }
  }
  return out;
}

/** §11.2 I-2: a known end released the Session occupancy and the Lease; an unknown end kept both (Query: §8 D-11). */
export function checkI2ReleaseMatchesOutcome(world: InvariantWorld): InvariantViolation[] {
  const index = indexOf(world);
  const out: InvariantViolation[] = [];
  for (const run of world.runs) {
    // `claimOf(r)` is defined for every Run (§11.0): the claim commit writes the Run with its Attempt and Outbox.
    const claim = index.claimOf(run);
    if (claim === null) {
      out.push(finding('I-2', run.ref, `Run ${run.ref.runId} has no claim (no Outbox)`));
      continue;
    }
    if (run.status !== 'ended') continue;
    const session = index.session(claim.sessionRef);
    const holdsSession = session !== undefined && ownsOccupancy(session, run.ref, claim.generation);
    const holdsLease = leaseOwnedByRun(index.lease(run.ref.goalId, run.task.taskId), claim);
    if (known(run.outcome)) {
      if (holdsSession) out.push(finding('I-2', run.ref, `Run ${run.ref.runId} ended ${String(run.outcome)} but still occupies Session ${claim.sessionRef.sessionId}`));
      if (holdsLease) out.push(finding('I-2', run.ref, `Run ${run.ref.runId} ended ${String(run.outcome)} but still holds the Lease of ${run.task.taskId}`));
    } else if (run.outcome === 'outcome_unknown') {
      if (!holdsSession) out.push(finding('I-2', run.ref, `Run ${run.ref.runId} ended outcome_unknown and released Session ${claim.sessionRef.sessionId}`));
      if (!holdsLease) out.push(finding('I-2', run.ref, `Run ${run.ref.runId} ended outcome_unknown and released the Lease of ${run.task.taskId}`));
    }
  }
  for (const query of world.queryRuns) {
    const state = query.run.executionState;
    if (state === undefined) continue;
    const session = index.session(state.sessionRef);
    const holds = session !== undefined && ownsOccupancy(session, query.ref, state.sessionGeneration);
    if (state.phase === 'settled' && holds) out.push(finding('I-2', query.ref, `settled QueryRun ${query.ref.runId} still occupies its Session`));
    if (state.phase === 'unknown' && !holds) out.push(finding('I-2', query.ref, `QueryRun ${query.ref.runId} is unknown and released its Session`));
  }
  return out;
}

/** The required requirement keys of a Task's required obligations (`completion-policy.ts` `requiredRequirementsOf`). */
function requiredRequirementKeys(plan: PlanRevisionSnapshot, taskId: string): string[] {
  const keys: string[] = [];
  for (const obligation of plan.obligations) {
    if (!obligation.taskIds.includes(taskId) || obligation.requirementLevel !== 'required') continue;
    for (const requirement of obligation.verificationRequirements) {
      if (requirement.requirementLevel !== 'required') continue;
      keys.push(requirementKeyOf({ obligationId: obligation.obligationId, requirementId: requirement.requirementId }));
    }
  }
  return keys;
}

/** §11.3 I-3: a COMPLETED GoalPhase of the active Plan is backed by PASS chain heads covering every required Task. */
export function checkI3GoalCompletionBacked(world: InvariantWorld, prev?: InvariantWorld, step?: FuzzStep): InvariantViolation[] {
  const index = indexOf(world);
  const out: InvariantViolation[] = [];
  for (const phase of world.goalPhases) {
    if (phase.phase !== 'COMPLETED') continue;
    const goal = index.goal(phase.ref.goalId);
    if (goal === undefined) {
      out.push(finding('I-3', phase.ref, `GoalPhase of ${phase.ref.goalId} has no Goal`));
      continue;
    }
    // `selectedPlanMatches`: a completion of an older Plan is out of scope (D-17).
    if (!sameRef(phase.planRef, goal.activePlanRevision)) continue;
    const plan = index.plan(phase.planRef);
    if (plan === undefined) {
      out.push(finding('I-3', phase.ref, `the completed Plan ${phase.planRef.planId} is not in the window`));
      continue;
    }
    if (goal.desiredState !== 'active') out.push(finding('I-3', phase.ref, `Goal ${goal.ref.goalId} is COMPLETED while ${goal.desiredState}`));
    for (const task of plan.tasks) {
      if (task.requirementLevel !== 'required' || task.disposition === 'cancelled' || task.disposition === 'superseded') continue;
      out.push(...completedTaskProblems(index, world, goal, plan, task));
    }
  }
  if (step?.kind === 'goal_completed') {
    const before = new Map((prev?.goalPhases ?? []).map((phase) => [refKey(phase.ref), phase.revision]));
    for (const phase of world.goalPhases) {
      if (phase.phase !== 'COMPLETED' || before.get(refKey(phase.ref)) === phase.revision) continue;
      for (const run of index.runsOfGoal(phase.ref.goalId)) {
        const blocker = runUnresolvedBlocker(run);
        if (unresolved(run) || blocker !== null) {
          out.push(finding('I-3', run.ref, `Goal ${phase.ref.goalId} completed while Run ${run.ref.runId} is unresolved${blocker === null ? '' : `: ${blocker}`}`));
        }
      }
    }
  }
  return out;
}

function completedTaskProblems(
  index: WorldIndex, world: InvariantWorld, goal: GoalSnapshot, plan: PlanRevisionSnapshot, task: RuntimeTask,
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const taskRef = { projectId: goal.ref.projectId, goalId: goal.ref.goalId, taskId: task.taskId };
  const state = index.taskState(goal.ref.goalId, task.taskId);
  if (state?.phase !== 'satisfied') {
    out.push(finding('I-3', taskRef, `required Task ${task.taskId} of the COMPLETED Goal projects ${state?.phase ?? 'nothing'}`));
  }
  const reduction = index.reduction(goal.ref.goalId, task.taskId);
  if (reduction === undefined || reduction.phase !== 'satisfied') {
    out.push(finding('I-3', taskRef, `required Task ${task.taskId} has no satisfied TaskReduction`));
    return out;
  }
  const audit = reduction.completion;
  if (audit === undefined) {
    out.push(legacy('I-3', reduction.ref, `TaskReduction of ${task.taskId} has no completion audit (written before R3e.3)`));
    return out;
  }
  const round = index.round(audit.roundRef);
  if (round === undefined) {
    out.push(finding('I-3', reduction.ref, `the completion round ${audit.roundRef.roundId} of ${task.taskId} is not in the window`));
    return out;
  }
  if (round.status !== 'finalized' || round.outcome !== 'PASS' || round.gaps.length > 0) {
    out.push(finding('I-3', round.ref, `the completion round of ${task.taskId} is ${round.status} ${String(round.outcome)} with ${round.gaps.length} gap(s)`));
  }
  if (round.subject.taskId !== task.taskId) out.push(finding('I-3', round.ref, `the completion round of ${task.taskId} is about ${round.subject.taskId}`));
  let chain: RoundSnapshot[];
  if (task.taskKind === 'work') {
    const run = index.run(round.subjectRunRef);
    if (isGateRound(round) || run === undefined || run.task.taskId !== task.taskId || run.outcome !== 'completed') {
      out.push(finding('I-3', round.ref, `the completion round of work ${task.taskId} is not a work round of its completed production Run`));
    }
    chain = index.workChain(round.ref.goalId, round.ref.taskId, round.ref.runId);
  } else {
    if (!isGateRound(round)) out.push(finding('I-3', round.ref, `the completion round of gate ${task.taskId} is not a gate round`));
    chain = index.gateChain(round.ref.goalId, round.ref.taskId);
  }
  const head = roundChainHead(chain);
  if (head.kind !== 'head' || !sameRef(head.head.ref, round.ref)) {
    out.push(finding('I-3', round.ref, `the completion round of ${task.taskId} is not its chain head (VD-14)`));
  }
  const evidence = round.evidenceRefs.map((ref) => index.evidence(ref.evidenceId));
  for (const key of requiredRequirementKeys(plan, task.taskId)) {
    const covered = evidence.some((snapshot) => snapshot !== undefined && snapshot.evidence.outcome === 'PASS'
      && snapshot.evidence.coverage.some((coverage) => requirementKeyOf(coverage) === key));
    if (!covered) out.push(finding('I-3', round.ref, `the completion round of ${task.taskId} has no PASS evidence for requirement ${key.replace('\u0000', '/')}`));
  }
  const excluded = new Set([...world.requeues.filter((requeue) => requeue.ref.goalId === goal.ref.goalId && requeue.ref.taskId === task.taskId)
    .flatMap((requeue) => requeue.supersededEvidenceIds), ...(round.chain?.supersededEvidenceIds ?? [])]);
  const adopted = [...audit.evidenceRefs.map((ref) => ref.evidenceId), ...reduction.effectiveEvidenceIds];
  const stale = adopted.filter((evidenceId) => excluded.has(evidenceId));
  if (stale.length > 0) out.push(finding('I-3', reduction.ref, `the completion of ${task.taskId} adopts superseded evidence ${[...new Set(stale)].join(', ')} (TD-2)`));
  return out;
}

/** §11.4 I-4: one writing execution per Session at most, and the occupancy is exactly its holder's. */
export function checkI4SingleWriterPerSession(world: InvariantWorld): InvariantViolation[] {
  const index = indexOf(world);
  const out: InvariantViolation[] = [];
  type Writer = { ref: ExecutionRef; generation: number; label: string };
  const writers = new Map<string, Writer[]>();
  const add = (sessionRef: { projectId: string; sessionId: string }, writer: Writer): void => {
    const key = `${sessionRef.projectId}\u0000${sessionRef.sessionId}`;
    const list = writers.get(key);
    if (list === undefined) writers.set(key, [writer]);
    else list.push(writer);
  };
  for (const run of world.runs) {
    if (!unresolved(run)) continue;
    const claim = index.claimOf(run);
    if (claim !== null) add(claim.sessionRef, { ref: run.ref, generation: claim.generation, label: `Run ${run.ref.runId}` });
  }
  for (const query of world.queryRuns) {
    const state = query.run.executionState;
    if (state !== undefined && queryUnresolved(query)) {
      add(state.sessionRef, { ref: query.ref, generation: state.sessionGeneration, label: `QueryRun ${query.ref.runId}` });
    }
  }
  for (const session of world.sessions) {
    const holders = writers.get(`${session.ref.projectId}\u0000${session.ref.sessionId}`) ?? [];
    if (holders.length > 1) out.push(finding('I-4', session.ref, `Session ${session.ref.sessionId} has ${holders.length} unresolved writers (${holders.map((h) => h.label).join(', ')})`));
    const [holder] = holders;
    if (holders.length === 1 && holder !== undefined && !ownsOccupancy(session, holder.ref, holder.generation)) {
      out.push(finding('I-4', session.ref, `Session ${session.ref.sessionId} is not occupied by its writer ${holder.label} at generation ${holder.generation}`));
    }
    if (holders.length === 0 && session.occupancy !== null) {
      out.push(finding('I-4', session.ref, `Session ${session.ref.sessionId} is occupied (${session.occupancy.kind}) without an unresolved writer`));
    }
    if (session.lifecycle === 'archived' && session.occupancy !== null) out.push(finding('I-4', session.ref, `archived Session ${session.ref.sessionId} is occupied`));
  }
  return out;
}

/**
 * §11.5 I-5: at most one queued pointer intent per Run, the pointer names it,
 * a superseded intent is never the pointer, a queued steer is a control input.
 * A queued pause/cancel/resume is `legacy` only when the pointer moved on to
 * an intent submitted after it (pre-D-8 data, the CTL-05 compatibility path);
 * with no pointer, an older pointer or a pointer intent outside the window it
 * is a violation (CTL-01/CTL-04 write the pointer and supersede the old one).
 */
export function checkI5SingleQueuedPointerIntent(world: InvariantWorld): InvariantViolation[] {
  const index = indexOf(world);
  const out: InvariantViolation[] = [];
  const intentsByRun = group(world.intents, (intent) => runKey(intent.runRef));
  const submittedAt = new Map(world.events.filter((event) => event.eventType === 'ControlIntentSubmitted')
    .map((event) => [event.subject, event.seq]));
  // Submission order: the ControlIntentSubmitted events when both are in the log (a store), else `requestedAt`.
  const submittedAfter = (later: ControlIntentSnapshotV1, earlier: ControlIntentSnapshotV1): boolean => {
    const laterSeq = submittedAt.get(refKey(later.ref));
    const earlierSeq = submittedAt.get(refKey(earlier.ref));
    return laterSeq !== undefined && earlierSeq !== undefined ? laterSeq > earlierSeq : later.requestedAt > earlier.requestedAt;
  };
  for (const run of world.runs) {
    const intents = intentsByRun.get(runKey(run.ref)) ?? [];
    const pointer = run.controlState?.intentRef;
    const pointerIntent = pointer === undefined ? undefined : index.intent(pointer);
    for (const intent of intents) {
      const isPointer = sameRef(intent.ref, pointer);
      const id = intent.ref.intentId;
      if (intent.status === 'queued' && intent.kind !== 'steer') {
        if (!isPointer) {
          const what = `queued ${intent.kind} intent ${id} is not Run ${run.ref.runId}'s pointer`;
          if (pointerIntent !== undefined && submittedAfter(pointerIntent, intent)) {
            out.push(legacy('I-5', intent.ref, `${what} (pre-D-8 data: the pointer moved on to ${pointerIntent.ref.intentId})`));
          } else {
            out.push(finding('I-5', intent.ref, pointer === undefined ? `${what} (the Run has no pointer)`
              : pointerIntent === undefined ? `${what} (the pointer intent ${pointer.intentId} is not in the window)`
                : `${what} (the pointer names ${pointer.intentId}, which was not submitted after it)`));
          }
        } else if (run.controlState?.desiredState !== intent.desiredState) {
          out.push(finding('I-5', intent.ref, `Run ${run.ref.runId} points at queued ${intent.kind} ${id} with desiredState ${String(run.controlState?.desiredState)}`));
        }
      }
      // CTL-06/CTL-08(c): a natural terminal supersedes the still-queued pointer intent, and an ended
      // Run's pointer never moves (§7), so that one stays the pointer; any other superseded pointer is not.
      // A yielded Run is not a natural terminal: CTL-06 is illegal on YieldedWait and its intents stay queued.
      const terminalSuperseded = intent.status === 'superseded' && intent.observation.kind === 'terminal_without_cancel'
        && run.status === 'ended' && known(run.outcome) && run.outcome !== 'yielded';
      if (intent.status === 'superseded' && isPointer && !terminalSuperseded) {
        out.push(finding('I-5', intent.ref, `Run ${run.ref.runId} still points at superseded intent ${intent.ref.intentId}`));
      }
      if (intent.kind === 'steer' && intent.status === 'queued' && !(run.controlInputs ?? []).some((input) => sameRef(input, intent.ref))) {
        out.push(finding('I-5', intent.ref, `queued steer ${intent.ref.intentId} is not among Run ${run.ref.runId}'s control inputs`));
      }
    }
  }
  return out;
}

const RUN_STATUS_ORDER = { starting: 0, running: 1, ended: 2 } as const;

/** §11.6 I-6: Attempt, Run, Outbox and Lease end together (D-14 ended rows, AD-1, L-2). */
export function checkI6EndingConsistency(world: InvariantWorld): InvariantViolation[] {
  const index = indexOf(world);
  const out: InvariantViolation[] = [];
  const outboxes = new Map(world.outboxes.map((outbox) => [refKey(outbox.ref), outbox]));
  for (const attempt of world.attempts) {
    const run = index.run({ goalId: attempt.ref.goalId, runId: attempt.runId });
    if (run === undefined) {
      out.push(finding('I-6', attempt.ref, `Attempt ${attempt.ref.attemptId} names Run ${attempt.runId}, which is not in the window`));
      continue;
    }
    const outbox = outboxes.get(refKey({ ...attempt.ref, aggregateType: 'DispatchOutboxEntry' }));
    const id = attempt.ref.attemptId;
    if ((attempt.status === 'ended') !== (run.status === 'ended')) out.push(finding('I-6', attempt.ref, `Attempt ${id} is ${attempt.status} while Run ${run.ref.runId} is ${run.status}`));
    if (attempt.status === 'ended' && run.status === 'ended' && attempt.endOutcome !== run.outcome) {
      out.push(finding('I-6', attempt.ref, `Attempt ${id} ended ${String(attempt.endOutcome)}, its Run ${String(run.outcome)}`));
    }
    if (attempt.status === 'claimed' && run.status !== 'starting') out.push(finding('I-6', attempt.ref, `claimed Attempt ${id} has a ${run.status} Run`));
    if (attempt.status === 'started' && run.status !== 'running') out.push(finding('I-6', attempt.ref, `started Attempt ${id} has a ${run.status} Run`));
    if (outbox === undefined) {
      out.push(finding('I-6', attempt.ref, `Attempt ${id} has no Outbox`));
      continue;
    }
    const unknownEnd = run.status === 'ended' && run.outcome === 'outcome_unknown';
    if ((outbox.status === 'settled') !== (run.status === 'ended' && known(run.outcome))) {
      out.push(finding('I-6', outbox.ref, `Outbox of ${id} is ${outbox.status} while Run ${run.ref.runId} is ${run.status} ${String(run.outcome)}`));
    }
    if (outbox.status === 'entered' && !(run.status === 'running' || (unknownEnd && attempt.startedAt !== null))) {
      out.push(finding('I-6', outbox.ref, `Outbox of ${id} is entered while Run ${run.ref.runId} is ${run.status} ${String(run.outcome)}`));
    }
    if (outbox.status === 'pending' && !(run.status === 'starting' || (unknownEnd && attempt.startedAt === null))) {
      out.push(finding('I-6', outbox.ref, `Outbox of ${id} is pending while Run ${run.ref.runId} is ${run.status} ${String(run.outcome)}`));
    }
    if (attempt.status === 'ended') {
      for (const problem of checkAttemptPairing(run, attempt, outbox, index.lease(attempt.ref.goalId, attempt.ref.taskId))) {
        out.push(finding('I-6', attempt.ref, problem));
      }
    }
  }
  for (const lease of world.leases) {
    const release = lease.release;
    if (release === undefined) continue;
    const run = index.run(release.runRef);
    if (run === undefined || run.status !== 'ended' || !known(run.outcome) || lease.holderRunId !== run.ref.runId) {
      out.push(finding('I-6', lease.ref, `the Lease of ${lease.ref.taskId} was released by Run ${release.runRef.runId}, which is not its ended holder with a known outcome`));
    }
  }
  return out;
}

const INTERRUPTED_CAUSES: readonly string[] = ['host_restart', 'ticket_invalid'];
const INCONCLUSIVE_CAUSES: readonly string[] = ['not_started', 'source_not_matched', 'process_timed_out', 'process_cancelled', 'process_abnormal'];

/** §11.7 I-7: round and check shapes, outcomes, causes; finalized rounds and settled checks never change. */
export function checkI7RoundConsistency(world: InvariantWorld, prev?: InvariantWorld): InvariantViolation[] {
  const index = indexOf(world);
  const out: InvariantViolation[] = [];
  for (const round of world.rounds) {
    const id = round.ref.roundId;
    if (round.status === 'open' && round.outcome !== null) out.push(finding('I-7', round.ref, `open round ${id} has outcome ${round.outcome}`));
    if (round.status === 'finalized') {
      if (round.outcome === null) out.push(finding('I-7', round.ref, `finalized round ${id} has no outcome`));
      if (round.checks.some((check) => check.phase === 'executing')) out.push(finding('I-7', round.ref, `finalized round ${id} still has an executing check`));
    }
    if (round.outcome === 'PASS') {
      if (round.gaps.length > 0) out.push(legacy('I-7', round.ref, `round ${id} is PASS with ${round.gaps.length} gap(s) (before VD-4)`));
      for (const planned of round.verificationPlan.checks) {
        const check = round.checks.find((candidate) => candidate.checkId === planned.checkId);
        if (check === undefined || check.phase !== 'finished' || check.outcome !== 'PASS' || check.sourceStatus !== 'matched') {
          out.push(finding('I-7', round.ref, `PASS round ${id} has required check ${planned.checkId} ${check === undefined ? 'missing' : `${check.phase} ${String(check.outcome)} ${String(check.sourceStatus)}`}`));
        }
      }
    }
    if (round.outcome === 'FAIL') {
      const failed = round.checks.filter((check) => check.phase === 'finished' && check.outcome === 'FAIL');
      if (failed.length === 0) out.push(finding('I-7', round.ref, `FAIL round ${id} has no finished FAIL check (D-2)`));
      const evidence = round.evidenceRefs.map((ref) => index.evidence(ref.evidenceId));
      if (failed.length > 0 && evidence.every((snapshot) => snapshot !== undefined)
        && !evidence.some((snapshot) => snapshot!.evidence.outcome === 'FAIL')) {
        out.push(finding('I-7', round.ref, `FAIL round ${id} admitted no applicable FAIL evidence (D-2)`));
      }
    }
    for (const check of round.checks) {
      const fields = [check.invocationId, check.outcome, check.reportRef, check.sourceStatus].map((value) => value !== null);
      const shape = check.phase === 'pending' ? [false, false, false, false]
        : check.phase === 'finished' ? [true, true, true, true] : [true, false, false, false];
      if (fields.some((value, position) => value !== shape[position])) {
        out.push(finding('I-7', round.ref, `check ${check.checkId} of round ${id} is ${check.phase} with fields ${JSON.stringify(fields)} (§9.1)`));
      }
      const cause = check.incompleteCause ?? null;
      const needsCause = check.phase === 'interrupted' || (check.phase === 'finished' && check.outcome === 'INCONCLUSIVE');
      const allowed = check.phase === 'interrupted' ? INTERRUPTED_CAUSES : INCONCLUSIVE_CAUSES;
      if (needsCause !== (cause !== null) || (cause !== null && !allowed.includes(cause))) {
        const message = `check ${check.checkId} of round ${id} is ${check.phase} ${String(check.outcome)} with cause ${String(cause)} (C5)`;
        out.push(check.incompleteCause === undefined ? legacy('I-7', round.ref, `${message}; no cause field`) : finding('I-7', round.ref, message));
      }
    }
  }
  if (prev === undefined) return out;
  for (const before of prev.rounds) {
    const after = index.round(before.ref);
    if (after === undefined) continue; // I-15 reports a disappeared record.
    const id = before.ref.roundId;
    if (before.status === 'finalized' && (after.status !== before.status || after.outcome !== before.outcome
      || !sameJson(after.gaps, before.gaps) || !sameJson(after.evidenceRefs, before.evidenceRefs))) {
      out.push(finding('I-7', before.ref, `finalized round ${id} changed`));
    }
    for (const check of before.checks) {
      if (check.phase !== 'interrupted' && check.phase !== 'finished') continue;
      const now = after.checks.find((candidate) => candidate.checkId === check.checkId);
      if (!sameJson(now, check)) out.push(finding('I-7', before.ref, `${check.phase} check ${check.checkId} of round ${id} changed`));
    }
    if (before.chain !== undefined && !sameJson(after.chain, before.chain)) out.push(finding('I-7', before.ref, `the chain of round ${id} changed`));
  }
  return out;
}

const MESSAGE_ORDER = { pending: 0, read: 1, responded: 2 } as const;

/** §11.8 I-8: message status shapes; status never goes back, the response is written once, inputs only append. */
export function checkI8MessageMonotone(world: InvariantWorld, prev?: InvariantWorld): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const message of world.messages) {
    const id = message.ref.messageId;
    const shape = message.status === 'pending' ? message.readAt === null && message.response === null
      : message.status === 'read' ? message.readAt !== null && message.response === null
        : message.readAt !== null && message.response !== null;
    if (!shape) out.push(finding('I-8', message.ref, `message ${id} is ${message.status} with readAt ${String(message.readAt)} and ${message.response === null ? 'no' : 'a'} response`));
  }
  if (prev === undefined) return out;
  const now = new Map(world.messages.map((message) => [refKey(message.ref), message]));
  for (const before of prev.messages) {
    const after = now.get(refKey(before.ref));
    if (after === undefined) continue;
    const id = before.ref.messageId;
    if (MESSAGE_ORDER[after.status] < MESSAGE_ORDER[before.status]) out.push(finding('I-8', before.ref, `message ${id} went back from ${before.status} to ${after.status}`));
    if (before.response !== null && !sameJson(after.response, before.response)) out.push(finding('I-8', before.ref, `the response of message ${id} changed`));
    const inputs = before.acceptedInputs ?? [];
    if (!sameJson((after.acceptedInputs ?? []).slice(0, inputs.length), inputs)) out.push(finding('I-8', before.ref, `the accepted inputs of message ${id} were rewritten`));
    if (before.consultationDerivation !== undefined && !sameJson(after.consultationDerivation, before.consultationDerivation)) {
      out.push(finding('I-8', before.ref, `the consultation derivation of message ${id} changed`));
    }
  }
  return out;
}

const ADMISSION_EVENTS: ReadonlySet<InvariantEventType> = new Set<InvariantEventType>([
  'TaskClaimed', 'ExecutionEntryAuthorized', 'VerificationRoundOpened', 'VerificationCheckBegun', 'TaskRequeued',
  'TaskReworkRefused', 'VerificationRoundReverified',
]);

/**
 * §11.9 I-9 over the event log: every claim, authorization, round open, check
 * begin, rework write and Run resume commits while the Goal's last
 * `GoalCreated`/`GoalDesiredStateChanged` before it says `active`.
 */
export function checkI9NoAdmissionAfterGoalStop(world: Pick<InvariantWorld, 'events'>): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const desired = new Map<string, GoalDesiredState>();
  for (const event of [...world.events].sort((left, right) => left.seq - right.seq)) {
    if (event.goalStateTo !== null) {
      desired.set(event.goalId, event.goalStateTo);
      continue;
    }
    const admits = ADMISSION_EVENTS.has(event.eventType) || (event.eventType === 'ControlIntentSubmitted' && event.controlKind === 'resume');
    if (!admits) continue;
    const state = desired.get(event.goalId);
    if (state !== 'active') {
      out.push(finding('I-9', event.subject, `${event.eventType}${event.controlKind === null ? '' : ` (${event.controlKind})`} committed at #${event.seq} while Goal ${event.goalId} is ${state ?? 'not created'}`));
    }
  }
  return out;
}

// ------------------------------------------------------------------------ //
// I-10..I-15                                                                //
// ------------------------------------------------------------------------ //

/** §11.10 I-10: each Run is one of the §6.1 machine states; continuation ⇔ yielded; `failed` never appears. */
export function checkI10RunNodeShape(world: InvariantWorld): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const run of world.runs) {
    const auth = run.executionAuthorization;
    if (auth !== undefined && !isAuthorizationV2(auth)) {
      if (run.outcome === 'failed') out.push(legacy('I-10', run.ref, `V1 Run ${run.ref.runId} ended failed`));
      continue;
    }
    const problem = runCombinationProblem(run);
    if (problem !== null) {
      out.push(finding('I-10', run.ref, `Run ${run.ref.runId}: ${problem}`));
      continue;
    }
    if ((run.continuation !== undefined) !== (run.outcome === 'yielded')) {
      out.push(finding('I-10', run.ref, `Run ${run.ref.runId} ended ${String(run.outcome)} ${run.continuation === undefined ? 'without' : 'with'} a continuation`));
    }
  }
  return out;
}

/** §11.10 I-11: a QueryRun is answered/closed ⇔ its execution settled ⇔ it has an end and an outcome. */
export function checkI11QueryRunSettlement(world: InvariantWorld): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const query of world.queryRuns) {
    const run = query.run;
    const statusSettled = run.status === 'answered' || run.status === 'closed';
    const phaseSettled = run.executionState?.phase === 'settled';
    const ended = run.endedAt !== null && run.outcome !== null;
    if (statusSettled !== phaseSettled || phaseSettled !== ended) {
      out.push(finding('I-11', query.ref, `QueryRun ${query.ref.runId} is ${run.status}, phase ${run.executionState?.phase ?? 'none'}, endedAt ${String(run.endedAt)}, outcome ${String(run.outcome)}`));
    }
  }
  return out;
}

/** The TaskRequeues before Run r along its chain (`requeueRef`, `consumedWait`), ND-3. */
function requeuesBefore(index: WorldIndex, run: RunSnapshot): TaskRequeueSnapshotV1[] {
  const found: TaskRequeueSnapshotV1[] = [];
  const seen = new Set<string>();
  let current: RunSnapshot | undefined = run;
  while (current !== undefined && !seen.has(runKey(current.ref))) {
    seen.add(runKey(current.ref));
    if (current.requeueRef !== undefined) {
      const requeue = index.requeue(current.requeueRef);
      if (requeue === undefined) break;
      found.push(requeue);
      current = index.run(requeue.afterRunRef);
    } else if (current.consumedWait !== undefined) {
      current = index.run(current.consumedWait.runRef);
    } else {
      current = undefined;
    }
  }
  return found;
}

/**
 * I-12 clause 7's `prev`, as §11.12 writes it (not the writer's helper): from
 * r back along `consumedWait` to the first Run with a `requeueRef`, that
 * TaskRequeue's `autoCount`; 0 when there is none. A `requeueRef` whose
 * TaskRequeue is not in the window is reported (`missing`), counted as 0.
 */
function priorAutoCount(index: WorldIndex, run: RunSnapshot): { count: number; missing: { runId: string; afterRunId: string } | null } {
  const seen = new Set<string>();
  let current: RunSnapshot | undefined = run;
  while (current !== undefined && !seen.has(runKey(current.ref))) {
    seen.add(runKey(current.ref));
    if (current.requeueRef !== undefined) {
      const requeue = index.requeue(current.requeueRef);
      return requeue === undefined ? { count: 0, missing: { runId: current.ref.runId, afterRunId: current.requeueRef.afterRunId } }
        : { count: requeue.automation.autoCount, missing: null };
    }
    current = current.consumedWait === undefined ? undefined : index.run(current.consumedWait.runRef);
  }
  return { count: 0, missing: null };
}

/**
 * Slice 1 (spec §3.4, §3.5, lead 2026-10-08): an archive requeue's class is re-derived with the
 * verified interruption that the persisted facts support: an execution origin only through an
 * anchor in the window for that afterRun (cause retired_archive → retired_interruption, otherwise
 * archive_cancel); a wait origin only for that afterRun. A forged or unmatched origin gives null,
 * so the plain three-argument derivation decides (and differs from an exempted class).
 */
function archiveInterruptionOf(requeue: InvariantWorld['requeues'][number],
  anchors: readonly SessionAnomalyAnchorV1[]): VerifiedArchiveInterruptionV1 | null {
  const origin = requeue.archiveOrigin ?? null;
  if (origin === null) return null;
  if (origin.kind === 'wait') {
    return sameRef(origin.runRef, requeue.afterRunRef)
      ? { kind: 'wait', runRef: origin.runRef, messageRef: origin.messageRef, cause: 'archive_wait_cancel' } : null;
  }
  const anchor = anchors.find(candidate => sameRef(candidate.ref, origin.anchorRef));
  if (anchor === undefined || !sameRef(anchor.runRef, requeue.afterRunRef)) return null;
  return { kind: 'execution', anchorRef: anchor.ref, runRef: anchor.runRef,
    cause: anchor.cause === 'retired_archive' ? 'retired_interruption' : 'archive_cancel' };
}

/** §11.12 I-12: every TaskRequeue equals what the persistent facts re-derive (clauses 1–10), plus the step-local clause. */
export function checkI12RequeueFacts(world: InvariantWorld, prev?: InvariantWorld, step?: FuzzStep): InvariantViolation[] {
  const index = indexOf(world);
  const out: InvariantViolation[] = [];
  for (const requeue of world.requeues) {
    const at = requeue.ref;
    const run = index.run(requeue.afterRunRef);
    if (run === undefined) {
      out.push(finding('I-12', at, `the afterRun ${requeue.afterRunRef.runId} is not in the window`));
      continue;
    }
    const cls = actorClassOf(requeue.requestedBy);
    // 1. Unique and known.
    if (at.afterRunId !== requeue.afterRunRef.runId || at.taskId !== run.task.taskId) out.push(finding('I-12', at, 'the record key does not name its afterRun and Task'));
    if (run.status !== 'ended' || !known(run.outcome)) out.push(finding('I-12', at, `the afterRun ${run.ref.runId} is ${run.status} ${String(run.outcome)}`));
    else if (requeue.afterOutcome !== run.outcome) out.push(finding('I-12', at, `afterOutcome ${requeue.afterOutcome} ≠ Run outcome ${run.outcome}`));
    if (run.outcome === 'yielded' && run.controlState?.desiredState !== 'cancelled') out.push(finding('I-12', at, 'a yielded afterRun without a cancelled pointer (P17)'));
    // 2. Head and evidence.
    const chain = index.head(run);
    if (requeue.afterRoundRef === null) {
      if (chain.kind !== 'none') out.push(finding('I-12', at, `afterRoundRef is null but Run ${run.ref.runId} has a round chain`));
    } else if (chain.kind !== 'head') {
      out.push(finding('I-12', at, `afterRoundRef names a round but the chain is ${chain.kind === 'none' ? 'empty' : `invalid: ${chain.reason}`}`));
    } else if (!sameRef(chain.head.ref, requeue.afterRoundRef)) {
      out.push(finding('I-12', at, `afterRoundRef ${requeue.afterRoundRef.roundId} is not the chain head ${chain.head.ref.roundId}`));
    } else if (!isFinalizedNonPass(chain.head)) {
      out.push(finding('I-12', at, `the head ${chain.head.ref.roundId} is not finalized non-PASS`));
    }
    const afterRound = requeue.afterRoundRef === null ? null : index.round(requeue.afterRoundRef) ?? null;
    if (!sameJson(requeue.supersededEvidenceIds, afterRound === null ? [] : chainEvidenceIds(afterRound))) {
      out.push(finding('I-12', at, 'supersededEvidenceIds is not chainEvidenceIds(afterRoundRef) (TD-2)'));
    }
    // 3, 4. Class and stop, from the Run, its pointer and its head.
    const pointer = index.pointer(run);
    if (pointer.status === 'missing') {
      out.push(finding('I-12', at, `the pointer intent ${pointer.ref.intentId} of Run ${run.ref.runId} is not in the window`));
    } else {
      const intent = pointer.status === 'found' ? pointer.intent : null;
      const derived = deriveReworkClass(run, intent, chain, archiveInterruptionOf(requeue, world.anchors ?? []));
      if (derived.kind !== 'class') out.push(finding('I-12', at, `the afterRun derives ${derived.row} (${derived.kind}), not a rework class`));
      else if (derived.failureClass !== requeue.failureClass || derived.interruption !== requeue.interruption) {
        out.push(finding('I-12', at, `failureClass/interruption ${requeue.failureClass}/${String(requeue.interruption)} ≠ derived ${derived.failureClass}/${String(derived.interruption)}`));
      }
      // Clause 4 as §11.12 writes it: a pause or cancel pointer gives its ref and `stopRequesterOf`, else null and none.
      const stop = intent !== null && (intent.kind === 'pause' || intent.kind === 'cancel')
        ? { intentRef: intent.ref, requester: stopRequesterOf(intent) } : { intentRef: null, requester: 'none' as const };
      if (!sameRef(requeue.stopIntentRef, stop.intentRef) || requeue.stopRequester !== stop.requester) {
        out.push(finding('I-12', at, `stop ${requeue.stopIntentRef?.intentId ?? 'null'}/${requeue.stopRequester} ≠ derived ${stop.intentRef?.intentId ?? 'null'}/${stop.requester}`));
      }
    }
    if ((requeue.interruption !== null) !== (requeue.failureClass === 'interrupted')) out.push(finding('I-12', at, 'interruption is set exactly for class interrupted'));
    if ((requeue.interruption === 'paused') !== isPausedInterrupted(run)) out.push(finding('I-12', at, `interruption ${String(requeue.interruption)} disagrees with isPausedInterrupted`));
    if (requeue.failureClass === 'check_incomplete' && cls !== 'human') out.push(finding('I-12', at, `a ${cls} requeued check_incomplete (only a human may; TASK-17)`));
    if (requeue.failureClass === 'cancelled' && cls === 'agent') out.push(finding('I-12', at, 'an agent requeued a cancelled Run (C2)'));
    // 5. Key comparison.
    const comparison = requeue.failureClass === 'interrupted' ? 'skipped_interrupted'
      : requeue.failureClass === 'cancelled' && cls === 'human' ? 'skipped_human_cancel' : 'compared';
    if (requeue.basisComparison !== comparison) out.push(finding('I-12', at, `basisComparison ${requeue.basisComparison} ≠ ${comparison}`));
    if (comparison === 'compared') {
      const same = requeuesBefore(index, run).filter((earlier) => earlier.basis.digest === requeue.basis.digest);
      if (same.length > 0) out.push(finding('I-12', at, `the compared key equals earlier TaskRequeue ${same.map((s) => s.ref.afterRunId).join(', ')} (ND-3)`));
    }
    // 6. Actor and trigger.
    if ((cls === 'agent') !== (requeue.agentProvenance !== null)) out.push(finding('I-12', at, `agentProvenance does not match actor class ${cls}`));
    if ((requeue.trigger !== undefined) !== isGoalFanOut(requeue.requestedBy)) {
      out.push(finding('I-12', at, `${requeue.trigger === undefined ? 'no trigger' : 'a trigger'} with requestedBy ${requeue.requestedBy.kind}:${requeue.requestedBy.id} (a trigger exactly for GOAL_FAN_OUT_ACTOR, GOAL-29)`));
    }
    if (requeue.trigger !== undefined && (requeue.trigger.kind !== 'goal_resume' || requeue.interruption !== 'paused'
      || requeue.stopRequester !== 'goal_fan_out')) {
      out.push(finding('I-12', at, 'a Goal-resume continuation continues a fan-out pause (goal_resume, paused, goal_fan_out)'));
    }
    // 7. Automatic count.
    const automatic = cls !== 'human';
    const counted = automatic && requeue.failureClass !== 'interrupted';
    const prior = priorAutoCount(index, run);
    if (prior.missing !== null) out.push(finding('I-12', at, `Run ${prior.missing.runId} claimed with TaskRequeue ${prior.missing.afterRunId}, which is not in the window`));
    const expectedCount = !automatic ? 0 : counted ? prior.count + 1 : prior.count;
    const automation = requeue.automation;
    if (automation.automatic !== automatic || automation.counted !== counted || automation.autoCount !== expectedCount
      || (automation.cap !== null) !== automatic || (automation.cap !== null && automation.cap > MAX_AUTO_REWORK_LIMIT)) {
      out.push(finding('I-12', at, `automation ${JSON.stringify(automation)} ≠ {automatic:${automatic}, counted:${counted}, autoCount:${expectedCount}, cap ${automatic ? '0..10' : 'null'}}`));
    }
    if (counted && automation.cap !== null && automation.autoCount > automation.cap) out.push(finding('I-12', at, `autoCount ${automation.autoCount} exceeds the cap ${automation.cap}`));
    // 8. Budget.
    if (requeue.budget !== null && cls === 'agent') out.push(finding('I-12', at, 'an agent requeue carries a budget'));
    if (run.outcome === 'budget_exhausted' && !((requeue.budget !== null && requeue.budget.tokenBudget > run.budget.tokenBudget)
      || requeue.newInputRefs.length > 0)) {
      out.push(finding('I-12', at, 'a requeue after budget_exhausted has neither a larger budget nor a new input'));
    }
    // 9. The claim with this requeueRef.
    const claimants = world.runs.filter((candidate) => candidate.requeueRef !== undefined && sameRef(candidate.requeueRef, requeue.ref));
    if (claimants.length > 1) out.push(finding('I-12', at, `${claimants.length} Runs claim with this TaskRequeue`));
    for (const claimant of claimants) {
      if (claimant.task.taskId !== at.taskId || claimant.ref.goalId !== at.goalId) out.push(finding('I-12', at, `Run ${claimant.ref.runId} claims it for another Task`));
      if (claimant.consumedWait !== undefined) out.push(finding('I-12', at, `Run ${claimant.ref.runId} claims it and consumes a wait`));
      const attempt = index.attemptOf(claimant);
      if (attempt === undefined || !sameRef(attempt.requeueRef, requeue.ref)) out.push(finding('I-12', at, `the Attempt of Run ${claimant.ref.runId} does not record this requeueRef`));
      if (requeue.budget !== null && !sameJson(claimant.budget, requeue.budget)) out.push(finding('I-12', at, `Run ${claimant.ref.runId} budget differs from the pinned budget`));
    }
    // 10. History source (LA-1).
    if (run.executionHistory !== undefined) {
      const claim = index.claimOf(run);
      if (requeue.historySource !== null && claim !== null && !sameRef(requeue.historySource.sessionRef, claim.sessionRef)) {
        out.push(finding('I-12', at, `historySource names Session ${requeue.historySource.sessionRef.sessionId}, not the claim Session ${claim.sessionRef.sessionId}`));
      }
    } else {
      const inherited = run.requeueRef === undefined ? null : index.requeue(run.requeueRef)?.historySource ?? null;
      if (!sameJson(requeue.historySource, inherited)) out.push(finding('I-12', at, 'the historySource of an un-entered afterRun is not the one its requeueRef carries'));
    }
  }
  if (step?.kind === 'task_requeued' && prev !== undefined) {
    const before = indexOf(prev);
    for (const requeue of written(prev.requeues, world.requeues)) {
      const at = requeue.ref;
      const selected = before.taskState(at.goalId, at.taskId)?.selectedRunRef ?? null;
      if (!sameRef(selected, requeue.afterRunRef)) out.push(finding('I-12', at, `the afterRun ${requeue.afterRunRef.runId} was not the selected Run before the step`));
      const run = before.run(requeue.afterRunRef);
      if (run !== undefined && runUnresolvedBlocker(run) !== null) out.push(finding('I-12', at, `the afterRun ${run.ref.runId} was unresolved`));
      const plan = index.activePlan(at.goalId);
      const task = plan === null ? undefined : taskOf(plan, at.taskId);
      if (task?.disposition !== 'active') out.push(finding('I-12', at, `Task ${at.taskId} is ${task?.disposition ?? 'not in the active Plan'}`));
      if (index.goal(at.goalId)?.desiredState !== 'active') out.push(finding('I-12', at, `Goal ${at.goalId} is not active`));
      // Clause 7: `cap` is the `autoReworkLimit` in effect when the requeue was written (§11.11 "上限变化").
      const cap = requeue.automation.cap;
      if (requeue.automation.automatic && cap !== step.automationPolicy.autoReworkLimit) {
        out.push(finding('I-12', at, `the automatic requeue records cap ${String(cap)}, not the limit ${step.automationPolicy.autoReworkLimit} in effect`));
      }
    }
  }
  return out;
}

/** §11.10 I-13: a TaskEvidenceIndex has revision = its id count ≥ 1 (a legacy @0 is `legacy`). */
export function checkI13EvidenceIndex(world: InvariantWorld): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const index of world.evidenceIndexes) {
    if (index.revision === 0 && index.evidenceIds.length === 0) out.push(legacy('I-13', index.ref, `TaskEvidenceIndex of ${index.ref.taskId} is @0`));
    else if (index.revision !== index.evidenceIds.length || index.revision < 1) {
      out.push(finding('I-13', index.ref, `TaskEvidenceIndex of ${index.ref.taskId} is @${index.revision} with ${index.evidenceIds.length} id(s)`));
    }
  }
  return out;
}

/** §11.10 I-14: a GoalPhase of the active Plan has an active Goal. */
export function checkI14CompletedGoalIsActive(world: InvariantWorld): InvariantViolation[] {
  const index = indexOf(world);
  const out: InvariantViolation[] = [];
  for (const phase of world.goalPhases) {
    const goal = index.goal(phase.ref.goalId);
    if (goal !== undefined && sameRef(phase.planRef, goal.activePlanRevision) && goal.desiredState !== 'active') {
      out.push(finding('I-14', phase.ref, `Goal ${goal.ref.goalId} has a GoalPhase of its active Plan while ${goal.desiredState}`));
    }
  }
  return out;
}

const OUTBOX_ORDER = { pending: 0, entered: 1, settled: 2 } as const;
const ATTEMPT_ORDER = { claimed: 0, started: 1, ended: 2 } as const;
const ENTERED_PHASES: readonly string[] = ['entered', 'unknown', 'settled'];

function runMonotoneProblems(before: RunSnapshot, after: RunSnapshot): string[] {
  const problems: string[] = [];
  const id = before.ref.runId;
  if (RUN_STATUS_ORDER[after.status] < RUN_STATUS_ORDER[before.status]) problems.push(`Run ${id} went back from ${before.status} to ${after.status}`);
  if (before.status === 'ended' && before.outcome !== after.outcome) {
    if (before.outcome !== 'outcome_unknown') problems.push(`Run ${id} changed its outcome ${String(before.outcome)} to ${String(after.outcome)}`);
    else {
      const kind = after.reconciliation?.observation.kind;
      if (kind !== 'runtime_terminal' && kind !== 'human_attested') problems.push(`Run ${id} left outcome_unknown without RUN-21/22 (${String(kind)})`);
    }
  }
  for (const field of ['task', 'planRef', 'attemptId', 'requeueRef', 'consumedWait'] as const) {
    if (!sameJson(after[field], before[field])) problems.push(`Run ${id} changed its claim field ${field}`);
  }
  if (before.terminalPayload !== undefined && !sameJson(after.terminalPayload, before.terminalPayload)) problems.push(`Run ${id} rewrote its terminalPayload`);
  if (before.inputBinding !== undefined && !sameJson(after.inputBinding, before.inputBinding)) problems.push(`Run ${id} rewrote its inputBinding`);
  const authBefore = before.executionAuthorization;
  const authAfter = after.executionAuthorization;
  if (isAuthorizationV2(authBefore)) {
    if (!isAuthorizationV2(authAfter)) problems.push(`Run ${id} lost its V2 authorization`);
    else {
      if (authAfter.generation < authBefore.generation) problems.push(`Run ${id} entry generation went back`);
      if (ENTERED_PHASES.includes(authBefore.phase) && !ENTERED_PHASES.includes(authAfter.phase)) problems.push(`Run ${id} went back from entry phase ${authBefore.phase} to ${authAfter.phase}`);
      if (authBefore.phase === 'settled' && authAfter.phase !== 'settled') problems.push(`Run ${id} left the settled entry phase`);
      if (authBefore.phase === 'unknown' && authAfter.phase === 'entered') problems.push(`Run ${id} went back from entry phase unknown to entered`);
      // `Entering → Revoked → Authorized` only via RUN-16 then RUN-03, and RUN-03 writes a new generation.
      if (authAfter.phase === 'authorized' && (authBefore.phase === 'entering' || authBefore.phase === 'revoked')
        && authAfter.generation <= authBefore.generation) {
        problems.push(`Run ${id} went from entry phase ${authBefore.phase} to authorized without a new generation (RUN-16/RUN-03)`);
      }
    }
  }
  return problems;
}

function attemptMonotoneProblems(before: TaskAttemptSnapshot, after: TaskAttemptSnapshot): string[] {
  const id = before.ref.attemptId;
  if (ATTEMPT_ORDER[after.status] < ATTEMPT_ORDER[before.status]) return [`Attempt ${id} went back from ${before.status} to ${after.status}`];
  if (before.status === 'ended' && before.endOutcome !== 'outcome_unknown' && after.endOutcome !== before.endOutcome) {
    return [`Attempt ${id} changed its known end ${String(before.endOutcome)} to ${String(after.endOutcome)}`];
  }
  return [];
}

function outboxMonotoneProblems(before: TaskClaimOutbox, after: TaskClaimOutbox): string[] {
  const id = before.ref.attemptId;
  if (OUTBOX_ORDER[after.status] < OUTBOX_ORDER[before.status]) return [`Outbox ${id} went back from ${before.status} to ${after.status}`];
  if (before.status === 'settled' && !sameJson(after, before)) return [`settled Outbox ${id} changed`];
  return [];
}

function intentMonotoneProblems(before: ControlIntentSnapshotV1, after: ControlIntentSnapshotV1): string[] {
  const id = before.ref.intentId;
  if ((before.status === 'applied' || before.status === 'superseded') && !sameJson(after, before)) return [`${before.status} intent ${id} changed`];
  // D-8: OutcomeUnknown leaves only through CTL-07, to Applied or Superseded.
  if (before.status === 'outcome_unknown' && after.status === 'queued') return [`intent ${id} went back from outcome_unknown to queued`];
  return [];
}

function compareKind<T extends { ref: object; revision: number }>(
  out: InvariantViolation[], kind: string, before: readonly T[], after: readonly T[],
  problems: (before: T, after: T) => string[] = () => [],
): void {
  const now = new Map(after.map((record) => [refKey(record.ref), record]));
  for (const record of before) {
    const next = now.get(refKey(record.ref));
    if (next === undefined) {
      out.push(finding('I-15', record.ref, `${kind} disappeared`));
      continue;
    }
    if (next.revision < record.revision) out.push(finding('I-15', record.ref, `${kind} went back from @${record.revision} to @${next.revision}`));
    for (const problem of problems(record, next)) out.push(finding('I-15', record.ref, problem));
  }
}

/** §11.10 I-15: records only move forward; immutable records and write-once fields never change (needs `prev`). */
export function checkI15Monotone(world: InvariantWorld, prev?: InvariantWorld): InvariantViolation[] {
  if (prev === undefined) return [];
  const out: InvariantViolation[] = [];
  const immutable = <T>(kind: string) => (before: T, after: T): string[] => sameJson(after, before) ? [] : [`${kind} is immutable and changed`];
  compareKind(out, 'Run', prev.runs, world.runs, runMonotoneProblems);
  compareKind(out, 'TaskAttempt', prev.attempts, world.attempts, attemptMonotoneProblems);
  compareKind(out, 'DispatchOutboxEntry', prev.outboxes, world.outboxes, outboxMonotoneProblems);
  compareKind(out, 'ControlIntent', prev.intents, world.intents, intentMonotoneProblems);
  compareKind(out, 'TaskLease', prev.leases, world.leases);
  compareKind(out, 'Session', prev.sessions, world.sessions);
  compareKind(out, 'QueryRun', prev.queryRuns, world.queryRuns);
  compareKind(out, 'VerificationRound', prev.rounds, world.rounds, (before, after) =>
    before.chain !== undefined && !sameJson(after.chain, before.chain) ? [`the chain of round ${before.ref.roundId} changed`] : []);
  compareKind(out, 'TaskEvidenceIndex', prev.evidenceIndexes, world.evidenceIndexes);
  compareKind(out, 'SessionMessage', prev.messages, world.messages);
  compareKind(out, 'Goal', prev.goals, world.goals);
  compareKind(out, 'GoalPhase', prev.goalPhases, world.goalPhases);
  compareKind(out, 'TaskReduction', prev.reductions, world.reductions);
  compareKind(out, 'TaskReworkRefusal', prev.refusals, world.refusals);
  compareKind(out, 'PlanRevision', prev.plans, world.plans, immutable('PlanRevision'));
  compareKind(out, 'Evidence', prev.evidence, world.evidence, immutable('Evidence'));
  compareKind(out, 'TaskRequeue', prev.requeues, world.requeues, immutable('TaskRequeue'));
  return out;
}

// ------------------------------------------------------------------------ //
// I-16..I-22                                                                //
// ------------------------------------------------------------------------ //

/** §11.13 I-16: a Run the restart ended while paused agrees with its pointer and pause intent, and projects P19. */
export function checkI16PausedInterrupted(world: InvariantWorld): InvariantViolation[] {
  const index = indexOf(world);
  const out: InvariantViolation[] = [];
  for (const run of world.runs) {
    const observation = run.reconciliation?.observation;
    if (observation?.kind !== 'interrupted_clean') continue;
    const id = run.ref.runId;
    const paused = observation.pausedIntentRef;
    if (paused !== null) {
      if (run.outcome !== 'crashed') out.push(finding('I-16', run.ref, `paused-interrupted Run ${id} ended ${String(run.outcome)}, not crashed`));
      if (run.controlState?.desiredState !== 'paused' || !sameRef(run.controlState.intentRef, paused)) {
        out.push(finding('I-16', run.ref, `paused-interrupted Run ${id} does not point at its pause intent ${paused.intentId}`));
      }
      const intent = index.intent(paused);
      if (intent === undefined || intent.kind !== 'pause' || intent.status !== 'applied') {
        out.push(finding('I-16', run.ref, `the pause intent ${paused.intentId} of Run ${id} is ${intent === undefined ? 'missing' : `${intent.kind} ${intent.status}`}, not an applied pause`));
      }
    }
    if (run.outcome === 'cancelled' && paused !== null) out.push(finding('I-16', run.ref, `cancelled Run ${id} names a paused intent (RUN-23 is a cancel)`));
    if (!isPausedInterrupted(run)) continue;
    const requeue = index.requeueOf(run);
    const state = index.taskState(run.ref.goalId, run.task.taskId);
    if (requeue === null && state !== undefined && sameRef(state.selectedRunRef, run.ref)) {
      const reduced = state.cause === null && index.reduction(run.ref.goalId, run.task.taskId) !== undefined;
      if (!reduced && !(state.phase === 'blocked' && state.cause?.code === 'paused_interrupted')) {
        out.push(finding('I-16', run.ref, `Task ${run.task.taskId} of paused-interrupted Run ${id} projects ${String(state.phase)}/${state.cause?.code ?? 'none'}, not blocked/paused_interrupted (P19)`));
      }
    }
    if (requeue !== null) {
      const fanOut = isGoalFanOut(requeue.requestedBy) && requeue.trigger?.kind === 'goal_resume';
      if (requeue.interruption !== 'paused') out.push(finding('I-16', requeue.ref, `the continuation of Run ${id} has interruption ${String(requeue.interruption)}`));
      if (actorClassOf(requeue.requestedBy) !== 'human' && !fanOut) out.push(finding('I-16', requeue.ref, `Run ${id} was continued automatically, not by a human or the Goal-resume fan-out`));
    }
  }
  return out;
}

/** §11.14 I-17: work a human stopped is restarted only by a human (or the Goal-resume fan-out of a fan-out pause). */
export function checkI17HumanStopRespected(world: InvariantWorld, prev?: InvariantWorld, step?: FuzzStep): InvariantViolation[] {
  const index = indexOf(world);
  const out: InvariantViolation[] = [];
  for (const requeue of world.requeues) {
    const run = index.run(requeue.afterRunRef);
    const fence = index.fence(run);
    const cls = actorClassOf(requeue.requestedBy);
    const fanOut = isGoalFanOut(requeue.requestedBy) && requeue.trigger?.kind === 'goal_resume';
    if (fence === 'unknown') out.push(finding('I-17', requeue.ref, `the fence of Run ${requeue.afterRunRef.runId} is unknown: its pointer intent is not in the window`));
    if (fence === 'human_only' && cls !== 'human') out.push(finding('I-17', requeue.ref, `a ${cls} requeued Run ${requeue.afterRunRef.runId}, which a human stopped`));
    if (fence === 'human_or_goal_resume' && cls !== 'human' && !fanOut) {
      out.push(finding('I-17', requeue.ref, `a ${cls} requeued Run ${requeue.afterRunRef.runId} paused by the Goal fan-out without the Goal-resume trigger`));
    }
  }
  for (const round of world.rounds) {
    const reverify = round.chain?.reverify ?? null;
    if (reverify === null || isGateRound(round)) continue;
    const fence = index.fence(index.run(round.subjectRunRef));
    if (fence !== 'none' && (reverify.actorClass !== 'human' || actorClassOf(reverify.requestedBy) !== 'human')) {
      out.push(finding('I-17', round.ref, `a ${reverify.actorClass} reverified round ${round.ref.roundId} of a Run a human stopped (fence ${fence})`));
    }
  }
  if (step?.kind === 'plan_adopted' && prev !== undefined) {
    const before = indexOf(prev);
    const fenceBefore = (goalId: string, taskId: string): ReworkFence | 'unknown' => {
      const selected = before.taskState(goalId, taskId)?.selectedRunRef ?? null;
      return before.fence(selected === null ? null : before.run(selected));
    };
    const adopter = actorClassOf(step.actor);
    for (const goal of world.goals) {
      const adopted = index.activePlan(goal.ref.goalId);
      const source = before.activePlan(goal.ref.goalId);
      if (adopted === null || source === null || sameRef(adopted.ref, source.ref)) continue;
      // Guard 7: an automatic adopter never changes the disposition of a fenced traced Task. The adopter is
      // the persisted entry's `actor` (§11.0 `actorClass` of a disposition entry), whatever the step says.
      const entries = adopted.schemaVersion === 2 ? adopted.dispositionRecord?.entries ?? [] : [];
      for (const entry of entries) {
        if (!entry.traced || !sameRef(entry.setIn, adopted.ref)) continue;
        const entryClass = actorClassOf(entry.actor);
        if (entryClass === 'human') continue;
        const fence = fenceBefore(goal.ref.goalId, entry.taskId);
        if (fence !== 'none') {
          out.push(finding('I-17', adopted.ref, `a ${entryClass} changed the disposition of traced Task ${entry.taskId} (fence ${fence}; TASK-19 guard 7)`));
        }
      }
      // Guard 9: no new active work carrier for an obligation whose carriers a human stopped. A new carrier has
      // no entry actor, so the step's adopter is classified (only the automation or an agent is checked).
      if (adopter === 'human') continue;
      const carriers = (plan: PlanRevisionSnapshot, obligationId: string): string[] =>
        (plan.obligations.find((obligation) => obligation.obligationId === obligationId)?.taskIds ?? [])
          .filter((taskId) => { const task = taskOf(plan, taskId); return task?.taskKind === 'work' && task.disposition === 'active'; });
      for (const obligation of adopted.obligations) {
        const old = carriers(source, obligation.obligationId);
        const added = carriers(adopted, obligation.obligationId).filter((taskId) => !old.includes(taskId));
        if (added.length === 0 || old.length === 0) continue;
        if (!old.some((taskId) => fenceBefore(goal.ref.goalId, taskId) === 'none')) {
          out.push(finding('I-17', adopted.ref, `a ${adopter} added carrier(s) ${added.join(', ')} for obligation ${obligation.obligationId}, whose carriers a human stopped (guard 9)`));
        }
      }
    }
  }
  return out;
}

const REQUEUE_ONLY_CODES: readonly string[] = ['budget_not_increased'];
const REVERIFY_ONLY_CODES: readonly string[] = ['source_unchanged', 'verification_uncovered'];
const CONFIGURATION_CODES: readonly string[] = ['verification_uncovered', 'no_new_basis'];

/** The current head of a round's subject chain (work: its Run's chain; gate: the gate's chain). */
function subjectHead(index: WorldIndex, round: RoundSnapshot): RoundChainHeadV1 {
  return roundChainHead(isGateRound(round) ? index.gateChain(round.ref.goalId, round.ref.taskId)
    : index.workChain(round.ref.goalId, round.ref.taskId, round.ref.runId));
}

/** The record keys and revisions of the kinds a refusal step must not write. */
function nonRefusalVersions(world: InvariantWorld): string {
  const versions = [...world.runs, ...world.attempts, ...world.leases, ...world.sessions, ...world.rounds, ...world.requeues]
    .map((record) => `${refKey(record.ref)}@${record.revision}`);
  return versions.sort().join('\n');
}

/** §11.15 I-18: the refusal log — revisions, codes, subjects, known results, cap, key match, watermark. */
export function checkI18RefusalLog(world: InvariantWorld, prev?: InvariantWorld, step?: FuzzStep): InvariantViolation[] {
  const index = indexOf(world);
  const out: InvariantViolation[] = [];
  const eventsByRef = group(world.events.filter((event) => event.eventType === 'TaskReworkRefused'), (event) => event.subject);
  for (const refusal of world.refusals) {
    const at = refusal.ref;
    const operation = at.operation;
    const revisions = (eventsByRef.get(refKey(at)) ?? []).sort((left, right) => left.seq - right.seq).map((event) => event.revision);
    if (!sameJson(revisions, Array.from({ length: refusal.revision }, (_, position) => position + 1))) {
      out.push(finding('I-18', at, `refusal @${refusal.revision} has TaskReworkRefused revisions [${revisions.join(', ')}]`));
    }
    if ((REQUEUE_ONLY_CODES.includes(refusal.code) && operation !== 'requeue') || (REVERIFY_ONLY_CODES.includes(refusal.code) && operation !== 'reverify')) {
      out.push(finding('I-18', at, `code ${refusal.code} does not belong to operation ${operation} (ND-8)`));
    }
    if (operation === 'requeue' && at.subjectId !== refusal.afterRunRef.runId) out.push(finding('I-18', at, 'a requeue refusal is keyed by its afterRun'));
    if (operation === 'reverify') {
      const round = refusal.subjectRoundRef === null ? undefined : index.round(refusal.subjectRoundRef);
      if (refusal.subjectRoundRef === null || refusal.subjectRoundRef.roundId !== at.subjectId) out.push(finding('I-18', at, 'a reverify refusal is keyed by its subject round'));
      if (round === undefined || !isFinalizedNonPass(round)) out.push(finding('I-18', at, 'the refused round is not a finalized non-PASS round'));
      else if (refusal.failureClass !== reverifyFailureClass(round)) out.push(finding('I-18', at, `failureClass ${refusal.failureClass} ≠ ${String(reverifyFailureClass(round))}`));
    }
    const run = index.run(refusal.afterRunRef);
    if (run === undefined || run.status !== 'ended' || !known(run.outcome)) out.push(finding('I-18', at, `the afterRun ${refusal.afterRunRef.runId} has no known end (hard limit 1)`));
    if (refusal.failureClass === 'interrupted') out.push(finding('I-18', at, 'an interrupted class is never refused by policy'));
    const cls = actorClassOf(refusal.requestedBy);
    if (refusal.code === 'auto_rework_cap_reached' && cls === 'human') out.push(finding('I-18', at, 'the cap refused a human'));
    if (operation === 'requeue' && refusal.code === 'no_new_basis') {
      const matched = refusal.matchedRequeueRef === null ? undefined : index.requeue(refusal.matchedRequeueRef);
      if (matched === undefined || matched.ref.taskId !== at.taskId || matched.ref.goalId !== at.goalId || matched.basis.digest !== refusal.basisDigest) {
        out.push(finding('I-18', at, 'a no_new_basis requeue refusal names no TaskRequeue of the same Task with the same key'));
      }
    }
    const ended = countEndedGoalRuns(index.runsOfGoal(at.goalId));
    if (refusal.goalEndedRunsAtRefusal > ended) out.push(finding('I-18', at, `watermark ${refusal.goalEndedRunsAtRefusal} exceeds the ${ended} ended Goal Runs`));
    const configurationDependent = operation === 'reverify' && CONFIGURATION_CODES.includes(refusal.code);
    if ((refusal.configurationRevision !== null) !== configurationDependent) {
      out.push(finding('I-18', at, `configurationRevision ${String(refusal.configurationRevision)} for ${operation} ${refusal.code} (LA-4)`));
    }
  }
  if (prev === undefined) return out;
  const now = new Map(world.refusals.map((refusal) => [refKey(refusal.ref), refusal]));
  for (const before of prev.refusals) {
    const after = now.get(refKey(before.ref));
    if (after === undefined) continue;
    if (after.revision < before.revision || after.goalEndedRunsAtRefusal < before.goalEndedRunsAtRefusal) {
      out.push(finding('I-18', before.ref, `refusal went from @${before.revision}/${before.goalEndedRunsAtRefusal} to @${after.revision}/${after.goalEndedRunsAtRefusal}`));
    }
    if (after.revision === before.revision && !sameJson(after, before)) out.push(finding('I-18', before.ref, `refusal @${before.revision} changed without a new revision`));
  }
  // A refusal record changes only through `task_rework_refused` (cross-step clause; known only when the step is named).
  if (step !== undefined && step.kind !== 'task_rework_refused') {
    for (const refusal of written(prev.refusals, world.refusals)) {
      out.push(finding('I-18', refusal.ref, `refusal @${refusal.revision} was written by a ${step.kind} step, not task_rework_refused`));
    }
  }
  if (step?.kind === 'task_rework_refused') {
    const before = indexOf(prev);
    for (const refusal of written(prev.refusals, world.refusals)) {
      const at = refusal.ref;
      if (at.operation === 'requeue') {
        const selected = before.taskState(at.goalId, at.taskId)?.selectedRunRef ?? null;
        if (!sameRef(selected, refusal.afterRunRef)) out.push(finding('I-18', at, `the refused afterRun ${refusal.afterRunRef.runId} was not the selected Run`));
        if (before.requeueOf({ ref: refusal.afterRunRef }) !== null) {
          out.push(finding('I-18', at, `the refused afterRun ${refusal.afterRunRef.runId} was already requeued`));
        }
      } else {
        const round = refusal.subjectRoundRef === null ? undefined : before.round(refusal.subjectRoundRef);
        const head = round === undefined ? null : subjectHead(before, round);
        if (round === undefined || head?.kind !== 'head' || !sameRef(head.head.ref, round.ref)) out.push(finding('I-18', at, 'the refused round was not its subject chain head'));
        if (round !== undefined && !isGateRound(round) && before.requeueOf({ ref: round.subjectRunRef }) !== null) {
          out.push(finding('I-18', at, `the subject Run ${round.subjectRunRef.runId} was already requeued`));
        }
      }
      if (index.goal(at.goalId)?.desiredState !== 'active') out.push(finding('I-18', at, `Goal ${at.goalId} is not active`));
    }
    if (nonRefusalVersions(prev) !== nonRefusalVersions(world)) {
      out.push(finding('I-18', world.projectId, 'the refusal step wrote a Run, Attempt, Lease, Session, round or TaskRequeue'));
    }
  }
  return out;
}

/** §11.16 I-19: an authorized Run binds a continuation brief exactly when it has a requeueRef, never on a W2 claim. */
export function checkI19ContinuationBriefBinding(world: InvariantWorld, prev?: InvariantWorld): InvariantViolation[] {
  const index = indexOf(world);
  const out: InvariantViolation[] = [];
  const manifests = new Map((world.manifests ?? []).map((manifest) => [runKey(manifest.runRef), manifest]));
  for (const run of world.runs) {
    const binding = run.inputBinding;
    if (binding === undefined) continue;
    const id = run.ref.runId;
    const digest = binding.continuationBriefDigest;
    if ((run.requeueRef !== undefined) !== (digest !== undefined)) {
      out.push(finding('I-19', run.ref, `Run ${id} ${run.requeueRef === undefined ? 'has no' : 'has a'} requeueRef and ${digest === undefined ? 'no' : 'a'} brief digest`));
    }
    if (run.consumedWait !== undefined && digest !== undefined) out.push(finding('I-19', run.ref, `continuation Run ${id} binds a brief`));
    const manifest = manifests.get(runKey(run.ref));
    if (manifest === undefined || digest === undefined) continue;
    const brief = manifest.continuationBrief;
    if (manifest.problem !== null || brief === null) {
      out.push(finding('I-19', run.ref, `the manifest of Run ${id} has no readable brief: ${manifest.problem ?? 'no continuationBrief'}`));
      continue;
    }
    if (continuationBriefDigest(brief) !== digest) out.push(finding('I-19', run.ref, `the manifest brief of Run ${id} does not match its bound digest`));
    if (!sameRef(brief.runRef, index.claimOf(run)?.runRef) || !sameRef(brief.requeueRef, run.requeueRef)) {
      out.push(finding('I-19', run.ref, `the brief of Run ${id} names another Run or requeue`));
    }
    const rendered = `\n\n${renderContinuationBriefZh(brief, digest)}`;
    if (!manifest.input.endsWith(rendered) || rendered.split('\n')[3] !== continuationBriefMarker(digest)) {
      out.push(finding('I-19', run.ref, `the manifest input of Run ${id} does not end with the rendered brief and its marker`));
    }
  }
  if (prev !== undefined) {
    for (const before of prev.runs) {
      const after = index.run(before.ref);
      if (before.inputBinding !== undefined && after !== undefined && !sameJson(after.inputBinding, before.inputBinding)) {
        out.push(finding('I-19', before.ref, `Run ${before.ref.runId} rewrote its inputBinding`));
      }
    }
  }
  return out;
}

/** §11.17 I-20: each subject's rounds form one linear chain with recomputable successor facts; one chain per gate. */
export function checkI20RoundChain(world: InvariantWorld, prev?: InvariantWorld, step?: FuzzStep): InvariantViolation[] {
  const index = indexOf(world);
  const out: InvariantViolation[] = [];
  const subjects = group(world.rounds, (round) => isGateRound(round) ? `gate\u0000${taskKey(round.ref.goalId, round.ref.taskId)}`
    : `work\u0000${workChainKey(round.ref.goalId, round.ref.taskId, round.ref.runId)}`);
  for (const rounds of subjects.values()) {
    const first = rounds[0]!;
    const label = `${isGateRound(first) ? 'gate' : 'work'} chain of ${first.ref.taskId}${isGateRound(first) ? '' : `/${first.ref.runId}`}`;
    const roots = rounds.filter((round) => roundOrdinalOf(round) === 1);
    if (roots.length > 1) {
      out.push(roots.every((root) => root.chain === undefined)
        ? legacy('I-20', first.ref, `the ${label} has ${roots.length} legacy roots (round_ambiguous, GAP-52)`)
        : finding('I-20', first.ref, `the ${label} has ${roots.length} roots (${roots.map((root) => root.ref.roundId).join(', ')})`));
      continue;
    }
    const byOrdinal = group(rounds, (round) => String(roundOrdinalOf(round)));
    const length = rounds.length;
    if (length > ROUND_CHAIN_MAX) out.push(finding('I-20', first.ref, `the ${label} has ${length} rounds, above ${ROUND_CHAIN_MAX}`));
    let broken = false;
    for (let ordinal = 1; ordinal <= length; ordinal += 1) {
      if ((byOrdinal.get(String(ordinal))?.length ?? 0) !== 1) {
        out.push(finding('I-20', first.ref, `the ${label} has ${byOrdinal.get(String(ordinal))?.length ?? 0} round(s) at ordinal ${ordinal}`));
        broken = true;
      }
    }
    if (broken) continue;
    const chain = Array.from({ length }, (_, position) => byOrdinal.get(String(position + 1))![0]!);
    for (const [position, round] of chain.entries()) {
      out.push(...chainLinkProblems(round, position === 0 ? null : chain[position - 1]!, position === length - 1, label));
    }
    const head = chain[length - 1]!;
    if (!isGateRound(head)) {
      const requeue = index.requeueOf({ ref: head.subjectRunRef });
      if (requeue !== null && !sameRef(requeue.afterRoundRef, head.ref)) {
        out.push(finding('I-20', head.ref, `the ${label} grew after TaskRequeue ${requeue.ref.afterRunId} covered it (VR-09)`));
      }
    }
  }
  if (step?.kind === 'round_reverified' && prev !== undefined) {
    const before = indexOf(prev);
    // Only the successor this step opened; a later write to it (check begun, result, finalize) is not VR-14.
    for (const round of world.rounds.filter((candidate) => before.round(candidate.ref) === undefined)) {
      const chain = round.chain;
      if (chain === undefined || chain.ordinal < 2 || chain.predecessorRoundRef === null) continue;
      const predecessor = before.round(chain.predecessorRoundRef);
      const head = predecessor === undefined ? null : subjectHead(before, predecessor);
      if (predecessor === undefined || head?.kind !== 'head' || !sameRef(head.head.ref, predecessor.ref) || !isFinalizedNonPass(predecessor)) {
        out.push(finding('I-20', round.ref, `the predecessor of round ${round.ref.roundId} was not a finalized non-PASS chain head`));
      }
      if (index.goal(round.ref.goalId)?.desiredState !== 'active') out.push(finding('I-20', round.ref, `Goal ${round.ref.goalId} is not active`));
      const plan = index.activePlan(round.ref.goalId);
      if ((plan === null ? undefined : taskOf(plan, round.ref.taskId))?.disposition !== 'active') {
        out.push(finding('I-20', round.ref, `subject Task ${round.ref.taskId} is not active`));
      }
      const reverify = chain.reverify;
      if (reverify !== null && actorClassOf(reverify.requestedBy) !== 'human' && reverify.exemption !== 'host_interruption'
        && chain.autoCount > step.automationPolicy.autoReworkLimit) {
        out.push(finding('I-20', round.ref, `autoCount ${chain.autoCount} exceeds the limit ${step.automationPolicy.autoReworkLimit} in effect`));
      }
    }
  }
  return out;
}

function chainLinkProblems(round: RoundSnapshot, predecessor: RoundSnapshot | null, isHead: boolean, label: string): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const at = round.ref;
  const id = round.ref.roundId;
  if (!isHead && round.status === 'open') out.push(finding('I-20', at, `round ${id} of the ${label} is open but not the head`));
  const chain = round.chain;
  if (chain === undefined) return out; // A legacy root is a slot-less ordinal 1.
  if (chain.autoCount > MAX_AUTO_REWORK_LIMIT) out.push(finding('I-20', at, `round ${id} has autoCount ${chain.autoCount}`));
  if (predecessor === null) {
    if (chain.predecessorRoundRef !== null || chain.predecessorRevision !== null || chain.reverify !== null
      || chain.supersededEvidenceIds.length > 0 || chain.basisDigests.length > 0 || chain.autoCount !== 0) {
      out.push(finding('I-20', at, `root round ${id} of the ${label} carries successor facts`));
    }
    return out;
  }
  if (!sameRef(chain.predecessorRoundRef, predecessor.ref) || chain.predecessorRevision !== predecessor.revision) {
    out.push(finding('I-20', at, `round ${id} does not name round ${predecessor.ref.roundId}@${predecessor.revision} as its predecessor`));
  }
  if (!isFinalizedNonPass(predecessor)) out.push(finding('I-20', at, `the predecessor ${predecessor.ref.roundId} of round ${id} is not finalized non-PASS`));
  if (!sameRef(round.subjectRunRef, predecessor.subjectRunRef)) out.push(finding('I-20', at, `round ${id} moved to another subject Run`));
  if (!sameJson(chain.supersededEvidenceIds, chainEvidenceIds(predecessor))) out.push(finding('I-20', at, `round ${id} does not supersede chainEvidenceIds of its predecessor`));
  const reverify = chain.reverify;
  if (reverify === null) {
    out.push(finding('I-20', at, `successor round ${id} has no reverify facts`));
    return out;
  }
  const previousDigests = predecessor.chain?.basisDigests ?? [];
  if (!sameJson(chain.basisDigests, [...previousDigests, reverify.basis.digest])) out.push(finding('I-20', at, `round ${id} basisDigests is not its predecessor's plus its own key`));
  if (reverify.exemption === 'none' && previousDigests.includes(reverify.basis.digest)) out.push(finding('I-20', at, `round ${id} repeats an earlier key without an exemption (§13.7)`));
  const cls = actorClassOf(reverify.requestedBy);
  const exemption = reverifyExemption(predecessor);
  if (reverify.failureClass !== reverifyFailureClass(predecessor) || reverify.exemption !== exemption || reverify.actorClass !== cls
    || reverify.sourceChanged !== (reverify.basis.source.sourceDigest !== predecessor.identity.sourceDigest)) {
    out.push(finding('I-20', at, `the reverify facts of round ${id} differ from the recomputed class/exemption/actor/source`));
  }
  // The count as §11.17 writes it (not the writer's helper): human → 0, host_interruption → unchanged, else +1.
  const previousCount = predecessor.chain?.autoCount ?? 0;
  const expectedCount = cls === 'human' ? 0 : reverify.exemption === 'host_interruption' ? previousCount : previousCount + 1;
  if (chain.autoCount !== expectedCount) {
    out.push(finding('I-20', at, `round ${id} autoCount ${chain.autoCount} is not the recomputed count ${expectedCount}`));
  }
  return out;
}

/** The event-log entries that admit or write on a Task (I-21's step-local clause). */
const TASK_ADMISSION_EVENTS: ReadonlySet<InvariantEventType> = new Set<InvariantEventType>([
  'TaskClaimed', 'ExecutionEntryAuthorized', 'VerificationRoundOpened', 'VerificationCheckBegun', 'VerificationRoundReverified',
  'TaskRequeued', 'TaskReworkRefused',
]);

type StepSubject = { goalId: string; taskId: string; what: string };

/**
 * The (goal, task) subjects a step wrote: first every admission event newer
 * than `prev`'s last event (a Workflow `start` authorizes, enters and ends a
 * Run in one step, so the records alone no longer show the authorization),
 * then, for hand-built worlds without those events, the records of the step's
 * kind that differ between `prev` and `world`. One subject per Task.
 */
function stepSubjects(kind: FuzzStepKind, prev: InvariantWorld, world: InvariantWorld): StepSubject[] {
  const lastSeq = prev.events.reduce((last, event) => Math.max(last, event.seq), Number.NEGATIVE_INFINITY);
  const subjects: StepSubject[] = [
    ...world.events.flatMap((event) => event.seq > lastSeq && TASK_ADMISSION_EVENTS.has(event.eventType) && event.taskId !== null
      ? [{ goalId: event.goalId, taskId: event.taskId, what: `${event.eventType} #${event.seq}` }] : []),
    ...recordStepSubjects(kind, prev, world),
  ];
  return subjects.filter((subject, position) => subjects.findIndex((seen) => seen.goalId === subject.goalId
    && seen.taskId === subject.taskId) === position);
}

/** The (goal, task) subjects a step of the given kind wrote, found by comparing `prev` and `world`'s records. */
function recordStepSubjects(kind: FuzzStepKind, prev: InvariantWorld, world: InvariantWorld): StepSubject[] {
  const subjects: StepSubject[] = [];
  switch (kind) {
    case 'task_claimed':
      for (const attempt of written(prev.attempts, world.attempts)) {
        if (attempt.revision === 1) subjects.push({ goalId: attempt.ref.goalId, taskId: attempt.ref.taskId, what: `claim ${attempt.ref.attemptId}` });
      }
      break;
    case 'entry_authorized': {
      const before = indexOf(prev);
      for (const run of world.runs) {
        const auth = run.executionAuthorization;
        const old = before.run(run.ref)?.executionAuthorization;
        if (isAuthorizationV2(auth) && auth.phase === 'authorized' && !sameJson(auth, old)) {
          subjects.push({ goalId: run.ref.goalId, taskId: run.task.taskId, what: `authorization of Run ${run.ref.runId}` });
        }
      }
      break;
    }
    case 'task_requeued':
      for (const requeue of written(prev.requeues, world.requeues)) subjects.push({ goalId: requeue.ref.goalId, taskId: requeue.ref.taskId, what: 'requeue' });
      break;
    case 'task_rework_refused':
      for (const refusal of written(prev.refusals, world.refusals)) subjects.push({ goalId: refusal.ref.goalId, taskId: refusal.ref.taskId, what: 'refusal' });
      break;
    case 'round_opened':
    case 'round_reverified':
      for (const round of written(prev.rounds, world.rounds)) {
        if ((roundOrdinalOf(round) === 1) === (kind === 'round_opened') && round.revision === 1) {
          subjects.push({ goalId: round.ref.goalId, taskId: round.ref.taskId, what: `round ${round.ref.roundId}` });
        }
      }
      break;
    case 'check_begun': {
      const before = new Map(prev.rounds.map((round) => [refKey(round.ref), round]));
      for (const round of world.rounds) {
        const old = before.get(refKey(round.ref));
        const begun = round.checks.filter((check) => check.invocationId !== null
          && old?.checks.find((candidate) => candidate.checkId === check.checkId)?.invocationId !== check.invocationId);
        for (const check of begun) subjects.push({ goalId: round.ref.goalId, taskId: round.ref.taskId, what: `check ${check.checkId}` });
      }
      break;
    }
    case 'goal_completed':
    case 'plan_adopted':
    case 'other':
      break;
    default: return unreachable(kind, 'step kind');
  }
  return subjects;
}

const ACTIVE_ONLY_STEPS: ReadonlySet<FuzzStepKind> = new Set<FuzzStepKind>([
  'task_claimed', 'entry_authorized', 'task_requeued', 'task_rework_refused', 'round_opened', 'check_begun', 'round_reverified',
]);

/** §11.18 I-21: a non-active Task of an active Plan has no unresolved Run and no held Lease; admissions only on active Tasks. */
export function checkI21NonActiveTaskQuiescent(world: InvariantWorld, prev?: InvariantWorld, step?: FuzzStep): InvariantViolation[] {
  const index = indexOf(world);
  const out: InvariantViolation[] = [];
  for (const goal of world.goals) {
    const plan = index.activePlan(goal.ref.goalId);
    if (plan === null) continue;
    for (const task of plan.tasks) {
      if (task.disposition === 'active') continue;
      const at = { projectId: goal.ref.projectId, goalId: goal.ref.goalId, taskId: task.taskId };
      for (const run of index.runsOfTask(goal.ref.goalId, task.taskId)) {
        if (unresolved(run)) out.push(finding('I-21', at, `${task.disposition} Task ${task.taskId} has unresolved Run ${run.ref.runId}`));
      }
      const lease = index.lease(goal.ref.goalId, task.taskId);
      if (lease !== null && lease.release === undefined) out.push(finding('I-21', at, `${task.disposition} Task ${task.taskId} still holds its Lease`));
    }
  }
  if (step !== undefined && prev !== undefined && ACTIVE_ONLY_STEPS.has(step.kind)) {
    for (const subject of stepSubjects(step.kind, prev, world)) {
      const plan = index.activePlan(subject.goalId);
      const disposition = plan === null ? undefined : taskOf(plan, subject.taskId)?.disposition;
      if (disposition !== 'active') {
        out.push(finding('I-21', { projectId: world.projectId, goalId: subject.goalId, taskId: subject.taskId },
          `${step.kind} (${subject.what}) committed on Task ${subject.taskId}, which is ${disposition ?? 'not in the active Plan'}`));
      }
    }
  }
  return out;
}

/**
 * §11.19 I-22: once a Task has a Run, the active Plan keeps the effective
 * basis and execution definition of each Run's claim Plan. Exactly the two
 * §11.19 cases are `legacy`: the claim Plan's basis for the Task cannot be
 * resolved, or the Goal has a later v2 adoption without `taskStateBasis`
 * (before W1). A claim Plan missing from the window (PlanRevisions are never
 * deleted) and an active basis that no longer resolves are violations.
 */
export function checkI22TracedBasisFrozen(world: InvariantWorld): InvariantViolation[] {
  const index = indexOf(world);
  const out: InvariantViolation[] = [];
  for (const goal of world.goals) {
    const active = index.activePlan(goal.ref.goalId);
    if (active === null) continue;
    const plans = world.plans.filter((plan) => plan.goalRef.goalId === goal.ref.goalId);
    const first = Math.min(...plans.map((plan) => plan.planRevision));
    const beforeW1 = plans.some((plan) => plan.schemaVersion === 2 && plan.planRevision > first && plan.taskStateBasis === undefined);
    const activeFacts = planTaskFacts(active);
    for (const run of index.runsOfGoal(goal.ref.goalId)) {
      const taskId = run.task.taskId;
      const claimPlan = index.plan(run.planRef);
      if (claimPlan === undefined) {
        out.push(finding('I-22', run.ref, `the claim Plan ${run.planRef.planId} of Run ${run.ref.runId} is not in the window`));
        continue;
      }
      const claimFacts = planTaskFacts(claimPlan);
      const activeBasis = activeFacts.basis.get(taskId);
      const claimBasis = claimFacts.basis.get(taskId);
      const activeDefinition = activeFacts.definitions.get(taskId);
      const claimDefinition = claimFacts.definitions.get(taskId);
      if (activeBasis === undefined || activeDefinition === undefined) {
        out.push(finding('I-22', run.ref, `the active Plan no longer carries Task ${taskId} of Run ${run.ref.runId}`));
        continue;
      }
      if (claimBasis === undefined || claimDefinition === undefined || isBasisUnsupported(claimBasis)) {
        out.push(legacy('I-22', run.ref, `the claim Plan basis of Task ${taskId} is not resolvable for Run ${run.ref.runId}`));
        continue;
      }
      const problem = isBasisUnsupported(activeBasis)
        ? `the basis of Task ${taskId} moved from ${claimBasis.planId} to an unresolvable basis (${activeBasis.reason})`
        : !sameRef(activeBasis, claimBasis) ? `the basis of Task ${taskId} moved from ${claimBasis.planId} to ${activeBasis.planId}`
          : executionDefinitionsAgree({ left: activeDefinition, right: claimDefinition }) !== true
            ? `the execution definition of Task ${taskId} changed since Run ${run.ref.runId} was claimed` : null;
      if (problem !== null) out.push(beforeW1 ? legacy('I-22', run.ref, `${problem} (a v2 adoption without taskStateBasis)`) : finding('I-22', run.ref, problem));
    }
  }
  return out;
}

// ------------------------------------------------------------------------ //
// checkAllInvariants (§11.11)                                               //
// ------------------------------------------------------------------------ //

export type InvariantChecker = (world: InvariantWorld, prev?: InvariantWorld, step?: FuzzStep) => InvariantViolation[];

/** The §11 checker of each invariant, in I-1..I-22 order. */
export const INVARIANT_CHECKERS: Readonly<Record<InvariantId, InvariantChecker>> = Object.freeze({
  'I-1': checkI1RunningPairing,
  'I-2': checkI2ReleaseMatchesOutcome,
  'I-3': checkI3GoalCompletionBacked,
  'I-4': checkI4SingleWriterPerSession,
  'I-5': checkI5SingleQueuedPointerIntent,
  'I-6': checkI6EndingConsistency,
  'I-7': checkI7RoundConsistency,
  'I-8': checkI8MessageMonotone,
  'I-9': checkI9NoAdmissionAfterGoalStop,
  'I-10': checkI10RunNodeShape,
  'I-11': checkI11QueryRunSettlement,
  'I-12': checkI12RequeueFacts,
  'I-13': checkI13EvidenceIndex,
  'I-14': checkI14CompletedGoalIsActive,
  'I-15': checkI15Monotone,
  'I-16': checkI16PausedInterrupted,
  'I-17': checkI17HumanStopRespected,
  'I-18': checkI18RefusalLog,
  'I-19': checkI19ContinuationBriefBinding,
  'I-20': checkI20RoundChain,
  'I-21': checkI21NonActiveTaskQuiescent,
  'I-22': checkI22TracedBasisFrozen,
});

function allFindings(world: InvariantWorld, prev?: InvariantWorld, step?: FuzzStep): InvariantViolation[] {
  return [...Object.values(INVARIANT_CHECKERS).flatMap((checker) => checker(world, prev, step)),
    ...checkSlice1Invariants(world, prev)];
}

/**
 * Slice 1 §5.1 additions: an archived Session has no occupancy and no archive
 * request (S1-1, S1-2); a readonly copy has no open Work claim (S1-3); an
 * archived source is not claimed again (S1-6); one Run has at most one
 * immutable anomaly anchor (S1-4); writing an anchor never changes its Task's
 * phase and a retired Session cannot be reactivated (S1-5, the two cross-step
 * clauses, run only when `prev` is given). Anchors are read through the
 * decoded world (`SESSION_ANOMALY_RECORD_SCHEMAS` is registered by
 * `platformRecordSchemas`), never from raw rows.
 */
export function checkSlice1Invariants(world: InvariantWorld, prev?: InvariantWorld): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const sessionKey = (ref: { projectId: string; sessionId: string }): string => `${ref.projectId}\u0000${ref.sessionId}`;
  const archived = new Set(world.sessions.filter((session) => session.lifecycle === 'archived').map((session) => sessionKey(session.ref)));
  const copies = new Set(world.sessions
    .filter((session) => session.provenance?.kind === 'readonly_copy').map((session) => sessionKey(session.ref)));
  for (const session of world.sessions) {
    if (session.lifecycle !== 'archived') continue;
    if (session.occupancy !== null) {
      out.push(finding('S1-1', session.ref, `archived Session ${session.ref.sessionId} still has an occupancy`));
    }
    if ((session.archiveRequest ?? null) !== null) {
      out.push(finding('S1-2', session.ref, `archived Session ${session.ref.sessionId} still carries an archive request`));
    }
  }
  for (const outbox of world.outboxes) {
    if (outbox.status === 'settled') continue;
    const key = sessionKey(outbox.claim.sessionRef);
    if (copies.has(key)) {
      out.push(finding('S1-3', outbox.ref, `readonly copy Session ${outbox.claim.sessionRef.sessionId} holds an open Work claim`));
    }
    if (archived.has(key)) {
      out.push(finding('S1-6', outbox.ref, `archived Session ${outbox.claim.sessionRef.sessionId} holds an open Work claim`));
    }
  }
  const byRun = group(world.anchors ?? [], (anchor) => refKey(anchor.runRef));
  for (const anchors of byRun.values()) {
    const first = anchors[0]!;
    if (anchors.length > 1) {
      out.push(finding('S1-4', first.ref, `Run ${first.runRef.runId} has ${anchors.length} anomaly anchors`));
    }
  }
  if (prev !== undefined) {
    // S1-5: an anchor is an immutable fact about an already stopped execution;
    // writing it never re-projects the Task's phase (§5.1, SV37).
    const beforeCommits = slice1CommitCounts.get(prev);
    const afterCommits = slice1CommitCounts.get(world);
    // Hand-built unit worlds describe one transition. Persisted worlds must
    // prove that exactly one commit separates them. Owner fixtures check each
    // commit, whereas a Host restart intentionally observes several commits.
    const anchorCommitOnly = beforeCommits === undefined && afterCommits === undefined
      || beforeCommits !== undefined && afterCommits === beforeCommits + 1;
    const phaseBefore = new Map(prev.taskStates.map((state) => [taskKey(state.goalId, state.taskId), state.phase]));
    for (const anchor of anchorCommitOnly ? written(prev.anchors ?? [], world.anchors ?? []) : []) {
      const key = taskKey(anchor.task.goalId, anchor.task.taskId);
      const before = phaseBefore.get(key);
      const after = world.taskStates.find((state) => taskKey(state.goalId, state.taskId) === key)?.phase;
      if (before !== undefined && before !== null && after !== undefined && after !== null && before !== after) {
        out.push(finding('S1-5', anchor.ref,
          `writing the anchor of Run ${anchor.runRef.runId} moved Task ${anchor.task.taskId} from ${before} to ${after}`));
      }
    }
    // S1-5: a retired Session cannot be reactivated. S1-SES-05 refuses an
    // archived unavailable Session with `unavailable` and leaves its lifecycle
    // alone; the retired_archive anchor is the other durable retired fact.
    const retired = new Set((world.anchors ?? [])
      .filter((anchor) => anchor.cause === 'retired_archive').map((anchor) => sessionKey(anchor.sessionRef)));
    const archivedBefore = new Set(prev.sessions
      .filter((session) => session.lifecycle === 'archived').map((session) => sessionKey(session.ref)));
    for (const session of world.sessions) {
      if (session.lifecycle !== 'active') continue;
      const key = sessionKey(session.ref);
      if (archivedBefore.has(key) && (session.health === 'unavailable' || retired.has(key))) {
        out.push(finding('S1-5', session.ref, `retired Session ${session.ref.sessionId} was reactivated`));
      }
    }
  }
  return out;
}

/** §11.11: I-1..I-22 over one world (cross-step clauses with `prev`, step-local ones with `step`); `legacy` findings dropped. */
export function checkAllInvariants(world: InvariantWorld, prev?: InvariantWorld, step?: FuzzStep): InvariantViolation[] {
  return allFindings(world, prev, step).filter((violation) => violation.legacy !== true);
}

/** The findings §11 reports as `legacy`; a store a test started empty has none. */
export function legacyFindings(world: InvariantWorld, prev?: InvariantWorld, step?: FuzzStep): InvariantViolation[] {
  return allFindings(world, prev, step).filter((violation) => violation.legacy === true);
}
