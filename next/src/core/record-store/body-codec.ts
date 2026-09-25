/**
 * Raw artifact body codec — the one old/new row boundary for the existing
 * `artifacts(key, record)` table (RecordStore §5).
 *
 * The stored row is the legacy shape plus a single additive canonical field:
 *   { ref, body, sourceRefs, ownerRunRef, origin? }
 *
 * `ownerRunRef` stays byte-compatible for old readers (a Run/QueryRun keeps its
 * full ref; a TaskAttempt or platform origin stores null). `origin` is the new
 * canonical provenance; a legacy row has none and is decoded from
 * `ownerRunRef`, and a null owner is never guessed into a principal. A legacy
 * origin may be decoded but can never be newly encoded.
 *
 * All physical validation lives here so the memory Map seam and the SQLite table
 * differ only in how a row is persisted:
 *  - an incomplete RawArtifactPut is `invalid` (the store maps an
 *    ArtifactBodyCodecError raised by `encodeArtifactBodyRow` to `invalid`);
 *  - a stored row whose JSON, schema, ref or body integrity does not hold, or
 *    whose canonical origin disagrees with its compatibility `ownerRunRef`, is
 *    `corrupt` (the store maps an ArtifactBodyCodecError raised by
 *    `decodeArtifactBodyRow` to `corrupt`), never `not_found` and never an
 *    empty body.
 *
 * The codec does no I/O and no authorization: it only checks the physical shape
 * and content addressing of one row.
 */
import { ARTIFACT_MAX_SIZE_BYTES, artifactBodyDigest, artifactBodySize } from "../../contracts/artifact.js";
import type { ArtifactOwnerRunRef, ArtifactRef } from "../../contracts/artifact.js";
import { sameArtifactOwnerRunRef } from "../../contracts/material-access.js";
import type { SourceRefV1, TaskAttemptRef } from "../../contracts/dispatch.js";
import type { MaterialOrigin, RawArtifactPut, RawArtifactRecord } from "./body-ports.js";
import { isJsonObject, isNonEmptyString, parseJsonObject } from "./record-codec.js";

/** Raised by both codec directions: the store maps encode -> invalid, decode -> corrupt. */
export class ArtifactBodyCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactBodyCodecError";
  }
}

function reject(message: string): never {
  throw new ArtifactBodyCodecError(`Raw artifact body: ${message}`);
}

const SOURCE_KINDS = new Set<SourceRefV1["kind"]>([
  "plan-revision",
  "workspace",
  "governance",
  "artifact",
  "memory",
]);

function isSourceRef(value: unknown): value is SourceRefV1 {
  if (!isJsonObject(value)) return false;
  const kind = value["kind"];
  if (typeof kind !== "string" || !SOURCE_KINDS.has(kind as SourceRefV1["kind"])) return false;
  if (!isNonEmptyString(value["refId"])) return false;
  if (typeof value["revision"] !== "string") return false;
  return value["digest"] === undefined || typeof value["digest"] === "string";
}

export function isArtifactRef(value: unknown): value is ArtifactRef {
  if (!isJsonObject(value)) return false;
  return value["kind"] === "artifact" &&
    isNonEmptyString(value["contentType"]) &&
    isNonEmptyString(value["digest"]) &&
    typeof value["sizeBytes"] === "number" &&
    Number.isSafeInteger(value["sizeBytes"]) &&
    value["sizeBytes"] >= 0 &&
    isSourceRef(value["source"]);
}

function isOwnerRunRef(value: unknown): value is ArtifactOwnerRunRef {
  if (!isJsonObject(value)) return false;
  if (value["aggregateType"] === "Run") {
    return isNonEmptyString(value["projectId"]) &&
      isNonEmptyString(value["goalId"]) &&
      isNonEmptyString(value["runId"]);
  }
  if (value["aggregateType"] === "QueryRun") {
    return isNonEmptyString(value["projectId"]) &&
      isNonEmptyString(value["workspaceId"]) &&
      isNonEmptyString(value["queryJobId"]) &&
      isNonEmptyString(value["runId"]);
  }
  return false;
}

function isTaskAttemptRef(value: unknown): value is TaskAttemptRef {
  if (!isJsonObject(value)) return false;
  return value["aggregateType"] === "TaskAttempt" &&
    isNonEmptyString(value["projectId"]) &&
    isNonEmptyString(value["goalId"]) &&
    isNonEmptyString(value["taskId"]) &&
    isNonEmptyString(value["attemptId"]);
}

function isActorRef(value: unknown): value is { kind: "human" | "system"; id: string } {
  if (!isJsonObject(value)) return false;
  return (value["kind"] === "human" || value["kind"] === "system") && isNonEmptyString(value["id"]);
}

function cloneSourceRef(source: SourceRefV1): SourceRefV1 {
  return source.digest === undefined
    ? { kind: source.kind, refId: source.refId, revision: source.revision }
    : { kind: source.kind, refId: source.refId, revision: source.revision, digest: source.digest };
}

function cloneOwnerRunRef(owner: ArtifactOwnerRunRef): ArtifactOwnerRunRef {
  return owner.aggregateType === "Run"
    ? { aggregateType: "Run", projectId: owner.projectId, goalId: owner.goalId, runId: owner.runId }
    : {
        aggregateType: "QueryRun",
        projectId: owner.projectId,
        workspaceId: owner.workspaceId,
        queryJobId: owner.queryJobId,
        runId: owner.runId,
      };
}

function cloneTaskAttemptRef(attempt: TaskAttemptRef): TaskAttemptRef {
  return {
    aggregateType: "TaskAttempt",
    projectId: attempt.projectId,
    goalId: attempt.goalId,
    taskId: attempt.taskId,
    attemptId: attempt.attemptId,
  };
}

function cloneArtifactRef(ref: ArtifactRef): ArtifactRef {
  return {
    kind: "artifact",
    contentType: ref.contentType,
    digest: ref.digest,
    sizeBytes: ref.sizeBytes,
    source: cloneSourceRef(ref.source),
  };
}

function sameSourceRef(a: SourceRefV1, b: SourceRefV1): boolean {
  return a.kind === b.kind && a.refId === b.refId && a.revision === b.revision &&
    (a.digest ?? null) === (b.digest ?? null);
}

/** The content addressing key of the legacy `artifacts` table. */
export function artifactBodyKey(ref: Pick<ArtifactRef, "contentType" | "digest" | "sizeBytes">): string {
  return `${ref.contentType}|${ref.digest}|${ref.sizeBytes}`;
}

/**
 * One origin shape rule shared by the new-write boundary and the stored-row
 * reader. It rejects the decode-only legacy branch and any unknown kind, and
 * returns both the canonical origin and the compatibility `ownerRunRef` it must
 * agree with, so encode and decode never maintain two copies of the rule.
 */
type NormalizedOrigin = { origin: MaterialOrigin; ownerRunRef: ArtifactOwnerRunRef | null };

function normalizeOrigin(value: unknown): NormalizedOrigin {
  if (!isJsonObject(value)) reject("origin must be an object");
  const kind = value["kind"];
  if (kind === "run") {
    const owner = value["owner"];
    if (isOwnerRunRef(owner)) {
      const cloned = cloneOwnerRunRef(owner);
      return { origin: { kind: "run", owner: cloned }, ownerRunRef: cloned };
    }
    if (isTaskAttemptRef(owner)) {
      return { origin: { kind: "run", owner: cloneTaskAttemptRef(owner) }, ownerRunRef: null };
    }
    reject("run origin must carry a complete Run/QueryRun/TaskAttempt ref");
  }
  if (kind === "platform_operation") {
    const projectId = value["projectId"];
    if (!isNonEmptyString(projectId)) reject("platform origin projectId must be a non-empty string");
    const workspaceId = value["workspaceId"];
    if (workspaceId !== undefined && typeof workspaceId !== "string") {
      reject("platform origin workspaceId must be a string when present");
    }
    const requestId = value["requestId"];
    if (!isNonEmptyString(requestId)) reject("platform origin requestId must be a non-empty string");
    const actor = value["actor"];
    if (!isActorRef(actor)) reject("platform origin actor must be a human/system actor");
    return {
      origin: {
        kind: "platform_operation",
        projectId,
        ...(workspaceId === undefined ? {} : { workspaceId }),
        requestId,
        actor: { kind: actor.kind, id: actor.id },
      },
      ownerRunRef: null,
    };
  }
  if (kind === "legacy") reject("legacy origins cannot be written or stored explicitly");
  reject(`origin kind ${String(kind)} is not supported`);
}

/** A row with a canonical origin must carry the compatible owner authority. */
function originOwnerMatches(value: unknown, expected: ArtifactOwnerRunRef | null): boolean {
  if (expected === null) return value === null;
  return isOwnerRunRef(value) && sameArtifactOwnerRunRef(value, expected);
}

function decodeOrigin(value: unknown, ownerRunRef: unknown): MaterialOrigin {
  if (value === undefined) {
    if (ownerRunRef === undefined || ownerRunRef === null) return { kind: "legacy", ownerRunRef: null };
    if (!isOwnerRunRef(ownerRunRef)) {
      reject("stored legacy ownerRunRef must be null or a complete Run/QueryRun ref");
    }
    return { kind: "legacy", ownerRunRef: cloneOwnerRunRef(ownerRunRef) };
  }
  const normalized = normalizeOrigin(value);
  if (!originOwnerMatches(ownerRunRef, normalized.ownerRunRef)) {
    reject("stored ownerRunRef does not match the canonical origin");
  }
  return normalized.origin;
}

/** New-write boundary: a complete input encodes a row; a legacy origin is refused. */
export function encodeArtifactBodyRow(input: RawArtifactPut): string {
  const raw: unknown = input;
  if (!isJsonObject(raw)) reject("put input must be an object");
  const body = raw["body"];
  if (typeof body !== "string") reject("put body must be a string");
  const contentType = raw["contentType"];
  if (!isNonEmptyString(contentType)) reject("put contentType must be a non-empty string");
  const rawSources = raw["sourceRefs"];
  if (!Array.isArray(rawSources) || rawSources.length === 0) {
    reject("put sourceRefs must be a non-empty array");
  }
  const sourceRefs: SourceRefV1[] = [];
  for (const candidate of rawSources) {
    if (!isSourceRef(candidate)) reject("put sourceRefs must contain valid SourceRefV1 values");
    sourceRefs.push(cloneSourceRef(candidate));
  }
  if (!isNonEmptyString(raw["requestedAt"])) reject("put requestedAt must be a non-empty string");
  const { ownerRunRef, origin } = normalizeOrigin(raw["origin"]);
  const sizeBytes = artifactBodySize(body);
  if (sizeBytes > ARTIFACT_MAX_SIZE_BYTES) {
    reject(`put body size ${sizeBytes} exceeds ${ARTIFACT_MAX_SIZE_BYTES}`);
  }
  const digest = artifactBodyDigest(body);
  const firstSource = sourceRefs[0]!;
  const ref: ArtifactRef = { kind: "artifact", contentType, digest, sizeBytes, source: cloneSourceRef(firstSource) };
  return JSON.stringify({ ref, body, sourceRefs, ownerRunRef, origin });
}

/**
 * Reads back the ref of a row this codec just encoded, without re-hashing the
 * body. Only for the trusted result of `encodeArtifactBodyRow`; persisted rows
 * must still go through `decodeArtifactBodyRow` for integrity verification.
 */
export function readEncodedArtifactRef(json: string): ArtifactRef {
  const parsed = parseJsonObject(json);
  if (parsed.status === "invalid") reject(`encoded row is not a JSON object: ${parsed.reason}`);
  const ref = parsed.value["ref"];
  if (!isArtifactRef(ref)) reject("encoded row ref is not a complete ArtifactRef");
  return ref;
}

/** Old/new read boundary: any damaged stored row raises so the store can return `corrupt`. */
export function decodeArtifactBodyRow(json: string): RawArtifactRecord {
  const parsed = parseJsonObject(json);
  if (parsed.status === "invalid") reject(`stored row is not a JSON object: ${parsed.reason}`);
  const row = parsed.value;
  const ref = row["ref"];
  if (!isArtifactRef(ref)) reject("stored ref is not a complete ArtifactRef");
  const body = row["body"];
  if (typeof body !== "string") reject("stored body must be a string");
  const rawSources = row["sourceRefs"];
  if (!Array.isArray(rawSources) || rawSources.length === 0) {
    reject("stored sourceRefs must be a non-empty array");
  }
  const sourceRefs: SourceRefV1[] = [];
  for (const candidate of rawSources) {
    if (!isSourceRef(candidate)) reject("stored sourceRefs are invalid");
    sourceRefs.push(cloneSourceRef(candidate));
  }
  const firstSource = sourceRefs[0]!;
  if (!sameSourceRef(ref.source, firstSource)) reject("stored ref.source does not match sourceRefs[0]");
  if (artifactBodyDigest(body) !== ref.digest || artifactBodySize(body) !== ref.sizeBytes) {
    reject("stored body does not match its recorded digest/size");
  }
  return { ref: cloneArtifactRef(ref), body, sourceRefs, origin: decodeOrigin(row["origin"], row["ownerRunRef"]) };
}
