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
export function nonEmpty(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}
/** `argumentsDigest` and other sha256 fields are lowercase hex. */
export function isSha256Hex(value: unknown): value is string {
    return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
export function isInt(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value);
}
export function isNonNeg(value: unknown): value is number {
    return isInt(value) && value >= 0;
}
export function isPos(value: unknown): value is number {
    return isInt(value) && value >= 1;
}
export function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
    return Object.keys(value).every((key) => allowed.includes(key));
}
export function utf8Bytes(value: string): number {
    return new TextEncoder().encode(value).length;
}
export function codePoints(value: string): number {
    return [...value].length;
}
export function inList<T extends string>(value: unknown, allowed: readonly T[]): value is T {
    return typeof value === "string" && (allowed as readonly string[]).includes(value);
}
export function parseObject(json: string): UnknownRecord | null {
    try {
        const parsed: unknown = JSON.parse(json);
        return isRecord(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
export function parseTaggedObject(json: string, what: string): UnknownRecord | string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        return `${what} is not valid JSON`;
    }
    if (!isRecord(parsed))
        return `${what} JSON must be an object`;
    return parsed;
}
export function invalid(reason: string): { status: "invalid"; reason: string } {
    return { status: "invalid", reason };
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
