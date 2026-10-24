/**
 * Slice 5 §4.5 finite decision coordination (SPEC lines 884–886).
 *
 * `resolveDecision` is the ONE finite coordinator for the
 * `answerDecision → resolveGoalConflict → recordDecisionApplication` chain: the
 * answer is its own commit, the structured conflict action (only for an active
 * Goal's conflict card) is a second commit, and recording the application is a
 * third. Each command keeps its own `:answer` / `:settings` / `:application`
 * request identity and the original captured source pins. `orderGoalAdvances`
 * is the read-only ordering safe point (§4.5 lines 890): Host's existing
 * collaboration driver hands it the currently pending advances and it sorts by
 * `Goal.settings.order`, then the Goal key, then flowId/taskId, without adding a
 * scheduler, queue or persisted Host state.
 *
 * Rule 19: once the answer committed, a later failure is reported as `ready`
 * with the real receipts of the committed steps and `application_not_recorded`
 * (or `awaiting_resume` for a paused Goal); an answered card is never reported
 * as never answered and a committed step is never undone.
 */
import type { CommitCursor } from '../../contracts/command-event.js';
import type { VersionPin } from '../../contracts/core/identity.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../contracts/core/results.js';
import type { DecisionApplicationReceiptV1, SessionMessageRef } from '../../contracts/core/session-message.js';
import type { DecisionSelectionV1, DecisionSourceV1 } from '../../contracts/goal-decisions.js';
import type { GoalRef, GoalSnapshot } from '../../contracts/ledger.js';
import type { UnknownCallReviewV1 } from '../../contracts/unknown-call-review.js';
import type { CommandRerunRequestV1 } from '../../contracts/command-rerun-request.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import { isRecord, nonEmpty } from '../../contracts/validation/common.js';
import type { SessionMessage } from '../../core/work-graph/model/communication-contracts.js';
import type { CommandRerunRequestPort } from '../../core/work-graph/model/command-rerun-request-contracts.js';
import { commandRerunRequestRefOfSource } from '../../core/work-graph/tasks/command-rerun-request-codecs.js';
import type {
  DecisionMessagePort,
  GoalExecutedFilesPort,
  GoalSettingsPort,
  MessageDutiesFactsPort,
  ResolveDecisionActionV1,
} from '../../core/work-graph/model/decision-contracts.js';
import type { GraphWrite } from '../../core/work-graph/model/task-contracts.js';
import type {
  ResolveDecisionInputV1,
  ResolveDecisionReadV1,
  WorkflowAdvanceInput,
} from './contracts.js';

/** The narrow, internal result of one dispatched application step (U6). */
type DecisionApplicationOutcome = {
  action: ResolveDecisionActionV1 | WriteResult<UnknownCallReviewV1> | WriteResult<CommandRerunRequestV1>;
  receipt: DecisionApplicationReceiptV1 | null;
  /** Present when the step reports a coordination state (the conflict path). */
  state?: ResolveDecisionReadV1['state'];
};

/**
 * 4C-2 U6: one source kind's application step. The coordinator commits the
 * answer first, then dispatches step ② through ONE adapter table: the default
 * `goal_conflict` registration merged with `deps.decisionApplications`. A kind
 * with no adapter answers the card only. `receipt` is the formal receipt to
 * record in step ③; a `NoteDispositionResult` may instead carry its own.
 */
export type DecisionApplicationAdapter = {
  apply(ctx: CoreCallContext, input: {
    answer: SessionMessage; answerRef: SessionMessageRef;
    source: DecisionSourceV1; selection: DecisionSelectionV1; requestId: string; expected: VersionPin[];
  }): Promise<{ status: 'ready'; value: DecisionApplicationOutcome }>;
};

/**
 * The exact owners the finite decision coordinator composes. The settings owner
 * supplies the structured conflict action; the message owner answers and
 * records; the source/duties/executed-files readers are the §3.3 fact seams.
 *
 * `applicationReceipt` reads the formal identity/fingerprint of the settings
 * commit at its returned cursor (the `GoalSettingsChanged` event persists them),
 * so `recordDecisionApplication` can prove the change without the coordinator
 * knowing an owner-private identity algorithm. It is the ONE extra seam the
 * conflict path needs and it grants nothing.
 */
export type DecisionActionDependencies = {
  goalSettings?: GoalSettingsPort;
  decisionMessages?: Pick<DecisionMessagePort,
    'answerDecision' | 'readDecisionAnswer' | 'recordDecisionApplication'>;
  decisionDuties?: MessageDutiesFactsPort;
  goalExecutedFiles?: GoalExecutedFilesPort;
  /**
   * 4C-2 U6: the per-source-kind application adapters. A provided adapter is
   * dispatched after the answer commit and may return the formal receipt to
   * record. `goal_conflict` has a default registration inside the coordinator;
   * an entry here replaces it.
   */
  decisionApplications?: Partial<Record<DecisionSourceV1['kind'], DecisionApplicationAdapter>>;
  /**
   * §3.3 line 625: the earlier Goal's GoalPhase pin a `conflict_wait` settings
   * command must carry (absent phase = revision 0). Read-only; the settings owner
   * CASes it. Optional so an old composition still starts.
   */
  goalPhasePin?: (ctx: CoreCallContext, goalRef: GoalRef) => Promise<VersionPin | CoreRejection>;
  applicationReceipt?: (ctx: CoreCallContext, cursor: CommitCursor) => Promise<DecisionApplicationReceiptV1 | null>;
};

/** The shared ②-then-③ result (the coordinator owns the exact public narrowing). */
type AppliedOutcome = {
  action: ResolveDecisionActionV1 | WriteResult<UnknownCallReviewV1> | WriteResult<CommandRerunRequestV1>;
  application: WriteResult<SessionMessage> | CoreRejection | null;
  state: ResolveDecisionReadV1['state'];
};

/** K3 L19/UR7: the ②-then-③ result of advancing one answered review card. */
export type ReviewDispositionAdvanceResultV1 = {
  action: WriteResult<UnknownCallReviewV1> | WriteResult<CommandRerunRequestV1> | CoreRejection | null;
  application: WriteResult<SessionMessage> | CoreRejection | null;
  state: ResolveDecisionReadV1['state'];
};

/** §4.5 Workflow decision surface: resolve one decision, order pending advances. */
export type DecisionActionsPort = {
  resolveDecision(
    ctx: CoreCallContext,
    request: GraphWrite<ResolveDecisionInputV1>,
  ): Promise<ReadResult<ResolveDecisionReadV1>>;
  /**
   * K3 L19/UR7/UR7b: run ② (the adapter table) then ③ on an ALREADY answered
   * card, using the saved answer message and its own recorded selection. The
   * coordinator never answers again; ② replays by answer-derived identity.
   * `options.applicationCtx` books ③ (default: `ctx`); UR7 passes the Host
   * operator so the slice-5 S5-MSG-04 guard admits the application while ②
   * still runs as the Workflow automation.
   */
  advanceReviewDisposition(
    ctx: CoreCallContext,
    request: GraphWrite<{ source: DecisionSourceV1; selection: DecisionSelectionV1;
      decisionMessageRef: SessionMessageRef }>,
    options?: { applicationCtx?: CoreCallContext },
  ): Promise<ReadResult<ReviewDispositionAdvanceResultV1>>;
  orderGoalAdvances(
    ctx: CoreCallContext,
    input: { advances: WorkflowAdvanceInput[] },
  ): Promise<ReadResult<{ advances: WorkflowAdvanceInput[] }>>;
};

function unsupported(reason: string): CoreRejection {
  return { status: 'rejected', code: 'unsupported', reason };
}

function ready(value: ResolveDecisionReadV1): ReadResult<ResolveDecisionReadV1> {
  return { status: 'ready', value };
}

function goalKey(goalRef: GoalRef): string {
  return canonicalJson(goalRef as unknown as JsonValue);
}

/** The three structured conflict selections that carry a settings action. */
type ConflictSelection = Extract<DecisionSelectionV1,
  { kind: 'conflict_wait' | 'conflict_order' | 'conflict_parallel' }>;

function isConflictSelection(selection: DecisionSelectionV1): selection is ConflictSelection {
  return selection.kind === 'conflict_wait' || selection.kind === 'conflict_order' || selection.kind === 'conflict_parallel';
}

/**
 * §8.2 line 1366: the read-only replay seam a settings owner may expose beside
 * `resolveGoalConflict`. It rebuilds the SAME identity/fingerprint and returns
 * the original committed receipt (or `absent`) without any current-fact read.
 * Optional so an old owner/composition still starts; kept structural here so
 * the shared `GoalSettingsPort` declaration stays untouched.
 */
type GoalConflictReplayOutcome =
  | { status: 'found'; value: { goals: GoalSnapshot[] }; cursor: CommitCursor }
  | { status: 'absent' }
  | CoreRejection;

type GoalConflictReplayPort = {
  readGoalConflictReplay?: (ctx: CoreCallContext, request: GraphWrite<{
    source: DecisionSourceV1;
    selection: ConflictSelection;
    decisionMessageRef: SessionMessageRef;
  }>) => Promise<GoalConflictReplayOutcome>;
};

/**
 * §4.5 line 884: the canonical source the committed answer captured
 * (`SessionMessage.response.decision.source`). It carries the exact pins and Goal
 * bases of the original command, so the settings command built from it replays
 * on a retry instead of re-reading current facts. Returns null when the answer
 * does not carry the captured source; the coordinator then refuses it.
 */
function capturedAnswerSource(message: SessionMessage): DecisionSourceV1 | null {
  const response: unknown = message.response;
  if (!isRecord(response)) return null;
  const decision = response['decision'];
  if (!isRecord(decision)) return null;
  const source = decision['source'];
  if (!isRecord(source) || !Array.isArray(source['pins'])) return null;
  return source as unknown as DecisionSourceV1;
}

function refKeyOf(ref: unknown): string | null {
  try { return canonicalJson(ref as JsonValue); } catch { return null; }
}

/** The captured pin of one Goal ref from the answered source, or null. */
function capturedGoalPin(pins: readonly VersionPin[], goalRef: GoalRef): VersionPin | null {
  const key = refKeyOf(goalRef);
  if (key === null) return null;
  for (const pin of pins) {
    if (refKeyOf(pin.ref) === key) return { ref: structuredClone(pin.ref), revision: pin.revision };
  }
  return null;
}

/** §3.3 line 625: the GoalPhase ref a `conflict_wait` pins (absent = revision 0). */
function goalPhaseRefOf(goalRef: GoalRef): { aggregateType: 'GoalPhase'; projectId: string; goalId: string } {
  return { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId };
}

/**
 * The exact pin REFS of a conflict settings command, known from the answered
 * card and the structured selection alone. Captured Goals keep their captured
 * revision; supplementary refs (the earlier GoalPhase, an uncaptured order Goal)
 * carry a placeholder because the owner's fingerprint nulls their revision. No
 * current fact is read.
 */
function replayExpectedPins(captured: DecisionSourceV1, selection: ConflictSelection): VersionPin[] {
  const capturedPins = Array.isArray(captured.pins) ? captured.pins : [];
  const refs: GoalRef[] = selection.kind === 'conflict_order'
    ? [...selection.goalOrder]
    : [selection.earlier, selection.later];
  const expected: VersionPin[] = refs.map((ref) => capturedGoalPin(capturedPins, ref) ?? { ref, revision: 0 });
  if (selection.kind === 'conflict_wait') expected.push({ ref: goalPhaseRefOf(selection.earlier), revision: 0 });
  return expected;
}

/**
 * K3 L19a: the `command_rerun_request` step ② adapter beside B1's
 * `unknown_call_review` row. It commits the owner's answer application under
 * the answer-derived identity (the CRR codecs' ONE helper), so a retried
 * `decisions/answer` and a crash re-drive replay the original receipt. The
 * coordinator's step ③ then reads the formal receipt from the changed event.
 */
export type CommandRerunRequestApplicationDependencies = {
  commandRerunRequests: Pick<CommandRerunRequestPort, 'applyAnswer'>;
};

export function createCommandRerunRequestApplicationAdapter(
  commandRerunRequests: CommandRerunRequestApplicationDependencies['commandRerunRequests'],
): DecisionApplicationAdapter {
  return {
    async apply(ctx, { answerRef, source, selection, requestId, expected }) {
      const requestRef = commandRerunRequestRefOfSource(source);
      if (requestRef === null) {
        return { status: 'ready', value: { action: {
          status: 'rejected', code: 'invalid',
          reason: 'the answer source is not a command_rerun_request card',
        }, receipt: null } };
      }
      const optionId = selection.kind === 'option' ? selection.optionId : null;
      if (optionId !== 'allow_rerun' && optionId !== 'deny' && optionId !== 'deny_final') {
        return { status: 'ready', value: { action: {
          status: 'rejected', code: 'invalid',
          reason: 'a command_rerun_request card answers allow_rerun, deny or deny_final',
        }, receipt: null } };
      }
      // F-072: a throw/unknown outcome at the new CRR ② boundary is a
      // STRUCTURED failure, never an escaping error that hides the saved ①
      // answer. ① is already committed by the coordinator.
      let result: Awaited<ReturnType<typeof commandRerunRequests.applyAnswer>>;
      try {
        result = await commandRerunRequests.applyAnswer(ctx, {
          input: { requestRef, selection: optionId, decisionMessageRef: answerRef },
          meta: { requestId, expected },
        });
      } catch (error) {
        return { status: 'ready', value: { action: {
          status: 'rejected', code: 'unavailable',
          reason: `the command-rerun answer could not be applied: ${
            error instanceof Error ? error.message : String(error)}`,
        }, receipt: null } };
      }
      // A committed result's formal DecisionApplicationReceiptV1 is read from
      // the CRR changed event at this cursor by the coordinator's step ③.
      return { status: 'ready', value: { action: result, receipt: null } };
    },
  };
}

export function createDecisionActions(deps: DecisionActionDependencies): DecisionActionsPort {
  /**
   * §3.3 line 625: the exact `meta.expected` pin set of a `resolveGoalConflict`
   * command. The conflict Goals come from the answered card's OWN captured source
   * (so a retry of the same requestId keeps the original fingerprint and replays
   * the settings receipt); `conflict_order` may name the full workspace Goal list,
   * and `conflict_wait` also pins the earlier GoalPhase (absent = revision 0).
   * Every read here is read-only.
   */
  async function settingsExpectedPins(owner: GoalSettingsPort, ctx: CoreCallContext,
    selection: ConflictSelection, captured: DecisionSourceV1 | null):
    Promise<{ pins: VersionPin[] } | CoreRejection> {
    const capturedPins = Array.isArray(captured?.pins) ? captured.pins : [];
    const pinOf = async (goalRef: GoalRef): Promise<VersionPin | CoreRejection> => {
      const capturedPin = capturedGoalPin(capturedPins, goalRef);
      if (capturedPin !== null) return capturedPin;
      const read = await owner.readGoalSettings(ctx, { goalRef });
      if (read.status !== 'ready') {
        return read.status === 'rejected'
          ? read
          : { status: 'rejected', code: 'incomplete', reason: 'the conflict Goal is not readable' };
      }
      return { ref: read.value.goal.ref, revision: read.value.goal.revision };
    };
    const refs: GoalRef[] = selection.kind === 'conflict_order'
      ? [...selection.goalOrder]
      : [selection.earlier, selection.later];
    const pins: VersionPin[] = [];
    for (const ref of refs) {
      const pin = await pinOf(ref);
      if ('status' in pin) return pin;
      pins.push(pin);
    }
    if (selection.kind === 'conflict_wait') {
      if (deps.goalPhasePin === undefined) {
        return unsupported('no GoalPhase reader is bound for a conflict wait');
      }
      const phase = await deps.goalPhasePin(ctx, selection.earlier);
      if ('status' in phase) return phase;
      pins.push(phase);
    }
    return { pins };
  }

  /**
   * ② The built-in `goal_conflict` adapter: the pre-4C-2 conflict chain moved
   * unchanged. It returns the structured settings action; step ③ records its
   * receipt from the committed cursor.
   */
  async function applyGoalConflict(
    ctx: CoreCallContext, answer: SessionMessage, answerRef: SessionMessageRef,
    selection: DecisionSelectionV1, requestId: string,
    goalSettings: GoalSettingsPort,
  ): Promise<{ status: 'ready'; value: DecisionApplicationOutcome }> {
    // Free text / option / non-conflict answers only answer the card in this
    // slice; adopting a candidate still goes through the original plans/apply.
    if (!isConflictSelection(selection)) {
      return { status: 'ready', value: { action: null, receipt: null } };
    }

    // The command carries the answer's captured source pins; the supplementary
    // pins (the earlier GoalPhase of a wait, the uncaptured Goals of an order)
    // are read current and guard a first execution. §8.2 line 1366 / §4.5 line
    // 884: the ORIGINAL receipt is asked for FIRST, before any current-fact
    // read, because the owner's fingerprint keeps the captured pins alone.
    let action: WriteResult<{ goals: GoalSnapshot[] }> | CoreRejection;
    const captured = capturedAnswerSource(answer);
    if (captured !== null) {
      const replayPort = goalSettings as GoalSettingsPort & GoalConflictReplayPort;
      const replay = replayPort.readGoalConflictReplay === undefined
        ? { status: 'absent' as const }
        : await replayPort.readGoalConflictReplay(ctx, {
          input: { source: captured, selection, decisionMessageRef: answerRef },
          meta: { requestId: `${requestId}:settings`, expected: replayExpectedPins(captured, selection) },
        });
      if (replay.status === 'found') {
        action = { status: 'committed', value: replay.value, replayed: true, cursor: replay.cursor };
      } else if (replay.status === 'absent') {
        const derived = await settingsExpectedPins(goalSettings, ctx, selection, captured);
        if ('status' in derived) {
          return { status: 'ready', value: { action: derived, receipt: null, state: 'application_not_recorded' } };
        }
        action = await goalSettings.resolveGoalConflict(ctx, {
          input: { source: captured, selection, decisionMessageRef: answerRef },
          meta: { requestId: `${requestId}:settings`, expected: derived.pins },
        });
      } else {
        action = replay;
      }
    } else {
      return { status: 'ready', value: { action: {
        status: 'rejected', code: 'invalid',
        reason: 'the decision answer does not carry the captured decision source',
      }, receipt: null, state: 'application_not_recorded' } };
    }
    return { status: 'ready', value: { action, receipt: null } };
  }

  /**
   * The ONE ② adapter table, keyed by source kind: the built-in
   * `goal_conflict` registration merged with the composition's adapters. No
   * second dispatch table exists.
   */
  function applicationTable(
    goalSettings: DecisionActionDependencies['goalSettings'],
  ): Partial<Record<DecisionSourceV1['kind'], DecisionApplicationAdapter>> {
    const applications: Partial<Record<DecisionSourceV1['kind'], DecisionApplicationAdapter>> = {
      ...(goalSettings === undefined ? {} : {
        goal_conflict: {
          apply: (adapterCtx: CoreCallContext, adapterInput: Parameters<DecisionApplicationAdapter['apply']>[1]) =>
            applyGoalConflict(adapterCtx, adapterInput.answer, adapterInput.answerRef,
              adapterInput.selection, adapterInput.requestId, goalSettings),
        },
      }),
      ...deps.decisionApplications,
    };
    return applications;
  }

  /**
   * ③ Record the dispatched action's formal receipt (U6). The adapter may hand
   * one over directly; a committed WriteResult is proved from its cursor via
   * `applicationReceipt`; a done `NoteDispositionResult` carries its own. Rule
   * 19: after the answer commit every later failure is a `ready` result.
   *
   * `applicationCtx` is the identity ③ is booked under; it is separate from the
   * execution context ② ran as (K3-17: UR7's ② is the Workflow automation, its
   * ③ is the Host operator the slice-5 S5-MSG-04 guard admits).
   */
  async function recordApplicationOutcome(
    ctx: CoreCallContext, applicationCtx: CoreCallContext,
    decisionMessages: NonNullable<DecisionActionDependencies['decisionMessages']>,
    answerRef: SessionMessageRef, answerRevision: number,
    requestId: string, outcome: DecisionApplicationOutcome,
  ): Promise<AppliedOutcome> {
    const action = outcome.action;
    if (outcome.state !== undefined) {
      return { action, application: null, state: outcome.state };
    }
    if (action !== null && action.status === 'rejected') {
      return { action, application: null,
        state: action.code === 'busy' ? 'awaiting_resume' : 'application_not_recorded' };
    }
    let receipt = outcome.receipt;
    if (receipt === null && action !== null) {
      if (action.status === 'committed') {
        receipt = deps.applicationReceipt === undefined ? null : await deps.applicationReceipt(applicationCtx, action.cursor);
      } else if (action.status === 'done') {
        receipt = action.receipt;
      }
    }
    if (receipt === null) {
      return { action, application: null, state: action === null ? 'answered' : 'application_not_recorded' };
    }
    const application: WriteResult<SessionMessage> | CoreRejection =
      await decisionMessages.recordDecisionApplication(applicationCtx, {
        input: { messageRef: answerRef, receipt },
        meta: { requestId: `${requestId}:application`, expected: [{ ref: answerRef, revision: answerRevision }] },
      });
    return { action, application,
      state: application.status === 'committed' ? 'applied' : 'application_not_recorded' };
  }

  /**
   * The ONE ②-then-③ path shared by `resolveDecision` (after its ①) and the
   * K3 UR7/UR7b `advanceReviewDisposition` (no second answer). ② runs as
   * `ctx`; ③ is booked as `applicationCtx` (the same context unless a caller
   * separates them, as UR7 does).
   */
  async function dispatchApplication(
    ctx: CoreCallContext, applicationCtx: CoreCallContext, input: {
      answer: SessionMessage; answerRef: SessionMessageRef; answerRevision: number;
      source: DecisionSourceV1; selection: DecisionSelectionV1;
      requestId: string; expected: VersionPin[];
    },
    decisionMessages: NonNullable<DecisionActionDependencies['decisionMessages']>,
  ): Promise<AppliedOutcome> {
    const adapter = applicationTable(deps.goalSettings)[input.source.kind];
    if (adapter === undefined) {
      return { action: null, application: null, state: 'answered' };
    }
    const applied = await adapter.apply(ctx, {
      answer: input.answer, answerRef: input.answerRef, source: input.source,
      selection: input.selection, requestId: input.requestId, expected: input.expected,
    });
    return recordApplicationOutcome(ctx, applicationCtx, decisionMessages,
      input.answerRef, input.answerRevision, input.requestId, applied.value);
  }

  async function resolveDecision(
    ctx: CoreCallContext,
    request: GraphWrite<ResolveDecisionInputV1>,
  ): Promise<ReadResult<ResolveDecisionReadV1>> {
    const goalSettings = deps.goalSettings;
    const decisionMessages = deps.decisionMessages;
    if (goalSettings === undefined || decisionMessages === undefined) {
      return unsupported('the Workflow has no goal-settings/decision-message owner for a decision');
    }
    const raw = request as unknown as Record<string, unknown> | null | undefined;
    if (!isRecord(raw) || !isRecord(raw['meta']) || !nonEmpty(raw['meta']['requestId'])
      || !Array.isArray(raw['meta']['expected']) || !isRecord(raw['input'])) {
      return { status: 'rejected', code: 'invalid', reason: 'resolveDecision requires an input object and meta.requestId/expected' };
    }
    const input = raw['input'] as unknown as ResolveDecisionInputV1;
    const requestId = raw['meta']['requestId'] as string;
    const expected = raw['meta']['expected'] as VersionPin[];

    // ① The answer is always its own commit. A refusal BEFORE the answer is the
    // overall rejection; nothing here pretends the card was answered.
    const answer = await decisionMessages.answerDecision(ctx, {
      input: { source: input.source, selection: input.selection, text: input.text, annotations: input.annotations },
      meta: { requestId: `${requestId}:answer`, expected: [...expected] },
    });
    if (answer.status !== 'committed') return answer;

    // ② then ③, through the ONE adapter table. The person's own answer books
    // both under the same context (no behaviour change).
    const outcome = await dispatchApplication(ctx, ctx, {
      answer: answer.value, answerRef: answer.value.ref, answerRevision: answer.value.revision,
      source: input.source, selection: input.selection, requestId, expected,
    }, decisionMessages);
    return ready({ answer, action: outcome.action as ResolveDecisionActionV1,
      application: outcome.application, state: outcome.state });
  }

  /**
   * K3 L19 / UR7 / UR7b: advance an ALREADY answered card by its saved answer.
   * ② replays by the answer-derived identity and runs as `ctx`; ③ records the
   * original receipt under `options.applicationCtx` (default `ctx`). The
   * answer's own recorded selection is authoritative; a caller selection that
   * disagrees with the saved one is `invalid`.
   */
  async function advanceReviewDisposition(
    ctx: CoreCallContext,
    request: GraphWrite<{ source: DecisionSourceV1; selection: DecisionSelectionV1;
      decisionMessageRef: SessionMessageRef }>,
    options?: { applicationCtx?: CoreCallContext },
  ): Promise<ReadResult<ReviewDispositionAdvanceResultV1>> {
    const applicationCtx = options?.applicationCtx ?? ctx;
    const decisionMessages = deps.decisionMessages;
    if (decisionMessages === undefined) {
      return unsupported('the Workflow has no decision-message owner for a review disposition');
    }
    const raw = request as unknown as Record<string, unknown> | null | undefined;
    if (!isRecord(raw) || !isRecord(raw['meta']) || !nonEmpty(raw['meta']['requestId'])
      || !Array.isArray(raw['meta']['expected']) || !isRecord(raw['input'])) {
      return { status: 'rejected', code: 'invalid',
        reason: 'advanceReviewDisposition requires an input object and meta.requestId/expected' };
    }
    const input = raw['input'] as unknown as {
      source: DecisionSourceV1; selection: DecisionSelectionV1; decisionMessageRef: SessionMessageRef };
    const requestId = raw['meta']['requestId'] as string;
    const expected = raw['meta']['expected'] as VersionPin[];
    if (!isRecord(input.source) || !nonEmpty(input.source.key) || !isRecord(input.selection)) {
      return { status: 'rejected', code: 'invalid', reason: 'advanceReviewDisposition requires a decision source and selection' };
    }
    if (!isRecord(input.decisionMessageRef)) {
      return { status: 'rejected', code: 'invalid', reason: 'advanceReviewDisposition requires the answer message ref' };
    }
    const read = await decisionMessages.readDecisionAnswer(ctx, { source: input.source });
    if (read.status !== 'ready') {
      if (read.status === 'rejected') return read;
      if (read.status === 'not_found') return { status: 'not_found' };
      return read;
    }
    const { message, body } = read.value;
    if (message === null || body === null) {
      return { status: 'rejected', code: 'invalid', reason: 'the saved answer message has no readable decision body' };
    }
    const messageKey = refKeyOf(message.ref);
    if (messageKey === null || messageKey !== refKeyOf(input.decisionMessageRef)) {
      return { status: 'rejected', code: 'invalid',
        reason: 'the saved answer message is not the requested decisionMessageRef' };
    }
    const selectionKey = refKeyOf(body.selection);
    if (selectionKey === null || selectionKey !== refKeyOf(input.selection)) {
      return { status: 'rejected', code: 'invalid',
        reason: 'the requested selection disagrees with the saved answer selection' };
    }
    const outcome = await dispatchApplication(ctx, applicationCtx, {
      answer: message, answerRef: message.ref, answerRevision: message.revision,
      source: input.source, selection: body.selection, requestId, expected,
    }, decisionMessages);
    return { status: 'ready', value: {
      action: outcome.action as ReviewDispositionAdvanceResultV1['action'],
      application: outcome.application, state: outcome.state } };
  }

  async function orderGoalAdvances(
    ctx: CoreCallContext,
    input: { advances: WorkflowAdvanceInput[] },
  ): Promise<ReadResult<{ advances: WorkflowAdvanceInput[] }>> {
    if (deps.goalSettings === undefined) return unsupported('no Goal-settings owner is bound for advance ordering');
    const advances = Array.isArray(input?.advances) ? input.advances : [];
    const ordered: { advance: WorkflowAdvanceInput; order: number; key: string; flowId: string; taskId: string }[] = [];
    for (const advance of advances) {
      if (!isRecord(advance) || !isRecord(advance.goalRef)) {
        return { status: 'rejected', code: 'invalid', reason: 'an advance must carry a complete GoalRef' };
      }
      const read = await deps.goalSettings.readGoalSettings(ctx, { goalRef: advance.goalRef });
      if (read.status !== 'ready') {
        return read.status === 'rejected'
          ? read
          : { status: 'rejected', code: 'incomplete', reason: 'the advance Goal settings are not readable' };
      }
      ordered.push({
        advance, order: read.value.settings.order, key: goalKey(advance.goalRef),
        flowId: advance.flowId, taskId: advance.taskId ?? '',
      });
    }
    ordered.sort((left, right) => left.order - right.order
      || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
      || (left.flowId < right.flowId ? -1 : left.flowId > right.flowId ? 1 : 0)
      || (left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0));
    return { status: 'ready', value: { advances: ordered.map((entry) => entry.advance) } };
  }

  return { resolveDecision, advanceReviewDisposition, orderGoalAdvances };
}
