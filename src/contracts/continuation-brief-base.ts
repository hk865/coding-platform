/**
 * The continuation brief's bounds, which the renderer and the shape validator
 * both read, and its marker line, the second line a re-render is compared by.
 * It imports nothing, so `continuation-brief-render.ts` and
 * `continuation-brief.ts` both value-import it without a load cycle.
 */

/** Bounds of the brief; over-long fields are truncated and counted in `…Omitted` / `truncated`. */
export const CONTINUATION_BRIEF_LIMITS = Object.freeze({
  confirmedToolCalls: 40,
  notExecutedToolCalls: 20,
  unknownToolCalls: 20,
  /** Paths across `selfChanged` and across `uncommitted`. */
  paths: 64,
  pathsPerCall: 8,
  /** Kernel records read while assembling. */
  kernelRecords: 5000,
  /** Rendered text; the fixed instruction block is always kept. */
  renderedBytes: 16_384,
  earlierRequeues: 5,
  factsFromHops: 4,
  newInputs: 16,
  /** Per `BoundedTextV1` field, in UTF-16 code units. */
  textChars: 4000,
} as const);

/** The second line of the rendered brief; WorkGraph re-renders and compares this text. */
export function continuationBriefMarker(digest: string): string {
  return `[continuation-brief v1 sha256:${digest}]`;
}
