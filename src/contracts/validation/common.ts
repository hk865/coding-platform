// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
/** Shared issue format for consumers and structural primitives for validators.
 * The primitives describe wire shape; they do not decide business admission. */
export type ValidationIssueCode = "missing_field" | "bad_type" | "unknown_schema_version" | "invalid_command_type" | "empty_entries" | "incomplete_scope" | "duplicate_identity" | "digest_mismatch" | "empty_objective" | "bad_expected_revision" | "unknown_event_type" | "bad_revision" | "invalid_fixture" | "empty_collection" | "conflict_unresolved" | "invalid_escalate" | "unknown_task_ref" | "unknown_stage_ref" | "unknown_obligation_ref" | "bad_scope" | "bad_enum" | "bad_sequence" | "size_exceeded" | "bad_binding_ref" | "bad_ref" | "unknown_field";
export type ValidationIssue = {
    path: string;
    code: ValidationIssueCode;
    message: string;
};
export type UnknownRecord = Record<string, unknown>;
export function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function stringField(record: UnknownRecord, key: string, issues: ValidationIssue[], displayPath: string = key): string | null {
    const value = record[key];
    if (typeof value === "string" && value.length > 0)
        return value;
    if (value === undefined) {
        issues.push({ path: displayPath, code: "missing_field", message: `${displayPath} is required` });
    }
    else if (typeof value === "string") {
        issues.push({ path: displayPath, code: "missing_field", message: `${displayPath} must be a non-empty string` });
    }
    else {
        issues.push({ path: displayPath, code: "bad_type", message: `${displayPath} must be a string` });
    }
    return null;
}

// Completed-capability migration: selected original declarations, no legacy service port.
export function safePositiveIntField(value: unknown, path: string, issues: ValidationIssue[]): number | null {
    if (Number.isSafeInteger(value) && (value as number) >= 1)
        return value as number;
    if (value === undefined) {
        issues.push({ path, code: "missing_field", message: path + " is required" });
    }
    else {
        issues.push({ path, code: "bad_revision", message: path + " must be a positive integer" });
    }
    return null;
}
export function validateEnum(value: unknown, allowed: readonly string[], path: string, issues: ValidationIssue[]): void {
    if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
        issues.push({ path, code: "bad_type", message: path + " must be one of " + allowed.join("|") });
    }
}

// Completed-capability migration: selected original declarations, no legacy service port.
export function stringArrayField(record: UnknownRecord, key: string, issues: ValidationIssue[], displayPath: string = key, allowEmpty: boolean = true): string[] | null {
    const value = record[key];
    if (Array.isArray(value) && value.every((v) => typeof v === "string" && v.length > 0)) {
        if (!allowEmpty && value.length === 0) {
            issues.push({
                path: displayPath,
                code: "bad_scope",
                message: displayPath + " must not be empty",
            });
            return null;
        }
        return [...value];
    }
    issues.push({
        path: displayPath,
        code: "bad_type",
        message: displayPath + " must be an array of non-empty strings",
    });
    return null;
}
