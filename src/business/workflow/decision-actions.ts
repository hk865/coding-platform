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
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import type { SessionMessage } from '../../core/work-graph/model/communication-contracts.js';
import type {
  DecisionMessagePort,
  DecisionSourceFactsPort,
  GoalExecutedFilesPort,
  GoalSettingsPort,
  MessageDutiesFactsPort,
} from '../../core/work-graph/model/decision-contracts.js';
import type { GraphWrite } from '../../core/work-graph/model/task-contracts.js';
import type {
  ResolveDecisionInputV1,
  ResolveDecisionReadV1,
  WorkflowAdvanceInput,
} from './contracts.js';

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
  decisionSources?: DecisionSourceFactsPort;
  decisionDuties?: MessageDutiesFactsPort;
  goalExecutedFiles?: GoalExecutedFilesPort;
  /**
   * §3.3 line 625: the earlier Goal's GoalPhase pin a `conflict_wait` settings
   * command must carry (absent phase = revision 0). Read-only; the settings owner
   * CASes it. Optional so an old composition still starts.
   */
  goalPhasePin?: (ctx: CoreCallContext, goalRef: GoalRef) => Promise<VersionPin | CoreRejection>;
  applicationReceipt?: (ctx: CoreCallContext, cursor: CommitCursor) => Promise<DecisionApplicationReceiptV1 | null>;
};

/** §4.5 Workflow decision surface: resolve one decision, order pending advances. */
export type DecisionActionsPort = {
  resolveDecision(
    ctx: CoreCallContext,
    request: GraphWrite<ResolveDecisionInputV1>,
  ): Promise<ReadResult<ResolveDecisionReadV1>>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
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
 * on a retry instead of re-reading current facts. Returns null for any answer
 * that does not carry the slice-5 user-response shape.
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
    const answerRef = answer.value.ref;

    // Free text / option / non-conflict answers only answer the card in this
    // slice; adopting a candidate still goes through the original plans/apply.
    if (!isConflictSelection(input.selection)) {
      return ready({ answer, action: null, application: null, state: 'answered' });
    }

    // ② The structured conflict action. The command carries the answer's captured
    // source pins; the supplementary pins (the earlier GoalPhase of a wait, the
    // uncaptured Goals of an order) are read current and guard a first execution.
    // §8.2 line 1366 / §4.5 line 884: the ORIGINAL receipt is asked for FIRST,
    // before any current-fact read, because the owner's fingerprint keeps the
    // captured pins alone. Only when there is no original receipt does the
    // coordinator read the supplementary pins for the first execution's CAS.
    let action: WriteResult<{ goals: GoalSnapshot[] }> | CoreRejection;
    const captured = capturedAnswerSource(answer.value);
    if (captured !== null) {
      const replayPort = goalSettings as GoalSettingsPort & GoalConflictReplayPort;
      const replay = replayPort.readGoalConflictReplay === undefined
        ? { status: 'absent' as const }
        : await replayPort.readGoalConflictReplay(ctx, {
          input: { source: captured, selection: input.selection, decisionMessageRef: answerRef },
          meta: { requestId: `${requestId}:settings`, expected: replayExpectedPins(captured, input.selection) },
        });
      if (replay.status === 'found') {
        action = { status: 'committed', value: replay.value, replayed: true, cursor: replay.cursor };
      } else if (replay.status === 'absent') {
        const derived = await settingsExpectedPins(goalSettings, ctx, input.selection, captured);
        if ('status' in derived) {
          return ready({ answer, action: derived, application: null, state: 'application_not_recorded' });
        }
        action = await goalSettings.resolveGoalConflict(ctx, {
          input: { source: captured, selection: input.selection, decisionMessageRef: answerRef },
          meta: { requestId: `${requestId}:settings`, expected: derived.pins },
        });
      } else {
        action = replay;
      }
    } else {
      // Compatibility path for an answer response without the slice-5 captured
      // source shape: the original current-fact read decides.
      if (deps.decisionSources === undefined) {
        return ready({ answer, action: null, application: null, state: 'application_not_recorded' });
      }
      const sourceRead = await deps.decisionSources.readSource(ctx, input.source);
      if (sourceRead.status !== 'ready') {
        const sourceFailure: CoreRejection = sourceRead.status === 'rejected' ? sourceRead
          : { status: 'rejected', code: sourceRead.status === 'not_found' ? 'not_found' : 'unavailable',
            reason: 'the decision source of the answer is not readable' };
        return ready({ answer, action: sourceFailure, application: null, state: 'application_not_recorded' });
      }
      const facts = sourceRead.value;
      if (facts.goal.desiredState !== 'active') {
        return ready({ answer, action: null, application: null, state: 'awaiting_resume' });
      }
      const derived = await settingsExpectedPins(goalSettings, ctx, input.selection, facts.source);
      if ('status' in derived) {
        return ready({ answer, action: derived, application: null, state: 'application_not_recorded' });
      }
      action = await goalSettings.resolveGoalConflict(ctx, {
        input: { source: facts.source, selection: input.selection, decisionMessageRef: answerRef },
        meta: { requestId: `${requestId}:settings`, expected: derived.pins },
      });
    }

    if (action.status !== 'committed') {
      return ready({ answer, action, application: null,
        state: action.code === 'busy' ? 'awaiting_resume' : 'application_not_recorded' });
    }

    // ③ Record the application of the change the settings owner just committed,
    // proved from that commit's own formal receipt. Missing receipt leaves the
    // card answered and pending application; it never hides the committed step.
    const receipt = deps.applicationReceipt === undefined ? null : await deps.applicationReceipt(ctx, action.cursor);
    if (receipt === null) {
      return ready({ answer, action, application: null, state: 'application_not_recorded' });
    }
    const application: ResolveDecisionReadV1['application'] = await decisionMessages.recordDecisionApplication(ctx, {
      input: { messageRef: answerRef, receipt },
      meta: { requestId: `${requestId}:application`, expected: [{ ref: answerRef, revision: answer.value.revision }] },
    });
    return ready({
      answer, action, application,
      state: application.status === 'committed' ? 'applied' : 'application_not_recorded',
    });
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

  return { resolveDecision, orderGoalAdvances };
}
