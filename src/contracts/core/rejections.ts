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
/** The `{ ok: false, code, reason }` result shape. */
export function okFalse<C extends CoreError>(code: C, reason: string): {
    ok: false;
    code: C;
    reason: string;
} {
    return { ok: false, code, reason };
}
