/**
 * Slice 5 §4.2 source 2 (F27): the Goal decision-cause reader.
 *
 * It derives the real reasons a Goal needs a decision (from the saved Goal
 * causes / active-pointer absence, plus the `every_step` automation cause) and
 * never writes a GoalPhase. `createGoalDecisionCauseReader` returns the §4.2
 * `readGoalDecisionCauses(ctx, { goalRef, atLeastCursor? })` method. Every path
 * here is READ-ONLY (rule 20): it reads the Goal display, a pending proposal's
 * revision and the project's active governance pointers, and writes nothing.
 *
 * [lead S5-A6] The dependency types expose ONLY read/lookup capabilities and
 * the named `PlanTaskPort` readers; no `GoalRecordTransactionPort.commit`.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreError, ReadResult } from '../../../contracts/core/results.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  decisionSourceKey,
  type DecisionObjectV1,
  type DecisionOptionV1,
  type GoalDecisionBasisV1,
} from '../../../contracts/goal-decisions.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import { atLeastCursorResult } from '../persistence/read-result-failures.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { decodeRun } from '../persistence/run-record-codecs.js';
import type { GoalDecisionCauseReadV1 } from '../model/decision-contracts.js';
import type { PlanTaskPort, TaskRow } from '../model/plan-contracts.js';
import { automationConfirmationCause, gateFixInProgress, pausedAutomationAction } from '../state/decision-policy.js';
import type { GoalDisplayCauseV1 } from '../state/goal-machine.js';
import { modelServiceOf } from '../state/task-failure.js';
import { reverifyExemptionOfFacts, successorAutoCount } from '../state/verification-machine.js';
import { readInitializationPointers } from './initialization-pointers.js';

/** The read-only Store subset this reader needs: canonical reads, eventAt and lookup. */
export type GoalDecisionCauseReaderRecords =
  Pick<GoalRecordTransactionPort, 'readMany' | 'eventAt'> & Pick<RecordLookupPort, 'lookup'>;

/**
 * The narrow record readers plus the read-only Plan seam (spec §4.2 line 816):
 * the same dependency bag the Plan service uses. `readInitialPlanAnswerFacts`
 * and `queryGoalDisplay` are the named `PlanTaskPort` reads; the reader never
 * opens Job/manifest/body itself.
 */
export type GoalDecisionCauseReaderDependencies = {
  records: GoalDecisionCauseReaderRecords;
  /**
   * The same read-only Plan seam the Plan service publishes. `queryTaskGraph`
   * is optional only so the narrow `DecisionSourceFactsDependencies.plans`
   * construction (`queryGoalDisplay` + `readInitialPlanAnswerFacts`) keeps
   * compiling; every real Plan service publishes it, and it is the formal
   * source of the §4.2 source-2 automation cause and of each cause's failure
   * Run pin (the Task graph rows). An ABSENT seam is `unavailable`, never an
   * available empty Task set (F6, §4.2 line 821).
   */
  plans: Pick<PlanTaskPort, 'queryGoalDisplay' | 'readInitialPlanAnswerFacts'>
    & Partial<Pick<PlanTaskPort, 'queryTaskGraph'>>;
};

/** §4.2: the concrete persisted decision causes of one Goal, read-only. */
export interface GoalDecisionCauseReader {
  readGoalDecisionCauses(
    ctx: CoreCallContext,
    input: { goalRef: GoalRef; atLeastCursor?: CommitCursor },
  ): Promise<ReadResult<GoalDecisionCauseReadV1[]>>;
}

/**
 * The display causes that describe a real "the user/operator must decide" gap
 * (§4.2 source 2: the concrete cause, not only a NEEDS_DECISION title).
 */
const DECISION_CAUSE_CODES: ReadonlySet<string> = new Set([
  'initial_plan_pending', 'change_pending', 'required_task_deferred',
  'auto_rework_count', 'auto_rework_pending',
  'auto_rework_cap_reached', 'no_new_basis', 'verification_uncovered',
  'budget_exhausted', 'not_reworkable', 'unknown_outcome',
  'interrupted_pending_resume',
]);

type Rej = { status: 'rejected'; code: CoreError; reason: string };
function notFound(reason: string): Rej {
  return { status: 'rejected', code: 'not_found', reason };
}
function forbidden(reason: string): Rej {
  return { status: 'rejected', code: 'forbidden', reason };
}
function unavailable(reason: string): Rej {
  return { status: 'rejected', code: 'unavailable', reason };
}
/** The Goal plus the watermark its own read observed. */
type GoalRecordRead = { goal: GoalSnapshot; readThrough: CommitCursor | null };
function isRej(value: GoalRecordRead | Rej): value is Rej {
  return (value as { status?: unknown }).status === 'rejected';
}

/** One cause read: the causes, or the read failure that must be returned. */
type CauseReadResult = { ok: true; causes: GoalDecisionCauseReadV1[] } | { ok: false; rejection: Rej };

/** The canonical content basis of one Goal (the shared §2.8 shape, built here). */
function basisOf(goal: GoalSnapshot): GoalDecisionBasisV1 {
  return {
    goalRef: goal.ref,
    workspaceRef: goal.workspaceRef,
    objective: goal.objective,
    activePlanRef: goal.activePlanRevision,
    settings: goal.settings,
  };
}

/** Builds the Goal decision-cause reader; the factory itself never throws. */
export function createGoalDecisionCauseReader(
  deps: GoalDecisionCauseReaderDependencies,
): GoalDecisionCauseReader {
  const { records, plans } = deps;

  async function readGoalRecord(goalRef: GoalRef): Promise<GoalRecordRead | Rej> {
    const key = canonicalJson(goalRef as unknown as JsonValue);
    let read: Awaited<ReturnType<GoalDecisionCauseReaderRecords['readMany']>>;
    try {
      read = await records.readMany([key]);
    } catch (error) {
      return unavailable(`the Goal could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (read.status !== 'ready') return unavailable(`the Goal read failed: ${read.code}`);
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined) return notFound(`goal ${goalRef.goalId} does not exist`);
    const decoded = decodeGoalSnapshot(record);
    if (decoded.status !== 'decoded') return unavailable(`goal ${goalRef.goalId} is corrupt: ${decoded.reason}`);
    return { goal: decoded.value, readThrough: read.value.readThrough };
  }

  async function readRecordOf(ref: unknown): Promise<{ ok: true; record: EncodedRecord } | { ok: false; rejection: Rej }> {
    const key = canonicalJson(ref as JsonValue);
    let read: Awaited<ReturnType<GoalDecisionCauseReaderRecords['readMany']>>;
    try {
      read = await records.readMany([key]);
    } catch (error) {
      return { ok: false, rejection: unavailable(`the versioned object ${key} could not be read: ${messageOf(error)}`) };
    }
    if (read.status !== 'ready') {
      return { ok: false, rejection: unavailable(`the versioned object ${key} is unavailable: ${read.code}`) };
    }
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined) return { ok: false, rejection: notFound(`the versioned object ${key} does not exist`) };
    return { ok: true, record };
  }
  async function revisionPinOf(ref: unknown): Promise<{ ok: true; pin: VersionPin } | { ok: false; rejection: Rej }> {
    const read = await readRecordOf(ref);
    return read.ok ? { ok: true, pin: { ref: ref as VersionPin['ref'], revision: read.record.revision } } : read;
  }

  /**
   * §3.3 line 629/§4.2 source 2: the formal Task focus ref of a cause. The Task
   * vocabulary (`{aggregateType:'Task', projectId, goalId, taskId}`) is the same
   * one the Query focus refs use; a Task is not a stored aggregate, so the pin
   * carries the §2.1 absence revision 0 and the pin exists to give every
   * different Task its own source identity.
   */
  function taskPin(goal: GoalSnapshot, taskId: string): VersionPin {
    return { ref: { aggregateType: 'Task', projectId: goal.ref.projectId, goalId: goal.ref.goalId,
      taskId } as unknown as VersionPin['ref'], revision: 0 };
  }

  function cause(input: {
    goal: GoalSnapshot; code: string; action: GoalDecisionCauseReadV1['action'];
    affected: VersionPin[]; taskRef: GoalDecisionCauseReadV1['taskRef']; runRef: GoalDecisionCauseReadV1['runRef'];
    objects?: DecisionObjectV1[]; options?: DecisionOptionV1[];
  }): GoalDecisionCauseReadV1 {
    const byKey = new Map<string, VersionPin>();
    for (const pin of input.affected) byKey.set(canonicalJson(pin.ref as JsonValue), pin);
    const affected = [...byKey.keys()].sort().map((key) => byKey.get(key)!);
    return {
      source: {
        kind: 'goal_cause',
        key: decisionSourceKey({ kind: 'goal_cause', goalRef: input.goal.ref, code: input.code, affected }),
        subject: { kind: 'goal', goalRef: input.goal.ref },
        pins: [{ ref: input.goal.ref, revision: input.goal.revision }, ...affected],
        goalBases: [basisOf(input.goal)],
      },
      code: input.code,
      taskRef: input.taskRef,
      runRef: input.runRef,
      action: input.action,
      objects: input.objects ?? [],
      options: input.options ?? [],
    };
  }

  function taskTriple(goal: GoalSnapshot, taskId: string): GoalDecisionCauseReadV1['taskRef'] {
    return { projectId: goal.ref.projectId, goalId: goal.ref.goalId, taskId };
  }

  /**
   * §4.2 source 2 / B1/B2 / F6: the formal Task graph rows of the active Plan.
   * A Goal with no adopted Plan has no rows (`not_found`); any other read
   * failure is returned, never folded into "no causes" (§4.2 line 821: an
   * unavailable source is not an available empty array). A missing seam is
   * therefore itself `unavailable`, and a `not_found` only means "no rows" when
   * the Goal pointer proves there is no adopted Plan. `queryTaskGraph` is the
   * same seam the Workflow uses, so the reader and the Workflow derive the same
   * pins.
   */
  async function readTaskRows(
    ctx: CoreCallContext, goal: GoalSnapshot,
  ): Promise<{ ok: true; rows: Map<string, TaskRow> } | { ok: false; rejection: Rej }> {
    const query = plans.queryTaskGraph;
    if (query === undefined) {
      return { ok: false, rejection: unavailable('the Task graph reader is not available') };
    }
    let read: Awaited<ReturnType<typeof query>>;
    try {
      read = await query(ctx, { goalRef: goal.ref });
    } catch (error) {
      return { ok: false, rejection: unavailable(`the Task graph could not be read: ${messageOf(error)}`) };
    }
    if (read.status === 'not_found') {
      if (goal.activePlanRevision === null) return { ok: true, rows: new Map() };
      return { ok: false, rejection: unavailable('the Task graph was not found while the Goal has an adopted Plan') };
    }
    if (read.status !== 'ready') {
      return { ok: false, rejection: read.status === 'rejected'
        ? { status: 'rejected', code: read.code, reason: read.reason }
        : unavailable(`the Task graph is not readable (${read.status})`) };
    }
    const rows = new Map<string, TaskRow>();
    for (const row of read.value.tasks) rows.set(row.ref.taskId, row);
    return { ok: true, rows };
  }

  /**
   * §3.3 line 629 / defect-1: the formal pin of one failure Run. The saved
   * `runRevision` is used when the failure facts read the Run; when they did not
   * (`gateFailureFacts` with a null `anchorRun` still carries `head.subjectRunRef`
   * as `runRef`), the Run's formal revision is read through the SAME helper the
   * other affected objects use. It is never fabricated as `0`: a Run is a
   * stored aggregate (§2.1), so the §3.3 pin check would reject `Run@0` with
   * `revision_conflict` and leave the card unanswerable. The failure facts named
   * this Run, so a missing record is `unavailable`, never `not_found`.
   */
  async function runPinOf(
    runRef: RunRef, runRevision: number | null,
  ): Promise<{ ok: true; pin: VersionPin } | { ok: false; rejection: Rej }> {
    if (runRevision !== null) return { ok: true, pin: { ref: runRef, revision: runRevision } };
    const read = await revisionPinOf(runRef);
    if (!read.ok && read.rejection.code === 'not_found') {
      return { ok: false, rejection: unavailable(`the failure Run ${canonicalJson(runRef as JsonValue)} was not found`) };
    }
    return read;
  }

  /** §3.3 line 629 / B2/defect-1: the formal pin of the failure Run one Task cause is about. */
  async function failureRunOf(
    rows: Map<string, TaskRow>, taskId: string,
  ): Promise<{ ok: true; pin: VersionPin; runRef: RunRef } | { ok: false; rejection: Rej } | null> {
    const failure = rows.get(taskId)?.failure;
    if (failure === undefined || failure.runRef === null) return null;
    const read = await runPinOf(failure.runRef, failure.runRevision);
    if (!read.ok) return read;
    return { ok: true, pin: read.pin, runRef: failure.runRef };
  }

  async function displayCauses(
    ctx: CoreCallContext, goal: GoalSnapshot, rows: Map<string, TaskRow>,
  ): Promise<CauseReadResult> {
    if (plans.queryGoalDisplay === undefined) {
      return { ok: false, rejection: unavailable('the Goal display reader is not available') };
    }
    const display = await plans.queryGoalDisplay(ctx, { goalRef: goal.ref });
    if (display.status !== 'ready') {
      const reason = display.status === 'rejected' ? display.reason : `the Goal display is ${display.status}`;
      return { ok: false, rejection: unavailable(`the Goal display could not be read: ${reason}`) };
    }
    const causes: GoalDecisionCauseReadV1[] = [];
    for (const displayCause of display.value.display.causes as GoalDisplayCauseV1[]) {
      if (!DECISION_CAUSE_CODES.has(displayCause.code)) continue;
      switch (displayCause.code) {
        case 'change_pending':
        case 'initial_plan_pending': {
          const read = await revisionPinOf(displayCause.proposalRef);
          if (!read.ok) return { ok: false, rejection: read.rejection };
          causes.push(cause({ goal, code: displayCause.code, action: 'minor_semantic_patch',
            affected: [read.pin], taskRef: null, runRef: null }));
          break;
        }
        case 'required_task_deferred':
          causes.push(cause({ goal, code: displayCause.code, action: null,
            affected: displayCause.taskIds.map((taskId) => taskPin(goal, taskId)), taskRef: null, runRef: null }));
          break;
        case 'unknown_outcome': {
          const runRead = await revisionPinOf(displayCause.runRef);
          if (!runRead.ok) return { ok: false, rejection: runRead.rejection };
          causes.push(cause({ goal, code: displayCause.code, action: null,
            affected: [taskPin(goal, displayCause.taskId), runRead.pin],
            taskRef: taskTriple(goal, displayCause.taskId), runRef: displayCause.runRef }));
          break;
        }
        case 'auto_rework_pending':
        case 'auto_rework_count':
        default: {
          // GOAL-27 rework causes and the GOAL-30 stop causes name their active
          // Task; B2 adds the formal failure-Run pin so a later Run of the same
          // Task gets a different `source.key` and an old answer cannot close it.
          if (!('taskId' in displayCause)) {
            // SMK3b §3.6: the Goal-level interruption pins its record and the Tasks it lists.
            if ('interruption' in displayCause) {
              causes.push(cause({ goal, code: displayCause.code, action: null, taskRef: null, runRef: null,
                affected: [displayCause.interruption, ...displayCause.taskIds.map((taskId) => taskPin(goal, taskId))] }));
            }
            break;
          }
          const failureRun = await failureRunOf(rows, displayCause.taskId);
          if (failureRun !== null && !failureRun.ok) return { ok: false, rejection: failureRun.rejection };
          const affected = [taskPin(goal, displayCause.taskId)];
          if (failureRun !== null) affected.push(failureRun.pin);
          causes.push(cause({ goal, code: displayCause.code, action: null, affected,
            taskRef: taskTriple(goal, displayCause.taskId), runRef: failureRun?.runRef ?? null }));
          break;
        }
      }
    }
    return { ok: true, causes };
  }

  /**
   * §4.5 line 888 / B1: the source-2 automation cause the Workflow's
   * `automationConfirmation` derives for the current failure verdicts, from the
   * same Task graph rows. It shares the ONE `automationConfirmationCause`
   * derivation, so both entries produce the same `source.key`. A null saved
   * `runRevision` is resolved to the Run's formal revision first (defect-1), so
   * the reader pins exactly the same Run version the Workflow reads.
   *
   * F1: two cards the Workflow can show are not `requeue`/`reverify` verdicts.
   * LB-1 (a `stopped/budget_exhausted` failure with a class and a Run pin) is
   * the same `system_requeue` the Workflow's budget lift performs; and while a
   * Goal is paused (not cancelled) the verdict reads `none` (AV-0/GV-0), so the
   * action is re-derived from the saved facts by `pausedAutomationAction`
   * (§8.2 line 1357: a pause must not make an emitted card unanswerable).
   */
  async function automationCauses(goal: GoalSnapshot, rows: Map<string, TaskRow>): Promise<CauseReadResult> {
    const settings = goal.settings;
    const causes: GoalDecisionCauseReadV1[] = [];
    // §4.5 line 888 / defect-1(GV-5): the ONE coverage/phase derivation the Plan
    // service's gate fact builder also uses, over the same Task rows this reader
    // just read, so the paused gate card names the action that was emitted.
    const definitions = [...rows.values()].map((row) => row.definition);
    for (const row of rows.values()) {
      const failure = row.failure;
      if (failure === undefined) continue;
      const verdict = failure.automation.verdict;
      let action: 'system_requeue' | 'auto_reverify';
      let countedNext: number;
      if (verdict.kind === 'requeue') {
        // The Workflow's `automaticRequeue` itself requires the saved revision;
        // without it the Workflow derives no operation, so the reader must not
        // invent a card either.
        if (failure.runRef === null || failure.runRevision === null) continue;
        action = 'system_requeue';
        countedNext = failure.automation.requeueAutoCount + (failure.failureClass === 'interrupted' ? 0 : 1);
      } else if (verdict.kind === 'reverify') {
        if (verdict.needsFinalize || failure.round === null) continue;
        const exemption = reverifyExemptionOfFacts({ checks: failure.round.failingChecks, gapCodes: failure.round.gapCodes });
        action = 'auto_reverify';
        countedNext = successorAutoCount(failure.round.autoCount, 'system', exemption);
      } else if (verdict.kind === 'stopped' && verdict.reason === 'budget_exhausted'
        && failure.failureClass !== null && failure.runRef !== null && failure.runRevision !== null) {
        // LB-1: the Host budget lift turns this stop into a `system_requeue`; the
        // reader derives it always, with the count a requeue would use.
        action = 'system_requeue';
        countedNext = failure.automation.requeueAutoCount + (failure.failureClass === 'interrupted' ? 0 : 1);
      } else if (verdict.kind === 'none' && goal.desiredState === 'paused') {
        // A model-service interruption waits for the person: no confirmation card while the Goal is paused.
        if (failure.subjectKind === 'work' && failure.failureClass === 'interrupted' && failure.runRef !== null) {
          const read = await readRecordOf(failure.runRef);
          if (!read.ok) return { ok: false, rejection: read.rejection };
          const run = decodeRun(read.record);
          if (!run.ok) return { ok: false, rejection: unavailable(`the failure Run ${failure.runRef.runId} is corrupt: ${run.reason}`) };
          if (modelServiceOf(run.value) !== null) continue;
        }
        const paused = pausedAutomationAction({
          taskDispositionActive: row.disposition === 'active', failure,
          ...(row.definition.taskKind === 'gate'
            ? { gateFixInProgress: gateFixInProgress(definitions, row.definition,
              (taskId) => rows.get(taskId)?.effectivePhase) }
            : {}),
        });
        if (paused === null) continue;
        action = paused.action;
        countedNext = paused.countedNext;
      } else {
        continue;
      }
      // §3.3 line 629 / defect-1: the Run's formal revision, never `0`. A read
      // failure is returned, never folded into a Task-only or fabricated pin.
      let runRevision = failure.runRevision;
      if (failure.runRef !== null) {
        const read = await runPinOf(failure.runRef, failure.runRevision);
        if (!read.ok) return { ok: false, rejection: read.rejection };
        runRevision = read.pin.revision;
      }
      const derived = automationConfirmationCause({
        autonomy: settings.autonomy, action, countedNext, cap: failure.automation.cap,
        goalRef: goal.ref, taskId: row.ref.taskId, runRef: failure.runRef, runRevision,
        // L22: the user's review answer or released "I'll handle it" already
        // confirmed the one system requeue of the original Run.
        requeueConfirmedByReview: failure.unknownCallReview?.requeueConfirmed ?? false,
      });
      if (derived === null) continue;
      causes.push(cause({ goal, code: derived.code, action: derived.action, affected: derived.affected,
        taskRef: taskTriple(goal, row.ref.taskId), runRef: failure.runRef }));
    }
    return { ok: true, causes };
  }

  /** The project's formal active pointers; their absence is the §4.2/rule-14 source. */
  async function missingGovernanceCauses(goal: GoalSnapshot): Promise<CauseReadResult> {
    const pointers = await readInitializationPointers(records, goal.ref.projectId);
    if (pointers.status !== 'ready') {
      const reason = pointers.status === 'rejected'
        ? pointers.reason
        : `the governance pointers are unavailable: ${pointers.status}`;
      return { ok: false, rejection: unavailable(reason) };
    }
    const causes: GoalDecisionCauseReadV1[] = [];
    if (pointers.value.architecture === null) {
      causes.push(cause({ goal, code: 'missing_initial_architecture', action: 'adopt_first_plan',
        affected: [], taskRef: null, runRef: null }));
    }
    if (pointers.value.completionPolicy === null) {
      causes.push(cause({ goal, code: 'missing_initial_completion_policy', action: 'adopt_first_plan',
        affected: [], taskRef: null, runRef: null }));
    }
    return { ok: true, causes };
  }

  return {
    async readGoalDecisionCauses(ctx: CoreCallContext, input: { goalRef: GoalRef; atLeastCursor?: CommitCursor }) {
      if (input.goalRef.projectId !== ctx.projectId) return forbidden('the Goal belongs to another project');
      const goalRead = await readGoalRecord(input.goalRef);
      if (isRej(goalRead)) return goalRead;
      const { goal, readThrough } = goalRead;
      if (goal.workspaceRef.workspaceId !== ctx.workspaceId) return forbidden('the Goal belongs to another workspace');
      // The Goal read is the first read; every later read happens after it, so
      // a Goal read at or past the required position makes the whole result at
      // least that new.
      const readiness = atLeastCursorResult<GoalDecisionCauseReadV1[]>(readThrough, input.atLeastCursor);
      if (readiness !== null) return readiness;

      const governance = await missingGovernanceCauses(goal);
      if (!governance.ok) return governance.rejection;
      const rows = await readTaskRows(ctx, goal);
      if (!rows.ok) return rows.rejection;
      const displayed = await displayCauses(ctx, goal, rows.rows);
      if (!displayed.ok) return displayed.rejection;
      const automated = await automationCauses(goal, rows.rows);
      if (!automated.ok) return automated.rejection;
      const causes = [...governance.causes, ...displayed.causes, ...automated.causes];

      // The same cause code may appear twice (e.g. two pending causes); the §3.3
      // identity de-duplicates by code + affected refs, so only the first wins.
      const byKey = new Map<string, GoalDecisionCauseReadV1>();
      for (const entry of causes) byKey.set(entry.source.key, entry);
      return { status: 'ready', value: [...byKey.values()] };
    },
  };
}
