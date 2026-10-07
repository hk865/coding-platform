
// Completed-capability migration: selected original declarations, no legacy service port.
import type { RoleBindingRefV1 } from './dispatch.js';
import type { RuntimeBudget } from './runtime-budget.js';
import type { VerificationRoundScope } from './verification-context.js';
export type ReviewerConfigRef = {
    configId: string;
    revision: number;
    digest: string;
};
export type ReviewerProfileV1 = {
    schemaVersion: 1;
    profileId: string;
    revision: number;
    digest: string;
    subjectScope: VerificationRoundScope;
    roleBinding: RoleBindingRefV1;
    mode: 'review';
    permissions: {
        tools: string[];
        writeScope: [
        ];
    };
    model: {
        configurationRevision: string;
        provider: string;
        model: string;
        baseUrl: string;
    };
    budget: RuntimeBudget;
};
