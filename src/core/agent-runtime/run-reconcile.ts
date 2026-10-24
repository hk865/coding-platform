/**
 * Start-up Run reconcile: the Runtime classifier (STATE-MACHINES-SPEC §6
 * RUN-16..21, RUN-23, RUN-24, §12.1 steps 2 and 5, §12.2 W-05..W-20; A.2 step
 * 5.6).
 *
 * For one `Entering` or `Running` Run (or one ended `outcome_unknown`, W-15)
 * this reads the claim Session's Kernel history through the same reader the
 * observer uses (`kernel-turn-facts.ts`), reduces the fixed Turn and submits
 * exactly one WorkGraph write: a Kernel terminal through the extended
 * `recordRunResult` (RUN-17/18, RUN-21), anything else through `reconcileRun`
 * (RUN-16, RUN-19/24, RUN-20, RUN-23). It never starts a Kernel Turn, never
 * re-runs a tool, never resends a message (§12 principles). The classifier does
 * not pick RUN-19 or RUN-24: the WorkGraph machine reads the pointer (C4); it
 * only routes a queued cancel with a clean Turn to RUN-23, which the machine
 * requires.
 *
 * The same reading books late Kernel evidence of an unknown end in process
 * (RUN-21 on the `live_clean` proof, §12.2 "进程内的同类收尾"), and step 5
 * reads which queued steers the Kernel accepted before an earlier end
 * (CTL-08(e)).
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { ControlIntentRef } from '../../contracts/control-intent.js';
import type { RunExecutionHistoryV1 } from '../../contracts/core/execution-history.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../contracts/core/results.js';
import type { SessionRecord } from '../../contracts/core/session.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import type { QueryRunRef } from '../../contracts/query-job.js';
import type { RunContinuationV1, RunReconciliationBasisV1, RunRef, RunSnapshot } from '../../contracts/dispatch.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { validateRunStateInvariants, type RunState } from '../../../vendor/coding-agent/dist/public-api.js';
import type { SessionMailboxPort } from '../work-graph/model/communication-contracts.js';
import type { QueryExecutionPort, QueryExecutionRecord, QueryReconcileInput } from '../work-graph/queries/contracts.js';
import type { RunControlPort } from '../work-graph/tasks/control-contracts.js';
import type {
  AcceptedSteerV1, ExecutionEntryPort, KernelExecutionBinding, ObservedExecutionHistory,
} from '../work-graph/model/execution-entry-contracts.js';
import type { TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import type { ReconcileRunInput, ReconcileTurnV1, RunReconcilePort, AutoCleanupCandidateV1 } from '../work-graph/tasks/run-reconcile-contracts.js';
import { terminalEventOf, transcriptHasOutcomeUnknown, turnIsComplete } from './execution-observation.js';
import { confirmMailboxInputs } from './execution-inputs.js';
import { decodeKernelEntry, reduceTurnFromStart, unresolvedToolCallIds, type DecodedKernelRecord } from './kernel-turn-facts.js';
import { tallyTurnActivity } from './run-activity-tally.js';
import { unknownFacts } from './run-activity-reader.js';
import type { RunActivityFactsV1 } from '../../contracts/run-activity.js';
import type {
  HostTakeoverProofV1, ToolCommitLookup, UnknownCallReviewDraftV1, WorkspaceCaptureV1,
} from '../../contracts/unknown-call-review.js';
import type { ArtifactRef } from '../../contracts/artifact.js';
import {
  captureUnknownCallWorkspace, readUnknownCallReviewDraft, unknownCallInventoryProblem, type UnresolvedCallFactV1,
} from './unknown-call-draft.js';
import { containedByHostStop } from '../work-graph/state/unknown-call-kinds.js';
import type { SessionHistoryCursorOwner, SessionHistoryEntry, SessionMappingProbe } from './session-operations.js';

export type RunReconcileClassifierDependencies = {
  owner: SessionHistoryCursorOwner;
  messages?: Pick<SessionMailboxPort, 'recordInputAccepted' | 'readMessage'>;
  controls: Pick<RunControlPort, 'readControl'>;
  entry: Pick<ExecutionEntryPort, 'recordRunResult'>;
  reconcile: RunReconcilePort;
  now(): string;
  newId(): string;
  /** K3 (G6, L25): the read-only K closure support query; absent = closure_unsupported. */
  turnClosureSupport?(ctx: CoreCallContext, input: { sessionRef: { projectId: string; sessionId: string } }):
    Promise<{ status: 'supported' } | { status: 'unsupported'; reason: string }>;
  /** K3 (G8, L5): the workspace capture; absent = no_baseline/not_configured. */
  captureWorkspace?(ctx: CoreCallContext, input: { workspaceId: string; bundleRef: ArtifactRef }):
    Promise<WorkspaceCaptureV1>;
  /** K3 (G3/L4): the platform owners' committed-call lookup; absent = every platform item undetermined. */
  lookupToolCommit?: ToolCommitLookup;
};

/** One Run's line of the reconcile report (§12.1 step 7). */
export type RunReconcileReport = {
  runRef: RunRef;
  /** The §12.2 row or the reason it was left as recorded. */
  row: string;
  status: 'reconciled' | 'left' | 'failed';
  reason: string;
  /** K3 (L25, KR1): the automatic-closure outcome the Host report copies. */
  autoCleanup?: { applied: true } | { applied: false; blockedBy: string };
};

const PAGE_LIMIT = 200;
const MAX_PAGES = 64;
const TERMINAL_STATUSES: readonly string[] = ['completed', 'failed', 'cancelled', 'limit_exceeded', 'yielded', 'interrupted'];

type TurnRead =
  | { ok: true; decoded: DecodedKernelRecord[]; entries: SessionHistoryEntry[]; through: number }
  | { ok: false; reason: string };

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function sameRef(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left as never) === canonicalJson(right as never); } catch { return false; }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** The begin authorization's fixed Kernel identity. Every caller passes a Run the
 * platform already authorized; a missing authorization is not a reachable state. */
function isV2Kernel(run: RunSnapshot): KernelExecutionBinding | null {
  return run.executionAuthorization!.kernel;
}

/** The bounded Kernel window after `afterPosition` through the tail frozen by the first page. */
async function readTurnWindow(
  owner: SessionHistoryCursorOwner, session: SessionRecord, afterPosition: number, signal: AbortSignal,
): Promise<TurnRead> {
  const decoded: DecodedKernelRecord[] = [];
  const entries: SessionHistoryEntry[] = [];
  let cursor = afterPosition;
  let expected = afterPosition + 1;
  let through: number | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const window = await owner.readPositionWindow({ session, afterPosition: cursor, throughPosition: through,
      limit: PAGE_LIMIT, signal });
    if (window.status !== 'ready') {
      return { ok: false, reason: window.status === 'rejected' ? window.reason : `the Kernel history is ${window.status}` };
    }
    through = window.value.throughPosition;
    for (const entry of window.value.entries) {
      const item = decodeKernelEntry(entry);
      if (item === null || item.position !== expected) return { ok: false, reason: 'the Kernel history is damaged or not contiguous' };
      expected += 1;
      decoded.push(item);
      entries.push(entry);
    }
    cursor = window.value.nextPosition;
    if (!window.value.hasMore) return { ok: true, decoded, entries, through: through ?? afterPosition };
  }
  return { ok: false, reason: 'the Turn history exceeds the bounded reconcile page budget' };
}

/** The Turn's `turn.started` record of the fixed Kernel identity, with its position and instant. */
function turnStartOf(decoded: readonly DecodedKernelRecord[], kernel: KernelExecutionBinding): DecodedKernelRecord | null {
  for (const item of decoded) {
    if (item.record.recordType !== 'turn.started') continue;
    const run = (item.record.payload as unknown as { run?: { runId?: string; turn?: { turnId?: string } } }).run;
    if (run?.runId === kernel.runId && run.turn?.turnId === kernel.turnId) return item;
  }
  return null;
}

/** CTL-08(b)/(e): the queued steers of `controlInputs` whose `run.input_accepted` the Kernel saved in this Turn. */
function acceptedSteersOf(
  decoded: readonly DecodedKernelRecord[], kernel: KernelExecutionBinding, run: RunSnapshot,
): AcceptedSteerV1[] {
  const steers: AcceptedSteerV1[] = [];
  for (const item of decoded) {
    if (item.record.recordType !== 'agent.event') continue;
    const event = item.record.payload.event;
    if (event.type !== 'run.input_accepted' || event.meta.runId !== kernel.runId || event.meta.turnId !== kernel.turnId) continue;
    const source = event.payload.input.sourceRef;
    if (!isRecord(source) || source['kind'] !== 'ControlIntent' || !isRecord(source['intentRef'])) continue;
    const intentRef = source['intentRef'] as ControlIntentRef;
    if (!(run.controlInputs ?? []).some(ref => sameRef(ref, intentRef))) continue;
    steers.push({ intentRef, position: item.position, kernelEventId: event.meta.eventId, kernelEventSequence: event.meta.sequence });
  }
  return steers;
}

/**
 * RD-3 condition 1: the message refs of this Turn's `send_session_message`
 * tool results that carry `waiting: true` (`communication-tools.ts`), from
 * the Kernel history itself, never from the platform outbox.
 */
function waitingSendsOf(state: RunState): SessionMessageRef[] {
  const names = new Map<string, string>();
  for (const entry of state.transcript) {
    if (entry.kind !== 'assistant_message') continue;
    for (const call of entry.toolCalls) names.set(call.callId, call.name);
  }
  const refs: SessionMessageRef[] = [];
  for (const entry of state.transcript) {
    if (entry.kind !== 'tool_result' || entry.result.status !== 'success' || names.get(entry.callId) !== 'send_session_message') continue;
    for (const part of entry.result.output) {
      if (part.kind !== 'json' || !isRecord(part.value) || part.value['waiting'] !== true) continue;
      const message = part.value['message'];
      if (isRecord(message) && isRecord(message['ref'])) refs.push(message['ref'] as unknown as SessionMessageRef);
    }
  }
  return refs;
}

/**
 * RD-3, L-5: a yielded terminal without a live handle rebuilds its
 * continuation only when (1) exactly one `send_session_message` of the Turn
 * waits for a reply, (2) its stored message was sent by this Run at the claim
 * generation with `waitAfterSend`, and (3) the continuation names the claim's
 * Task and Session. Anything else is `continuation_unrebuildable` (RUN-20(iii)).
 * `recordRunResult` reads and guards the same message in its commit.
 */
async function rebuildContinuation(
  deps: RunReconcileClassifierDependencies, ctx: CoreCallContext, record: TaskExecutionRecord, state: RunState,
): Promise<RunContinuationV1 | null> {
  const readMessage = deps.messages?.readMessage;
  if (readMessage === undefined) return null;
  const waiting = waitingSendsOf(state);
  const only = waiting.length === 1 ? waiting[0] : undefined;
  if (only === undefined) return null;
  const claim = record.outbox.claim;
  let read;
  try { read = await readMessage(ctx, only); } catch { return null; }
  if (read.status !== 'ready') return null;
  const sender = read.value.sender;
  if (sender.kind !== 'work_run' || !sameRef(sender.runRef, record.run.ref) || sender.generation !== claim.generation
    || read.value.waitAfterSend !== true) {
    return null;
  }
  return { schemaVersion: 1, kind: 'wait_reply', task: { ...claim.task }, sessionRef: { ...claim.sessionRef },
    messageRef: { ...read.value.ref } };
}

/**
 * Classify and book one Run. `probe` is the claim Session's probe from step 1
 * (§8.2); an inconclusive probe leaves the Run as recorded (W-07).
 */
export async function reconcileRunAtStartup(
  deps: RunReconcileClassifierDependencies, ctx: CoreCallContext,
  input: { record: TaskExecutionRecord; hostInstanceId: string; probe: SessionMappingProbe;
    takeover?: HostTakeoverProofV1 | null },
): Promise<RunReconcileReport> {
  const { record, hostInstanceId } = input;
  return classifyRun(deps, ctx, { record, probe: input.probe,
    basis: { kind: 'host_instance_takeover', hostInstanceId },
    requestId: `a2-reconcile:${hostInstanceId}:${record.run.ref.runId}:${String(record.run.revision)}`,
    takeover: input.takeover ?? null });
}

/**
 * RUN-21 in process (§12.2 "进程内的同类收尾", RD-4): a Run already ended
 * `outcome_unknown` whose Kernel now holds a new terminal with every
 * unresolved call determined is booked on the `live_clean` proof (the Turn's
 * process ended before; nothing here runs it). Every other reading leaves the
 * Run as recorded. Answers whether a commit was made.
 */
export async function bookLateEvidenceInProcess(
  deps: RunReconcileClassifierDependencies, ctx: CoreCallContext, input: { record: TaskExecutionRecord },
): Promise<boolean> {
  const run = input.record.run;
  if (run.status !== 'ended' || run.outcome !== 'outcome_unknown' || isV2Kernel(run) === null) return false;
  const probe = await deps.owner.probe({ session: input.record.session, signal: ctx.signal });
  if (probe.verdict !== 'ready') return false;
  const result = await classifyRun(deps, ctx, { record: input.record, probe, basis: { kind: 'live_clean' },
    requestId: `a2-run21:${run.ref.runId}:${String(run.revision)}` });
  return result.status === 'reconciled';
}

async function classifyRun(
  deps: RunReconcileClassifierDependencies, ctx: CoreCallContext,
  input: { record: TaskExecutionRecord; probe: SessionMappingProbe; basis: RunReconciliationBasisV1; requestId: string;
    takeover?: HostTakeoverProofV1 | null },
): Promise<RunReconcileReport> {
  const { record, probe, basis, requestId } = input;
  const run = record.run;
  const runRef = run.ref;
  const left = (row: string, reason: string): RunReconcileReport => ({ runRef, row, status: 'left', reason });
  const failed = (row: string, rejection: CoreRejection | string): RunReconcileReport =>
    ({ runRef, row, status: 'failed', reason: typeof rejection === 'string' ? rejection : `${rejection.code}: ${rejection.reason}` });
  // Every caller passes a Run the platform authorized: startup step 2 skips a
  // never-entered start, live ends always carry the V2 binding.
  const auth = run.executionAuthorization!;
  const unknownOutcome = run.status === 'ended' && run.outcome === 'outcome_unknown';
  const entering = run.status === 'starting' && auth.phase === 'entering';
  if (!entering && run.status !== 'running' && !unknownOutcome) {
    return left('W-01..W-04', 'a Run that never began is re-driven by the Workflow with the same claim');
  }
  // In process only late evidence is booked (RUN-21); every other end needs the takeover proof.
  if (basis.kind === 'live_clean' && !unknownOutcome) return left('K', 'only late evidence of an unknown end is booked in process');
  const kernel = auth.kernel;
  if (kernel === null) return left('W-01..W-04', 'the Run has no begin Kernel identity');
  if (probe.verdict === 'host_config' || probe.verdict === 'transient' || probe.verdict === 'cancelled') {
    return left('W-07', `a ${probe.verdict} probe proves nothing: ${probe.reason}`);
  }
  const expected = [{ ref: runRef, revision: run.revision }];
  const submit = async (row: string, result: ReconcileRunInput['result'], activity?: RunActivityFactsV1): Promise<RunReconcileReport> => {
    const written = await deps.reconcile.reconcileRun(ctx, { input: { runRef, basis, probe: probe.verdict, result,
      ...(activity === undefined ? {} : { activity }) },
      meta: { requestId, expected } });
    const report: RunReconcileReport = written.status === 'committed'
      ? { runRef, row, status: 'reconciled', reason: result.kind } : failed(row, written);
    if (written.status === 'committed' && result.kind === 'unknown' && result.autoCleanup !== undefined) {
      // L25: the report reads the COMMITTED Run's observation, so a candidate
      // the WorkGraph blocked reports WorkGraph's first guard, not `applied`.
      const observation = written.value.reconciliation?.observation;
      if (observation?.kind === 'takeover_unresolved') {
        report.row = 'W-26';
        report.reason = 'takeover_unresolved';
        report.autoCleanup = { applied: true };
      } else if (observation?.kind === 'unresolved' && observation.autoCleanupBlockedBy !== undefined) {
        report.autoCleanup = { applied: false, blockedBy: observation.autoCleanupBlockedBy };
      } else {
        report.autoCleanup = 'blockedBy' in result.autoCleanup
          ? { applied: false, blockedBy: result.autoCleanup.blockedBy } : { applied: true };
      }
    }
    return report;
  };
  if (probe.verdict === 'missing' || probe.verdict === 'damaged') {
    // W-06, W-14: an unreadable Kernel is not proof of not entering (SD-3).
    if (unknownOutcome) return left('W-15', 'the Kernel is unreadable; the unknown end waits for an attestation');
    return submit(entering ? 'W-06' : 'W-14', { kind: 'unknown', cause: 'kernel_unreadable', unresolvedToolCallIds: [],
      observedThroughPosition: null, turn: null }, unknownFacts('kernel_unreadable', probe.reason));
  }
  // The Turn starts after the Run's locator start, or for an Entering Run after the last completed boundary.
  const locator = run.executionHistory;
  let afterPosition = 0;
  if (locator !== undefined) afterPosition = Math.max(0, locator.startPosition - 1);
  else {
    const boundary = await deps.owner.completedBoundary({ session: record.session, signal: ctx.signal });
    if (boundary.status !== 'resolved') return failed('W-05..W-08', boundary);
    afterPosition = boundary.position;
  }
  const read = await readTurnWindow(deps.owner, record.session, afterPosition, ctx.signal);
  if (!read.ok) return failed('W-08..W-20', read.reason);
  const start = turnStartOf(read.decoded, kernel);
  if (start === null) {
    if (entering) return submit('W-05', { kind: 'not_entered', kernel: { ...kernel } });     // RUN-16
    // W-15: an unknown end after RUN-20(ii) whose Kernel still shows no Turn has no new fact.
    if (unknownOutcome) return left('W-15', 'no Turn of the fixed identity in the Kernel; the unknown end waits for an attestation');
    return failed('W-09..W-20', 'the fixed turn.started record is not in the Run history window');
  }
  let state: RunState | null;
  try {
    state = reduceTurnFromStart(read.decoded, kernel);
    if (state === null) return failed('W-09..W-20', 'the Turn could not be reduced from its start');
    const invariants = validateRunStateInvariants(state);
    if (!invariants.ok) return failed('W-09..W-20', `the reduced Turn violates Kernel invariants: ${invariants.message}`);
  } catch (error) {
    return failed('W-09..W-20', `reducing the Turn failed: ${messageOf(error)}`);
  }
  // L1: `run.interrupted` is a Kernel closure the platform already did, never a
  // platform Run terminal. A not-yet-ended platform Run that meets it is only
  // reported (`left`), never booked; the L4 authorization makes this unreachable.
  if (state.status === 'interrupted') {
    return left('K', 'kernel_closed_without_platform_end: the platform Run is not ended but its Kernel Turn is closed as interrupted; a person checks it');
  }
  const inputsConfirmed = await confirmMailboxInputs(deps.messages, ctx, runRef, kernel, read.decoded);
  const lastPosition = read.decoded.at(-1)?.position ?? read.through;
  const turnRecords = read.decoded.filter(item => item.position >= start.position);
  const turnLast = turnRecords.at(-1)?.position ?? start.position;
  const enteredHistory: ObservedExecutionHistory = { kernel: { ...kernel }, startPosition: start.position,
    observedThroughPosition: turnLast, endPosition: null };
  const turn: ReconcileTurnV1 = {
    terminal: TERMINAL_STATUSES.includes(state.status),
    inFlightToolCallIds: unresolvedToolCallIds(state),
    lastPosition,
    kernelPaused: state.status === 'paused',
    entered: run.startedAt === null
      ? { enteredAt: start.record.recordedAt, kernelSource: { ...kernel, position: start.position }, history: enteredHistory } : null,
    acceptedSteers: acceptedSteersOf(read.decoded, kernel, run),
    inputsConfirmed,
  };
  const unresolved = (!turnIsComplete(state) && !(state.toolBatch?.calls.some(call => call.status === 'abandoned') ?? false))
    || transcriptHasOutcomeUnknown(state.transcript) || turn.inFlightToolCallIds.length > 0;
  // L6: the reconcile already read the window, so the tally uses the decoded
  // records directly; a terminal booked through `recordRunResult` is
  // `end_position`, a `reconcileRun` result is `reconcile_observation`.
  const activityFor = (bound: 'end_position' | 'reconcile_observation'): RunActivityFactsV1 =>
    tallyTurnActivity(read.decoded, kernel, { fromPosition: start.position, throughPosition: turnLast, bound });
  if (turn.terminal) {
    if (unresolved) {
      if (unknownOutcome) return left('W-15', 'the Kernel terminal still has a tool call without a determined result');
      // RUN-20(i) names the calls without a result; a terminal Turn left incomplete without one names
      // nothing the machine can record, so it is left as recorded and reported (never booked on a guess).
      if (turn.inFlightToolCallIds.length === 0) {
        return left('W-13', 'the Kernel terminal Turn is incomplete without a tool call to name; a person checks it');
      }
      return submit('W-13', { kind: 'unknown', cause: 'tool_calls_unresolved', unresolvedToolCallIds: turn.inFlightToolCallIds,
        observedThroughPosition: turnLast, turn }, activityFor('reconcile_observation'));
    }
    // §10.3: a Kernel terminal is booked only after every accepted input is confirmed against its source.
    if (!inputsConfirmed) {
      return left(unknownOutcome ? 'W-15' : 'W-09', 'an accepted input is not confirmed against its source; the next start reads it again');
    }
    let continuation: RunContinuationV1 | null = null;
    if (state.status === 'yielded') {
      continuation = await rebuildContinuation(deps, ctx, record, state);
      if (continuation === null) {
        if (unknownOutcome) return left('W-15', 'the yielded continuation cannot be rebuilt');
        return submit('W-10', { kind: 'unknown', cause: 'continuation_unrebuildable', unresolvedToolCallIds: [],
          observedThroughPosition: turnLast, turn }, activityFor('reconcile_observation'));
      }
    }
    // RUN-17/18 (or RUN-21 for an unknown end): the Kernel terminal is booked as the observer books it.
    const endPosition = turnLast;
    const boundary = read.entries.find(entry => entry.source.position === endPosition);
    if (boundary === undefined) return failed('W-09', 'the terminal history entry has no canonical cursor');
    const event = terminalEventOf(state, runRef, run.lastEventSeq + 1, deps.newId(), deps.now());
    if (event === null) return failed('W-09', 'the Kernel terminal has no Runtime event');
    const history: ObservedExecutionHistory = { kernel: { ...kernel },
      startPosition: locator?.startPosition ?? start.position, observedThroughPosition: endPosition, endPosition };
    const written: WriteResult<RunSnapshot> = await deps.entry.recordRunResult(ctx, {
      input: { claim: record.outbox.claim, entry: { consumerId: auth.consumerId, entryGeneration: auth.generation }, event,
        kernelSource: { ...kernel, position: endPosition },
        completedHistoryBoundary: { source: { ...kernel, position: endPosition }, cursor: boundary.cursor },
        history, ...(continuation === null ? {} : { continuation }), basis, unresolvedToolCallIds: [],
        ...(run.startedAt === null ? { enteredAt: start.record.recordedAt } : {}), acceptedSteers: turn.acceptedSteers,
        inputsConfirmed, activity: activityFor('end_position') },
      meta: { requestId, expected },
    });
    const row = unknownOutcome ? 'W-15' : state.status === 'yielded' ? 'W-10' : 'W-09';
    return written.status === 'committed' ? { runRef, row, status: 'reconciled', reason: `terminal ${state.status}` }
      : failed(row, written);
  }
  if (unknownOutcome) return left('W-15', 'no new Kernel terminal; the unknown end waits for new evidence or an attestation');
  if (turn.inFlightToolCallIds.length > 0) {
    const autoCleanup = await autoCleanupOutcome(deps, ctx, {
      record, kernel, probe, takeover: input.takeover ?? null, decoded: read.decoded, state,
      turn, startPosition: start.position, turnLast,
    });
    return submit('W-13', { kind: 'unknown', cause: 'tool_calls_unresolved', unresolvedToolCallIds: turn.inFlightToolCallIds,
      observedThroughPosition: turnLast, turn, ...(autoCleanup === undefined ? {} : { autoCleanup }) },
      activityFor('reconcile_observation'));
  }
  // A queued cancel with a clean Turn is RUN-23 (W-12); every other clean Turn is RUN-19/24 by the pointer (W-11, W-20).
  const control = run.controlState;
  if (control !== undefined && control.desiredState === 'cancelled') {
    const intent = await deps.controls.readControl(ctx, control.intentRef);
    if (intent.status !== 'ready') return failed('W-12', 'the queued cancel could not be read');
    if (intent.value.status === 'queued') {
      // CTL-10: at a restart the pause in effect before the cancel is not a persisted fact (the Run points
      // to the cancel, and the Kernel `run.paused` names no intent), so `pausedBy` is null.
      return submit('W-12', { kind: 'paused_stop', cancelIntentRef: { ...control.intentRef }, pausedBy: null, turn },
        activityFor('reconcile_observation'));
    }
  }
  return submit(control?.desiredState === 'paused' ? 'W-20' : 'W-11', { kind: 'interrupted_clean', turn },
    activityFor('reconcile_observation'));
}

/**
 * K3 (L25, KR1): the Runtime-side guards of RUN-25, in the spec order G10, G1,
 * G3, G5, G6, G11, G8. The first failing guard returns `{ blockedBy }`; the
 * candidate carries the proof, the closure head, the capture and the draft.
 * `review_round` is checked first and stops before any lookup or capture (D1).
 */
async function autoCleanupOutcome(
  deps: RunReconcileClassifierDependencies, ctx: CoreCallContext,
  input: {
    record: TaskExecutionRecord; kernel: KernelExecutionBinding; probe: SessionMappingProbe;
    takeover: HostTakeoverProofV1 | null; decoded: readonly DecodedKernelRecord[]; state: RunState;
    turn: ReconcileTurnV1; startPosition: number; turnLast: number;
  },
): Promise<AutoCleanupCandidateV1 | { blockedBy: string } | undefined> {
  const run = input.record.run;
  if (run.purpose !== undefined) return { blockedBy: 'review_round' };                       // G10
  const takeover = input.takeover;
  if (takeover === null || takeover === undefined || takeover.kind === 'memory_store') {
    return { blockedBy: 'no_takeover_proof' };                                                // G1
  }
  const calls = unresolvedCallFactsOf(input.decoded, input.state, input.turn.inFlightToolCallIds, input.kernel,
    input.startPosition);
  if (!calls.every(call => containedByHostStop(call.toolName))) return { blockedBy: 'uncontained_tool' };  // G3
  if (input.turn.inputsConfirmed !== true) return { blockedBy: 'inputs_unconfirmed' };        // G5
  if (deps.turnClosureSupport === undefined) return { blockedBy: 'closure_unsupported' };     // G6
  const closure = await deps.turnClosureSupport(ctx, { sessionRef: input.record.session.ref });
  if (closure.status !== 'supported') return { blockedBy: 'closure_unsupported' };
  const head = input.probe.activeRunId;
  if (head === null || !sameRef(head, input.kernel.runId)) return { blockedBy: 'head_mismatch' };
  const draftDeps = { ...(deps.lookupToolCommit === undefined ? {} : { lookupToolCommit: deps.lookupToolCommit }),
    ...(deps.captureWorkspace === undefined ? {} : { captureWorkspace: deps.captureWorkspace }) };
  const inventoryInput = { record: input.record, kernel: input.kernel, turnFound: true, kernelReadable: true,
    kernelUnreadableAtStop: false, unresolved: calls };
  // L25/G11: the PURE inventory check comes first; a Turn that fails it does no
  // capture (so no capture Artifact) and no owner lookup.
  if (unknownCallInventoryProblem(inventoryInput) !== null) return { blockedBy: 'inventory_incomplete' };
  // L25/G8: capture once, then reuse it for the owner lookups below.
  const workspace = await captureUnknownCallWorkspace(draftDeps, ctx, run);
  if (workspace.status !== 'captured') return { blockedBy: `workspace_${workspace.reason}` };
  if (!workspace.runBaselineKnown) return { blockedBy: 'no_baseline' };
  const draft = await readUnknownCallReviewDraft(draftDeps, ctx, { ...inventoryInput, capturedWorkspace: workspace });
  return { proof: takeover, closure: { status: 'supported', headActiveRunId: head },
    workspace, unresolvedCalls: calls.map(call => ({ callId: call.callId, toolName: call.toolName })), draft };
}

/** The unresolved calls with the names, arguments and positions the Kernel recorded (L4/L7). */
function unresolvedCallFactsOf(
  decoded: readonly DecodedKernelRecord[], state: RunState, unresolvedIds: readonly string[],
  kernel: KernelExecutionBinding, fallbackPosition: number,
): UnresolvedCallFactV1[] {
  const declared = new Map<string, { name: string; arguments: unknown }>();
  for (const entry of state.transcript) {
    if (entry.kind !== 'assistant_message') continue;
    for (const call of entry.toolCalls) declared.set(call.callId, { name: call.name, arguments: call.arguments });
  }
  const positions = new Map<string, number>();
  const started = new Map<string, { position: number; at: string }>();
  for (const item of decoded) {
    if (item.record.recordType !== 'agent.event') continue;
    const event = item.record.payload.event;
    if (event.meta.runId !== kernel.runId || event.meta.turnId !== kernel.turnId) continue;
    if (event.type === 'assistant.message_completed') {
      for (const call of event.payload.toolCalls) if (!positions.has(call.callId)) positions.set(call.callId, item.position);
    }
    if (event.type === 'tool.started') {
      const callId = event.payload.call.callId;
      if (!started.has(callId)) started.set(callId, { position: item.position, at: item.record.recordedAt });
    }
  }
  return unresolvedIds.map((callId) => {
    const call = declared.get(callId);
    const start = started.get(callId);
    return { callId, toolName: call?.name ?? '', arguments: call?.arguments ?? {},
      declaredPosition: positions.get(callId) ?? fallbackPosition,
      startedPosition: start?.position ?? null, startedAt: start?.at ?? null };
  });
}

// -------------------------------------------------------------------------- //
// Step 5: queued intents without another end (CTL-08(d)/(e))                 //
// -------------------------------------------------------------------------- //

/**
 * §12.1 step 5 for one ended Run that carries a queued intent and no other
 * reconcile write: an unknown end (CTL-08(d)) or an ended Run whose acks a
 * crash lost (CTL-08(e)). For an
 * ended, entered Run with a queued steer the Kernel Turn is read, so a steer
 * the Kernel accepted is applied `steered` (as (b)), never superseded; when
 * that Kernel read is not possible the Run is left as recorded.
 */
export async function reconcileRunControlsAtStartup(
  deps: Pick<RunReconcileClassifierDependencies, 'owner' | 'reconcile'>, ctx: CoreCallContext,
  input: { record: TaskExecutionRecord; hostInstanceId: string; queuedSteers: boolean },
): Promise<RunReconcileReport> {
  const { record, hostInstanceId } = input;
  const run = record.run;
  const runRef = run.ref;
  const row = run.outcome === 'outcome_unknown' ? 'W-19' : 'W-16';
  let acceptedSteers: AcceptedSteerV1[] = [];
  const kernel = isV2Kernel(run);
  const locator = run.executionHistory;
  if (run.status === 'ended' && run.outcome !== 'outcome_unknown' && input.queuedSteers && kernel !== null && locator !== undefined) {
    const read = await readTurnWindow(deps.owner, record.session, Math.max(0, locator.startPosition - 1), ctx.signal);
    if (!read.ok) return { runRef, row, status: 'left', reason: `the queued steers wait: the Kernel Turn is not readable (${read.reason})` };
    acceptedSteers = acceptedSteersOf(read.decoded, kernel, run);
  }
  const written = await deps.reconcile.reconcileRunControls(ctx, {
    input: { runRef, hostInstanceId, acceptedSteers },
    meta: { requestId: `a2-reconcile-controls:${hostInstanceId}:${runRef.runId}:${String(run.revision)}`,
      expected: [{ ref: runRef, revision: run.revision }] } });
  if (written.status === 'committed') return { runRef, row, status: 'reconciled', reason: 'queued intents settled' };
  // The owner's lease guard is still the correct check; this call never submits a
  // foreign hostInstanceId, so any refusal here is a definite failure.
  return { runRef, row, status: 'failed', reason: `${written.code}: ${written.reason}` };
}

// -------------------------------------------------------------------------- //
// QueryRun (§12.3 Q-01..Q-07, QRR-01..05)                                     //
// -------------------------------------------------------------------------- //

export type QueryReconcileClassifierDependencies = {
  owner: SessionHistoryCursorOwner;
  messages?: Pick<SessionMailboxPort, 'recordInputAccepted'>;
  queries: Pick<QueryExecutionPort, 'reconcileQueryRun'>;
  /** QRR-03: a mappable Kernel terminal is booked by the Query observer with its Answer (see the file note). */
  observeQuery(ctx: CoreCallContext, request: { queryRunRef: QueryRunRef }): Promise<ReadResult<QueryExecutionRecord>>;
};

export type QueryReconcileReport = { queryRunRef: QueryRunRef; row: string; status: 'reconciled' | 'left' | 'failed'; reason: string };

const QUERY_TERMINAL: readonly string[] = ['completed', 'failed', 'cancelled', 'limit_exceeded'];

/**
 * Classify and settle one unsettled QueryRun. A mappable Kernel terminal
 * (Q-03) is booked through the Query observer, which reads the same history,
 * extracts the Answer and settles through QRR-03; the Turn-less, clean,
 * unknown and unreadable cases go through `reconcileQueryRun` (QRR-01, 02,
 * 04, 05).
 */
export async function reconcileQueryRunAtStartup(
  deps: QueryReconcileClassifierDependencies, ctx: CoreCallContext,
  input: { record: QueryExecutionRecord; hostInstanceId: string; probe: SessionMappingProbe },
): Promise<QueryReconcileReport> {
  const { record, hostInstanceId, probe } = input;
  const queryRunRef = record.run.ref;
  const state = record.run.run.executionState;
  const left = (row: string, reason: string): QueryReconcileReport => ({ queryRunRef, row, status: 'left', reason });
  if (state === undefined || state.phase === 'settled') return left('Q-none', 'the QueryRun has no unsettled execution state');
  const submit = async (row: string, result: QueryReconcileInput['result'], inputsConfirmed: boolean | 'kernel_unreadable',
    activity?: RunActivityFactsV1): Promise<QueryReconcileReport> => {
    const reconcile = deps.queries.reconcileQueryRun;
    if (reconcile === undefined) return { queryRunRef, row, status: 'failed', reason: 'the Query reconcile writer is not configured' };
    const written = await reconcile(ctx, { input: { queryRunRef, hostInstanceId, probe: probe.verdict, inputsConfirmed, result,
      ...(activity === undefined ? {} : { activity }) },
      meta: { requestId: `a2-query-reconcile:${hostInstanceId}:${queryRunRef.runId}:${String(record.run.revision)}`,
        expected: [{ ref: queryRunRef, revision: record.run.revision }] } });
    if (written.status !== 'committed') return { queryRunRef, row, status: 'failed', reason: `${written.code}: ${written.reason}` };
    // QRR-05: the report names the cause the QueryRun records (the attestation panel reads it there).
    const unknown = written.value.run.run.executionState?.unknown;
    return { queryRunRef, row, status: 'reconciled', reason: result.kind === 'unknown' && unknown !== undefined
      ? `unknown (${unknown.kind === 'unresolved_tools' ? `tool calls without a result: ${unknown.toolCallIds.join(', ')}`
        : `Kernel ${unknown.verdict}`})` : result.kind };
  };
  if (state.phase === 'claimed' || state.phase === 'prepared') return submit('Q-01', { kind: 'not_entered' }, true);
  if (probe.verdict === 'host_config' || probe.verdict === 'transient' || probe.verdict === 'cancelled') {
    return left('Q-07', `a ${probe.verdict} probe proves nothing: ${probe.reason}`);
  }
  const entry = state.entry;
  if (entry === null) return left('Q-none', 'the QueryRun has no fixed entry');
  if (probe.verdict === 'missing' || probe.verdict === 'damaged') {
    if (state.phase === 'unknown') return left('Q-06', 'the Kernel is unreadable; the unknown QueryRun waits for an attestation');
    return submit('Q-05', { kind: 'unknown', unresolvedToolCallIds: [], history: null }, 'kernel_unreadable');
  }
  const afterPosition = state.history === null ? Math.max(0, (await deps.owner.completedBoundary({ session: record.session,
    signal: ctx.signal }).then(boundary => boundary.status === 'resolved' ? boundary.position : 0))) : Math.max(0, state.history.startPosition - 1);
  const read = await readTurnWindow(deps.owner, record.session, afterPosition, ctx.signal);
  if (!read.ok) return { queryRunRef, row: 'Q-02..Q-05', status: 'failed', reason: read.reason };
  const start = turnStartOf(read.decoded, entry.kernel);
  if (start === null) {
    if (state.phase === 'entering') return submit('Q-02', { kind: 'not_entered' }, true);
    return { queryRunRef, row: 'Q-03..Q-05', status: 'failed', reason: 'the fixed Query turn.started record is not in the history' };
  }
  const turnState = reduceTurnFromStart(read.decoded, entry.kernel);
  if (turnState === null) return { queryRunRef, row: 'Q-03..Q-05', status: 'failed', reason: 'the Query Turn could not be reduced' };
  const inFlight = unresolvedToolCallIds(turnState);
  const turnLast = read.decoded.at(-1)?.position ?? start.position;
  const history: RunExecutionHistoryV1 = { schemaVersion: 1, sessionRef: { ...state.sessionRef }, kernel: { ...entry.kernel },
    startPosition: start.position, observedThroughPosition: turnLast, endPosition: null };
  if (inFlight.length > 0) {
    if (state.phase === 'unknown') return left('Q-06', 'a tool call still has no result');
    return submit('Q-05', { kind: 'unknown', unresolvedToolCallIds: inFlight, history }, true);
  }
  if (QUERY_TERMINAL.includes(turnState.status)) {
    const observed = await deps.observeQuery(ctx, { queryRunRef });
    if (observed.status !== 'ready') {
      return { queryRunRef, row: 'Q-03', status: 'failed', reason: observed.status === 'rejected' ? observed.reason : observed.status };
    }
    const settled = observed.value.run.run.executionState?.phase === 'settled';
    return { queryRunRef, row: 'Q-03', status: settled ? 'reconciled' : 'left',
      reason: settled ? `terminal ${turnState.status}` : 'the Query observer did not settle the terminal' };
  }
  if (state.phase === 'unknown') return left('Q-06', 'no new Kernel terminal; the unknown QueryRun waits for an attestation');
  const inputsConfirmed = await confirmMailboxInputs(deps.messages, ctx, queryRunRef, entry.kernel, read.decoded);
  const kernelStatus = turnState.status === 'paused' || turnState.status === 'yielded' || turnState.status === 'created'
    ? turnState.status : 'running';
  // L16: QRR-04 records the tally of the window this reconcile already read.
  const activity = tallyTurnActivity(read.decoded, entry.kernel, { fromPosition: start.position,
    throughPosition: read.decoded.at(-1)?.position ?? start.position, bound: 'reconcile_observation' });
  return submit('Q-04', { kind: 'interrupted_clean', kernelStatus, history }, inputsConfirmed, activity);
}

// -------------------------------------------------------------------------- //
// The Host entry of an attestation (RUN-22, QRR-06; contract (d), L-1)        //
// -------------------------------------------------------------------------- //

/**
 * The Kernel facts an attestation carries, read by the Host entry before it
 * submits (contract (d)): whether the attested Turn is left without a Kernel
 * terminal, and whether every accepted input is confirmed. Only a Kernel the
 * probe proves unreadable (`missing`/`damaged`, SES-07/10, SD-3) is taken as
 * an open Turn with `inputsConfirmed: null`. A probe or read that proves
 * nothing (`host_config`, `transient`, `cancelled`, a failed window read of a
 * readable Kernel) refuses the attestation `unavailable`, so it writes nothing
 * and is retried (SD-2): it never retires a Session on a guess.
 */
export async function readAttestationFacts(
  deps: Pick<RunReconcileClassifierDependencies, 'owner' | 'messages'>, ctx: CoreCallContext,
  input: { session: SessionRecord; executionRef: RunRef | QueryRunRef; kernel: KernelExecutionBinding; startPosition: number | null },
): Promise<{ ok: true; kernelTurnOpen: boolean; inputsConfirmed: boolean | null; activity: RunActivityFactsV1 }
  | { ok: false; rejection: CoreRejection }> {
  const probe = await deps.owner.probe({ session: input.session, signal: ctx.signal });
  if (probe.verdict === 'missing' || probe.verdict === 'damaged') {
    return { ok: true, kernelTurnOpen: true, inputsConfirmed: null, activity: unknownFacts('kernel_unreadable', probe.reason) };
  }
  if (probe.verdict !== 'ready') {
    return { ok: false, rejection: { status: 'rejected', code: 'unavailable',
      reason: `the Kernel could not be read (${probe.verdict}: ${probe.reason}); retry the attestation` } };
  }
  const afterPosition = input.startPosition === null ? 0 : Math.max(0, input.startPosition - 1);
  const read = await readTurnWindow(deps.owner, input.session, afterPosition, ctx.signal);
  if (!read.ok) {
    return { ok: false, rejection: { status: 'rejected', code: 'unavailable',
      reason: `the Kernel history could not be read (${read.reason}); retry the attestation` } };
  }
  const state = reduceTurnFromStart(read.decoded, input.kernel);
  const inputsConfirmed = await confirmMailboxInputs(deps.messages, ctx, input.executionRef, input.kernel, read.decoded);
  // L16: the attestation records the tally of the Turn it read; no Turn of the
  // fixed identity is an explicit `unknown`, never zero.
  const turnStart = turnStartOf(read.decoded, input.kernel);
  const fromPosition = turnStart?.position ?? input.startPosition ?? 0;
  const activity = turnStart === null
    ? unknownFacts('turn_not_found', 'the attested QueryRun has no Kernel Turn')
    : tallyTurnActivity(read.decoded, input.kernel, { fromPosition,
      throughPosition: read.decoded.at(-1)?.position ?? fromPosition, bound: 'reconcile_observation' });
  // No Turn at all leaves nothing open; a Turn without a Kernel terminal is open.
  if (state === null) return { ok: true, kernelTurnOpen: false, inputsConfirmed, activity };
  return { ok: true, kernelTurnOpen: !TERMINAL_STATUSES.includes(state.status), inputsConfirmed, activity };
}

// -------------------------------------------------------------------------- //
// RUN-23 in process (§12.2 "进程内的同类收尾", RD-7, CTL-10)                  //
// -------------------------------------------------------------------------- //

/**
 * A cancel delivered to a Run whose live handle already exited at a safe
 * point (the Kernel Turn is `paused`, every owned resource closed): the
 * platform stops it on that exit proof (`live_clean`) instead of leaving the
 * cancel queued. The Turn must be paused with no tool call in flight and every
 * accepted input confirmed; anything else leaves the cancel queued.
 * `pausedBy` is the pause the live handle consumed (CTL-10).
 */
export async function stopPausedRunInProcess(
  deps: Pick<RunReconcileClassifierDependencies, 'owner' | 'messages' | 'reconcile'>, ctx: CoreCallContext,
  input: { record: TaskExecutionRecord; cancelIntentRef: ControlIntentRef; pausedBy: ControlIntentRef | null },
): Promise<boolean> {
  const { record } = input;
  const run = record.run;
  const auth = run.executionAuthorization;
  const locator = run.executionHistory;
  if (run.status !== 'running' || auth === undefined
    || auth.kernel === null || locator === undefined) {
    return false;
  }
  const kernel = auth.kernel;
  const read = await readTurnWindow(deps.owner, record.session, Math.max(0, locator.startPosition - 1), ctx.signal);
  if (!read.ok) return false;
  const state = reduceTurnFromStart(read.decoded, kernel);
  if (state === null || state.status !== 'paused') return false;
  const inFlight = unresolvedToolCallIds(state);
  if (inFlight.length > 0) return false;
  const inputsConfirmed = await confirmMailboxInputs(deps.messages, ctx, run.ref, kernel, read.decoded);
  if (!inputsConfirmed) return false;
  const turn: ReconcileTurnV1 = { terminal: false, inFlightToolCallIds: [], lastPosition: read.decoded.at(-1)?.position ?? null,
    kernelPaused: true, entered: null, acceptedSteers: acceptedSteersOf(read.decoded, kernel, run), inputsConfirmed };
  const activity = tallyTurnActivity(read.decoded, kernel, { fromPosition: locator.startPosition,
    throughPosition: read.decoded.at(-1)?.position ?? locator.startPosition, bound: 'reconcile_observation' });
  const written = await deps.reconcile.reconcileRun(ctx, { input: { runRef: run.ref, basis: { kind: 'live_clean' }, probe: 'ready',
    result: { kind: 'paused_stop', cancelIntentRef: { ...input.cancelIntentRef }, pausedBy: input.pausedBy, turn }, activity },
  meta: { requestId: `a2-run23:${run.ref.runId}:${input.cancelIntentRef.intentId}`, expected: [{ ref: run.ref, revision: run.revision }] } });
  return written.status === 'committed';
}

// -------------------------------------------------------------------------- //
// The Host attestation entry's review draft (K3 L8, KR3; Q3)                   //
// -------------------------------------------------------------------------- //

/**
 * K3 (L8, KR3; Q3): the Host attestation entry reads the Kernel facts AND the
 * untruncated review draft in one pass. It replaces `readAttestationFacts` for
 * a Work Run: the same probe and window read, plus the unresolved calls the
 * draft needs. The classifier's optional lookup and capture dependencies are
 * reused; absent, the draft reports the Q2/Q3 defaults (`lookup_not_wired`,
 * `not_configured`).
 */
export async function readReviewDraftAtEntry(
  deps: Pick<RunReconcileClassifierDependencies, 'owner' | 'messages' | 'lookupToolCommit' | 'captureWorkspace'>,
  ctx: CoreCallContext,
  input: { record: TaskExecutionRecord; kernel: KernelExecutionBinding; startPosition: number | null },
): Promise<{ ok: true; kernelTurnOpen: boolean; inputsConfirmed: boolean | null; draft: UnknownCallReviewDraftV1 }
  | { ok: false; rejection: CoreRejection }> {
  const observation = input.record.run.reconciliation?.observation;
  const unreadableAtStop = observation !== undefined && observation.kind === 'unresolved'
    && observation.reason === 'kernel_unreadable';
  const draftDeps = { ...(deps.lookupToolCommit === undefined ? {} : { lookupToolCommit: deps.lookupToolCommit }),
    ...(deps.captureWorkspace === undefined ? {} : { captureWorkspace: deps.captureWorkspace }) };
  const base = { record: input.record, kernel: input.kernel, turnFound: true, kernelReadable: true,
    kernelUnreadableAtStop: unreadableAtStop } as const;
  const probe = await deps.owner.probe({ session: input.record.session, signal: ctx.signal });
  if (probe.verdict === 'missing' || probe.verdict === 'damaged') {
    return { ok: true, kernelTurnOpen: true, inputsConfirmed: null,
      draft: await readUnknownCallReviewDraft(draftDeps, ctx, { ...base, turnFound: false, kernelReadable: false,
        unresolved: [] }) };
  }
  if (probe.verdict !== 'ready') {
    return { ok: false, rejection: { status: 'rejected', code: 'unavailable',
      reason: `the Kernel could not be read (${probe.verdict}: ${probe.reason}); retry the attestation` } };
  }
  const afterPosition = input.startPosition === null ? 0 : Math.max(0, input.startPosition - 1);
  const read = await readTurnWindow(deps.owner, input.record.session, afterPosition, ctx.signal);
  if (!read.ok) {
    return { ok: false, rejection: { status: 'rejected', code: 'unavailable',
      reason: `the Kernel history could not be read (${read.reason}); retry the attestation` } };
  }
  const state = reduceTurnFromStart(read.decoded, input.kernel);
  const inputsConfirmed = await confirmMailboxInputs(deps.messages, ctx, input.record.run.ref, input.kernel, read.decoded);
  if (state === null) {
    return { ok: true, kernelTurnOpen: false, inputsConfirmed,
      draft: await readUnknownCallReviewDraft(draftDeps, ctx, { ...base, turnFound: false, unresolved: [] }) };
  }
  const unresolvedIds = unresolvedToolCallIds(state);
  const startPosition = read.decoded.find(item => item.record.recordType === 'turn.started')?.position ?? afterPosition + 1;
  const calls = unresolvedCallFactsOf(read.decoded, state, unresolvedIds, input.kernel, startPosition);
  return { ok: true, kernelTurnOpen: !TERMINAL_STATUSES.includes(state.status), inputsConfirmed,
    draft: await readUnknownCallReviewDraft(draftDeps, ctx, { ...base, unresolved: calls }) };
}
