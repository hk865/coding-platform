import { createHash } from "node:crypto";

/**
 * Minimal RFC 8785 / JCS canonical JSON serializer.
 *
 * Only the JSON value kinds used by this contract pack are supported
 * (null, boolean, finite number, string, array of JSON values, object with
 * string keys and JSON values). Non-JSON values (undefined, function, symbol,
 * non-finite numbers) are rejected deterministically.
 *
 * Object keys are sorted by UTF-16 code unit (same order as JS default
 * `sort()`). Values must not contain cycles — callers construct the exact
 * object shape specified by the interface.
 */
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

export function canonicalJson(value: JsonValue): string {
  return encode(value);
}

function encode(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError(`non-finite number is not JCS serializable: ${value}`);
    }
    // JCS serializes -0 as "0"; JSON.stringify already does that.
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const parts = value.map((item) => encode(item));
    return `[${parts.join(",")}]`;
  }
  const keys = Object.keys(value).sort(); // default sort is UTF-16 code unit order
  const parts = keys.map((key) => `${JSON.stringify(key)}:${encode(value[key] as JsonValue)}`);
  return `{${parts.join(",")}}`;
}

/** SHA-256 of UTF-8 bytes, lowercase hex. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
