/**
 * Branded opaque value helper (mirrors `Opaque<Value, Brand>` from the
 * Command/Event Interface).
 */
export type Opaque<Value, Brand extends string> = Value & {
  readonly __brand: Brand;
};
