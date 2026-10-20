/**
 * Bounded UserDecision records.
 * Decision authority and required non-empty obligations remain admission constraints.
 */
import type { ActorRef } from "./command-event.js";
import type { PlanRevisionRef } from "./plan.js";
import type { GoalRef } from "./ledger.js";
// ------------------------------------------------------------------------ //
// Requests and value types                                                   //
// ------------------------------------------------------------------------ //
type UserDecisionOutcome = "accept" | "reject" | "defer";
export type UserDecisionV1 = {
    schemaVersion: 1;
    decisionId: string;
    projectId: string;
    workspaceId: string;
    proposalRef: {
        aggregateType: "PlanProposal";
        projectId: string;
        workspaceId: string;
        proposalId: string;
    };
    subject: {
        goalRef: GoalRef;
        sourcePlanRef: PlanRevisionRef;
        sourcePlanRevision: number;
    };
    outcome: UserDecisionOutcome;
    actor: ActorRef;
    authority: {
        strategy: "user" | "delegated";
        delegator: string | null;
        policyVersion: string;
    };
    authorizedTarget: {
        goalId: string;
        newObjective: string | null;
        sourcePlanDigest: string;
    };
    summary: string | null;
    decidedAt: string;
};
export type UserDecisionSnapshot = {
    ref: {
        aggregateType: "UserDecision";
        projectId: string;
        workspaceId: string;
        decisionId: string;
    };
    revision: 1;
    schemaVersion: 1;
    decision: UserDecisionV1;
    recordedAt: string;
};
