import { canonicalJson, sha256Hex, type JsonValue } from "./fingerprint.js";
import type { DependencyRequirement, PlanRevisionRef } from "./plan.js";

/** The content-derived `edge:` declaration id of one execution-DAG edge. */
export function edgeDeclarationId(
    planRef: PlanRevisionRef,
    edge: { taskId: string; dependsOnId: string; requires: DependencyRequirement },
): string {
    return "edge:" + sha256Hex(canonicalJson({
        planRef, consumerTaskId: edge.taskId, dependsOnId: edge.dependsOnId, requires: edge.requires,
    } as unknown as JsonValue));
}
/** The `legacy:` declaration id of one exact `inputRequirements` entry. */
export function legacyDeclarationId(requirementId: string): string {
    return `legacy:${requirementId}`;
}
