/**
 * Record 1 (§3.14): the `member_create` arm of `CoreOperation`, its three replay events and the pure rules between
 * their fields.
 *
 * A member request is admitted once and then advanced by its owner; the arm stores the immutable input beside the
 * mutable progress. Section 3.4 fixes the order of every progress field, so a reader never re-derives it. This module
 * is the pure half: the field tables, the cross-field rule and the event body checks. The Store envelope codecs and the
 * typed event decoders live in `sessions/session-record-codecs.ts`, because only that layer may name the Store's
 * `EncodedDomainEvent`.
 *
 * The member operation's Task is the child line's Task: it must belong to the operation's workspace and project, and
 * the caller must be in that same project. A secretary caller or an adviser's planning round is a Query run; a Host
 * pick has no run at all.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type {
  SessionAggregateRef, SessionRef, WorkspaceScope,
} from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { DecisionChangeProofV1 } from '../../../contracts/goal-decisions.js';
import type { QueryJobRef, QueryRunRef } from '../../../contracts/query-job.js';
import type { TaskTriple } from '../../../contracts/dispatch.js';
import {
  defineEvent, defineShape, f,
} from '../../../contracts/data-format.js';
import {
  id, OperationRefShape, QueryJobRefShape, QueryRunRefShape, RunRefShape,
  SessionAggregateRefShape, SessionMessageRefShape, SessionRefShape, TaskTripleShape, WorkspaceScopeShape,
} from '../../../contracts/data-format-refs.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import { isPos, isRecord, utf8Bytes } from '../../../contracts/validation/common.js';

/** The fixed progress order (§3.14 record 1); a step not reached is `null`. */
export const MEMBER_CREATION_STAGES = ['accepted', 'awaiting_decision', 'creating', 'done', 'rejected', 'stale'] as const;
/** A card answer is the person's approve/reject, never a generic selection. */
export const MEMBER_CREATION_ANSWERS = ['approve', 'reject'] as const;
/** The decision policy's two outcomes: a card or the automatic notice. */
export const MEMBER_CREATION_VERDICTS = ['automatic_notice', 'needs_decision'] as const;

/**
 * The caller recorded on the immutable input. `host_pick` is the Host's suggestion path: it writes
 * `noticeItemKey: null` and reads no `run`, so its absence is a fact, not an error.
 */
export type MemberCallerV1 =
  | { kind: 'work'; actor: ActorRef; session: SessionRef; run: RunRef }
  | { kind: 'secretary_query'; session: SessionRef; run: QueryRunRef; round: QueryJobRef; requestRoot: QueryJobRef }
  /** 121-114: the responsible adviser's own intervention planning round. */
  | { kind: 'adviser_query'; session: SessionRef; run: QueryRunRef }
  | { kind: 'host_pick' };

export type MemberCreateActionV1 = {
  kind: 'member_create';
  input: {
    workspace: WorkspaceScope;
    caller: MemberCallerV1;
    duty: 'executor';
    scope: { kind: 'task'; task: TaskTriple };
    reason: string;
    acknowledgement: SessionMessageRef | null;
    commandId: string;
    fingerprint: string;
  };
  progress: {
    stage: (typeof MEMBER_CREATION_STAGES)[number];
    decision: {
      verdict: (typeof MEMBER_CREATION_VERDICTS)[number];
      cardKey: string | null;
      answer: (typeof MEMBER_CREATION_ANSWERS)[number] | null;
      /** The person's card answer for a decided request; null for automatic/reused progress. */
      answerRef: SessionMessageRef | null;
    } | null;
    createChild: OperationRef | null;
    outcome: { kind: 'reused' | 'created'; session: SessionRef } | null;
    noticeItemKey: string | null;
    lastRefusal: { code: string; reason: string } | null;
  };
};

const HumanActorFields = { kind: f.literal('human'), id };
const SystemActorFields = { kind: f.literal('system'), id };
const MemberActorField = f.union('kind', {
  human: HumanActorFields,
  system: SystemActorFields,
  agent: { kind: f.literal('agent'), id, runRef: f.ref(RunRefShape) },
});

const MemberCallerShape = f.union('kind', {
  work: {
    kind: f.literal('work'), actor: MemberActorField, session: f.ref(SessionRefShape), run: f.ref(RunRefShape),
  },
  secretary_query: {
    kind: f.literal('secretary_query'), session: f.ref(SessionRefShape), run: f.ref(QueryRunRefShape),
    round: f.ref(QueryJobRefShape), requestRoot: f.ref(QueryJobRefShape),
  },
  adviser_query: { kind: f.literal('adviser_query'), session: f.ref(SessionRefShape), run: f.ref(QueryRunRefShape) },
  host_pick: { kind: f.literal('host_pick') },
});

/**
 * The immutable input's cross-field rule. The reason bound lives here (not only in the field table) because it is the
 * one rule both the record codec and the request owner call. Every nested project must agree with the workspace.
 */
export function memberCreateInputProblem(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value['input'])) return 'a member_create action requires its input';
  const input = value['input'];
  const workspace = input['workspace'];
  if (!isRecord(workspace) || !isRecord(input['scope']) || !isRecord(input['scope']['task'])) {
    return 'a member_create input requires its workspace and task scope';
  }
  const task = input['scope']['task'];
  if (task['projectId'] !== workspace['projectId']) {
    return 'the member Task belongs to another project than the operation workspace';
  }
  const reason = input['reason'];
  if (typeof reason !== 'string') return 'a member_create input requires a string reason';
  const bytes = utf8Bytes(reason);
  if (bytes < 1 || bytes > 2_000) return 'the member reason must be 1..2000 UTF-8 bytes';
  const caller = input['caller'];
  if (!isRecord(caller)) return 'a member_create input requires its caller';
  const project = workspace['projectId'];
  const sameProject = (ref: unknown): boolean => isRecord(ref) && ref['projectId'] === project;
  if (caller['kind'] === 'work') {
    if (!sameProject(caller['session'])) return 'the member work caller Session belongs to another project';
    if (!sameProject(caller['run'])) return 'the member work caller Run belongs to another project';
    const actor = caller['actor'];
    if (isRecord(actor) && actor['kind'] === 'agent' && !sameProject(actor['runRef'])) {
      return 'the member work caller agent Run belongs to another project';
    }
    return null;
  }
  if (caller['kind'] === 'secretary_query') {
    if (!sameProject(caller['session'])) return 'the member secretary caller Session belongs to another project';
    if (!sameProject(caller['run'])) return 'the member secretary caller QueryRun belongs to another project';
    if (!sameProject(caller['round'])) return 'the member secretary round belongs to another project';
    if (!sameProject(caller['requestRoot'])) return 'the member secretary request root belongs to another project';
    return null;
  }
  if (caller['kind'] === 'adviser_query') {
    if (!sameProject(caller['session'])) return 'the member adviser caller Session belongs to another project';
    if (!sameProject(caller['run'])) return 'the member adviser caller QueryRun belongs to another project';
    return null;
  }
  if (caller['kind'] === 'host_pick') return null;
  return 'the member caller kind is not recognized';
}

export const MemberCreateActionShape = defineShape({
  name: 'MemberCreateAction',
  fields: {
    kind: f.literal('member_create'),
    input: f.object({
      workspace: f.ref(WorkspaceScopeShape),
      caller: MemberCallerShape,
      duty: f.literal('executor'),
      scope: f.object({ kind: f.literal('task'), task: f.ref(TaskTripleShape) }),
      reason: f.string(),
      acknowledgement: f.nullable(f.ref(SessionMessageRefShape)),
      commandId: f.string({ min: 1, max: 200, unit: 'codePoints' }),
      fingerprint: f.sha256(),
    }),
    progress: f.object({
      stage: f.enumOf(MEMBER_CREATION_STAGES),
      decision: f.nullable(f.object({
        verdict: f.enumOf(MEMBER_CREATION_VERDICTS),
        cardKey: f.nullable(id),
        answer: f.nullable(f.enumOf(MEMBER_CREATION_ANSWERS)),
        answerRef: f.nullable(f.ref(SessionMessageRefShape)),
      })),
      createChild: f.nullable(f.ref(OperationRefShape)),
      outcome: f.nullable(f.object({
        kind: f.enumOf(['reused', 'created'] as const),
        session: f.ref(SessionRefShape),
      })),
      noticeItemKey: f.nullable(id),
      lastRefusal: f.nullable(f.object({ code: id, reason: id })),
    }),
  },
  rules: [memberCreateInputProblem],
});

/**
 * One pure progress step over the stored arm; the record's envelope (ref, revision, times) stays with its writer.
 * `refused` is the recovery result: it records the refusal and keeps the creating stage untouched.
 */
export type MemberCreationStepV1 =
  | { kind: 'awaiting_decision'; cardKey: string; createChild: OperationRef }
  | { kind: 'creating'; createChild: OperationRef; noticeItemKey: string }
  | { kind: 'created'; session: SessionRef }
  | { kind: 'reused'; session: SessionRef }
  | { kind: 'rejected'; refusal: { code: string; reason: string } }
  | { kind: 'refused'; refusal: { code: string; reason: string } }
  | { kind: 'decided'; answer: 'approve' | 'reject'; stale: boolean; answerRef: SessionMessageRef };

/** The record shell's five phases, the same values `model/session-contracts.ts` stores. */
type MemberCreationPhaseV1 = 'accepted' | 'running' | 'completed' | 'failed' | 'unknown';
type MemberCreationTransitionV1 = { action: MemberCreateActionV1; phase: MemberCreationPhaseV1 };

/** The accepted step: the only step that starts from nothing. */
export function acceptedMemberCreation(input: MemberCreateActionV1['input']): MemberCreationTransitionV1 {
  return {
    action: {
      kind: 'member_create',
      input: structuredClone(input),
      progress: {
        stage: 'accepted', decision: null, createChild: null, outcome: null, noticeItemKey: null, lastRefusal: null,
      },
    },
    phase: 'accepted',
  };
}

/**
 * The next progress step: the stored action and the record's phase go in, the next both come out. The writer adds the
 * revision and the step's time; no caller decides a stage, phase or outcome of its own.
 */
export function advancedMemberCreation(
  action: MemberCreateActionV1,
  phase: MemberCreationPhaseV1,
  step: MemberCreationStepV1,
): MemberCreationTransitionV1 {
  const progress = action.progress;
  switch (step.kind) {
    case 'awaiting_decision':
      return {
        action: { ...action, progress: { ...progress, stage: 'awaiting_decision',
          decision: { verdict: 'needs_decision', cardKey: step.cardKey, answer: null, answerRef: null },
          createChild: structuredClone(step.createChild) } },
        phase: 'running',
      };
    case 'creating':
      return {
        action: { ...action, progress: { ...progress, stage: 'creating',
          decision: { verdict: 'automatic_notice', cardKey: null, answer: null, answerRef: null },
          createChild: structuredClone(step.createChild), noticeItemKey: step.noticeItemKey } },
        phase: 'running',
      };
    case 'created':
      return {
        action: { ...action, progress: { ...progress, stage: 'done',
          outcome: { kind: 'created', session: structuredClone(step.session) } } },
        phase: 'completed',
      };
    case 'reused':
      return {
        action: { ...action, progress: { ...progress, stage: 'done',
          decision: { verdict: 'automatic_notice', cardKey: null, answer: null, answerRef: null },
          outcome: { kind: 'reused', session: structuredClone(step.session) } } },
        phase: 'completed',
      };
    case 'rejected':
      return {
        action: { ...action, progress: { ...progress, stage: 'rejected',
          lastRefusal: { ...step.refusal } } },
        phase: 'failed',
      };
    case 'refused':
      return {
        action: { ...action, progress: { ...progress, lastRefusal: { ...step.refusal } } },
        phase,
      };
    case 'decided': {
      const decision = { ...progress.decision!, answer: step.answer,
        answerRef: structuredClone(step.answerRef) };
      if (step.answer === 'reject') {
        return {
          action: { ...action, progress: { ...progress, stage: 'rejected', decision,
            lastRefusal: { code: 'invalid', reason: 'the member creation was rejected' } } },
          phase: 'failed',
        };
      }
      return {
        action: { ...action, progress: { ...progress, stage: step.stale ? 'stale' : 'creating', decision } },
        phase: step.stale ? 'failed' : 'running',
      };
    }
  }
}

/** `done` names the child it produced or reused; a done operation without an outcome is damage, never a stage. */
function memberProgressProblem(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value['progress'])) return 'a member_create action requires its progress';
  const progress = value['progress'];
  if (progress['stage'] === 'done' && progress['outcome'] === null) {
    return 'a done member_create operation requires its outcome';
  }
  return null;
}

export const memberCreationAcceptedEventFormat = defineEvent({
  name: 'MemberCreationAccepted',
  eventType: 'MemberCreationAccepted',
  schemaVersion: 1,
  fields: {
    projectId: id, workspaceId: id, operationRef: f.ref(OperationRefShape),
    revision: f.integer({ min: 1 }), action: f.ref(MemberCreateActionShape),
  },
  rules: [(value) => {
    if (!isRecord(value) || !isRecord(value['action'])) return 'MemberCreationAccepted requires its action';
    const action = value['action'];
    if (value['revision'] !== 1) return 'MemberCreationAccepted is the first revision';
    if (!isRecord(action['progress']) || action['progress']['stage'] !== 'accepted') {
      return 'MemberCreationAccepted records the accepted stage';
    }
    if (action['progress']['decision'] !== null) return 'MemberCreationAccepted records no decision';
    return memberProgressProblem(action) === null ? null : 'MemberCreationAccepted carries invalid progress';
  }],
});

export const memberCreationDecidedEventFormat = defineEvent({
  name: 'MemberCreationDecided',
  eventType: 'MemberCreationDecided',
  schemaVersion: 1,
  fields: {
    projectId: id, workspaceId: id, operationRef: f.ref(OperationRefShape),
    revision: f.integer({ min: 1 }), action: f.ref(MemberCreateActionShape),
  },
  rules: [(value) => {
    if (!isRecord(value) || !isRecord(value['action']) || !isRecord(value['action']['progress'])) {
      return 'MemberCreationDecided requires its action';
    }
    const progress = value['action']['progress'];
    if (!isRecord(progress['decision'])) return 'MemberCreationDecided records its decision';
    if (!isPos(value['revision']) || value['revision'] < 2) return 'MemberCreationDecided is not the first revision';
    return memberProgressProblem(value['action']);
  }],
});

export type MemberCreatedEventV1 = {
  eventId: string;
  eventType: 'MemberCreated';
  schemaVersion: 1;
  occurredAt: string;
  projectId: string;
  workspaceId: string;
  operationRef: OperationRef;
  /** The new Session aggregate (tagged), so the proof's version lookup matches the commit's refKey. */
  sessionRef: SessionAggregateRef;
  /** The Session version written by this same commit; the proof's `after` is read back from the commit. */
  sessionRevision: number;
  /** The Work Run that initiated the request; `null` for a secretary or adviser Query run or a Host pick. */
  initiatorRun: RunRef | null;
  actor: ActorRef;
  acknowledgement?: SessionMessageRef;
  proof: DecisionChangeProofV1 | null;
};

export const memberCreatedEventFormat = defineEvent({
  name: 'MemberCreated',
  eventType: 'MemberCreated',
  schemaVersion: 1,
  fields: {
    projectId: id,
    workspaceId: id,
    operationRef: f.ref(OperationRefShape),
    sessionRef: f.ref(SessionAggregateRefShape),
    sessionRevision: f.integer({ min: 1 }),
    initiatorRun: f.nullable(f.ref(RunRefShape)),
    actor: MemberActorField,
    acknowledgement: f.optional(f.ref(SessionMessageRefShape)),
    proof: f.nullable(f.json()),
  },
  rules: [(value) => {
    if (!isRecord(value)) return 'MemberCreated must be an object';
    if (value['sessionRevision'] !== 1) return 'a member-created Session is written at revision 1';
    if (value['proof'] === null && value['acknowledgement'] !== undefined) {
      return 'a MemberCreated with an acknowledgement must carry its proof';
    }
    return null;
  }],
});

export function checkMemberCreatedEventBody(value: unknown): string | null {
  return checkShape(memberCreatedEventFormat, value, 'stored');
}
