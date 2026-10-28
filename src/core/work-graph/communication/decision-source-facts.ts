/**
 * Slice 5 §3.3 canonical decision-source facts (F41).
 *
 * The read-only seam that turns a `DecisionSourceV1` into its formal Goal,
 * objects, options, guards, `closed` flag and allowed reader Sessions, and that
 * proves one recorded application through its real receipt. It does not depend
 * on `views`; the source is re-derived from the lower-level records and the
 * shared `decisionSourceKey` contract, so a caller can never merely assert
 * "this card exists" (SPEC §4.2 line 790, S5-MSG-03).
 *
 * Every kind re-derives its identity, objects, pins, closure and allowed
 * readers from the formal records: a candidate is the real per-request head (or
 * the named proposal), a planning question is a real saved Answer question, a
 * goal cause names real affected objects (or a real missing active pointer) and
 * a goal conflict proves both Goals, both active Plan pointers and a real §4.3
 * overlap. The caller's `source.pins` are never trusted as authorization.
 *
 * Each source kind's branch lives in `decision-source/`; this module keeps the
 * public factory, the common pre-checks, the dispatch, the final pin re-check
 * and the result assembly.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { DecisionObjectV1, DecisionOptionV1, DecisionSourceIdentityV1,
  DecisionSourceV1 } from '../../../contracts/goal-decisions.js';
import { DecisionSubjectShape, decisionSubjectGoalRef, decisionSourceKey } from '../../../contracts/goal-decisions.js';
import { canonicalOf } from '../../../contracts/fingerprint.js';
import { rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import { isRecord } from '../../../contracts/validation/common.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { DecisionSourceFactsPort, NoteDecisionSourcePort, S5RecordPort } from '../model/decision-contracts.js';
import type { InitializationBindingReadPort } from '../model/goal-card-contracts.js';
import type { UnknownCallReviewReadPort } from '../model/unknown-call-review-contracts.js';
import type { CommandRerunRequestReadPort } from '../model/command-rerun-request-contracts.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import type { KernelCommandReader } from '../model/kernel-command-read-contracts.js';
import type { PlanProposalRef, PlanTaskPort } from '../model/plan-contracts.js';
import { decodeQueryJobAnswerSnapshot, decodeQueryRunSnapshotRecord } from '../queries/query-record-codecs.js';
import { createGoalDecisionCauseReader } from '../tasks/goal-decision-reader.js';
import { readProposal } from '../tasks/plan-readers.js';
import { decodeSessionMessageRecord } from '../sessions/message-record-codecs.js';
import type { WorkspaceToolsPort } from '../../workspace/ports.js';
import { readApplicationReceiptFacts } from './decision-application.js';
import { clonePins, createSourceReadSupport, isAbsencePin, readStoredDecoded,
  SAVED_ANSWER_READ_TEMPLATES, type Scope } from './decision-source/read-support.js';
import { readMessageSource } from './decision-source/message.js';
import { readGoalCauseSource } from './decision-source/goal-cause.js';
import { readCandidateSource } from './decision-source/candidate.js';
import { readPlanningQuestionSource } from './decision-source/planning-question.js';
import { readGoalConflictSource } from './decision-source/goal-conflict.js';
import { readNoteReviewSource } from './decision-source/note-review.js';
import { readUnknownCallReviewSource } from './decision-source/unknown-call-review.js';
import { readCommandRerunRequestSource } from './decision-source/command-rerun-request.js';
import { readMessageReleaseSource } from './decision-source/message-release.js';
import type { DecisionSourceBranchFacts } from './decision-source/types.js';

/** The one Store seam this reader uses, the same instance every other WorkGraph reader shares. */
export type DecisionSourceFactsDependencies = {
  records: S5RecordPort;
  /**
   * §4.2 source 2: the formal Goal-cause reader seam (`queryGoalDisplay` and
   * `readInitialPlanAnswerFacts`). It is OPTIONAL so the frozen
   * `createDecisionSourceFacts({ records })` construction keeps compiling and
   * working; when present, a `goal_cause` source is proven to match one REAL
   * formal cause. Production wiring should pass the SAME Plan-service instance
   * the read model uses: `plans?: Pick<PlanTaskPort,
   * 'queryGoalDisplay' | 'readInitialPlanAnswerFacts'>`.
   */
  plans?: Pick<PlanTaskPort, 'queryGoalDisplay' | 'readInitialPlanAnswerFacts'>;
  /**
   * The notes owner's note-review decision port. Optional; without it a
   * `note_review` source is explicitly `unavailable`, never an empty source.
   */
  noteDecisions?: Pick<NoteDecisionSourcePort, 'readNoteDecision'>;
  /**
   * The UnknownCallReview owner's direct read. Optional; without it a
   * `unknown_call_review` source is explicitly `unavailable`, never an empty
   * source. Only `readReview` is needed here (the card source reads the list).
   */
  unknownCallReviews?: Pick<UnknownCallReviewReadPort, 'readReview'>;
  /**
   * The CommandRerunRequest owner's direct read. Optional; without it
   * (or the Kernel reader/execution read below) a `command_rerun_request`
   * source is explicitly `unavailable`, never an inferred open card.
   */
  commandRerunRequests?: Pick<CommandRerunRequestReadPort, 'listRequests' | 'readRequest'>;
  /** The original Run's Kernel command text (the card's blocked command). */
  readKernelCommandFacts?: KernelCommandReader;
  /** The original Run's Session, the Kernel reader's input. */
  commandRerunExecutions?: Pick<ExecutionReadPort, 'readExecution'>;
  /**
   * The workspace owner's read seam for each target path's current
   * digest. Optional so the frozen `{ records }` construction keeps compiling;
   * absent, every file object's digest is `null`.
   */
  workspace?: Pick<WorkspaceToolsPort, 'readWorkspace'>;
  /** The initialization binding read a planning-question binding source checks. */
  bindings: InitializationBindingReadPort;
};

/** Builds the canonical source/application facts reader. */
export function createDecisionSourceFacts(
  deps: DecisionSourceFactsDependencies,
): DecisionSourceFactsPort {
  const records = deps.records;
  // §4.2 source 2: when the composition injects the formal Goal-cause reader,
  // every `goal_cause` source is verified against the real derived cause. When
  // it is absent (the frozen `{ records }` construction), only the named-code
  // check plus the affected-object reads below apply.
  const goalCauses = deps.plans === undefined
    ? null : createGoalDecisionCauseReader({ records, plans: deps.plans });

  return {
    async readSource(ctx: CoreCallContext, source: DecisionSourceV1): Promise<ReadResult<{
      source: DecisionSourceV1; goal: GoalSnapshot | null;
      objects: DecisionObjectV1[]; options: DecisionOptionV1[];
      guards: readonly import('../../record-store/ports.js').RecordGuard[]; closed: boolean;
      allowedReaderSessionRefs: SessionRef[];
    }>> {
      if (!isRecord(source) || typeof source.key !== 'string' || source.key.length === 0) {
        return rejectedWithCurrent('invalid', 'readSource requires a decision source with its canonical key');
      }
      if (typeof ctx.projectId !== 'string' || ctx.projectId.length === 0
        || typeof ctx.workspaceId !== 'string' || ctx.workspaceId.length === 0) {
        return rejectedWithCurrent('forbidden', 'readSource requires a trusted bound project/workspace scope');
      }
      const scope: Scope = { projectId: ctx.projectId, workspaceId: ctx.workspaceId };
      let parsed: unknown;
      try {
        parsed = JSON.parse(source.key);
      } catch {
        return rejectedWithCurrent('invalid', 'the decision source key is not parseable JSON');
      }
      if (!isRecord(parsed) || parsed['kind'] !== source.kind) {
        return rejectedWithCurrent('invalid', 'the decision source key does not match its declared kind');
      }
      const identity = parsed as unknown as DecisionSourceIdentityV1;
      if (decisionSourceKey(identity) !== source.key) {
        return rejectedWithCurrent('invalid', 'the decision source key is not the canonical natural identity');
      }
      // §3.7 item 2: the subject decides which branch runs. A goal subject
      // loads its Goal; a project subject never loads one, and only the
      // note_review branch serves it. The shape is checked once here, before
      // any branch reads anything, so no branch re-reads the subject.
      const subjectProblem = checkShape(DecisionSubjectShape, { subject: source.subject }, 'stored');
      if (subjectProblem !== null) {
        return rejectedWithCurrent('invalid', 'the decision source subject is not recognized');
      }
      const subject = source.subject;
      const subjectGoalRef = decisionSubjectGoalRef(source);
      if (subjectGoalRef === null && subject.kind === 'project' && subject.projectRef.projectId !== ctx.projectId) {
        return rejectedWithCurrent('forbidden', 'the project subject is outside the bound call scope');
      }
      const goalRef: GoalRef | null = subjectGoalRef;

      const support = createSourceReadSupport(records, scope);

      /** §4.6 line 915: an unimplemented or unknown kind stays an explicit refusal. */
      async function readBranch(): Promise<ReadResult<DecisionSourceBranchFacts>> {
        if (goalRef === null) {
          // A project subject serves no other source kind in this slice; a
          // branch that would need a Goal stays an explicit refusal.
          return identity.kind === 'note_review'
            ? readNoteReviewSource(support, ctx, source, identity, deps, null)
            : rejectedWithCurrent('invalid', 'a project subject serves only a note_review source');
        }
        switch (identity.kind) {
          case 'message':
            return readMessageSource(support, identity, goalRef);
          case 'goal_cause':
            return readGoalCauseSource(support, ctx, identity, goalCauses);
          case 'candidate':
            return readCandidateSource(support, identity);
          case 'planning_question':
            return readPlanningQuestionSource(support, ctx, identity, goalRef, deps.bindings);
          case 'goal_conflict':
            return readGoalConflictSource(support, identity, goalRef);
          case 'note_review':
            return readNoteReviewSource(support, ctx, source, identity, deps, goalRef);
          case 'unknown_call_review':
            return readUnknownCallReviewSource(support, ctx, identity, deps, goalRef);
          case 'command_rerun_request':
            return readCommandRerunRequestSource(support, ctx, identity, deps, goalRef);
          case 'message_release':
            return readMessageReleaseSource(support, identity, goalRef);
          default:
            return rejectedWithCurrent('invalid', 'the decision source kind is not recognized');
        }
      }

      const branch = await readBranch();
      if (branch.status !== 'ready') return branch;
      const { goal, objects, options, pins, goalBases, closed, allowedReaderSessionRefs } = branch.value;

      if (pins.length > 0) {
        const pinProblem = await support.verifyPins(pins);
        if (pinProblem !== null) return pinProblem;
      }
      const canonicalSource: DecisionSourceV1 = {
        kind: source.kind,
        key: source.key,
        // The canonical subject is rebuilt from what the branch read: a goal
        // subject from the Goal actually read (candidate, Goal cause and message
        // read their Goal by their own identity, not by the caller's subject); a
        // project subject from the bound project, whose goal-less note the
        // note_review branch has proved.
        subject: goal !== null
          ? { kind: 'goal', goalRef: structuredClone(goal.ref) }
          : { kind: 'project', projectRef: { projectId: scope.projectId } },
        pins: clonePins(pins),
        goalBases: goalBases.map((basis) => structuredClone(basis)),
      };
      // §2.1/§3.3: a virtual absence pin (Task@0) is part of the source
      // identity and the accepted pin set, but it has no stored record schema,
      // so it must never become a Store commit guard.
      const guards = pins.filter((pin) => !isAbsencePin(pin)).map((pin) => {
        const refKey = canonicalOf(pin.ref);
        if (refKey === null) throw new Error('a verified decision source pin ref must canonicalize');
        return { refKey, expectedRevision: pin.revision };
      });
      return {
        status: 'ready',
        value: { source: canonicalSource, goal, objects, options, guards, closed, allowedReaderSessionRefs },
      };
    },
    readApplication: readApplicationReceiptFacts(records),
  };
}

// -------------------------------------------------------------------------- //
// §4.6 line 915 / N6: the SAVED answer's historical reader facts             //
// -------------------------------------------------------------------------- //

function readerScopeProblem(ref: unknown, scope: { projectId: string; workspaceId: string }): CoreRejection | null {
  if (!isRecord(ref)) {
    return { status: 'rejected', code: 'invalid', reason: 'a saved answer source ref is not a JSON object' };
  }
  const projectId = ref['projectId'];
  if (typeof projectId === 'string' && projectId.length > 0 && projectId !== scope.projectId) {
    return { status: 'rejected', code: 'forbidden', reason: 'a saved answer source object belongs to another project' };
  }
  const workspaceId = ref['workspaceId'];
  if (typeof workspaceId === 'string' && workspaceId.length > 0 && workspaceId !== scope.workspaceId) {
    return { status: 'rejected', code: 'forbidden', reason: 'a saved answer source object belongs to another workspace' };
  }
  return null;
}

/**
 * §4.6 line 915 / N6: derive the formal allowed reader Sessions of a SAVED
 * answer from the historical source captured with it, independent of whether
 * that source is still answerable. `readSource` is the answerability seam and
 * refuses a resolved candidate; this reader only re-derives the saved formal
 * proposer / request Session facts so the asking Session can read back the
 * answer it acted on. A read failure is returned (`unavailable`/`forbidden`),
 * never folded into "no reader".
 */
export async function readSavedAnswerReaderSessions(
  records: S5RecordPort,
  captured: DecisionSourceV1,
  scope: { projectId: string; workspaceId: string },
): Promise<ReadResult<SessionRef[]>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(captured.key);
  } catch {
    return { status: 'rejected', code: 'invalid', reason: 'the saved answer source key is not parseable JSON' };
  }
  if (!isRecord(parsed) || parsed['kind'] !== captured.kind) {
    return { status: 'rejected', code: 'invalid', reason: 'the saved answer source key does not match its declared kind' };
  }
  const identity = parsed as unknown as DecisionSourceIdentityV1;
  if (decisionSourceKey(identity) !== captured.key) {
    return { status: 'rejected', code: 'invalid', reason: 'the saved answer source key is not the canonical natural identity' };
  }
  switch (identity.kind) {
    case 'message': {
      const problem = readerScopeProblem(identity.messageRef, scope);
      if (problem !== null) return problem;
      const read = await readStoredDecoded(records, identity.messageRef, SAVED_ANSWER_READ_TEMPLATES,
        decodeSessionMessageRecord, 'SessionMessage');
      if (read.status !== 'ready') return read;
      const sender = read.value.sender;
      return { status: 'ready', value: sender.kind === 'work_run'
        ? [{ projectId: sender.sessionRef.projectId, sessionId: sender.sessionRef.sessionId }] : [] };
    }
    case 'candidate': {
      // The captured answer's proposal pin proves the formal proposer even after
      // the head stopped being live (an accepted candidate is still stored).
      const proposalPin = captured.pins.find((pin) => isRecord(pin.ref) && pin.ref['aggregateType'] === 'PlanProposal');
      if (proposalPin === undefined) return { status: 'ready', value: [] };
      const problem = readerScopeProblem(proposalPin.ref, scope);
      if (problem !== null) return problem;
      const proposal = await readProposal(records, proposalPin.ref as unknown as PlanProposalRef);
      if (proposal.status !== 'ready') return proposal;
      if (proposal.proposal.kind !== 'candidate_v2') return { status: 'ready', value: [] };
      const submittedBy = proposal.proposal.submittedBy;
      return { status: 'ready', value: submittedBy === undefined ? [] : [{
        projectId: submittedBy.sessionRef.projectId, sessionId: submittedBy.sessionRef.sessionId,
      }] };
    }
    case 'planning_question': {
      const problem = readerScopeProblem(identity.answerRef, scope);
      if (problem !== null) return problem;
      const answer = await readStoredDecoded(records, identity.answerRef, SAVED_ANSWER_READ_TEMPLATES,
        decodeQueryJobAnswerSnapshot, 'QueryJobAnswer');
      if (answer.status !== 'ready') return answer;
      const runRef = answer.value.answer.runRef;
      if (!isRecord(runRef)) return { status: 'ready', value: [] };
      const run = await readStoredDecoded(records, runRef, SAVED_ANSWER_READ_TEMPLATES,
        decodeQueryRunSnapshotRecord, 'QueryRun');
      if (run.status !== 'ready') return run;
      const sessionRef = run.value.run.executionState?.sessionRef;
      return { status: 'ready', value: sessionRef === undefined ? [] : [{
        projectId: sessionRef.projectId, sessionId: sessionRef.sessionId,
      }] };
    }
    case 'goal_cause':
    case 'goal_conflict':
      return { status: 'ready', value: [] };
    default:
      return { status: 'ready', value: [] };
  }
}
