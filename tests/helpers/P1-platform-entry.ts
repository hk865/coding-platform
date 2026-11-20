/**
 * P1's named RULES F3 exception (lead ruling T1, `p1-frozen.md`): the few P1 owner calls that only the platform or
 * the Host makes, until P2/P4 wire the real callers; then these calls move to the real entries or are deleted. The
 * lead registers this file in `tests/RULES.md` A7 item 5 at merge, with that deadline.
 *
 * Scope, and nothing else:
 * - the platform automation actor: `placeScribeStop` (H2, H3, H5, R5), `deliverStop` (S2–S7), `settle` (C5) and
 *   the rework the Workflow stopped before (R5);
 * - the configured operator (P2's `tasks/hold/release` and card routes): `releaseAll` (H3, C4) and `withdraw` (C4);
 *   for C4 the operator's context names a project the world does not host (the one-project PL world cannot open a
 *   second project), so the refs it is handed are another project's;
 * - a Host actor that is not the configured operator, only in the refusal rows of those two calls: `withdraw` (M3-8)
 *   and `releaseAll` (M4-7);
 * - the Host's `claims.claimTask` carrying `servedRequest` or the intervention mark (D4–D6, D9, AR-1, H5); a claim
 *   without either goes through the public `workflow/advance` (`P1-reads.ts` `performClaim`).
 * One thin function per entry; every ref it is handed is a value an earlier public step returned (the Workflow's own
 * claim request, the Workflow's own stopped `requeue_task`, a returned `actionRef`, a run or message ref a public
 * read gave). The automation context is the Host principal with `WORKFLOW_AUTOMATION_ACTOR`, the identity the
 * contract names for these steps (`src/contracts/task-requeue.ts:67-70`).
 */
import { createHostCoreCallContext } from '../../src/app/core-call-context.js';
import type { ActionRequestRef } from '../../src/contracts/action-request.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { ClaimTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type { S6AHostWorld } from './S6A-host-fixture.js';
import { S6A_SCOPE } from './S6A-request-fixture.js';

/** C4: a project this world does not host, in the world's workspace id. */
export const P1_OTHER_PROJECT = { projectId: 'p1-other-project', workspaceId: S6A_SCOPE.workspaceId } as const;

/** The platform automation identity (Host principal, `WORKFLOW_AUTOMATION_ACTOR`) bound to the world's scope. */
function automation(): CoreCallContext {
  return createHostCoreCallContext({ scope: S6A_SCOPE, actor: { ...WORKFLOW_AUTOMATION_ACTOR },
    signal: new AbortController().signal });
}

/** A Host actor that is not the configured operator. */
function otherHost(): CoreCallContext {
  return createHostCoreCallContext({ scope: S6A_SCOPE, actor: { kind: 'human', id: 'p1-not-the-operator' },
    signal: new AbortController().signal });
}

/** The world's configured operator (its human actor) in `scope`. */
function operator(world: S6AHostWorld, scope: { projectId: string; workspaceId: string }): CoreCallContext {
  const principal = world.humanContext().principal;
  if (principal.kind !== 'host') throw new Error('P1: the world has no Host operator');
  return createHostCoreCallContext({ scope, actor: { ...principal.actor }, signal: new AbortController().signal });
}

/** P4's caller: the scribe's conclusion places its stop reason (2.4 `placeScribeStop`). */
export async function placeScribeStop(world: S6AHostWorld, input: {
  taskRef: TaskTriple; reason: string; sourceMessage: SessionMessageRef; run: RunRef; operationId: string;
}, requestId: string) {
  return world.platform.claimHolds.placeScribeStop(automation(), { input, meta: { requestId, expected: [] } });
}

/** P2's callers (auto tool, approval, start-up reconcile): deliver a released stop (2.3 `deliverStop`). */
export async function deliverStop(world: S6AHostWorld, request: ActionRequestRef) {
  return world.platform.actionRequests.deliverStop(automation(), { request });
}

/** P2's Goal loop: void a request (2.3 `settle`, AR-04). */
export async function platformSettle(world: S6AHostWorld, request: ActionRequestRef, reason: string,
  requestId: string) {
  return world.platform.actionRequests.settle(automation(), { input: { request, reason },
    meta: { requestId, expected: [] } });
}

/** P2's `tasks/hold/release`: the configured operator releases every reason of a Task (2.4 `releaseAll`). */
export async function personReleaseAll(world: S6AHostWorld, taskRef: TaskTriple, requestId: string,
  scope: { projectId: string; workspaceId: string } = S6A_SCOPE) {
  return world.platform.claimHolds.releaseAll(operator(world, scope), { input: { taskRef },
    meta: { requestId, expected: [] } });
}

/** M4-7's refusal row: a Host that is not the configured operator releases every reason of a Task. */
export async function otherHostReleaseAll(world: S6AHostWorld, taskRef: TaskTriple, requestId: string) {
  return world.platform.claimHolds.releaseAll(otherHost(), { input: { taskRef }, meta: { requestId, expected: [] } });
}

/** M3-8's refusal row: a Host that is not the configured operator withdraws a request. */
export async function otherHostWithdraw(world: S6AHostWorld, request: ActionRequestRef, requestId: string) {
  return world.platform.actionRequests.withdraw(otherHost(), { input: { request }, meta: { requestId, expected: [] } });
}

/** P2's card route: the configured operator withdraws a request (2.3 `withdraw`). */
export async function personWithdraw(world: S6AHostWorld, request: ActionRequestRef, requestId: string,
  scope: { projectId: string; workspaceId: string } = S6A_SCOPE) {
  return world.platform.actionRequests.withdraw(operator(world, scope), { input: { request },
    meta: { requestId, expected: [] } });
}

/** The Workflow's own automatic rework, performed as the platform automation actor (R5). */
export async function platformRework(world: S6AHostWorld, stopped: WorkflowAdvanceInput) {
  if (stopped.kind !== 'perform' || stopped.operation.kind !== 'requeue_task') {
    throw new Error('P1: the stopped Workflow step is not its automatic requeue_task');
  }
  return world.platform.claims.requeueTask!(automation(), stopped.operation.request);
}

/**
 * P2's `buildClaimOperation`/`claimIntervention`: the Workflow's own claim request as the Host makes it, with the
 * served request (2.5) or the intervention mark (Q6a) added; nothing else changes.
 */
export async function hostClaim(world: S6AHostWorld, step: WorkflowAdvanceInput, mark:
  | { servedRequest: { ref: ActionRequestRef; revision: number } }
  | { intervention: { messageRef: SessionMessageRef } }) {
  if (step.kind !== 'perform' || step.operation.kind !== 'claim_task') {
    throw new Error('P1: the Workflow step is not its own claim_task');
  }
  const request: GraphWrite<ClaimTaskInput> = step.operation.request;
  return world.platform.claims.claimTask(world.humanContext(), { ...request, input: { ...request.input, ...mark } });
}
