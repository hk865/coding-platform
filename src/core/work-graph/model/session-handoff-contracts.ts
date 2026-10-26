/**
 * The handoff advance's saved inputs and results, the secretary archive command's inputs and progress, the
 * successor's brief consumption port and the Workflow-level handoff entry.
 *
 * Declarations only: the advance/archive commands, the composite and every reader are their owners' code. A saved
 * input is stored before its child call so a crash resumes by replaying the original call under its own identity.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, WorkLinkTarget } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionProvenanceV1 } from '../../../contracts/core/session.js';
import type { RequestSessionArchiveInput } from '../../../contracts/core/session-archive.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type { QueryJobRef, QueryRunRef, RequestUnderstandingCommandV1 } from '../../../contracts/query-job.js';
import type { EncodedRecord, RecordGuard } from '../../record-store/ports.js';
import type { CoverageGoalV1, SecretaryHandoffBasisV1 } from './secretary-lifecycle-contracts.js';
import type { HANDOFF_STAGES, HandoffActionV1, SECRETARY_ARCHIVE_STAGES } from './session-operation-arms.js';
import type { SessionOperationRecord } from './session-contracts.js';
import type { GraphWrite } from './task-contracts.js';

export type HandoffStageV1 = (typeof HANDOFF_STAGES)[number];
/** The exact `ensureLine` child input; W cannot import B's `LineCreationInput`, so the shape is declared here. */
export type HandoffSavedCreateInputV1 = {
  commandId: string; duty: PlatformDutyV1; scope: { kind: 'project' }; reason: string;
  provenance: SessionProvenanceV1; roleConfiguration: RoleConfigurationRef;
  replaces: SessionRef | null; parentOperation: OperationRef | null;
};
/** The full input one atomic write stores before its child call, so a resume replays the original call. */
export type HandoffSavedInputV1 =
  /** `plannedSessionRef` is not part of `ensureLine`; the capacity call recomputes it. */
  | { kind: 'create'; requestId: string; input: HandoffSavedCreateInputV1 }
  | { kind: 'transfer'; requestId: string; from: SessionRef; to: SessionRef; target: WorkLinkTarget;
      expected: { fromSession: number; toSession: number; sourceLink: number; destinationLink: number } }
  | { kind: 'route'; operationId: string; to: SessionRef; expectedSource: SessionRef }
  | { kind: 'archive'; request: GraphWrite<RequestSessionArchiveInput> }
  | { kind: 'understanding'; command: RequestUnderstandingCommandV1 }
  | { kind: 'fence' | 'wait' | 'recheck' | 'notice' | 'finish'; basis: string };
export type HandoffAdvanceInputV1 =
  /** Continue: choose the next write from the operation's own stage and commit it. */
  | { kind: 'continue'; operation: OperationRef; expectedRevision: number }
  /** Replay: return the receipt of the write this exact commandId made (or its saved input, for a before-write). */
  | { kind: 'replay'; operation: OperationRef; commandId: string }
  /** Refusal: the child of the before write `commandId` refused (any code, `unavailable` included). Records the
   *  stage-level mark with the child's code and reason as `lastRefusal`, then stops (`stop: 'refused'`, `next: null`). */
  | { kind: 'refusal'; operation: OperationRef; expectedRevision: number; commandId: string;
      refusal: { code: CoreRejection['code']; reason: string } };
export type HandoffWriteV1 = {
  /** The frozen `commandId` of this write, the replay key. */
  commandId: string; stage: HandoffStageV1; item: string; phase: 'before' | 'after';
  generation: number; savedInput: HandoffSavedInputV1 | null;
  receipt: { cursor: CommitCursor } | null;
};
/** A stop that writes nothing: the writer has not stopped, another holder has the source's fence, or the coverage
 *  waits for an understanding round that has not committed. The operation is unchanged at `revision`. */
export type HandoffAdvanceStopV1 = {
  status: 'stopped'; operation: OperationRef; revision: number; stage: HandoffStageV1; generation: number;
  stop: 'wait_writer' | 'fenced' | 'incomplete'; reason: string;
};
export type HandoffAdvanceResultV1 = WriteResult<{
  operation: OperationRef; revision: number; stage: HandoffStageV1; phase: SessionOperationRecord['phase'];
  generation: number; write: HandoffWriteV1;
  /** The next stage the caller should drive, or null when finished/blocked/waiting. */
  next: HandoffStageV1 | null;
  /** Why the caller stops: `wait_writer` and a held fence are not failures. */
  stop: 'advanced' | 'finished' | 'replayed' | 'wait_writer' | 'fenced' | 'incomplete' | 'refused';
}> | HandoffAdvanceStopV1;

/** The Workflow owner the Host and the fixture reach through `WorkflowPort.sessionHandoff`. */
export interface SessionHandoffWorkflowPort {
  /** The automatic entry. Identity = source + the threshold basis (run + requestIndex); an unfinished operation of
   *  the same source is continued, never duplicated. */
  startHandoff(ctx: CoreCallContext,
    input: { source: SessionRef; basis: SecretaryHandoffBasisV1 }): Promise<ReadResult<HandoffProgressV1>>;
  /** The continuation entry the Host calls after a round end and at start-up. */
  continueHandoff(ctx: CoreCallContext, input: { operation: OperationRef }): Promise<ReadResult<HandoffProgressV1>>;
  advance(ctx: CoreCallContext, input: { operation: OperationRef }): Promise<ReadResult<HandoffProgressV1>>;
  manualArchive(ctx: CoreCallContext, input: { operation: OperationRef }): Promise<ReadResult<SecretaryArchiveProgressV1>>;
}
export type HandoffProgressV1 = {
  operation: OperationRef; revision: number; stage: HandoffStageV1;
  phase: 'accepted' | 'running' | 'completed' | 'failed';
  /** The trigger the operation was accepted with; the automatic identity is frozen at accept. */
  trigger: 'too_long' | 'manual';
  successor: SessionRef | null; archived: boolean; noticeItemKey: string | null; lastRefusal: string | null;
};

export type SecretaryArchiveStageV1 = (typeof SECRETARY_ARCHIVE_STAGES)[number];
export type SecretaryArchiveAcceptInputV1 = {
  commandId: string; source: SessionRef;
  choices: { requestRoot: QueryJobRef; to: SessionRef | null }[];
};
export type SecretaryArchiveAcceptResultV1 =
  WriteResult<{ operation: OperationRef; stage: 'accepted'; phase: 'accepted' }>;
export type SecretaryArchiveAdvanceInputV1 =
  | { kind: 'continue'; operation: OperationRef; expectedRevision: number }
  | { kind: 'replay'; operation: OperationRef; commandId: string };
export type SecretaryArchiveProgressV1 = {
  operation: OperationRef; revision: number; stage: SecretaryArchiveStageV1;
  phase: 'accepted' | 'running' | 'completed' | 'failed'; generation: number;
  items: { requestRoot: QueryJobRef; outcome: 'routed' | 'dropped' | 'failed' | null;
    to: SessionRef | null; routingRound: QueryJobRef | null; reason: string | null;
    receipt: CommitCursor | null }[];
  archiveRequest: OperationRef | null; lastRefusal: string | null;
};
export type SecretaryArchiveAdvanceResultV1 = WriteResult<{
  operation: OperationRef; revision: number; stage: SecretaryArchiveStageV1;
  phase: SessionOperationRecord['phase']; generation: number;
  item: { requestRoot: QueryJobRef; commandId: string;
    savedInput: { operationId: string; to: SessionRef | null; expectedSource: SessionRef } | null;
    receipt: { routingRound: QueryJobRef; cursor: CommitCursor } | null };
  stop: 'advanced' | 'finished' | 'replayed' | 'refused';
}>;

/** The one request fact an archive item's recovery reads when its child receipt is missing. */
export type HandoffRequestFactsReadPort = { readRequest: (ctx: CoreCallContext, input: { requestRoot: QueryJobRef }) =>
  Promise<ReadResult<{ processing: boolean; owner: SessionRef | null }>> };

/** The port called at entered confirmation; consumption uses a state constructor and the sessions planner. */
export interface HandoffBriefPort {
  /** The record and guard to merge into the entered confirmation; it writes no event. */
  consume(ctx: CoreCallContext, input: { operation: OperationRef; queryRun: QueryRunRef; at: string }):
    Promise<{ status: 'ready'; value: { record: EncodedRecord; guard: RecordGuard } } | CoreRejection>;
}

/** The brief's saved goal refs, exactly as the progress stores them: one entry per covered goal. */
export type HandoffBriefGoalRefsV1 = NonNullable<HandoffActionV1['progress']['brief']>['goals'];
export type HandoffBriefGoalRefV1 = HandoffBriefGoalRefsV1[number];

/**
 * The brief's saved refs, read by the facts layer: it owns the Note read, and the advance stores the two refs
 * without reading a Note itself (the Session owner reads no Note).
 */
export type HandoffBriefRefsReadPort = {
  readBriefGoalRefs(ctx: CoreCallContext, input: { source: SessionRef; goals: CoverageGoalV1[] }):
    Promise<{ status: 'ready'; value: HandoffBriefGoalRefsV1 } | CoreRejection>;
};
