/**
 * K3 group 4 session B3, K3-35 (二)(三): ONE consistent public fact built by the
 * REAL path, never by hand.
 *
 * The approved record, the eight anomaly anchors, the continuation basis and
 * the prepared/started Runs all carry the record's own Task. Every Run of the
 * chain (the eight anchors, the record's own ninth Run and the continuation)
 * is claimed by the public claim owner and then goes through the real prepare
 * (production `createExecutionPreparation` with the production
 * `readTaskClosure`) and the real Runtime entry (`runtime.port.startRun` →
 * authorize / begin / `recordExecutionEntered` with the Kernel facts of the
 * real Turn).
 *
 * The anchors are real in-flight Runs: the scripted model's `shell` call is
 * held by the §5.1 stand-in (`K3-tool-seams.ts`), the archive is registered
 * while the Run is in flight, the handler is released and the model's next
 * `beforeReply` throws, so the production Runtime itself turns the fault into
 * `run_crashed` and books the real Kernel end (`terminalEventOf` +
 * `recordRunResult`). The test never builds an event or calls `recordRunResult`.
 * The Session is then archived through the public `archiveLine` path, and the
 * changed-file read is the production reader with its Execution read made to
 * fail once (`S1-public-anchor.ts`), so the platform itself writes
 * `source: 'unknown', status: 'unavailable'` with the L20 worst-case reason.
 *
 * The record's own Run is the ninth Run. The Kernel executes a non-read-only
 * tool batch one call at a time, so the blocked `shell` call is the only call
 * that really started: the production draft and the RUN-20/RUN-22 record carry
 * exactly that one process item, never 31 appended starts. The continuation Run
 * is claimed from the public requeue owner, prepared by the production Runtime
 * (its real manifest input is `preparedInput`) and started with a plain text
 * scripted model.
 *
 * Real-path consequence: each anchor is bound by the NEXT Run's prepared
 * `inputBinding.anomalyAnchorRefs`, so all eight are picked up and the
 * continuation's brief has NO anomaly section. That is the fact the byte totals
 * measure; the renderer's anomaly extremes stay in the pure-renderer test.
 *
 * THE harness: `openRealRunHarness(world, options)` below is the ONE reusable
 * real-Run path (public claim → real prepare → `runtime.port.startRun` with the
 * real tools/seams → Runtime-recorded end → public requeue). Other K3 helpers
 * must use it instead of building their own prior state; its inputs are
 * injected dependencies only (clock/id generators and blocking seams), never a
 * Kernel identity, position, cursor, review/observed item or `closed` value.
 *
 * Recognition runs through the platform's real Host assembly: `reconcileUnknown`
 * (RUN-20 alone), `reconcileUnknownTwice` (RUN-25 then the same request again),
 * `createRecord` (RUN-20 then RUN-22) and `replayRecord` (RUN-20 then the same
 * RUN-22 twice) lazily open `createTargetPlatform` over the SAME store as the
 * world (the SQLite directory's ledger/body store and Kernel store, or the
 * world's ONE in-memory records AND artifact-body backend). `reconcileUnknown`
 * calls the Host's `reconcile.reconcileRun` (the start-up assembly; an optional
 * takeover proof is the Host input RUN-25 needs) and `createRecord` then calls
 * the public `resolveUnknownRun` (RUN-22); both read the draft with the real
 * `lookupToolCommit` and `captureWorkspace`. The fixture never opens a second
 * union backend or builds a draft/result.
 */
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vi } from 'vitest';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import * as bodyStore from '../../src/core/record-store/body-store.js';
import * as inMemoryRecordStore from '../../src/core/record-store/in-memory-record-store.js';
import type { HostTakeoverProofV1, UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { ContinuationUnknownCallReviewV1 } from '../../src/contracts/continuation-brief.js';
import type { RoleBindingRefV1, RunRef, RunSnapshot, TaskTriple } from '../../src/contracts/dispatch.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { SessionAnomalyAnchorV1 } from '../../src/contracts/session-anomaly.js';
import type { TaskRequeueSnapshotV1 } from '../../src/contracts/task-requeue.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { PreparedTaskExecution } from '../../src/contracts/core/prepared-execution.js';
import type { SessionMailboxPort } from '../../src/core/work-graph/model/communication-contracts.js';
import { assembleUnknownCallReviewSection } from '../../src/core/agent-runtime/continuation-brief-assembly.js';
import { createKernelStoreRegistry, type KernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionHistoryCursorOwner, type SessionMappingProbe } from '../../src/core/agent-runtime/session-operations.js';
import type { ResolvedRuntimeConfiguration } from '../../src/core/agent-runtime/execution-contracts.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { loadPreparedManifest } from '../../src/core/agent-runtime/execution-preparation.js';
import type { RunReconcileReport } from '../../src/core/agent-runtime/run-reconcile.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createSessionAnomalyService } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { taskRequeueRefKey } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import { createSessionArchiveService } from '../../src/business/workflow/session-archive.js';
import { DEFAULT_SESSION_ARCHIVE_POLICY } from '../../src/business/workflow/ports.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import { createCommandRecognizer } from '../../src/core/work-graph/tasks/command-recognition.js';
import type { WorkspaceFileReader } from '../../src/core/work-graph/model/kernel-command-read-contracts.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { openRealWorkspace, type RealWorkspace } from './K3-real-workspace.js';
import { GOAL_B, PLAN_B2 } from './S5-decision-fixture.js';
import {
  drivePublicArchive, failingChangedFilesReader, registerPublicArchive, WORST_ANOMALY_REASON,
  type PublicArchiveRequest,
} from './S1-public-anchor.js';
import { createScriptedModel, type ScriptedModel } from './B2-runtime-fixture.js';
import { mailboxToolSeam, shellSeam } from './K3-tool-seams.js';
import { createK3_35Runtime, k3_35Configuration, K3_35_HOST_REVISION, type K3_35RuntimeOptions } from './K3-35-runtime.js';
import { initGitWorkspace } from '../scenarios/support/git-workspace.js';
import { prepareContinuation } from './K3-35-prepare.js';
import {
  adoptK3PlanTask, answerK3Disposition, claimK3ReviewRound, endK3RunCompleted, k3TaskIdOfBytes,
  openK3ReviewCardWorld, readK3Review, runK3ReviewRound, settleK3Review, writeK3Proposal,
  type K3ReviewCardWorld,
} from './K3-proposal-round.js';

import { APPROVED_COMMAND, at, P, W } from './K3-continuation-pure-fixture.js';

// The pure construction, the fixed brief literals and `requiredReviewBlock`
// now live in `K3-continuation-pure-fixture.ts` (F-014). Re-export them here so
// this heavy helper's non-pure consumers keep their imports unchanged.
export { APPROVED_COMMAND };
export {
  approvedMethodBlockBytes, K3_35_REQUIRED_REVIEW_BLOCK_ONE,
} from './K3-continuation-pure-fixture.js';

export const WORST_REASON = WORST_ANOMALY_REASON;

// ------------------------------------------------------------------------ //
// The public-owner review record plus eight real archived anchors.          //
// ------------------------------------------------------------------------ //
/** The real answer text; the renderer clips it to 60 UTF-16 units + `…（已截断）`. */
const SAFER_NOTE = '稳'.repeat(2_000);

/** 512 UTF-8 bytes (the L7/L8 callId ceiling): 170 three-byte characters plus two ASCII digits. */
function longCallId(alias: number): string {
  return `${'调'.repeat(170)}${String(alias).padStart(2, '0')}`;
}

/**
 * An EMPTY mailbox port double for the record Run's platform calls. The
 * injected `send_user_message` calls are served by §5.1's `mailboxToolSeam`
 * (the test file replaces `createSessionMailboxTools` with `vi.mock`), so these
 * dependency objects only have to answer the Runtime's selection checks; no
 * message is fabricated and no send happens while the calls stay unresolved.
 */
function emptyMailbox(): SessionMailboxPort {
  const page = async () => ({ status: 'ready' as const,
    value: { items: [], nextCursor: null, sourceCursor: 'c0000000000' as never } });
  return {
    readInbox: page, readOutbox: page, readRoutedReplies: page,
    async readMessage() { return { status: 'rejected', code: 'not_found', reason: 'the K3-35 record Run reads no message' }; },
    async readMessageBody() { return { status: 'rejected', code: 'not_found', reason: 'the K3-35 record Run reads no body' }; },
    async sendMessage() { throw new Error('the §5.1 mailbox seam never sends'); },
    async ackMessage() { throw new Error('the §5.1 mailbox seam never acks'); },
    async respondMessage() { throw new Error('the §5.1 mailbox seam never responds'); },
  } as unknown as SessionMailboxPort;
}

export const K3_35_TASK_ID = 'k3-20-a';
const K3_35_ANCHORS = 8;

type K3_35PublicOptions = {
  /**
   * When set, the K3 review world first adopts a REAL Plan revision on Goal B
   * with one Task whose id is `'t'.repeat(taskIdBytes)` (512 / 600), and the
   * record, its anchors and the continuation basis all use that Task. Default:
   * the K3 review world's own `k3-20-a` (`K3_35_TASK_ID`).
   */
  taskIdBytes?: number;
};

export type K3_35PublicRecord = {
  world: K3ReviewCardWorld;
  /** The record's Task: anchors, basis and prepared Run all use it. */
  task: TaskTriple;
  /** The resolved record after the public `approve` answer (one blocked command). */
  review: UnknownCallReviewV1;
  section: ContinuationUnknownCallReviewV1;
  /** The record's own Run (the ninth Run), read from the public execution store. */
  original: TaskExecutionRecord;
  /** The eight real anchors, read back from the public anomaly store. */
  anchors: SessionAnomalyAnchorV1[];
  /** The continuation claim produced by the public requeue/claim path. */
  continuation: TaskClaim;
  /** The production prepared value of the continuation Run (its manifest input is `preparedInput`). */
  prepared: PreparedTaskExecution;
  preparedInput: string;
  /** The S5 records port (the one store every owner of this fixture writes through). */
  records: import('../../src/core/record-store/ports.js').GoalRecordTransactionPort & RecordLookupPort;
  processCallId: string;
  platformCallIds: string[];
  /** Read an ended Run's boundary back against its real Kernel history entry. */
  endBoundaryOf(ref: RunRef): Promise<{
    endPosition: number | null; position: number; cursor: string;
    sessionCursor: string | null; entryPosition: number | null; entryCursor: string | null;
  }>;
  close(): Promise<void>;
};

/** A §5.1 blocking seam the harness may be handed instead of the module singleton. */
type K3_35BlockingSeam = {
  readonly name?: string;
  readonly enabled: boolean;
  readonly calls: ReadonlyArray<{ callId: string; arguments: unknown }>;
  arm(): void; release(): void; waitForCall(): Promise<void>;
};

/**
 * Injected dependencies of the real-Run harness: the clock, the fact-id and
 * Run-id generators, and the two §5.1 blocking seams. None of these is a Kernel
 * identity, position, cursor, review item, observed item or `closed` value; the
 * harness reads every such fact from the platform itself.
 */
type K3_35RealRunHarnessOptions = {
  now?: () => string;
  eventId?: () => string;
  finalizeCompletedBeforeRequeue?: boolean;
  /** The claim owner's Run-id generator. */
  newId?: () => string;
  shellSeam?: K3_35BlockingSeam;
  mailboxToolSeam?: K3_35BlockingSeam;
  /**
   * RUN-25 needs a REAL run-start baseline and a real workspace capture: the
   * world's temp directory is the git work tree top level (`git init` + one
   * commit), exactly the K3 §5.1 "git workspace". It is test environment setup,
   * not a platform fact; every capture below is still the production reader's.
   */
  gitWorkspace?: boolean;
  /**
   * The Host's own takeover proof (RUN-25). It is a Host INPUT: the platform's
   * Host instance is opened with it (the run machine compares the Host's proof
   * with the classifier candidate's), and `reconcileUnknown` hands the same
   * value to `reconcile.reconcileRun`. Never a record or a classification.
   */
  takeover?: HostTakeoverProofV1;
};

/** The takeover proof a Host input carries for RUN-25 (a fault-injection input, never a record). */
type K3_35TakeoverOptions = { takeover?: HostTakeoverProofV1 };

/**
 * THE reusable real-Run harness of this fixture. It is the ONE path the K3
 * helpers use: a public claim → the production `prepareExecution` →
 * `runtime.port.startRun` with a scripted model whose calls go through the real
 * tools/seams and are recorded by the Kernel → a real end/stop/crash with the
 * Runtime-recorded position and cursor → a public requeue → the next claim.
 */
export type K3_35RealRunHarness = {
  world: K3ReviewCardWorld;
  records: import('../../src/core/record-store/ports.js').GoalRecordTransactionPort & RecordLookupPort;
  /** The registry over the S5 fixture's real Kernel store (the same path the Runtime uses). */
  kernelStores: KernelStoreRegistry;
  closeUnion(): Promise<void>;
  claimRun(input: { sessionRef: { projectId: string; sessionId: string }; planRef: PlanRevisionRef;
    taskId: string; requeueRef?: TaskRequeueSnapshotV1['ref']; requestId: string;
    /** The Goal the Run is claimed under; defaults to the K3-35 world's `GOAL_B`. */
    goalRef?: GoalRef }): Promise<TaskClaim>;
  /**
   * The REAL entry of every K3-35 Run: production `prepareExecution` then
   * production `startRun`. With `blockOnShell` the scripted model's `shell`
   * call is held by the §5.1 stand-in until the caller releases it, so the Run
   * is genuinely in flight when it is interrupted.
   */
  prepareAndStart(claim: TaskClaim, options: { model: ScriptedModel; tools: readonly string[];
    writeScope: readonly string[]; blockOnShell: boolean; blockOnPlatform?: boolean;
    /**
     * RUN-25 needs the production `workspaceHost` baseline: prepare through the
     * Runtime's own `port.prepareExecution` (same production preparation owner,
     * with the Host workspace binding) instead of the continuation helper, which
     * wires no baseline. Defaults to the continuation prepare so every existing
     * K3-35 row keeps its exact prepared input.
     */
    prepareViaRuntime?: boolean }):
    Promise<{ prepared: PreparedTaskExecution; input: string; started: Promise<ReadResult<TaskExecutionRecord>> }>;
  /**
   * RUN-20 only, through the platform's real Host assembly: read the Run and
   * its REAL probe through the public `executions`, call
   * `reconcile.reconcileRun` (the start-up assembly, which books
   * `tool_calls_unresolved` for the blocked call), then read the ended
   * `outcome_unknown` Run snapshot back with its real revision. It never calls
   * `resolveUnknownRun` and takes no draft, item or event. `options.probe`
   * replaces only the explicit probe (a fault-injection caller).
   * `options.takeover` is the Host's takeover proof handed to
   * `reconcile.reconcileRun({record, hostInstanceId, takeover, probe})`; with it
   * the real classifier builds `takeover_unresolved` and the real RUN-25 owner
   * writes the review record in the same commit (fault-injection input, not a
   * record).
   */
  reconcileUnknown(claim: TaskClaim, options?: { probe?: SessionMappingProbe } & K3_35TakeoverOptions):
    Promise<RunSnapshot>;
  /**
   * The REAL RUN-25 path plus the same Host reconcile retried with the SAME
   * pre-commit execution read: the request identity (`a2-reconcile:<host>:<run>:<revision>`)
   * and content are unchanged, so the second call answers the owner's recorded
   * receipt and commits nothing. A new read after the first commit would have a
   * new revision and therefore a new request id; this is the retry the Host
   * makes with the record it already holds.
   */
  reconcileUnknownTwice(claim: TaskClaim, options?: { probe?: SessionMappingProbe } & K3_35TakeoverOptions):
    Promise<{ report: RunReconcileReport; replayReport: RunReconcileReport; run: RunSnapshot }>;
  /**
   * The platform's real recognition path: RUN-20 through `reconcileUnknown`,
   * then RUN-22 through the Host assembly's public `resolveUnknownRun`, which
   * reads the draft itself with the real `lookupToolCommit` and
   * `captureWorkspace`. It takes no draft and no items. Both backends are
   * supported: a SQLite world shares the fixture directory's ledger/body store;
   * a memory world shares its ONE in-memory records/body backend with the
   * platform. The optional `probe` is the explicit Session-mapping probe for
   * RUN-20 when a caller injects a fault; the later public RUN-22 still probes
   * the real Kernel. `requestId` names the RUN-22 receipt explicitly.
   */
  createRecord(claim: TaskClaim, options?: { probe?: SessionMappingProbe; requestId?: string }):
    Promise<UnknownCallReviewV1>;
  /**
   * The same real recognition path, with the public RUN-22 called a SECOND time
   * under the SAME request identity and input: the owner answers its recorded
   * receipt (`replayed: true`) before it compares pins or state, which the first
   * attestation already moved. One RUN-20, no second recognition path.
   */
  replayRecord(claim: TaskClaim, options?: { probe?: SessionMappingProbe; requestId?: string }):
    Promise<{ record: UnknownCallReviewV1; first: WriteResult<RunSnapshot>; replay: WriteResult<RunSnapshot> }>;
  /**
   * Read an ended Run's booked boundary back against the REAL Kernel history
   * entry: the Run's `history.endPosition`, the Session's canonical cursor and
   * the entry at that position (its own cursor and identity).
   */
  endBoundaryOf(ref: RunRef): Promise<{
    endPosition: number | null; position: number; cursor: string;
    sessionCursor: string | null; entryPosition: number | null; entryCursor: string | null;
  }>;
  requeue(claim: TaskClaim, note: string): Promise<TaskRequeueSnapshotV1>;
  registerArchive(sessionRef: { projectId: string; sessionId: string }, requestId: string, reason: string): Promise<number>;
  driveArchive(sessionRef: { projectId: string; sessionId: string }, requestId: string, reason: string, sessionRevision: number):
    Promise<{ anchorsBefore: number }>;
  anchorOfRun(runId: string): Promise<SessionAnomalyAnchorV1>;
  anchorList(): Promise<SessionAnomalyAnchorV1[]>;
  anchorCount(): Promise<number>;
  now: () => string;
  eventId: () => string;
  newId: () => string;
  setMinute(minute: number): void;
};

/** The S5 trusted role binding/budget the review rounds also use. */
const ROLE_BINDING: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 's5-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const BUDGET = { tokenBudget: 100_000, deadline: null };
/**
 * One real continuation Run, entered by the production Runtime: the prepared
 * value comes from `runtime.port.prepareExecution`; the Kernel run/turn
 * identity and the entry positions are the real turn's, never hand-filled.
 */
export async function openRealRunHarness(
  world: K3ReviewCardWorld, options: K3_35RealRunHarnessOptions = {},
): Promise<K3_35RealRunHarness> {
  const directory = world.fixture.base.directory;
  // RUN-25's real capture compares the work tree with the run-start baseline,
  // so the world's own temp root must be the git work-tree top level. This is
  // environment setup (the K3 §5.1 "git workspace"), not a platform fact.
  if (options.gitWorkspace === true) {
    await initGitWorkspace(directory);
    // The fixture's SQLite ledger/body/Kernel stores live in the work-tree root.
    // They are not workspace content, and every commit changes them; a real
    // store is outside the tree. Ignore them (like the scenario's denied file)
    // so the run-start baseline and the RUN-25 capture compare the same files.
    await appendFile(join(directory, '.git', 'info', 'exclude'),
      '*.sqlite\n*.sqlite-journal\n*.sqlite-wal\n*.sqlite-shm\n');
  }
  // L19a/F-032: the Runtime's shell hook shares the ONE production recognizer
  // with the CRR owner (`createCommandRecognizer`). Its `package.json` script
  // expansions read the SAME real root the Host resolves, through the
  // production workspace reader (`openRealWorkspace`: A8's test-created root
  // and authorization), not a built `WorkspaceFile`. The reader is opened
  // lazily — only a command that actually names a script pays for it.
  let recognizerWorkspace: Promise<RealWorkspace> | undefined;
  const realWorkspaceReader: WorkspaceFileReader = {
    async readWorkspace(ctx, input) {
      recognizerWorkspace ??= openRealWorkspace({
        root: directory, workspace: { aggregateType: 'Workspace', ...world.fixture.base.scope } });
      return (await recognizerWorkspace).readWorkspace(ctx, input);
    },
  };
  const commandRecognizer = createCommandRecognizer({ readWorkspace: realWorkspaceReader });
  // S5 registers the slice-1 archive/anomaly schemas on the world's own store, so
  // every owner of the harness uses that SAME records instance (no second backend).
  const records = world.records;
  // The S5 fixture created the Sessions' Kernel stores at this path; the
  // production Runtime and the platform Host read the same store for the real
  // Turn facts (ONE entry, no second identity).
  const kernelEntry = { adapterId: 's5-kernel', storeKey: 's5-kernel-store',
    workspace: { projectId: P, workspaceId: W }, databasePath: join(directory, 's5-kernel.sqlite') };
  const kernelStores = await createKernelStoreRegistry({ entries: [kernelEntry] });
  const reads = createRunStateReader({ records });
  const facts = createSessionFactsService({ records });
  const lifecycle = createSessionLifecycleService({ records, lookups: records, sessionFacts: facts });
  let minute = 8;
  const now = options.now ?? ((): string => at(minute));
  let seq = 0;
  const eventId = options.eventId ?? ((): string => `k3-35-event-${String(++seq)}`);
  const roles = createRoleConfigurationService({ records, now, eventId });
  let runSeq = 0;
  const newId = options.newId ?? ((): string => `00000000-0000-4000-8000-${String(++runSeq).padStart(12, '0')}`);
  const runId = newId;
  const shell = options.shellSeam ?? shellSeam;
  const mailbox = options.mailboxToolSeam ?? mailboxToolSeam;
  const claims = createTaskClaimService({ records, roles, now, newId: runId });
  const anomalies = createSessionAnomalyService({ records, lookups: records, sessionFacts: facts, now });
  const materials = createMaterialService({ bodies: world.fixture.bodies,
    authority: createMaterialRecordReaders(records).authority, now });
  // The requeue source digest is the REAL source capture of the same root the
  // production `workspaceHost.resolveRoot` names (`captureDigest` over the
  // whole workspace), never a hashed counter.
  const workspaceHost = { async resolveRoot() {
    return { status: 'ready' as const, value: { root: directory, workspaceRevision: 1 } };
  } };
  const sourceReader = new VerificationWorkspaceReader();
  const requeues = createTaskRequeueService({ records, reads, materials, workspaceHost,
    source: { captureDigest: (root: string) => sourceReader.captureDigest(root) },
    messages: { async readMessage() { return { status: 'not_found' as const }; } },
    now, eventId });
  const archiveService = createSessionArchiveService({
    sessionLifecycle: lifecycle, sessionFacts: facts, sessionAnomalies: anomalies,
    archivePolicy: DEFAULT_SESSION_ARCHIVE_POLICY, now,
    sessions: world.fixture.b2.base.sessionsPort, plans: world.fixture.b2.base.plans, executions: reads,
    claims: requeues as never,
    runtime: { readArchiveChangedFiles: (ctx: never, input: never) =>
      failingChangedFilesReader(WORST_ANOMALY_REASON).readArchiveChangedFiles(ctx, input) } as never,
  });

  const sessionPin = async (sessionRef: { projectId: string; sessionId: string }) => {
    const card = await world.fixture.b2.base.sessionsPort.readSession(world.fixture.ctx, sessionRef);
    if (card.status !== 'ready') throw new Error(`the Session is not readable: ${JSON.stringify(card)}`);
    return { ref: { aggregateType: 'Session' as const, ...sessionRef }, revision: card.value.record.revision };
  };
  const goalRevision = async (goalRef: GoalRef = GOAL_B): Promise<number> => {
    const goal = await world.fixture.b2.base.plans.queryGoal(world.fixture.ctx, goalRef);
    if (goal.status !== 'ready') throw new Error(`the Goal is not readable: ${JSON.stringify(goal)}`);
    return goal.value.goal.revision;
  };
  const workspaceRevision = async (): Promise<number> => {
    const read = await records.readMany([JSON.stringify({ aggregateType: 'Workspace', projectId: P, workspaceId: W })]);
    if (read.status !== 'ready') throw new Error(`the Workspace is not readable: ${JSON.stringify(read)}`);
    const record = read.value.records[0];
    if (record === undefined) throw new Error('the Workspace snapshot is missing');
    return (JSON.parse(record.json) as { revision: number }).revision;
  };

  async function claimRun(input: { sessionRef: { projectId: string; sessionId: string }; planRef: PlanRevisionRef;
    taskId: string; requeueRef?: TaskRequeueSnapshotV1['ref']; requestId: string;
    /** The Goal the Run is claimed under; defaults to the K3-35 world's `GOAL_B`. */
    goalRef?: GoalRef }): Promise<TaskClaim> {
    const goalRef = input.goalRef ?? GOAL_B;
    const claimed = await claims.claimTask(world.fixture.ctx, { input: {
      goalRef, planRef: input.planRef, taskId: input.taskId, sessionRef: input.sessionRef,
      roleBinding: ROLE_BINDING, budget: BUDGET,
      ...(input.requeueRef === undefined ? {} : { requeueRef: input.requeueRef }),
    }, meta: { requestId: input.requestId, expected: [{ ref: goalRef, revision: await goalRevision(goalRef) },
      { ref: { aggregateType: 'Workspace', projectId: P, workspaceId: W }, revision: await workspaceRevision() },
      await sessionPin(input.sessionRef)] } });
    if (claimed.status !== 'committed') throw new Error(`the public claim failed: ${JSON.stringify(claimed)}`);
    return claimed.value;
  }

  async function prepareAndStart(
    claim: TaskClaim,
    options: { model: ScriptedModel; tools: readonly string[]; writeScope: readonly string[];
      blockOnShell: boolean; blockOnPlatform?: boolean; prepareViaRuntime?: boolean },
  ): Promise<{ prepared: PreparedTaskExecution; input: string; started: Promise<ReadResult<TaskExecutionRecord>> }> {
    const platform = options.tools.includes(mailbox.name ?? mailboxToolSeam.name);
    const runtime = createK3_35Runtime(world, {
      model: options.model, tools: options.tools, writeScope: options.writeScope,
      now, eventId, newId: () => `k3-35-runtime-id-${String(++seq)}`, kernelStores, workspaceRevision,
      // The shell hook's ONE recognizer (shared with the CRR owner by shape);
      // without it a Run whose binding carries a blocked command fails closed
      // before the shell call.
      commandRecognizer,
      ...(platform ? { messages: emptyMailbox(),
        decisionMessages: emptyMailbox() as unknown as NonNullable<K3_35RuntimeOptions['decisionMessages']> } : {}),
    });
    // The production preparation owner (with the required `readTaskClosure`) is
    // the one place a Run's manifest/envelope/binding is built; the Runtime then
    // re-reads that same stored value on `startRun`. RUN-25 additionally needs
    // the Host `workspaceHost` baseline, carried only by the Runtime's own
    // `port.prepareExecution` (the continuation helper wires no baseline).
    let prepared: PreparedTaskExecution;
    let input: string;
    if (options.prepareViaRuntime === true) {
      const preparedResult = await runtime.runtime.port.prepareExecution(world.fixture.ctx, {
        runRef: claim.runRef, requestId: `k3-35-prepare-${claim.runRef.runId}` });
      if (preparedResult.status !== 'ready') {
        throw new Error(`the Runtime preparation failed: ${JSON.stringify(preparedResult)}`);
      }
      prepared = preparedResult.value;
      const loaded = await loadPreparedManifest(world.fixture.bodies, prepared);
      if (loaded.status !== 'ready') throw new Error(`the prepared manifest is not readable: ${JSON.stringify(loaded)}`);
      input = loaded.value.manifest.input;
    } else {
      const preparedRun = await prepareContinuation({
        world, records, task: claim.task, runRef: claim.runRef, tools: options.tools, writeScope: options.writeScope, now,
      });
      prepared = preparedRun.prepared;
      input = preparedRun.input;
    }
    // The §5.1 stand-ins are armed before start so the Kernel builds the
    // stand-in tools; they block there until the caller releases them.
    if (options.blockOnShell) shell.arm();
    if (options.blockOnPlatform === true) mailbox.arm();
    const started = runtime.runtime.port.startRun(world.fixture.ctx,
      { prepared, consumerId: `k3-35-runtime-${claim.runRef.runId}`,
        requestId: `k3-35-start-${claim.runRef.runId}` });
    if (options.blockOnShell) {
      await Promise.race([
        shell.waitForCall(),
        started.then(result => {
          const value = result.status === 'ready' ? result.value : null;
          const auth = value?.run.executionAuthorization as { phase?: string } | undefined;
          throw new Error(`the Run settled before its shell call: ${JSON.stringify({ modelCalls: options.model.calls(),
            status: result.status, runStatus: value?.run.status, phase: auth?.phase })}`);
        }, error => { throw error; }),
      ]);
    }
    return { prepared, input, started };
  }

  /**
   * The platform's real Host assembly, opened lazily by `reconcileUnknown` /
   * `createRecord` over the
   * SAME store as the S5 fixture. A SQLite world shares the directory's ledger
   * (`ledger.sqlite`), body store (`artifacts.sqlite`, the path S5 writes) and
   * Kernel store. A memory world shares its ONE in-memory backend with the
   * platform (see `openMemoryPlatform`), so RUN-20
   * (`reconcile.reconcileRun`) and the public RUN-22 (`resolveUnknownRun`) read
   * the world's real Run/review facts and build the draft with the real
   * `lookupToolCommit` and `captureWorkspace`, never a second classification.
   */
  type PlatformHost = Awaited<ReturnType<typeof createTargetPlatform>>;
  const platformHostId = 'k3-35-platform-host';
  const defaultTakeover = options.takeover ?? null;
  const platformOptions = {
    now,
    hostInstance: { hostInstanceId: platformHostId, lease: 'owned' as const,
      ...(defaultTakeover === null ? {} : { takeover: defaultTakeover }) },
    kernelStores: { entries: [kernelEntry] },
    workspace: {
      async resolveRoot() {
        return { status: 'ready' as const, value: { root: directory,
          workspaceRevision: options.finalizeCompletedBeforeRequeue === true
            ? world.fixture.workspace.revision : 1 } };
      },
      async authorize() {
        return { status: 'ready' as const, value: { subjectKey: 'k3-35-platform-host',
          permissionRevision: K3_35_HOST_REVISION, allowsRead: () => true } };
      },
    },
    // The trusted Host grant the Runtime would resolve; no model call happens
    // here. The reconcile only needs the configuration to be ready.
    runtime: { async resolveConfiguration() {
      return { status: 'ready' as const,
        value: k3_35Configuration(['read'], [], {} as ResolvedRuntimeConfiguration['model']['client']) };
    } },
  };
  /**
   * The platform's memory backend would be a NEW empty store, not the S5
   * fixture's one in-memory backend, so recognition would see no Run at all.
   * Share the world's ONE backend by wrapping the accepted factory for exactly
   * the synchronous call that builds it (the same test-only pattern the S4A
   * fault fixture and the scenario harness use); the platform then commits and
   * reads the world's own facts, and its `close` leaves the world's store open.
   */
  const openMemoryPlatform = async (): Promise<PlatformHost> => {
    const spy = vi.spyOn(inMemoryRecordStore, 'createInMemoryRecordBackend').mockReturnValue({
      records: world.records, close: async () => undefined,
    } as never);
    // RUN-25 reads the prepared baseline from the bundle body and stores the
    // capture Artifact; a second empty in-memory body store would lose the
    // world's real prepared manifest (baselineKnown false). Share the world's
    // ONE artifact-body store too, like the records backend above. The platform
    // builds its body store after `observeRecordCommits` awaits, so both wraps
    // must stay active until the whole factory resolves.
    const bodiesSpy = vi.spyOn(bodyStore, 'RawArtifactBodyStore').mockImplementation(
      // Vitest requires a `class` for a constructor mock: return the world's ONE
      // artifact-body store instead of a fresh empty one.
      class ReturningWorldBodies { constructor() { return world.fixture.bodies as never; } } as never,
    );
    try {
      return await createTargetPlatform({ ...platformOptions, storage: { kind: 'memory' } });
    } finally {
      spy.mockRestore();
      bodiesSpy.mockRestore();
    }
  };
  let platformHost: Promise<PlatformHost> | undefined;
  const hostPlatform = (): Promise<PlatformHost> => {
    platformHost ??= world.kind === 'sqlite'
      ? createTargetPlatform({ ...platformOptions, storage: { kind: 'sqlite', directory } })
      : openMemoryPlatform();
    return platformHost;
  };

  /**
   * RUN-20 only: read the in-flight Run and its REAL probe through the
   * platform's public `executions`, run the start-up assembly (which books
   * `tool_calls_unresolved` for the blocked call), then read the ended
   * `outcome_unknown` Run back with its real revision. It takes no draft, item
   * or event and never calls RUN-22. `options.probe` replaces only the explicit
   * RUN-20 probe (a fault-injection caller).
   */
  /**
   * ONE real Host reconcile over a Run's execution read: the public
   * `executions.readExecution`, the real probe, and
   * `platform.reconcile.reconcileRun({record, hostInstanceId, takeover, probe})`.
   * `takeover` is a Host input (the RUN-25 proof); no classification is built.
   * The SAME read is returned so a retry can reuse the exact request identity.
   */
  async function hostReconcile(claim: TaskClaim,
    options: { probe?: SessionMappingProbe } & K3_35TakeoverOptions): Promise<{
      platform: PlatformHost; record: TaskExecutionRecord; probe: SessionMappingProbe;
      takeover: HostTakeoverProofV1 | null; report: RunReconcileReport;
    }> {
    const platform = await hostPlatform();
    const current = await platform.executions.readExecution(world.fixture.ctx, claim.runRef);
    if (current.status !== 'ready') {
      throw new Error(`the record Run is not readable through the platform: ${JSON.stringify(current)}`);
    }
    const probe = options.probe ?? await createSessionHistoryCursorOwner({ kernelStores, kernel }).probe({
      session: current.value.session, signal: world.fixture.ctx.signal });
    const takeover = options.takeover ?? defaultTakeover;
    const report = await platform.reconcile.reconcileRun(world.fixture.ctx,
      { record: current.value, hostInstanceId: platformHostId, probe,
        ...(takeover === null ? {} : { takeover }) });
    return { platform, record: current.value, probe, takeover, report };
  }

  async function reconcileUnknown(claim: TaskClaim,
    options: { probe?: SessionMappingProbe } & K3_35TakeoverOptions = {}): Promise<RunSnapshot> {
    const { platform, report } = await hostReconcile(claim, options);
    if (report.status !== 'reconciled') {
      throw new Error(`the record's RUN-20 did not book the blocked call: ${JSON.stringify(report)}`);
    }
    const unknown = await platform.executions.readExecution(world.fixture.ctx, claim.runRef);
    if (unknown.status !== 'ready') throw new Error(JSON.stringify(unknown));
    return unknown.value.run;
  }

  async function reconcileUnknownTwice(claim: TaskClaim,
    options: { probe?: SessionMappingProbe } & K3_35TakeoverOptions = {}): Promise<{
      report: RunReconcileReport; replayReport: RunReconcileReport; run: RunSnapshot;
    }> {
    const first = await hostReconcile(claim, options);
    if (first.report.status !== 'reconciled') {
      throw new Error(`the record's RUN-25 did not commit: ${JSON.stringify(first.report)}`);
    }
    // The retry keeps the EXACT pre-commit execution read: same request id
    // (`...:<run>:<revision>`) and content, so the real owner resolves its
    // receipt instead of comparing the pins its own commit moved.
    const replayReport = await first.platform.reconcile.reconcileRun(world.fixture.ctx,
      { record: first.record, hostInstanceId: platformHostId, probe: first.probe,
        ...(first.takeover === null ? {} : { takeover: first.takeover }) });
    const unknown = await first.platform.executions.readExecution(world.fixture.ctx, claim.runRef);
    if (unknown.status !== 'ready') throw new Error(JSON.stringify(unknown));
    return { report: first.report, replayReport, run: unknown.value.run };
  }

  /**
   * The production recognition path: RUN-20 through `reconcileUnknown`, then
   * the public RUN-22 entry (which reads the draft itself with the real
   * `lookupToolCommit`/`captureWorkspace`). No draft, item or event is an input.
   * `options.probe` replaces only the explicit RUN-20 probe (a fault-injection
   * caller); RUN-22 still reads the real Kernel. With `repeat`, the SAME public
   * RUN-22 request is called a second time (caller-chosen `requestId`), which
   * the owner answers from its recorded receipt.
   */
  async function hostRecord(claim: TaskClaim,
    options: { probe?: SessionMappingProbe; requestId?: string }, repeat: boolean): Promise<{
      record: UnknownCallReviewV1; first: WriteResult<RunSnapshot>;
      replay: WriteResult<RunSnapshot> | null;
    }> {
    const unknown = await reconcileUnknown(claim, options);
    const platform = await hostPlatform();
    const request = { input: {
      runRef: claim.runRef, reason: 'the K3-35 record Run was attested from the real draft',
    }, meta: { requestId: options.requestId ?? `k3-35-record-attest-${claim.runRef.runId}`,
      expected: [{ ref: claim.runRef, revision: unknown.revision }] } };
    const resolved = await platform.resolveUnknownRun(world.fixture.ctx, request);
    if (resolved.status !== 'committed') {
      throw new Error(`the record's RUN-22 failed: ${JSON.stringify(resolved)}`);
    }
    let replay: WriteResult<RunSnapshot> | null = null;
    if (repeat) {
      replay = await platform.resolveUnknownRun(world.fixture.ctx, request);
      if (replay.status !== 'committed' || replay.replayed !== true) {
        throw new Error(`the same RUN-22 request did not replay: ${JSON.stringify(replay)}`);
      }
    }
    const read = await world.reviews.readReview(world.fixture.ctx, { runRef: claim.runRef });
    if (read.status !== 'ready') throw new Error(`the record is not readable: ${JSON.stringify(read)}`);
    return { record: read.value, first: resolved, replay };
  }

  async function createRecord(claim: TaskClaim,
    options: { probe?: SessionMappingProbe; requestId?: string } = {}): Promise<UnknownCallReviewV1> {
    return (await hostRecord(claim, options, false)).record;
  }

  async function replayRecord(claim: TaskClaim,
    options: { probe?: SessionMappingProbe; requestId?: string } = {}): Promise<{
      record: UnknownCallReviewV1; first: WriteResult<RunSnapshot>; replay: WriteResult<RunSnapshot>;
    }> {
    const result = await hostRecord(claim, options, true);
    if (result.replay === null) throw new Error('the RUN-22 replay result is missing');
    return { record: result.record, first: result.first, replay: result.replay };
  }

  async function requeue(claim: TaskClaim, note: string): Promise<TaskRequeueSnapshotV1> {
    let current = await reads.readExecution(world.fixture.ctx, claim.runRef);
    if (current.status !== 'ready') throw new Error(JSON.stringify(current));
    if (options.finalizeCompletedBeforeRequeue === true
      && current.value.run.status === 'ended' && current.value.run.outcome === 'completed') {
      const platform = await hostPlatform();
      platform.registerCheckConfiguration({ configuration: {
        configurationRevision: 'k3-35-requeue-checks@1',
        workspace: world.fixture.base.workspaceRef,
        executor: world.fixture.operatorActor,
        permissionRevision: K3_35_HOST_REVISION,
        sourceAccess: 'verification_workspace',
        processAccess: 'all_except_denied',
        deniedPrefixes: ['.git'],
        checks: [],
      } });
      const opened = await platform.evidence.openVerification(world.fixture.ctx, {
        input: { subjectRunRef: claim.runRef, subject: claim.task, planRef: claim.planRef },
        meta: { requestId: `k3-35-open:${claim.runRef.runId}`, expected: [] },
      });
      if (opened.status !== 'committed') throw new Error(JSON.stringify(opened));
      const finalized = await platform.evidence.finalizeChecks(world.fixture.ctx, {
        input: { roundRef: opened.value.ref },
        meta: { requestId: `k3-35-final:${claim.runRef.runId}`,
          expected: [{ ref: opened.value.ref, revision: opened.value.revision }] },
      });
      if (finalized.status !== 'committed') throw new Error(JSON.stringify(finalized));
      current = await reads.readExecution(world.fixture.ctx, claim.runRef);
      if (current.status !== 'ready') throw new Error(JSON.stringify(current));
    }
    const result = await requeues.requeueTask(world.fixture.ctx, { input: {
      taskRef: claim.task, afterRunRef: claim.runRef, reason: 'continue the K3-35 Task', note },
    meta: { requestId: `k3-35-requeue-${claim.runRef.runId}`, expected: [{ ref: GOAL_B, revision: await goalRevision() },
      { ref: claim.runRef, revision: current.value.run.revision }] } });
    if (result.status !== 'committed') throw new Error(`the requeue failed: ${JSON.stringify(result)}`);
    if (result.value.kind !== 'requeued') throw new Error(`the requeue was refused: ${JSON.stringify(result.value)}`);
    return result.value.requeue;
  }

  async function registerArchive(sessionRef: { projectId: string; sessionId: string }, requestId: string,
    reason: string): Promise<number> {
    const card = await world.fixture.b2.base.sessionsPort.readSession(world.fixture.ctx, sessionRef);
    if (card.status !== 'ready') throw new Error(JSON.stringify(card));
    await registerPublicArchive(lifecycle, world.fixture.ctx,
      { sessionRef, reason, requestId, sessionRevision: card.value.record.revision });
    return card.value.record.revision;
  }

  async function driveArchive(sessionRef: { projectId: string; sessionId: string }, requestId: string,
    reason: string, sessionRevision: number): Promise<{ anchorsBefore: number }> {
    const before = await anchorCount();
    const request: PublicArchiveRequest = { sessionRef, reason, requestId, sessionRevision };
    const line = await drivePublicArchive(archiveService, world.fixture.ctx, request);
    if (line.requeueRefusals.length > 0) {
      throw new Error(`the archive refused a requeue: ${JSON.stringify(line.requeueRefusals)}`);
    }
    return { anchorsBefore: before };
  }

  async function anchorOfRun(runIdValue: string): Promise<SessionAnomalyAnchorV1> {
    const listed = await anomalies.listSessionAnomalies(world.fixture.ctx, { goalRef: GOAL_B, page: { limit: 100 } });
    if (listed.status !== 'ready') throw new Error(JSON.stringify(listed));
    const found = listed.value.items.find(item => item.anchor.runRef.runId === runIdValue);
    if (found === undefined) throw new Error(`no real anchor for Run ${runIdValue}`);
    return found.anchor;
  }

  async function anchorList(): Promise<SessionAnomalyAnchorV1[]> {
    const listed = await anomalies.listSessionAnomalies(world.fixture.ctx, { goalRef: GOAL_B, page: { limit: 100 } });
    if (listed.status !== 'ready') throw new Error(JSON.stringify(listed));
    return listed.value.items.map(item => item.anchor);
  }
  async function anchorCount(): Promise<number> { return (await anchorList()).length; }

  // No union backend is opened any more; `closeUnion` stays for the existing
  // callers and closes the lazily opened platform Host if `reconcileUnknown` or
  // `createRecord` opened one (for a caller that never recognizes a Run it is a
  // no-op).
  async function closeUnion(): Promise<void> {
    if (recognizerWorkspace !== undefined) {
      const opened = recognizerWorkspace;
      recognizerWorkspace = undefined;
      try { await (await opened).close(); } catch { /* best effort; never mask the caller's error */ }
    }
    if (platformHost === undefined) return;
    const opened = platformHost;
    platformHost = undefined;
    try { await (await opened).close(); } catch { /* cleanup is best effort; never mask the caller's error */ }
  }

  return { world, records, kernelStores,
    closeUnion, claimRun, prepareAndStart,
    reconcileUnknown, reconcileUnknownTwice, createRecord, replayRecord,
    endBoundaryOf: (ref: RunRef) => readRunBoundary(world, ref), requeue, registerArchive, driveArchive,
    anchorOfRun, anchorList, anchorCount, now, eventId, newId,
    setMinute(value: number) { minute = value; } };
}

/**
 * Read an ended Run's booked end against the REAL Kernel history: its
 * `history.endPosition`, the Session's canonical completed-boundary cursor and
 * the entry at that position (its own position and cursor). It writes nothing;
 * K3-16 uses the same reader after `endK3RunCompleted`/`endK3RunUnfinished`.
 */
export async function readRunBoundary(world: K3ReviewCardWorld, ref: RunRef): Promise<{
  endPosition: number | null; position: number; cursor: string;
  sessionCursor: string | null; entryPosition: number | null; entryCursor: string | null;
}> {
  const reads = createRunStateReader({ records: world.records });
  const current = await reads.readExecution(world.fixture.ctx, ref);
  if (current.status !== 'ready') throw new Error(`the ended Run is not readable: ${JSON.stringify(current)}`);
  const endPosition = current.value.run.executionHistory?.endPosition ?? null;
  if (endPosition === null) throw new Error('the ended Run has no history end position');
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 's5-kernel', storeKey: 's5-kernel-store', workspace: { projectId: P, workspaceId: W },
    databasePath: join(world.fixture.base.directory, 's5-kernel.sqlite'),
  }] });
  const owner = createSessionHistoryCursorOwner({ kernelStores, kernel });
  const boundary = await owner.completedBoundary({ session: current.value.session, signal: world.fixture.ctx.signal });
  if (boundary.status !== 'resolved') {
    throw new Error(`the ended Run's Session boundary is not a real Kernel cursor: ${JSON.stringify(boundary)}`);
  }
  if (boundary.cursor === null) throw new Error('the ended Run has no canonical Kernel cursor');
  const window = await owner.readPositionWindow({ session: current.value.session,
    afterPosition: endPosition - 1, throughPosition: endPosition, limit: 1, signal: world.fixture.ctx.signal });
  if (window.status !== 'ready') throw new Error(`the Kernel history entry is not readable: ${JSON.stringify(window)}`);
  const entry = window.value.entries[0];
  if (entry === undefined) throw new Error(`the Kernel history has no entry at position ${String(endPosition)}`);
  return { endPosition, position: boundary.position, cursor: boundary.cursor,
    sessionCursor: current.value.session.historyCursor,
    entryPosition: entry.source.position, entryCursor: entry.cursor };
}

/**
 * The public steps reached: eight interrupted Runs archived on the Task (real
 * requests, real stops, the real archive owner and the failing changed-file
 * read), the RUN-20/RUN-22 record on the ninth Run, the safer_method answer and
 * proposal round, settlement, the `approve` answer, and the continuation Run
 * from the public requeue/claim path.
 */
export async function openK3_35PublicRecord(
  kind: 'memory' | 'sqlite' = 'memory', options: K3_35PublicOptions = {},
): Promise<K3_35PublicRecord> {
  const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
  let harness: K3_35RealRunHarness | undefined;
  try {
    harness = await openRealRunHarness(world);
    const taskId = options.taskIdBytes === undefined ? K3_35_TASK_ID : k3TaskIdOfBytes(options.taskIdBytes);
    const planRef = options.taskIdBytes === undefined ? PLAN_B2 : (await adoptK3PlanTask(world, taskId)).planRef;
    // ---- eight real interrupted Runs on the Task --------------------------
    // Archive each Run before the next claim, so the next real prepare carries
    // the still-pending previous anchor.
    let previousRequeue: TaskRequeueSnapshotV1['ref'] | undefined;
    let lastClaim: TaskClaim | undefined;
    for (let index = 0; index < K3_35_ANCHORS; index += 1) {
      harness.setMinute(8 + index);
      const sessionRef = await world.fixture.createS5Session(`k3-35-anchor-${String(index)}`);
      const claim = await harness.claimRun({ sessionRef, planRef, taskId, requestId: `k3-35-anchor-claim-${String(index)}`,
        ...(previousRequeue === undefined ? {} : { requeueRef: previousRequeue }) });
      // The REAL prepare and the REAL runtime entry: the scripted model's
      // `shell` call is held by the §5.1 stand-in, so the Run is in flight. Its
      // next `beforeReply` throws, which the production Runtime turns into the
      // real `run_crashed` terminal (no test-built event).
      const run = await harness.prepareAndStart(claim, {
        model: createScriptedModel([{ kind: 'calls', calls: [{
          callId: `k3-35-anchor-shell-${String(index)}`, name: 'shell', args: { command: 'printf anchor' },
        }] }], async (_request, round) => {
          if (round > 0) throw new Error('the K3-35 archive interrupted this execution');
        }),
        tools: ['read', 'shell'], writeScope: ['.'], blockOnShell: true,
      });
      // A later anchor's real prepare must carry the still-pending previous
      // anchor in its anomaly section: no scaffold brief omits it.
      if (index > 0 && !run.input.includes('### 异常锚点')) {
        throw new Error(`the real prepare of anchor ${String(index)} lost the pending anomaly section`);
      }
      const archiveReason = `the operator archives the K3-35 anchor ${String(index)}`;
      // Register the archive while the Run is still in flight, then let the
      // scripted model crash it and await the Runtime's own terminal.
      const sessionRevision = await harness.registerArchive(sessionRef,
        `k3-35-anchor-archive-${String(index)}`, archiveReason);
      try {
        shellSeam.release();
        const settled = await run.started;
        if (settled.status !== 'ready' || settled.value.run.status !== 'ended'
          || settled.value.run.outcome !== 'crashed') {
          throw new Error(`the anchor Run did not crash through the Runtime: ${JSON.stringify(settled)}`);
        }
      } finally {
        shellSeam.release();
        await run.started.catch(() => undefined);
      }
      // The archive is driven after the real crash: it records the anchor and
      // its real TaskRequeue covers the interrupted Run the next claim consumes.
      const archived = await harness.driveArchive(sessionRef, `k3-35-anchor-archive-${String(index)}`,
        archiveReason, sessionRevision);

      const anchor = await harness.anchorOfRun(claim.runRef.runId);
      if (archived.anchorsBefore + 1 !== (await harness.anchorCount())) {
        throw new Error('the public archive did not add exactly one anchor');
      }
      const requeueRead = await harness.records.readMany([taskRequeueRefKey({ aggregateType: 'TaskRequeue',
        projectId: P, goalId: GOAL_B.goalId, taskId, afterRunId: claim.runRef.runId })]);
      if (requeueRead.status !== 'ready') throw new Error(JSON.stringify(requeueRead));
      const requeueRecord = requeueRead.value.records[0];
      if (requeueRecord === undefined) throw new Error(`the archive left no requeue for ${claim.runRef.runId} (${anchor.ref.runId})`);
      previousRequeue = (JSON.parse(requeueRecord.json) as TaskRequeueSnapshotV1).ref;
      lastClaim = claim;
    }
    if (lastClaim === undefined) throw new Error('the K3-35 anchors did not build');
    // ---- the record's own Run: the ninth, claimed from the eighth requeue ---
    const recordSession = await world.fixture.createS5Session('k3-35-record-run');
    const recordClaim = await harness.claimRun({ sessionRef: recordSession, planRef, taskId,
      requestId: 'k3-35-record-claim', ...(previousRequeue === undefined ? {} : { requeueRef: previousRequeue }) });
    // The record Run declares what the real serial path can reach: ONE process
    // `shell` call (the L7/L8 512-byte callId ceiling). A non-read-only mixed
    // batch runs one call at a time, so a blocked first handler means the later
    // declarations never started and are not review items.
    const processCallId = longCallId(1);
    const recordRun = await harness.prepareAndStart(recordClaim, {
      model: createScriptedModel([{ kind: 'calls', calls: [
        { callId: processCallId, name: 'shell', args: { command: 'printf one > a.txt' } },
      ] }]),
      tools: ['read', 'shell'], writeScope: ['.'], blockOnShell: true,
    });
    if (!recordRun.input.includes('### 异常锚点')) {
      throw new Error('the ninth Run\'s real prepare lost the pending anomaly section');
    }
    // The platform Host assembly recognizes the in-flight Run: RUN-20 books the
    // blocked call and the public RUN-22 reads the REAL Kernel draft itself (its
    // callId, positions, arguments digest, summary and `observed` are the
    // platform's; the workspace capture is the real `captureWorkspace`).
    let created: UnknownCallReviewV1;
    try {
      created = await harness.createRecord(recordClaim);
    } finally {
      shellSeam.release();
      await recordRun.started.catch(() => undefined);
    }
    // A complete inventory with a process item is `pending_review`; the REAL
    // review round (claim → conclusion owner → real end → settle) concludes it
    // with a `possible` self-check, so settlement adds `crash_possible` and the
    // one-item record settles to `needs_decision`.
    if (created.status !== 'pending_review') {
      throw new Error(`the RUN-22 record must be pending_review: ${JSON.stringify(created.status)}`);
    }
    const reviewRound = await runK3ReviewRound(world, created, {
      planRef,
      conclusions: [{
        item: 1, verdict: 'done', evidence: '依据'.repeat(300),
        crashSuspicion: { verdict: 'possible', evidence: '可疑'.repeat(300) },
      }],
    });
    const decided = reviewRound.settled;
    if (decided === null || decided.status !== 'needs_decision') {
      throw new Error(`the real review round must settle needs_decision: ${JSON.stringify(decided?.status)}`);
    }
    // The review world's production Kernel reader returns the ORIGINAL command
    // text of the real Turn; the owner computes and writes `blockedCommands`
    // itself during the approve application.
    const proposed = await answerK3Disposition(world, decided, 'safer_method', {
      text: SAFER_NOTE, requestId: 'k3-35-safer',
    });
    if (proposed.status !== 'awaiting_proposal') {
      throw new Error(`the safer_method answer must await a proposal: ${JSON.stringify(proposed.status)}`);
    }
    const round = await claimK3ReviewRound(world, proposed, { phase: 'proposal', planRef });
    const written = await writeK3Proposal(world, round, {
      item: 1, command: APPROVED_COMMAND, cwd: null,
      rationale: 'the exact L20 5,120-byte worst case',
    });
    await endK3RunCompleted(world, round.claim);
    const awaiting = await settleK3Review(world, written);
    if (awaiting.status !== 'awaiting_approval') {
      throw new Error(`the proposal round must settle awaiting_approval: ${JSON.stringify(awaiting.status)}`);
    }
    const approved = await answerK3Disposition(world, awaiting, 'approve', { text: '', requestId: 'k3-35-approve' });
    if (approved.status !== 'resolved') {
      throw new Error(`the approve answer must resolve: ${JSON.stringify(approved.status)}`);
    }
    const record = await readK3Review(world, approved.ref);
    if (record.blockedCommands.length !== 1) {
      throw new Error(`the approve owner must write ONE blocked command, got ${String(record.blockedCommands.length)}`);
    }
    const original = await readExecution(harness.records, world, recordClaim.runRef);
    // ---- the continuation Run: the public requeue over the record's Run -----
    const continuationRequeue = await harness.requeue(recordClaim, 'K3-35 continuation after the review');
    const continuationSession = await world.fixture.createS5Session('k3-35-continuation');
    const continuation = await harness.claimRun({ sessionRef: continuationSession, planRef, taskId,
      requestId: 'k3-35-continuation-claim', requeueRef: continuationRequeue.ref });
    // The continuation Run also goes through the real prepare and the real
    // runtime entry; its model is a plain text reply, so the Run ends normally
    // after the prepared manifest has been stored.
    const continuationRun = await harness.prepareAndStart(continuation, {
      model: createScriptedModel([{ kind: 'text', text: 'K3-35 continuation entered' }]),
      tools: ['read'], writeScope: [], blockOnShell: false,
    });
    const continuationStarted = await continuationRun.started;
    if ((continuationStarted as { status?: string }).status !== 'ready') {
      throw new Error(`the continuation Run did not start: ${JSON.stringify(continuationStarted)}`);
    }
    const anchorList = await listAnchors(harness);
    const section = assembleUnknownCallReviewSection({ review: record });
    return {
      world, task: { ...record.task }, review: record, section, original, anchors: anchorList, continuation,
      prepared: continuationRun.prepared, preparedInput: continuationRun.input,
      records: harness.records, processCallId: record.items[0]!.callId,
      platformCallIds: record.items.slice(1).map(item => item.callId),
      endBoundaryOf: (ref: RunRef) => harness!.endBoundaryOf(ref),
      close: async () => { await harness!.closeUnion(); await world.close(); },
    };
  } catch (error) {
    if (harness !== undefined) await harness.closeUnion();
    await world.close();
    throw error;
  }
}

async function readExecution(
  records: import('../../src/core/record-store/ports.js').GoalRecordTransactionPort & RecordLookupPort,
  world: K3ReviewCardWorld, ref: RunRef,
): Promise<TaskExecutionRecord> {
  const read = await createRunStateReader({ records }).readExecution(world.fixture.ctx, ref);
  if (read.status !== 'ready') throw new Error(`the original Run is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

async function listAnchors(harness: K3_35RealRunHarness): Promise<SessionAnomalyAnchorV1[]> {
  return await harness.anchorList();
}
