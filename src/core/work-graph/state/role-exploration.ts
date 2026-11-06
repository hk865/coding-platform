/**
 * The `role_exploration` Query of a cold start: its one `goalId:null` execution arm, the Host system “please act”
 * text the cold start sends, and the one trusted binding check the note owner runs on the round. Pure; the caller
 * does the reads.
 */
import type { CoreRejection } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { ModuleRef } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { QueryJobIntentV1, QueryRunRef } from '../../../contracts/query-job.js';
import type { RoleBindingRefV1 } from '../../../contracts/dispatch.js';
import type { RuntimeBudget } from '../../../contracts/runtime-budget.js';
import type { ColdStartActionV1 } from './cold-start.js';

export type RoleExplorationSegmentV1 = 'coarse_split' | 'region';
export type RoleExplorationBindingV1 = { operationRef: OperationRef; systemMessageRef: SessionMessageRef };

/** The one `goalId:null` execution arm: the QueryRun is the trusted principal (spec S7-RL-13). */
export function roleExplorationExecution(input: {
  roleBinding: RoleBindingRefV1; runtimeBudget: RuntimeBudget;
}): QueryJobIntentV1['execution'] {
  return { kind: 'role_exploration', roleBinding: structuredClone(input.roleBinding),
    runtimeBudget: structuredClone(input.runtimeBudget) };
}

export function roleExplorationQuestion(segment: RoleExplorationSegmentV1, region: ModuleRef | null): string {
  return segment === 'coarse_split'
    ? 'Please act: read only the top-level directories, entry points and existing docs, then propose the coarse split.'
    : `Please act: explore only the region ${region?.moduleId ?? ''} and propose that region's revision.`;
}

/**
 * Host system `action_request`, read from the record only: the shape of the `overlap-note:` planning source and of
 * a cold-start exploration's “please act” message.
 */
export function hostSystemActionRequest(message: { sender: { kind: string; actor?: { kind: string } }; intent?: string }): boolean {
  return message.sender.kind === 'host' && message.sender.actor?.kind === 'system'
    && message.intent === 'action_request';
}

/** The one binding check: Session role facts + the cold-start payload + the Host system message. */
export function roleExplorationBindingOf(input: {
  coldStartRef: OperationRef;
  lineOperation: OperationRef | null;
  action: ColdStartActionV1;
  queryRunRef: QueryRunRef;
  message: { sender: { kind: string; actor?: { kind: string } }; intent?: string } | null;
}): { status: 'ready'; value: RoleExplorationBindingV1 } | CoreRejection {
  if (input.lineOperation === null) return rejected('forbidden', 'the exploration QueryRun has no role-line operation');
  const entry = input.action.explorations.find(candidate =>
    candidate.queryRunRef.projectId === input.queryRunRef.projectId
    && candidate.queryRunRef.queryJobId === input.queryRunRef.queryJobId
    && candidate.queryRunRef.runId === input.queryRunRef.runId);
  if (entry === undefined) return rejected('forbidden', 'the QueryRun is not one this cold start opened');
  // The entry's `operationRef` is the line's stored origin (`SessionRoleFactsV1.originOperation`): the opening
  // adviser's is `start_lines`; a region line's is the origin the chosen line stored, the cold-start operation for
  // a newly opened line and its own earlier origin for a line reused from standby.
  if (input.lineOperation.projectId !== entry.operationRef.projectId
    || input.lineOperation.operationId !== entry.operationRef.operationId) {
    return rejected('forbidden', 'the exploration line origin is not the adviser line the cold start opened');
  }
  if (input.message === null || !hostSystemActionRequest(input.message)) {
    return rejected('forbidden', 'the exploration round has no Host system “please act” message');
  }
  return { status: 'ready', value: { operationRef: { ...input.coldStartRef },
    systemMessageRef: { ...entry.messageRef } } };
}
