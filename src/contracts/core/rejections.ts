import type { VersionPin } from "./identity.js";
import type { CoreError } from "./results.js";

/** A Core rejection with no `current`. */
export function rejected<C extends CoreError>(code: C, reason: string): {
    status: "rejected";
    code: C;
    reason: string;
} {
    return { status: "rejected", code, reason };
}
/** A Core rejection that keeps `current` whenever the caller passed it (an empty array included). */
export function rejectedWithCurrent<C extends CoreError>(code: C, reason: string, current?: VersionPin[]): {
    status: "rejected";
    code: C;
    reason: string;
    current?: VersionPin[];
} {
    return { status: "rejected", code, reason, ...(current === undefined ? {} : { current }) };
}
/** A Core rejection that attaches `current` only when it is non-empty. */
export function rejectedWithNonEmptyCurrent<C extends CoreError>(code: C, reason: string, current?: VersionPin[]): {
    status: "rejected";
    code: C;
    reason: string;
    current?: VersionPin[];
} {
    return current !== undefined && current.length > 0
        ? { status: "rejected", code, reason, current }
        : { status: "rejected", code, reason };
}
/**
 * P6I R2: a rejection its source marks lasting: the cause is known there and does not lift by itself (a template that
 * cannot render, a selected prompt pack that is not there, a frozen input that does not fit). A reader acts only on
 * this mark, never on the bare code: the same codes also come from causes that lift (a key not configured yet, a
 * request that moved between two reads).
 */
export function lastingRejection<C extends CoreError>(code: C, reason: string): {
    status: "rejected";
    code: C;
    reason: string;
    lasting: true;
} {
    return { status: "rejected", code, reason, lasting: true };
}
/** Whether a result is a rejection its source marked lasting (`lastingRejection`). */
export function isLastingRejection(result: unknown): boolean {
    return typeof result === "object" && result !== null && (result as { status?: unknown }).status === "rejected"
        && (result as { lasting?: unknown }).lasting === true;
}
/** The `{ ok: false, code, reason }` result shape. */
export function okFalse<C extends CoreError>(code: C, reason: string): {
    ok: false;
    code: C;
    reason: string;
} {
    return { ok: false, code, reason };
}
