
// Completed-capability migration: selected original declarations, no legacy service port.
export const REVIEWER_MATERIAL_PAGE_MAX_BYTES = 32 * 1024;
export const REVIEWER_SOURCE_MAX_LINES = 200;
export class ReviewerMaterialError extends Error {
    constructor(readonly code: 'invalid_reference' | 'forbidden' | 'stale' | 'unavailable', message: string) { super(message); }
}
export type ReviewerSourceRequest = {
    path: string;
    startLine: number;
    endLine: number;
    digest?: string;
};
export type ReviewerSourcePage = {
    materialId: string;
    path: string;
    digest: string;
    startLine: number;
    endLine: number;
    content: string;
};

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
