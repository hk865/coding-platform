/**
 * The `maintainer_assignment` arm of `SessionOperationRecord` (§3.13): the immutable request input beside the mutable
 * progress. This module is the pure half — the stage/answer/verdict tables, the field table and the cross-field input
 * rule. The Store envelope, the operation codec arm and the `MaintainerAssignmentRecorded` event live in
 * `sessions/session-record-codecs.ts`, because only that layer may name the Store's `EncodedDomainEvent`.
 *
 * The input's caller is the real Work identity that asked for the assignment; it is attribution, never the trusted
 * command branch. The branch and its proof stay with the command (`model/module-maintainer-contracts.ts`).
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { ModuleRef, SessionRef, SessionWorkLinkRef } from '../../../contracts/core/identity.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import { defineShape, f } from '../../../contracts/data-format.js';
import {
  id, ModuleRefShape, RunRefShape, SessionMessageRefShape, SessionRefShape, WorkLinkTargetField,
} from '../../../contracts/data-format-refs.js';
import { isRecord, utf8Bytes } from '../../../contracts/validation/common.js';

/** The fixed progress order; a step not reached is `null`. */
export const MAINTAINER_ASSIGNMENT_STAGES =
  ['accepted', 'awaiting_decision', 'done', 'rejected', 'stale'] as const;
/** A card answer is the person's approve/reject, never a generic selection. */
export const MAINTAINER_ASSIGNMENT_ANSWERS = ['approve', 'reject'] as const;
/** The decision policy's two outcomes: a card or the automatic assignment. */
export const MAINTAINER_ASSIGNMENT_VERDICTS = ['automatic', 'needs_decision'] as const;

/** The action input's real Work identity; carries no proof. */
export type MaintainerAssignmentCallerV1 = {
  kind: 'work'; actor: Extract<ActorRef, { kind: 'agent' }>; session: SessionRef; run: RunRef;
};

export type MaintainerAssignmentActionV1 = {
  kind: 'maintainer_assignment';
  input: {
    moduleRef: ModuleRef;
    line: SessionRef;
    reason: string;                 // 1..2000 UTF-8 bytes, as member
    caller: MaintainerAssignmentCallerV1;
  };
  progress: {
    stage: (typeof MAINTAINER_ASSIGNMENT_STAGES)[number];
    decision: {
      verdict: (typeof MAINTAINER_ASSIGNMENT_VERDICTS)[number];
      cardKey: string | null;
      answer: (typeof MAINTAINER_ASSIGNMENT_ANSWERS)[number] | null;
      answerRef: SessionMessageRef | null;
    } | null;
    outcome: { kind: 'assigned' | 'already_owner'; link: SessionWorkLinkRef } | null;
    lastRefusal: { code: string; reason: string } | null;
  };
};

const WORK_LINK_RELATIONS = ['responsible', 'participates', 'investigated'] as const;
const SessionWorkLinkRefShape = defineShape({
  name: 'MaintainerAssignmentOutcomeLink',
  fields: {
    aggregateType: f.literal('SessionWorkLink'), projectId: id, sessionId: id,
    target: WorkLinkTargetField, relation: f.enumOf(WORK_LINK_RELATIONS),
  },
});

/** The immutable input's cross-field rule: the reason bound both the codec and the request owner call. */
function maintainerAssignmentInputProblem(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value['input'])) {
    return 'a maintainer_assignment action requires its input';
  }
  const reason = value['input']['reason'];
  if (typeof reason !== 'string') return 'a maintainer_assignment input requires a string reason';
  const bytes = utf8Bytes(reason);
  return bytes >= 1 && bytes <= 2_000 ? null : 'the maintainer assignment reason must be 1..2000 UTF-8 bytes';
}

export const MaintainerAssignmentActionShape = defineShape({
  name: 'MaintainerAssignmentAction',
  fields: {
    kind: f.literal('maintainer_assignment'),
    input: f.object({
      moduleRef: f.ref(ModuleRefShape),
      line: f.ref(SessionRefShape),
      reason: f.string(),
      caller: f.object({
        kind: f.literal('work'),
        actor: f.object({ kind: f.literal('agent'), id, runRef: f.ref(RunRefShape) }),
        session: f.ref(SessionRefShape),
        run: f.ref(RunRefShape),
      }),
    }),
    progress: f.object({
      stage: f.enumOf(MAINTAINER_ASSIGNMENT_STAGES),
      decision: f.nullable(f.object({
        verdict: f.enumOf(MAINTAINER_ASSIGNMENT_VERDICTS),
        cardKey: f.nullable(id),
        answer: f.nullable(f.enumOf(MAINTAINER_ASSIGNMENT_ANSWERS)),
        answerRef: f.nullable(f.ref(SessionMessageRefShape)),
      })),
      outcome: f.nullable(f.object({
        kind: f.enumOf(['assigned', 'already_owner'] as const),
        link: f.ref(SessionWorkLinkRefShape),
      })),
      lastRefusal: f.nullable(f.object({ code: id, reason: id })),
    }),
  },
  rules: [maintainerAssignmentInputProblem],
});

/** One pure progress step over the stored arm; the record's envelope (ref, revision, times) stays with its writer. */
export type MaintainerAssignmentStepV1 =
  | { kind: 'awaiting_decision'; cardKey: string }
  | { kind: 'auto_applied'; outcome: { kind: 'assigned' | 'already_owner'; link: SessionWorkLinkRef } }
  | { kind: 'decided'; answer: 'approve'; answerRef: SessionMessageRef; stale: boolean;
      outcome: { kind: 'assigned' | 'already_owner'; link: SessionWorkLinkRef } }
  | { kind: 'decided'; answer: 'reject'; answerRef: SessionMessageRef }
  | { kind: 'refused'; refusal: { code: string; reason: string } };

/** The record shell's five phases, the same values `model/session-contracts.ts` stores. */
type MaintainerAssignmentPhaseV1 = 'accepted' | 'running' | 'completed' | 'failed' | 'unknown';
type MaintainerAssignmentTransitionV1 = { action: MaintainerAssignmentActionV1; phase: MaintainerAssignmentPhaseV1 };

/** The accepted step: the only step that starts from nothing. */
export function acceptedMaintainerAssignment(
  input: MaintainerAssignmentActionV1['input'],
): { action: MaintainerAssignmentActionV1; phase: 'accepted' } {
  return {
    action: {
      kind: 'maintainer_assignment',
      input: structuredClone(input),
      progress: { stage: 'accepted', decision: null, outcome: null, lastRefusal: null },
    },
    phase: 'accepted',
  };
}

/**
 * The next progress step: the stored action and the record's phase go in, the next both come out. The writer adds the
 * revision and the step's time; no caller decides a stage, phase or outcome of its own.
 */
export function advancedMaintainerAssignment(
  action: MaintainerAssignmentActionV1,
  phase: MaintainerAssignmentPhaseV1,
  step: MaintainerAssignmentStepV1,
): MaintainerAssignmentTransitionV1 {
  const progress = action.progress;
  switch (step.kind) {
    case 'awaiting_decision':
      return {
        action: { ...action, progress: { ...progress, stage: 'awaiting_decision',
          decision: { verdict: 'needs_decision', cardKey: step.cardKey, answer: null, answerRef: null } } },
        phase: 'running',
      };
    case 'auto_applied':
      return {
        action: { ...action, progress: { ...progress, stage: 'done',
          decision: { verdict: 'automatic', cardKey: null, answer: null, answerRef: null },
          outcome: { kind: step.outcome.kind, link: structuredClone(step.outcome.link) } } },
        phase: 'completed',
      };
    case 'decided': {
      const decision = { ...progress.decision!, answer: step.answer,
        answerRef: structuredClone(step.answerRef) };
      if (step.answer === 'reject') {
        return {
          action: { ...action, progress: { ...progress, stage: 'rejected', decision } },
          phase: 'failed',
        };
      }
      return {
        action: { ...action, progress: { ...progress, stage: step.stale ? 'stale' : 'done', decision,
          outcome: { kind: step.outcome.kind, link: structuredClone(step.outcome.link) } } },
        phase: step.stale ? 'failed' : 'completed',
      };
    }
    case 'refused':
      return {
        action: { ...action, progress: { ...progress, lastRefusal: { ...step.refusal } } },
        phase,
      };
  }
}
