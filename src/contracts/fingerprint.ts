import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import type { JsonValue } from "./canonical-json.js";
export { canonicalJson, CanonicalJsonError } from "./canonical-json.js";
export type { JsonPrimitive, JsonValue } from "./canonical-json.js";
/** Key-order-free equality by canonical JSON; a value it cannot encode (`undefined`, a non-finite number) is never equal. */
export function sameJson(left: unknown, right: unknown): boolean {
    try {
        return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
    }
    catch {
        return false;
    }
}
/** Canonical JSON of any value; unlike `canonicalOf` an unencodable value throws. */
export function canonicalKey(value: unknown): string {
    return canonicalJson(value as JsonValue);
}
/** Canonical JSON, or `null` when the value is not canonical JSON. */
export function canonicalOf(value: unknown): string | null {
    try {
        return canonicalJson(value as JsonValue);
    }
    catch {
        return null;
    }
}
/** SHA-256 of UTF-8 bytes, lowercase hex. */
export function sha256Hex(input: string): string {
    return createHash("sha256").update(input, "utf8").digest("hex");
}
