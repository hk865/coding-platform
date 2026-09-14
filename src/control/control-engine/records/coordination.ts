/** Stable internal entry for deterministic coordination commit construction.
 * Builders are grouped by business behavior below records/coordination/.
 */
export type { CoordinationFoldDeps, FoldContext } from './coordination/shared.js';
export { buildAgentInstanceRegisterCommit, buildParticipationStartCommit, buildParticipationEndCommit } from './coordination/participation.js';
export { directedRequestRefForOf, deliveryRefForOf, buildDirectedRequestSendCommit, buildDirectedRequestRespondCommit, buildDirectedRequestCancelCommit } from './coordination/directed-request.js';
export { buildSubscriptionCreateCommit, buildSubscriptionCancelCommit, buildSubscriptionCatchupCommit } from './coordination/subscription.js';
export { waitConditionRefForOf, communicationIntentRefForOf, intentSnapshotFor, buildIntentRecordCommit, withRouteIntentPlan, waitAdmissionIntentFor, waitDeadlineIntentFor, subscriptionRouteIntentFor, routePageIntentFor, buildWaitRegisterCommit, buildWaitCancelCommit } from './coordination/waiting.js';
export { buildCommunicationIntentClaimCommit, buildRoutePageCommit, buildIntentCancelRequestCommit, buildIntentSettleCommit, buildWaitObservationCommit } from './coordination/intent-lifecycle.js';
export { successorIdsFor, buildSuccessorCommit } from './coordination/successor.js';
