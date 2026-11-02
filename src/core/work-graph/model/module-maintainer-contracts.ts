/**
 * The module maintainer's owner port (L9). The formal request is the `maintainer_assignment` arm of the existing
 * `SessionOperationRecord`; its two entries (the person's route and the adviser's trusted tool) call one command and
 * share its result, the target `SessionWorkLink`. This file declares the port and the shapes the entries carry; the
 * owner itself is `sessions/module-maintainer-service.ts`, its pure decision `state/assign-maintainer.ts`.
 *
 * Three caller names stay apart: the stored action input's real Work identity (`MaintainerAssignmentCallerV1`, state),
 * the command's admission branch (`MaintainerCallerV1` here), and the tool request below. Only the trusted branch
 * carries a proof, and the owner rebuilds its checker binding from the stored operation input, never from the proof.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ModuleRef, SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { DecisionApplicationReceiptV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionWorkLink } from '../../../contracts/core/session.js';
import type { MaintainerCallBindingV1, MaintainerCallBranchV1 } from '../../../contracts/role-lines.js';
import type { MaintainerAssignmentCallerV1 } from '../state/module-maintainer-assignment.js';
import type { GraphWrite } from './task-contracts.js';
import type { MaintainerAssignmentOperationV1 } from './session-contracts.js';

/**
 * The command's admission. `person` is the route's own entry (the person-only binding is the admission there);
 * `trusted` is the adviser tool's branch, checked against the stored operation input before any link read.
 */
export type MaintainerCallerV1 = { kind: 'person' } | { kind: 'trusted'; proof: MaintainerCallBranchV1 };

export type AssignMaintainerInputV1 = { module: ModuleRef; line: SessionRef };

export type MaintainerAssignmentDecisionInputV1 = {
  commandId: string;
  operation: OperationRef;
  answer: SessionMessageRef;
  verdict: 'approve' | 'reject';
};

/** Rebuild the checker's independent binding from the STORED operation input only. */
export function maintainerBindingOfOperation(
  op: MaintainerAssignmentOperationV1,
): MaintainerCallBindingV1 {
  return {
    operation: structuredClone(op.ref),
    moduleRef: structuredClone(op.action.input.moduleRef),
    line: structuredClone(op.action.input.line),
  };
}

/** The tool's real Work identity (defined in state, imported above); it carries no proof. */
export type MaintainerAssignmentRequestV1 = {
  commandId: string; caller: MaintainerAssignmentCallerV1;
  moduleRef: ModuleRef; line: SessionRef; reason: string;
};

export type MaintainerAssignmentToolResultV1 =
  | { status: 'assigned'; line: SessionRef }
  | { status: 'needs_decision'; cardKey: string }
  | CoreRejection;

export interface ModuleMaintainerPort {
  maintainerOf(ctx: CoreCallContext, input: { workspace: WorkspaceScope; module: ModuleRef }):
    Promise<ReadResult<{ status: 'none' } | { status: 'assigned'; line: SessionRef; link: SessionWorkLink }>>;
  /** One R2 command; the result is the target link. `meta.expected` stays in the fingerprint. */
  assignModuleMaintainer(ctx: CoreCallContext, request: GraphWrite<AssignMaintainerInputV1>,
    caller: MaintainerCallerV1): Promise<WriteResult<SessionWorkLink>>;
  /** The answer adapter's one call; the owner advances the stored operation and returns its stage receipt. */
  applyMaintainerAssignmentDecision(ctx: CoreCallContext, input: MaintainerAssignmentDecisionInputV1,
    caller: Extract<MaintainerCallerV1, { kind: 'trusted' }>): Promise<
      | { status: 'done'; operation: OperationRef; link: SessionWorkLink;
          receipt: DecisionApplicationReceiptV1 }
      | { status: 'rejected'; operation: OperationRef; code: CoreError; reason: string }
      | { status: 'stale'; operation: OperationRef }
      | CoreRejection>;
  /** The tool's one entry: create the operation, then stop or continue by the real confirmation mode. */
  requestAssignment(ctx: CoreCallContext, request: MaintainerAssignmentRequestV1):
    Promise<MaintainerAssignmentToolResultV1>;
}
