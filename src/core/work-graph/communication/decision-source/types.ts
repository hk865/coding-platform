import type { SessionRef, VersionPin } from '../../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../../contracts/core/results.js';
import type { DecisionObjectV1, DecisionOptionV1,
  GoalDecisionBasisV1 } from '../../../../contracts/goal-decisions.js';
import type { GoalRef, GoalSnapshot } from '../../../../contracts/ledger.js';
import type { DecodeResult, EncodedRecord } from '../../../record-store/ports.js';
import type { CommandRerunRequestReadPort } from '../../model/command-rerun-request-contracts.js';
import type { NoteDecisionSourcePort, S5RecordPort } from '../../model/decision-contracts.js';
import type { ExecutionReadPort } from '../../model/execution-read-contracts.js';
import type { KernelCommandReader } from '../../model/kernel-command-read-contracts.js';
import type { UnknownCallReviewReadPort } from '../../model/unknown-call-review-contracts.js';
import type { WorkspaceToolsPort } from '../../../workspace/ports.js';

/** The complete branch facts one decision-source handler returns. */
export type DecisionSourceBranchFacts = {
  goal: GoalSnapshot;
  objects: DecisionObjectV1[];
  options: DecisionOptionV1[];
  pins: VersionPin[];
  goalBases: GoalDecisionBasisV1[];
  closed: boolean;
  allowedReaderSessionRefs: SessionRef[];
};

export type SourceReadResult = ReadResult<DecisionSourceBranchFacts>;

export type EncodedRecordOutcome = { ok: true; record: EncodedRecord } | { ok: false; rejection: CoreRejection };

/** The one Store seam, scope checks and pin helpers every handler shares. */
export type SourceReadSupport = {
  records: S5RecordPort;
  scope: { projectId: string; workspaceId: string };
  scopeProblem(ref: unknown): ReadResult<never> | null;
  readEncoded(ref: unknown): Promise<EncodedRecordOutcome>;
  readDecoded<T>(ref: unknown, decode: (record: EncodedRecord) => DecodeResult<T>, label: string): Promise<ReadResult<T>>;
  readGoal(ref: GoalRef): Promise<ReadResult<GoalSnapshot>>;
  refreshPins(pins: readonly VersionPin[]): Promise<ReadResult<VersionPin[]>>;
  verifyPins(pins: readonly VersionPin[]): Promise<ReadResult<never> | null>;
};

/** The optional owner ports the handlers read their branch facts from. */
export type SourceDependencies = {
  noteDecisions?: Pick<NoteDecisionSourcePort, 'readNoteDecision'>;
  unknownCallReviews?: Pick<UnknownCallReviewReadPort, 'readReview'>;
  commandRerunRequests?: Pick<CommandRerunRequestReadPort, 'listRequests' | 'readRequest'>;
  readKernelCommandFacts?: KernelCommandReader;
  commandRerunExecutions?: Pick<ExecutionReadPort, 'readExecution'>;
  workspace?: Pick<WorkspaceToolsPort, 'readWorkspace'>;
};
