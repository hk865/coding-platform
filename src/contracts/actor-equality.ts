import { isRecord } from "./validation/common.js";

/** Actor identity of two unknown values: `kind` and `id` decide it, `runRef` is not compared. */
export function sameActorIdentity(left: unknown, right: unknown): boolean {
  return isRecord(left) && isRecord(right) && left["kind"] === right["kind"] && left["id"] === right["id"];
}

/** Actor identity of two typed actor shapes: `kind` and `id` only, with no extra shape check. */
export function sameActorKindAndId(left: { kind: string; id: string }, right: { kind: string; id: string }): boolean {
  return left.kind === right.kind && left.id === right.id;
}
