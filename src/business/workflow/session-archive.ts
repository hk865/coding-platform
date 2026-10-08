/**
 * Slice 1 §4.1: the Workflow's single Session archive composition entry.
 *
 * The sequence is exactly the eight durable steps of the spec, one sub-commit
 * per step, never undoing a committed step. The outer result type is declared
 * here; the owner seams come from `WorkflowDependencies`. No owner Store,
 * database or model loop lives here.
 */
import type { CommitCursor } from '../../contracts/command-event.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { ExecutionRef, SessionRef, VersionPin, WorkLinkTarget } from '../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type {
  ArchiveStepRefV1, RequestSessionArchiveInput, SessionArchiveRequestV1,
} from '../../contracts/core/session-archive.js';
import type { SessionRecord } from '../../contracts/core/session.js';
import type { RunRef, RunSnapshot } from '../../contracts/dispatch.js';
import type { QueryRunRef } from '../../contracts/query-job.js';
import type { ArchiveChangedFilesV1, ArchiveRequeueOriginV1, SessionAnomalyAnchorV1 } from '../../contracts/session-anomaly.js';
import type { SubmitControlInput } from '../../contracts/control-intent.js';
import type { TaskRequeueRef, TaskReworkRefusalSnapshotV1 } from '../../contracts/task-requeue.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../contracts/fingerprint.js';
import type { SessionMailboxPort } from '../../core/work-graph/model/communication-contracts.js';
import type { GraphWrite } from '../../core/work-graph/model/session-contracts.js';
import type { RequeueTaskInput } from '../../core/work-graph/model/claim-contracts.js';
import type { SessionFactsV1 } from '../../core/work-graph/model/session-facts-contracts.js';
import type { WorkflowDependencies } from './ports.js';

/** §4.1: the caller supplies the archive request without choosing the mode. */
export type ArchiveLineInput = Omit<RequestSessionArchiveInput, 'mode'>;

/** One already-committed internal archive step and its real commit cursor. */
export type ArchiveStepReceiptV1 = {
  step: ArchiveStepRefV1['step']; subjectKey: string; cursor: CommitCursor; replayed: boolean;
};

/**
 * §4.1: an outer `ready` only means the composed result is readable; it never
 * implies archived. `pendingOn` keeps the exact execution the composition is
 * still stopping, and `message` uses the frozen user-visible wording.
 */
export type ArchiveLineResultV1 = {
  state: 'archived' | 'pending' | 'partial';
  session: SessionRecord;
  receipts: ArchiveStepReceiptV1[];
  pendingOn: ExecutionRef | null;
  rejection: CoreRejection | null;
  requeueRefusals: TaskReworkRefusalSnapshotV1[];
  message: '已归档' | '归档中' | '归档中 · 停止中' | '处置已完成，归档没成功';
};

export interface SessionArchivePort {
  archiveLine(
    ctx: CoreCallContext,
    request: GraphWrite<ArchiveLineInput>,
  ): Promise<ReadResult<ArchiveLineResultV1>>;
  continueArchiveLine(
    ctx: CoreCallContext,
    input: { sessionRef: SessionRef; archiveRequestId: string },
  ): Promise<ReadResult<ArchiveLineResultV1>>;
}

/**
 * §4.1 S:765 / E9: only trusted Workflow callers (maintenance, consultation)
 * may select a non-operator `mode`. The public `archiveLine` refuses a present
 * `mode`; internal callers use this entry on the same composition.
 */
export interface InternalSessionArchivePort {
  archiveLineInternal(
    ctx: CoreCallContext,
    request: GraphWrite<RequestSessionArchiveInput>,
  ): Promise<ReadResult<ArchiveLineResultV1>>;
}

/** Reuses the optional `WorkflowDependencies` owner seams plus the wired router. */
export type SessionArchiveDependencies = Pick<WorkflowDependencies,
  | 'sessionLifecycle'
  | 'sessionFacts'
  | 'responsibilities'
  | 'sessionAnomalies'
  | 'controls'
  | 'attestUnknownRun'
  | 'attestUnknownQueryRun'
  | 'archivePolicy'
  | 'sessionDuty'
  | 'now'> & {
    sessions?: WorkflowDependencies['sessions'];
    plans?: WorkflowDependencies['plans'];
    claims?: WorkflowDependencies['claims'];
    executions?: WorkflowDependencies['executions'];
    runtime?: WorkflowDependencies['runtime'];
    messages?: SessionMailboxPort;
  };

type HostActor = { kind: 'human' | 'system'; id: string };
const ARCHIVE_MODES: readonly SessionArchiveRequestV1['mode'][] =
  ['operator', 'executor_idle', 'retired', 'answered_copy', 'handoff_complete'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function reject(code: CoreRejection['code'], reason: string, current?: VersionPin[]): CoreRejection {
  return { status: 'rejected', code, reason, ...(current === undefined ? {} : { current }) };
}
function readFailure(result: Exclude<ReadResult<unknown>, { status: 'ready' }>, what: string): CoreRejection {
  if (result.status === 'rejected') return result;
  if (result.status === 'not_found') return reject('not_found', `${what} does not exist`);
  return reject('incomplete', `${what} is not ready at the required watermark`);
}
function canonical(value: unknown): string | null {
  try { return canonicalJson(value as JsonValue); } catch { return null; }
}
function sameCanonical(left: unknown, right: unknown): boolean {
  const a = canonical(left);
  const b = canonical(right);
  return a !== null && a === b;
}
function contextForActor(ctx: CoreCallContext, actor: HostActor): CoreCallContext {
  const workspaceId = ctx.workspaceId;
  return {
    projectId: ctx.projectId,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    principal: { kind: 'host', actor: { ...actor } },
    materialReader: {
      kind: 'host', projectId: ctx.projectId,
      ...(workspaceId === undefined ? {} : { workspaceId }), actor: { ...actor },
    },
    signal: ctx.signal,
  };
}
/**
 * E8 / §3.2 refusal table: the CURRENT caller is validated before the durable
 * authority of `R.requestedBy` is adopted. Only a trusted Host/system principal
 * in the caller's own project may continue an archive; an Agent caller
 * (`work_run`/`query_run` or equivalent) is `forbidden` / `archive_host_only:`.
 */
function archiveCallerProblem(ctx: CoreCallContext, sessionRef: SessionRef): CoreRejection | null {
  const principal = (ctx as unknown as { principal?: unknown }).principal;
  if (!isRecord(principal) || principal['kind'] !== 'host') {
    return reject('forbidden', 'archive_host_only: only the trusted Host may continue a Session archive');
  }
  const actor = principal['actor'];
  if (!isRecord(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return reject('forbidden', 'archive_host_only: the archive continuation needs a trusted Host actor');
  }
  if (sessionRef.projectId !== ctx.projectId) {
    return reject('forbidden', 'archive_scope: the archive continuation is outside the caller project');
  }
  return null;
}

export function createSessionArchiveService(
  deps: SessionArchiveDependencies,
): SessionArchivePort & Partial<InternalSessionArchivePort> {
  function stepFor(sessionRef: SessionRef, R: SessionArchiveRequestV1,
    step: ArchiveStepRefV1['step'], subjectKey: string): ArchiveStepRefV1 {
    return { sessionRef, archiveRequestId: R.requestId, requestReceipt: R.receipt, step, subjectKey };
  }

  function pinFor(R: SessionArchiveRequestV1, ref: RunRef | QueryRunRef): VersionPin | null {
    return R.executionPins.find((pin) => sameCanonical(pin.ref, ref)) ?? null;
  }

  function cancelControlWrite(R: SessionArchiveRequestV1, runRef: RunRef): GraphWrite<SubmitControlInput> | null {
    const original = pinFor(R, runRef);
    if (original === null) return null;
    return {
      input: { runRef, kind: 'cancel', reason: R.reason },
      meta: {
        requestId: 's1-archive-control:' + sha256Hex(canonicalJson({ requestReceipt: R.receipt, runRef, action: 'cancel' } as unknown as JsonValue)),
        expected: [original],
      },
    };
  }

  async function readFacts(ctx: CoreCallContext, sessionRef: SessionRef): Promise<{ facts: SessionFactsV1 } | { rejection: CoreRejection }> {
    if (deps.sessionFacts === undefined) return { rejection: reject('unsupported', 'the Session facts reader is not installed') };
    const result = await deps.sessionFacts.readSessionFacts(ctx, sessionRef);
    if (result.status === 'ready') return { facts: result.value };
    return { rejection: readFailure(result, `the Session facts of ${sessionRef.sessionId}`) };
  }

  /**
   * E3: a missing execution seam yields `run: null`, but a FAILED execution
   * read is a real rejection. Returning `null` for a damaged/unreadable Run
   * would silently skip the anchor and the requeue and still finish the
   * archive; every caller turns the rejection into `ready/partial` with R kept.
   */
  async function readRun(ctx: CoreCallContext, runRef: RunRef):
  Promise<{ run: RunSnapshot | null } | { rejection: CoreRejection }> {
    if (deps.executions === undefined) return { run: null };
    const read = await deps.executions.readExecution(ctx, runRef);
    if (read.status === 'ready') return { run: read.value.run };
    return { rejection: readFailure(read, `the execution of Run ${runRef.runId}`) };
  }

  /**
   * §3.3 S:596 / §4.1 step 4: whether the exact QueryRun is formally unknown.
   * The Query reader is the Session-facts port; a bounded page walk cannot be
   * called "unknown" from a partial read (it returns null instead).
   */
  async function queryRunIsUnknown(ctx: CoreCallContext, sessionRef: SessionRef, queryRunRef: QueryRunRef): Promise<boolean | null> {
    if (deps.sessionFacts === undefined) return null;
    const wanted = canonical(queryRunRef);
    let cursor: string | undefined;
    for (let page = 0; page < 25; page += 1) {
      const found = await deps.sessionFacts.listSessionQueries(ctx, {
        sessionRef, page: cursor === undefined ? { limit: 100 } : { limit: 100, cursor },
      });
      if (found.status !== 'ready') return null;
      const item = found.value.items.find((candidate) => canonical(candidate.ref) === wanted);
      if (item !== undefined) return item.run.executionState?.phase === 'unknown';
      if (found.value.nextCursor === null) return null;
      cursor = found.value.nextCursor ?? undefined;
    }
    return null;
  }

  async function currentRecord(ctx: CoreCallContext, sessionRef: SessionRef, fallback: SessionRecord): Promise<SessionRecord> {
    const read = await readFacts(ctx, sessionRef);
    return 'facts' in read ? read.facts.session : fallback;
  }

  function ready(value: ArchiveLineResultV1): ReadResult<ArchiveLineResultV1> {
    return { status: 'ready', value };
  }
  function partial(session: SessionRecord, receipts: ArchiveStepReceiptV1[],
    rejection: CoreRejection, requeueRefusals: TaskReworkRefusalSnapshotV1[]): ReadResult<ArchiveLineResultV1> {
    return ready({ state: 'partial', session, receipts, pendingOn: null, rejection, requeueRefusals,
      message: '处置已完成，归档没成功' });
  }
  function pending(session: SessionRecord, receipts: ArchiveStepReceiptV1[], pendingOn: ExecutionRef,
    message: '归档中' | '归档中 · 停止中', requeueRefusals: TaskReworkRefusalSnapshotV1[]): ReadResult<ArchiveLineResultV1> {
    return ready({ state: 'pending', session, receipts, pendingOn, rejection: null, requeueRefusals, message });
  }

  async function unknownChangedFiles(ctx: CoreCallContext, runRef: RunRef): Promise<ArchiveChangedFilesV1> {
    const reader = deps.runtime?.readArchiveChangedFiles;
    if (reader !== undefined) {
      try {
        const read = await reader.call(deps.runtime, ctx, { runRef });
        if (read.status === 'ready') return read.value;
        if (read.status === 'rejected') {
          return { source: 'unknown', status: 'unavailable', confirmed: [], possible: [], omitted: 0,
            baseCommit: null, runBaselineKnown: false, reason: read.reason };
        }
      } catch { /* a failed Kernel/worktree read still writes the anchor as unknown */ }
    }
    return { source: 'unknown', status: 'unavailable', confirmed: [], possible: [], omitted: 0,
      baseCommit: null, runBaselineKnown: false, reason: 'changed files are unavailable for this archive anchor' };
  }

  async function taskTerminal(ctx: CoreCallContext, task: { projectId: string; goalId: string; taskId: string }): Promise<boolean | null> {
    if (deps.plans === undefined) return null;
    const goalRef = { aggregateType: 'Goal' as const, projectId: task.projectId, goalId: task.goalId };
    const graph = await deps.plans.queryTaskGraph(ctx, { goalRef });
    if (graph.status !== 'ready') return null;
    const row = graph.value.tasks.find((candidate) => candidate.ref.taskId === task.taskId);
    if (row === undefined) return null;
    if (row.effectivePhase === 'satisfied') return true;
    return row.definition.disposition === 'cancelled' || row.definition.disposition === 'superseded';
  }

  /**
   * §4.1 step 7: the exact Task projection a required requeue rests on. Unlike
   * the anchor's permissive `taskTerminal`, a missing/damaged read here is the
   * rejection the partial archive must report (E3); the covering TaskRequeue,
   * when one exists, drives the L-d reuse.
   */
  async function readTaskArchiveState(
    ctx: CoreCallContext, task: { projectId: string; goalId: string; taskId: string },
  ): Promise<{ terminal: boolean; requeueRef: TaskRequeueRef | null } | { rejection: CoreRejection }> {
    if (deps.plans === undefined) return { rejection: reject('unsupported', 'the Plan reader is not installed') };
    const goalRef = { aggregateType: 'Goal' as const, projectId: task.projectId, goalId: task.goalId };
    const graph = await deps.plans.queryTaskGraph(ctx, { goalRef });
    if (graph.status !== 'ready') return { rejection: readFailure(graph, `the Task graph of ${task.goalId}`) };
    const row = graph.value.tasks.find((candidate) => candidate.ref.taskId === task.taskId);
    if (row === undefined) return { rejection: reject('incomplete', `the Task ${task.taskId} is not in the current Task graph`) };
    const terminal = row.effectivePhase === 'satisfied'
      || row.definition.disposition === 'cancelled' || row.definition.disposition === 'superseded';
    return { terminal, requeueRef: row.requeueRef ?? null };
  }

  /**
   * §4.1 step 1 / §2.3 S:240 (E1): read the open responsible links and the
   * current Task projection at first acceptance. An unfinished responsibility
   * without a matching archive choice is refused `invalid/archive_disposal_required`
   * with zero commits; a Task already terminal may be ignored, and module links
   * never block an archive (§2.4).
   */
  async function firstAcceptanceResponsibilityProblem(
    ctx: CoreCallContext, sessionRef: SessionRef, input: RequestSessionArchiveInput,
  ): Promise<CoreRejection | null> {
    if (deps.sessions === undefined) return null;
    const card = await deps.sessions.readSession(ctx, sessionRef);
    if (card.status !== 'ready') return readFailure(card, `the Session card of ${sessionRef.sessionId}`);
    const chosen = new Set<string>();
    for (const choice of input.tasks) {
      const key = canonical(choice.target);
      if (key !== null) chosen.add(key);
    }
    for (const link of card.value.links) {
      if (link.ref.relation !== 'responsible' || link.until !== null) continue;
      const target = link.ref.target;
      if (target.kind === 'module') continue;
      const key = canonical(target);
      if (key !== null && chosen.has(key)) continue;
      if (target.kind === 'task' && await taskTerminal(ctx, target.ref) === true) continue;
      return reject('invalid', 'archive_disposal_required: an open responsibility has no archive choice');
    }
    return null;
  }

  /**
   * Drive the durable steps 3–8 from one committed request. `initial` carries
   * the receipts already obtained in this call (none on a fresh `archiveLine`,
   * none on a `continueArchiveLine`; each step's own owner replays its commit).
   */
  async function drive(ctx: CoreCallContext, sessionRef: SessionRef, R: SessionArchiveRequestV1,
    initial: ArchiveStepReceiptV1[]): Promise<ReadResult<ArchiveLineResultV1>> {
    const receipts: ArchiveStepReceiptV1[] = [...initial];
    const requeueRefusals: TaskReworkRefusalSnapshotV1[] = [];
    const actorCtx = contextForActor(ctx, R.requestedBy);
    const factsRead = await readFacts(actorCtx, sessionRef);
    if (!('facts' in factsRead)) return factsRead.rejection;
    let facts = factsRead.facts;
    const fallbackSession = facts.session;

    // ---- Step 3/4: stop the execution (Work) or observe the Query. ----------
    if (R.execution.kind === 'work') {
      const runRef = R.execution.runRef;
      const runRead = await readRun(actorCtx, runRef);
      if ('rejection' in runRead) return partial(fallbackSession, receipts, runRead.rejection, requeueRefusals);
      const runNow = runRead.run;
      const subjectKey = canonical(runRef) ?? runRef.runId;
      if (runNow !== null && runNow.outcome === 'outcome_unknown') {
        if (!R.confirmUnknownStopped) {
          return pending(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts, runRef, '归档中 · 停止中', requeueRefusals);
        }
        if (deps.attestUnknownRun === undefined) {
          return partial(fallbackSession, receipts, reject('unsupported', 'the Host does not bind the unknown-run attestation'), requeueRefusals);
        }
        // §3.3/§2.3: the attestation replays with R's ORIGINAL pin only; the
        // current Run revision must never be substituted into the same identity.
        const pin = pinFor(R, runRef);
        if (pin === null) {
          return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts,
            reject('unavailable', 'the archive request has no stored pin for its unknown Run'), requeueRefusals);
        }
        const attested = await deps.attestUnknownRun(actorCtx, {
          input: { runRef, reason: R.reason },
          meta: { requestId: 's1-archive-attest:' + sha256Hex(canonicalJson({
            requestReceipt: R.receipt, runRef, action: 'attest_work',
          } as unknown as JsonValue)), expected: [pin] },
        });
        if (attested.status !== 'committed') return partial(fallbackSession, receipts, attested, requeueRefusals);
        receipts.push({ step: 'stop', subjectKey, cursor: attested.cursor, replayed: attested.replayed });
      } else {
        // §2.3: a Run that already reached a natural terminal is handled per the
        // current formal facts. Its original stop receipt (if the cancel was
        // committed before the crash) still replays; otherwise no cancel is
        // invented and no stop receipt is fabricated.
        const naturalEnded = runNow !== null && runNow.status === 'ended' && runNow.outcome !== 'yielded';
        const cancel = cancelControlWrite(R, runRef);
        if (cancel === null || deps.controls === undefined) {
          if (!naturalEnded) {
            return partial(fallbackSession, receipts, reject('unsupported', 'the archive request has no control pin for its Run'), requeueRefusals);
          }
        } else {
          const submitted = await deps.controls.submitControl(actorCtx, cancel);
          if (submitted.status !== 'committed') {
            // N1/D2: a stale stop pin is tolerated only when the Run already
            // reached its OWN terminal (the archive did not stop it). Any other
            // control failure stays ready/partial with R and the original pin;
            // an already queued stop replays through submitControl's own lookup,
            // so this branch never turns a real receipt replay into a partial.
            const tolerated = naturalEnded && submitted.code === 'revision_conflict';
            if (!tolerated) return partial(fallbackSession, receipts, submitted, requeueRefusals);
          } else {
            receipts.push({ step: 'stop', subjectKey, cursor: submitted.cursor, replayed: submitted.replayed });
            const deliver = deps.runtime?.deliverControl;
            if (deliver !== undefined) {
              try { await deliver.call(deps.runtime, actorCtx, { intentRef: submitted.value.intent.ref }); } catch { /* stays queued */ }
            }
            const afterRead = await readRun(actorCtx, runRef);
            if ('rejection' in afterRead) {
              return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts, afterRead.rejection, requeueRefusals);
            }
            const after = afterRead.run;
            if (after === null || after.status !== 'ended') {
              return pending(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts, runRef, '归档中 · 停止中', requeueRefusals);
            }
          }
        }
      }
    } else if (R.execution.kind === 'query') {
      const queryRunRef = R.execution.queryRunRef;
      // §3.3 S:596 / §4.1 step 4: a Query that is formally unknown and whose stop
      // the operator explicitly confirmed resolves through the existing explicit
      // attestation; it is never silently abandoned and never automatically
      // assumed stopped.
      if (R.confirmUnknownStopped) {
        const unknown = await queryRunIsUnknown(actorCtx, sessionRef, queryRunRef);
        if (unknown === true) {
          if (deps.attestUnknownQueryRun === undefined) {
            return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts,
              reject('unsupported', 'the Host does not bind the unknown-Query attestation'), requeueRefusals);
          }
          // The attestation replays with R's ORIGINAL QueryRun pin only.
          const pin = pinFor(R, queryRunRef);
          if (pin === null) {
            return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts,
              reject('unavailable', 'the archive request has no stored pin for its unknown Query'), requeueRefusals);
          }
          const subjectKey = canonical(queryRunRef) ?? queryRunRef.runId;
          const attested = await deps.attestUnknownQueryRun(actorCtx, {
            input: { queryRunRef, reason: R.reason },
            meta: {
              requestId: 's1-archive-attest:' + sha256Hex(canonicalJson({
                requestReceipt: R.receipt, queryRunRef, action: 'attest_query',
              } as unknown as JsonValue)),
              expected: [pin],
            },
          });
          if (attested.status !== 'committed') {
            return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts, attested, requeueRefusals);
          }
          receipts.push({ step: 'stop', subjectKey, cursor: attested.cursor, replayed: attested.replayed });
          const refreshed = await readFacts(actorCtx, sessionRef);
          if ('facts' in refreshed) facts = refreshed.facts;
        }
      }
      const occupancy = facts.session.occupancy;
      const stillOccupied = occupancy !== null && occupancy.kind === 'execution'
        && sameCanonical(occupancy.executionRef, queryRunRef);
      if (stillOccupied) {
        return pending(facts.session, receipts, queryRunRef, '归档中', requeueRefusals);
      }
    }

    // Re-read the facts after the stop; the occupancy and wait may have moved.
    const afterStop = await readFacts(actorCtx, sessionRef);
    if (!('facts' in afterStop)) return partial(fallbackSession, receipts, afterStop.rejection, requeueRefusals);
    facts = afterStop.facts;

    // ---- Step 5: the anomaly anchor for the interrupted Work. --------------
    let anchor: SessionAnomalyAnchorV1 | null = null;
    let anchorRunRef: RunRef | null = null;
    let anchorTask: { projectId: string; goalId: string; taskId: string } | null = null;
    if (R.execution.kind === 'work') {
      const runRead = await readRun(actorCtx, R.execution.runRef);
      if ('rejection' in runRead) return partial(fallbackSession, receipts, runRead.rejection, requeueRefusals);
      const run = runRead.run;
      if (run !== null && run.status === 'ended' && run.outcome !== 'yielded' && run.outcome !== 'completed') {
        anchorRunRef = run.ref;
        anchorTask = run.task;
      }
    } else if (R.mode === 'retired' && facts.latestWork !== null) {
      // S1-ANCHOR-02 judges the TASK (still unfinished), not the Run outcome: a
      // Run that ended `completed` (or otherwise) still anchors while its Task
      // is unfinished. The anchor owner re-checks the Task projection.
      const runRead = await readRun(actorCtx, facts.latestWork.runRef);
      if ('rejection' in runRead) return partial(fallbackSession, receipts, runRead.rejection, requeueRefusals);
      const run = runRead.run;
      if (run !== null && run.status === 'ended' && run.outcome !== 'yielded') {
        anchorRunRef = run.ref;
        anchorTask = run.task;
      }
    }
    if (anchorRunRef !== null) {
      const terminal = await taskTerminal(actorCtx, anchorTask
        ?? facts.latestWork?.task ?? { projectId: sessionRef.projectId, goalId: '', taskId: '' });
      if (terminal !== true) {
        if (deps.sessionAnomalies === undefined) {
          return partial(fallbackSession, receipts, reject('unsupported', 'the anomaly owner is not installed'), requeueRefusals);
        }
        const files = await unknownChangedFiles(actorCtx, anchorRunRef);
        const step = stepFor(sessionRef, R, 'anchor', canonical(anchorRunRef) ?? anchorRunRef.runId);
        try {
          const written = await deps.sessionAnomalies.recordSessionAnomaly(actorCtx, { step, files });
          if (written.status !== 'committed') {
            return partial(fallbackSession, receipts, written, requeueRefusals);
          }
          anchor = written.value;
          receipts.push({ step: 'anchor', subjectKey: step.subjectKey, cursor: written.cursor, replayed: written.replayed });
        } catch (error) {
          return partial(fallbackSession, receipts,
            reject('unavailable', `the anomaly anchor failed: ${error instanceof Error ? error.message : String(error)}`), requeueRefusals);
        }
      }
    }

    // ---- Step 6: dispose responsibility target by target. ------------------
    if (deps.responsibilities !== undefined) {
      for (const choice of R.tasks) {
        const targetKey = canonical(choice.target);
        if (targetKey === null) continue;
        const step = stepFor(sessionRef, R, 'responsibility', targetKey);
        try {
          const disposed = await deps.responsibilities.disposeArchiveResponsibility(actorCtx, step);
          if (disposed.status !== 'committed') return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts, disposed, requeueRefusals);
          receipts.push({ step: 'responsibility', subjectKey: targetKey, cursor: disposed.cursor, replayed: disposed.replayed });
        } catch (error) {
          return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts,
            reject('unavailable', `the responsibility disposal failed: ${error instanceof Error ? error.message : String(error)}`), requeueRefusals);
        }
      }
    } else if (R.tasks.length > 0) {
      return partial(fallbackSession, receipts, reject('unsupported', 'the responsibility owner is not installed'), requeueRefusals);
    }

    // §4.1 step 6 (E12): close the responsibilities whose Task is formally
    // terminal even when the request did not select them, so a terminal link
    // never blocks the final archive. The chosen targets were disposed above;
    // this covers the unselected ones the initial acceptance already tolerated.
    if (deps.responsibilities !== undefined && deps.sessions !== undefined) {
      const chosen = new Set<string>();
      for (const choice of R.tasks) {
        const key = canonical(choice.target);
        if (key !== null) chosen.add(key);
      }
      let scanned = await deps.sessions.readSession(actorCtx, sessionRef);
      if (scanned.status === 'ready') {
        const unselected: Extract<WorkLinkTarget, { kind: 'task' }>[] = [];
        for (const link of scanned.value.links) {
          if (link.ref.relation !== 'responsible' || link.until !== null) continue;
          const target = link.ref.target;
          if (target.kind !== 'task') continue;
          const key = canonical(target);
          if (key !== null && chosen.has(key)) continue;
          unselected.push(target);
        }
        for (const target of unselected) {
          // Re-read per close: an earlier terminal close in this same call bumps
          // the Session revision, so a stale pin would refuse the later link.
          scanned = await deps.sessions.readSession(actorCtx, sessionRef);
          if (scanned.status !== 'ready') {
            return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts,
              readFailure(scanned, 'the Session card'), requeueRefusals);
          }
          const targetKey = canonical(target);
          const link = scanned.value.links.find((candidate) => candidate.ref.relation === 'responsible'
            && candidate.until === null && targetKey !== null && canonical(candidate.ref.target) === targetKey);
          if (link === undefined) continue; // already closed by an earlier close in this call
          if (await taskTerminal(actorCtx, target.ref) !== true) continue;
          const step = stepFor(sessionRef, R, 'responsibility', targetKey ?? target.ref.taskId);
          try {
            const closed = await deps.responsibilities.closeTerminalResponsibility(actorCtx, {
              input: { sessionRef, target },
              meta: {
                requestId: `s1-archive-terminal:${step.requestReceipt.identityKey}:${targetKey ?? target.ref.taskId}`,
                expected: [
                  { ref: scanned.value.record.ref, revision: scanned.value.record.revision },
                  { ref: link.ref, revision: link.revision },
                ],
              },
            });
            if (closed.status !== 'committed') {
              return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts, closed, requeueRefusals);
            }
            receipts.push({ step: 'responsibility', subjectKey: targetKey ?? target.ref.taskId, cursor: closed.cursor, replayed: closed.replayed });
          } catch (error) {
            return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts,
              reject('unavailable', `the terminal responsibility close failed: ${error instanceof Error ? error.message : String(error)}`), requeueRefusals);
          }
        }
      }
    }

    // ---- Requeue plans are captured before the wait is disposed. ------------
    const requeueTargets: { afterRunRef: RunRef; origin: 'execution' | 'wait' }[] = [];
    // R3/S1-AUTO-02: only a Run THIS archive request really stopped is requeued
    // with an `archiveOrigin`. A retired line whose Run had already ended before
    // the request (`execution.kind === 'none'`) writes the anchor and drops the
    // responsibility; the existing start-up re-drive / advance requeues it.
    if (anchorRunRef !== null && anchor !== null && R.execution.kind === 'work') {
      requeueTargets.push({ afterRunRef: anchorRunRef, origin: 'execution' });
    }
    if (R.wait !== null && R.mode !== 'retired') {
      // E4 §4.1 step 7: the wait Run and its Task come from the immutable R and
      // the original Run. The current `facts.wait` disappears once the wait
      // cancel commits, so a recovery could never find the target from it.
      requeueTargets.push({ afterRunRef: R.wait.runRef, origin: 'wait' });
    }

    // ---- Step 7: dispose the wait, then requeue the actionable Task. -------
    if (R.wait !== null && R.mode !== 'retired') {
      const mailbox = deps.messages;
      if (mailbox?.disposeArchiveWait === undefined) {
        return partial(fallbackSession, receipts, reject('unsupported', 'the mailbox wait-disposal owner is not installed'), requeueRefusals);
      }
      const steps: ArchiveStepRefV1[] = R.wait.kind === 'transfer'
        ? [stepFor(sessionRef, R, 'reply_handler', canonical(R.wait.messageRef) ?? ''), stepFor(sessionRef, R, 'wait_cancel', canonical(R.wait.runRef) ?? '')]
        : [stepFor(sessionRef, R, 'wait_cancel', canonical(R.wait.runRef) ?? '')];
      for (const step of steps) {
        try {
          const disposed = await mailbox.disposeArchiveWait(actorCtx, step);
          if (disposed.status !== 'committed') return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts, disposed, requeueRefusals);
          receipts.push({ step: step.step, subjectKey: step.subjectKey, cursor: disposed.cursor, replayed: disposed.replayed });
        } catch (error) {
          return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts,
            reject('unavailable', `the wait disposal failed: ${error instanceof Error ? error.message : String(error)}`), requeueRefusals);
        }
      }
      // §3.2 S1-MSG-02 / §4.1 step 7: after the message disposition, the
      // existing Run cancel closes the old yielded continuation window. It is
      // the exact cancel intent the wait-origin requeue verifies.
      const waitCancel = cancelControlWrite(R, R.wait.runRef);
      if (waitCancel === null || deps.controls === undefined) {
        return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts,
          reject('unsupported', 'the archive request has no control pin for its wait Run'), requeueRefusals);
      }
      const waitSubmitted = await deps.controls.submitControl(actorCtx, waitCancel);
      if (waitSubmitted.status !== 'committed') {
        return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts, waitSubmitted, requeueRefusals);
      }
      const waitDeliver = deps.runtime?.deliverControl;
      if (waitDeliver !== undefined) {
        try { await waitDeliver.call(deps.runtime, actorCtx, { intentRef: waitSubmitted.value.intent.ref }); } catch { /* stays queued */ }
      }
    }

    // ---- Step 7 (continued): requeue every actionable Task. ----------------
    // §4.1 step 7 / §4.2 S:807 (E3): a required requeue either commits/replays
    // or the archive returns partial with the exact rejection and keeps R.
    if (requeueTargets.length > 0) {
      if (deps.claims?.requeueTask === undefined || deps.plans === undefined || deps.executions === undefined) {
        return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts,
          reject('unsupported', 'the archive requeue owner is not installed'), requeueRefusals);
      }
      const requeue = deps.claims.requeueTask;
      for (const target of requeueTargets) {
        const runRead = await deps.executions.readExecution(actorCtx, target.afterRunRef);
        if (runRead.status !== 'ready') {
          return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts,
            readFailure(runRead, `the archived Run of ${target.afterRunRef.runId}`), requeueRefusals);
        }
        const task = runRead.value.run.task;
        const stateRead = await readTaskArchiveState(actorCtx, task);
        if ('rejection' in stateRead) {
          return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts,
            stateRead.rejection, requeueRefusals);
        }
        // A Task that is already terminal needs no requeue (E1 / S:240).
        if (stateRead.terminal) continue;
        const goalRef = { aggregateType: 'Goal' as const, projectId: task.projectId, goalId: task.goalId };
        const goalRead = await deps.plans.queryGoal(actorCtx, goalRef);
        if (goalRead.status !== 'ready') {
          return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts,
            readFailure(goalRead, `the Goal of ${task.taskId}`), requeueRefusals);
        }
        // L-d (§2.3 S:622): an existing TaskRequeue covering this afterRun is
        // reused, never rewritten. The owner is still called first so a matching
        // replay returns the original commit cursor; when a later Goal update
        // makes the recomputed fingerprint diverge, the durable record is reused
        // without fabricating a receipt.
        const covered = stateRead.requeueRef !== null
          && stateRead.requeueRef.afterRunId === target.afterRunRef.runId;
        const origin: ArchiveRequeueOriginV1 = target.origin === 'execution' && anchor !== null
          ? { kind: 'execution', anchorRef: anchor.ref, archiveSessionRef: sessionRef, archiveRequestId: R.requestId }
          : { kind: 'wait', runRef: target.afterRunRef, messageRef: R.wait!.messageRef, archiveSessionRef: sessionRef, archiveRequestId: R.requestId };
        const write: GraphWrite<RequeueTaskInput> = {
          input: { taskRef: task, afterRunRef: target.afterRunRef, reason: R.reason, archiveOrigin: origin },
          meta: {
            requestId: 's1-archive-requeue:' + sha256Hex(canonicalJson({ requestReceipt: R.receipt, taskRef: task, afterRunRef: target.afterRunRef } as unknown as JsonValue)),
            expected: [{ ref: goalRef, revision: goalRead.value.goal.revision }, { ref: target.afterRunRef, revision: runRead.value.run.revision }],
          },
        };
        // E5/L-d (§2.3 S:622): the E5-owner read reuses the already committed
        // `(Task, afterRun)` TaskRequeue of this exact archive step and its
        // original cursor as the step receipt. A new write happens only when the
        // durable read has no such record, so a crash recovery never rewrites
        // (or falsifies a receipt for) the original requeue. A non-ready read is
        // left to `requeueTask`'s own lookup: a committed refusal (`unavailable`
        // here) replays as the original refusal, and a transient failure stays
        // the real rejection instead of being misread as "no requeue exists".
        const readRequeue = deps.claims.readTaskRequeue;
        if (readRequeue !== undefined) {
          const existing = await readRequeue.call(deps.claims, actorCtx, write);
          if (existing.status === 'ready') {
            receipts.push({ step: 'requeue', subjectKey: canonical(task) ?? task.taskId,
              cursor: existing.value.cursor, replayed: true });
            continue;
          }
        }
        try {
          const requeued = await requeue(actorCtx, write);
          if (requeued.status !== 'committed') {
            if (covered && requeued.code === 'idempotency_conflict') continue;
            return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts, requeued, requeueRefusals);
          }
          if (requeued.value.kind === 'refused') requeueRefusals.push(requeued.value.refusal);
          receipts.push({ step: 'requeue', subjectKey: canonical(task) ?? task.taskId, cursor: requeued.cursor, replayed: requeued.replayed });
        } catch (error) {
          return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts,
            reject('unavailable', `the archive requeue failed: ${error instanceof Error ? error.message : String(error)}`), requeueRefusals);
        }
      }
    }

    // ---- Step 8: CAS-complete the archive and clear R. ---------------------
    if (deps.sessionLifecycle === undefined) {
      return partial(fallbackSession, receipts, reject('unsupported', 'the Session lifecycle owner is not installed'), requeueRefusals);
    }
    const archiveStep = stepFor(sessionRef, R, 'archive', canonical(sessionRef) ?? sessionRef.sessionId);
    try {
      const archived = await deps.sessionLifecycle.finishSessionArchive(actorCtx, archiveStep);
      if (archived.status !== 'committed') {
        const current = await currentRecord(actorCtx, sessionRef, fallbackSession);
        return partial(current, receipts, archived, requeueRefusals);
      }
      receipts.push({ step: 'archive', subjectKey: archiveStep.subjectKey, cursor: archived.cursor, replayed: archived.replayed });
      return ready({ state: 'archived', session: archived.value, receipts, pendingOn: null, rejection: null, requeueRefusals, message: '已归档' });
    } catch (error) {
      return partial(await currentRecord(actorCtx, sessionRef, fallbackSession), receipts,
        reject('unavailable', `the final archive failed: ${error instanceof Error ? error.message : String(error)}`), requeueRefusals);
    }
  }

  async function archiveLine(
    ctx: CoreCallContext, request: GraphWrite<ArchiveLineInput>, internalMode = false,
  ): Promise<ReadResult<ArchiveLineResultV1>> {
    let isolated: unknown;
    try { isolated = structuredClone(request); } catch { return reject('invalid', 'the archive request cannot be isolated from the caller'); }
    if (!isRecord(isolated) || !isRecord(isolated['input']) || !isRecord(isolated['meta'])) {
      return reject('invalid', 'archive_input_invalid: archiveLine requires a GraphWrite');
    }
    const rawInput = isolated['input'];
    const rawMeta = isolated['meta'];
    if (!internalMode && Object.prototype.hasOwnProperty.call(rawInput, 'mode')) {
      return reject('invalid', 'archive_input_invalid: mode is an internal-only archive input');
    }
    if (Object.keys(rawInput).some((key) => !['sessionRef', 'reason', 'tasks', 'wait', 'confirmUnknownStopped', 'mode'].includes(key))) {
      return reject('invalid', 'archive_input_invalid: the archive input carries unknown fields');
    }
    if (Object.keys(rawMeta).some((key) => key !== 'requestId' && key !== 'expected')) {
      return reject('invalid', 'archive_input_invalid: the archive meta carries unknown fields');
    }
    const sessionRefRaw = rawInput['sessionRef'];
    if (!isRecord(sessionRefRaw) || !nonEmpty(sessionRefRaw['projectId']) || !nonEmpty(sessionRefRaw['sessionId'])) {
      return reject('invalid', 'archive_input_invalid: a complete SessionRef is required');
    }
    const sessionRef: SessionRef = { projectId: sessionRefRaw['projectId'] as string, sessionId: sessionRefRaw['sessionId'] as string };
    if (!nonEmpty(rawInput['reason'])) return reject('invalid', 'archive_input_invalid: a non-empty reason is required');
    if (!Array.isArray(rawInput['tasks'])) return reject('invalid', 'archive_input_invalid: tasks must be an array');
    if (!nonEmpty(rawMeta['requestId'])) return reject('invalid', 'archive_input_invalid: meta.requestId is required');
    if (!Array.isArray(rawMeta['expected']) || rawMeta['expected'].length !== 1) {
      return reject('invalid', 'archive_input_invalid: meta.expected must carry exactly one Session pin');
    }
    // §3.2 / E10: a present, malformed confirmation is a fake confirmation, not false.
    const confirmUnknownRaw = rawInput['confirmUnknownStopped'];
    if (confirmUnknownRaw !== undefined && typeof confirmUnknownRaw !== 'boolean') {
      return reject('invalid', 'archive_input_invalid: confirmUnknownStopped must be a boolean');
    }
    const explicitMode = rawInput['mode'];
    const mode = explicitMode === undefined ? 'operator' : explicitMode;
    if (typeof mode !== 'string' || !ARCHIVE_MODES.includes(mode as SessionArchiveRequestV1['mode'])) {
      return reject('invalid', 'archive_input_invalid: the archive mode is not recognized');
    }
    const expected = rawMeta['expected'] as readonly VersionPin[];
    const requestWrite: GraphWrite<RequestSessionArchiveInput> = {
      input: {
        sessionRef, reason: rawInput['reason'] as string,
        tasks: rawInput['tasks'] as RequestSessionArchiveInput['tasks'],
        wait: (rawInput['wait'] ?? null) as RequestSessionArchiveInput['wait'],
        confirmUnknownStopped: confirmUnknownRaw === true,
        mode: mode as SessionArchiveRequestV1['mode'],
      },
      meta: { requestId: rawMeta['requestId'] as string, expected },
    };

    if (deps.sessionLifecycle === undefined) return reject('unsupported', 'the Session lifecycle owner is not installed');
    const receipt = await deps.sessionLifecycle.readSessionArchiveRequestReceipt(ctx, requestWrite);
    if (receipt.status === 'ready') {
      const R = receipt.value.session.archiveRequest;
      if (R === null || R === undefined) return reject('unavailable', 'the archive request receipt carries no pending request');
      return drive(ctx, sessionRef, R, []);
    }
    const notFound = receipt.status === 'rejected' && receipt.code === 'not_found'
      && receipt.reason.startsWith('archive_request_receipt_not_found:');
    if (!notFound) return receipt;

    // First acceptance: validate the real pin, the execution and the choices
    // with zero commits before the durable request is registered.
    const factsRead = await readFacts(ctx, sessionRef);
    if (!('facts' in factsRead)) return factsRead.rejection;
    const facts = factsRead.facts;
    const currentPin = { ref: facts.session.ref, revision: facts.session.revision };
    const expectedPin = expected[0]!;
    if (!sameCanonical(expectedPin.ref, facts.session.ref) || expectedPin.revision !== facts.session.revision) {
      return reject('revision_conflict', 'the Session changed since the caller read it', [currentPin]);
    }
    const occupancy = facts.session.occupancy;
    if (occupancy !== null && occupancy.kind === 'execution' && occupancy.executionRef.aggregateType === 'Run') {
      const runRead = await readRun(ctx, occupancy.executionRef);
      if ('rejection' in runRead) return runRead.rejection;
      const run = runRead.run;
      if (run !== null && run.outcome === 'outcome_unknown' && requestWrite.input.confirmUnknownStopped !== true) {
        return reject('busy', 'archive_unknown_confirmation_required: the occupying Run outcome is unknown and no confirmation was given');
      }
    }
    const retired = facts.session.health === 'unavailable';
    if (facts.wait !== null && (requestWrite.input.wait === null || requestWrite.input.wait === undefined) && !retired) {
      return reject('busy', 'archive_wait_disposal_required: the Session is waiting for a continuation reply');
    }
    if (facts.wait === null && requestWrite.input.wait !== null && requestWrite.input.wait !== undefined) {
      return reject('invalid', 'archive_input_invalid: the Session has no wait to dispose');
    }
    // §4.1 step 1: the open responsibilities and current Task states are read
    // before the durable request; an uncovered unfinished responsibility is a
    // zero-commit refusal.
    const responsibilityProblem = await firstAcceptanceResponsibilityProblem(ctx, sessionRef, requestWrite.input);
    if (responsibilityProblem !== null) return responsibilityProblem;

    const registered = await deps.sessionLifecycle.requestSessionArchive(ctx, requestWrite);
    if (registered.status !== 'committed') return registered;
    const R = registered.value.archiveRequest;
    if (R === null || R === undefined) return reject('unavailable', 'the registered archive request is missing');
    return drive(ctx, sessionRef, R, []);
  }

  async function continueArchiveLine(
    ctx: CoreCallContext, input: { sessionRef: SessionRef; archiveRequestId: string },
  ): Promise<ReadResult<ArchiveLineResultV1>> {
    let isolated: unknown;
    try { isolated = structuredClone(input); } catch { return reject('invalid', 'the archive continuation cannot be isolated from the caller'); }
    if (!isRecord(isolated)) return reject('invalid', 'archive_input_invalid: continueArchiveLine requires an input');
    const sessionRefRaw = isolated['sessionRef'];
    if (!isRecord(sessionRefRaw) || !nonEmpty(sessionRefRaw['projectId']) || !nonEmpty(sessionRefRaw['sessionId'])) {
      return reject('invalid', 'archive_input_invalid: a complete SessionRef is required');
    }
    if (!nonEmpty(isolated['archiveRequestId'])) return reject('invalid', 'archive_input_invalid: archiveRequestId is required');
    const sessionRef: SessionRef = { projectId: sessionRefRaw['projectId'] as string, sessionId: sessionRefRaw['sessionId'] as string };
    const archiveRequestId = isolated['archiveRequestId'] as string;
    // E8: the current caller is checked before the durable `R.requestedBy`
    // authority is adopted; an Agent never continues an archive.
    const callerProblem = archiveCallerProblem(ctx, sessionRef);
    if (callerProblem !== null) return callerProblem;
    const factsRead = await readFacts(ctx, sessionRef);
    if (!('facts' in factsRead)) return factsRead.rejection;
    const record = factsRead.facts.session;
    if (ctx.workspaceId !== undefined && record.workspaceId !== ctx.workspaceId) {
      return reject('forbidden', 'archive_scope: the archive continuation is outside the caller workspace');
    }
    const R = record.archiveRequest ?? null;
    if (R === null) {
      if (record.lifecycle === 'archived') {
        return ready({ state: 'archived', session: record, receipts: [], pendingOn: null, rejection: null, requeueRefusals: [], message: '已归档' });
      }
      return reject('invalid', 'archive_input_invalid: the Session has no pending archive request');
    }
    if (R.requestId !== archiveRequestId) {
      return reject('invalid', 'archive_input_invalid: the archive request id does not match the pending request');
    }
    return drive(ctx, sessionRef, R, []);
  }

  async function archiveLineInternal(
    ctx: CoreCallContext, request: GraphWrite<RequestSessionArchiveInput>,
  ): Promise<ReadResult<ArchiveLineResultV1>> {
    return archiveLine(ctx, request, true);
  }

  return { archiveLine, archiveLineInternal, continueArchiveLine };
}
