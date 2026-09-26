/**
 * WorkGraph Goal graph repository — the typed layer over
 * `GoalRecordTransactionPort`.
 *
 * Responsibilities:
 *   - ONE read snapshot for the canonical Project/Workspace/Goal keys;
 *   - the legal early idempotency lookup;
 *   - the single commit call;
 *   - R3a §6 replay recovery: a stored receipt's `cursor` locates exactly the
 *     one `GoalCreated` event, so `eventAt(cursor)` is the O(1) read that
 *     rebuilds the ORIGINAL created Goal. A missing event, an unknown schema or
 *     a receipt pointing at another event is reported as `corrupt` — never a
 *     resubmission and never the current Goal as an approximation.
 *
 * No SQL, no Map, no domain admission and no legacy ledger import.
 */
import type { ActorRef, CommitCursor, CommandIdentity } from "../../../contracts/command-event.js";
import type { GoalRef, GoalSnapshot, ProjectRef, ProjectSnapshot, WorkspaceRef, WorkspaceSnapshot } from "../../../contracts/ledger.js";
import type { DecodeResult, EncodedRecord, GoalRecordTransactionPort, PreparedCommit, StoreCommitReceipt } from "../../record-store/ports.js";
import { goalCreateIdentityKey } from "./commit-compiler.js";
import { canonicalRefKey, decodeGoalCreatedEvent, decodeGoalSnapshot, decodeProjectSnapshot, decodeWorkspaceSnapshot, goalSnapshotFromCreatedEvent } from "./record-codecs.js";

export type CommittedStoreReceipt = Extract<StoreCommitReceipt, { status: "committed" }>;

export type GoalScopeRefs = {
  projectRef: ProjectRef;
  workspaceRef: WorkspaceRef;
  goalRef: GoalRef;
};

export type GoalScope = {
  project: ProjectSnapshot;
  workspace: WorkspaceSnapshot;
  /** Current Goal; `undefined` means it does not exist yet (compat fallback only). */
  goal: GoalSnapshot | undefined;
  readThrough: CommitCursor | null;
};

export type GoalScopeReadResult =
  | { status: "ready"; scope: GoalScope }
  | { status: "not_found"; reason: string }
  | { status: "corrupt"; reason: string }
  | { status: "unavailable"; reason: string };

/** The created-Goal identity a receipt must agree with to be replayed. */
export type GoalCreateIdentity = {
  identity: CommandIdentity;
  goalId: string;
  workspaceId: string;
};

export type OriginalGoalResult =
  | { status: "restored"; snapshot: GoalSnapshot }
  | { status: "corrupt"; reason: string }
  | { status: "unavailable"; reason: string };

export type GoalLookupInput = {
  identityKey: string;
  fingerprint: string;
  expected: GoalCreateIdentity;
};

export type GoalLookupResult =
  | { status: "found"; receipt: CommittedStoreReceipt; snapshot: GoalSnapshot }
  | { status: "missing" }
  | { status: "idempotency_conflict"; reason: string }
  | { status: "invalid"; reason: string }
  | { status: "corrupt"; reason: string }
  | { status: "unavailable"; reason: string };

export type GoalCommitInput = {
  prepared: PreparedCommit;
  /** The freshly folded value, returned when THIS call performed the commit. */
  folded: GoalSnapshot;
  expected: GoalCreateIdentity;
};

export type GoalCommitResult =
  | { status: "committed"; receipt: CommittedStoreReceipt; snapshot: GoalSnapshot }
  | {
      status: "revision_conflict";
      reason: string;
      current: { refKey: string; revision: number | null }[];
    }
  | { status: "idempotency_conflict"; reason: string }
  | { status: "invalid"; reason: string }
  | { status: "corrupt"; reason: string }
  | { status: "unavailable"; reason: string };

export interface GoalGraphRepository {
  readGoalScope(refs: GoalScopeRefs): Promise<GoalScopeReadResult>;
  lookupCommit(input: GoalLookupInput): Promise<GoalLookupResult>;
  commit(input: GoalCommitInput): Promise<GoalCommitResult>;
  readCreatedGoal(receipt: CommittedStoreReceipt, expected: GoalCreateIdentity): Promise<OriginalGoalResult>;
}

/** Copies a committed receipt so no caller can mutate the store's own arrays. */
function copyReceipt(receipt: CommittedStoreReceipt): CommittedStoreReceipt {
  return {
    status: "committed",
    replayed: receipt.replayed,
    identityKey: receipt.identityKey,
    versions: receipt.versions.map((version) => ({ refKey: version.refKey, revision: version.revision })),
    eventIds: [...receipt.eventIds],
    cursor: receipt.cursor,
  };
}

function actorsAgree(a: ActorRef, b: ActorRef): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;
  if (a.kind === "agent" && b.kind === "agent") {
    return (
      a.runRef.projectId === b.runRef.projectId &&
      a.runRef.goalId === b.runRef.goalId &&
      a.runRef.runId === b.runRef.runId
    );
  }
  return true;
}

export function createGoalGraphRepository(records: GoalRecordTransactionPort): GoalGraphRepository {
  /**
   * Decodes one requested key out of a single `readMany` batch. A key reported
   * missing is only "missing"; a key that is neither present nor reported
   * missing, or whose JSON/schema is damaged, is `corrupt` — never "the scope
   * does not exist".
   */
  function readOne<T>(
    key: string,
    present: Map<string, EncodedRecord>,
    missing: ReadonlySet<string>,
    decode: (record: EncodedRecord) => DecodeResult<T>,
  ): { status: "found"; value: T } | { status: "missing" } | { status: "corrupt"; reason: string } {
    if (present.has(key)) {
      const record = present.get(key)!;
      const decoded = decode(record);
      if (decoded.status !== "decoded") {
        return { status: "corrupt", reason: `record ${key} is not decodable: ${decoded.reason}` };
      }
      return { status: "found", value: decoded.value };
    }
    if (missing.has(key)) return { status: "missing" };
    return {
      status: "corrupt",
      reason: `read batch neither returned nor reported missing the record ${key}`,
    };
  }

  async function readGoalScope(refs: GoalScopeRefs): Promise<GoalScopeReadResult> {
    const projectKey = canonicalRefKey(refs.projectRef);
    const workspaceKey = canonicalRefKey(refs.workspaceRef);
    const goalKey = canonicalRefKey(refs.goalRef);
    const read = await records.readMany([projectKey, workspaceKey, goalKey]);
    if (read.status !== "ready") {
      if (read.code === "not_found") return { status: "not_found", reason: read.reason };
      if (read.code === "unavailable") return { status: "unavailable", reason: read.reason };
      return { status: "corrupt", reason: `${read.code}: ${read.reason}` };
    }
    const present = new Map<string, EncodedRecord>();
    for (const record of read.value.records) present.set(record.refKey, record);
    const missing = new Set(read.value.missing);

    const project = readOne(projectKey, present, missing, decodeProjectSnapshot);
    if (project.status === "corrupt") return { status: "corrupt", reason: project.reason };
    if (project.status === "missing") {
      return { status: "not_found", reason: `project ${refs.projectRef.projectId} does not exist` };
    }
    const workspace = readOne(workspaceKey, present, missing, decodeWorkspaceSnapshot);
    if (workspace.status === "corrupt") return { status: "corrupt", reason: workspace.reason };
    if (workspace.status === "missing") {
      return {
        status: "not_found",
        reason: `workspace ${refs.workspaceRef.workspaceId} does not exist in project ${refs.workspaceRef.projectId}`,
      };
    }
    const goal = readOne(goalKey, present, missing, decodeGoalSnapshot);
    if (goal.status === "corrupt") return { status: "corrupt", reason: goal.reason };

    return {
      status: "ready",
      scope: {
        project: project.value,
        workspace: workspace.value,
        goal: goal.status === "found" ? goal.value : undefined,
        readThrough: read.value.readThrough,
      },
    };
  }

  /**
   * R3a §6. `receipt.cursor` locates exactly the one GoalCreated event; every
   * check below is a pure agreement check against the recorded fact.
   */
  async function readCreatedGoal(
    receipt: CommittedStoreReceipt,
    expected: GoalCreateIdentity,
  ): Promise<OriginalGoalResult> {
    const expectedKey = goalCreateIdentityKey(expected.identity);
    if (receipt.identityKey !== expectedKey) {
      return {
        status: "corrupt",
        reason: `receipt belongs to identity ${receipt.identityKey}, not the recovered command identity`,
      };
    }
    if (receipt.eventIds.length !== 1) {
      return {
        status: "corrupt",
        reason: `goal-create receipt must reference exactly one event, got ${receipt.eventIds.length}`,
      };
    }
    const located = await records.eventAt(receipt.cursor);
    if (located.status !== "ready") {
      if (located.code === "unavailable") return { status: "unavailable", reason: located.reason };
      return {
        status: "corrupt",
        reason: `the original GoalCreated event at ${String(receipt.cursor)} is not readable: ${located.code}: ${located.reason}`,
      };
    }
    if (String(located.value.cursor) !== String(receipt.cursor)) {
      return {
        status: "corrupt",
        reason: `eventAt returned cursor ${String(located.value.cursor)} for requested cursor ${String(receipt.cursor)}`,
      };
    }
    const decoded = decodeGoalCreatedEvent(located.value.event);
    if (decoded.status !== "decoded") {
      return {
        status: "corrupt",
        reason: `the original event at ${String(receipt.cursor)} is not a legal GoalCreated@1: ${decoded.reason}`,
      };
    }
    const event = decoded.value;
    if (event.eventId !== receipt.eventIds[0]) {
      return {
        status: "corrupt",
        reason: `receipt points at ${String(receipt.eventIds[0])} but the event at its cursor is ${event.eventId}`,
      };
    }
    if (
      event.projectId !== expected.identity.projectId ||
      event.aggregateId !== expected.goalId ||
      event.workspaceId !== expected.workspaceId
    ) {
      return {
        status: "corrupt",
        reason: "the original GoalCreated event does not belong to the recovered goal scope",
      };
    }
    if (event.idempotencyKey !== expected.identity.idempotencyKey) {
      return {
        status: "corrupt",
        reason: "the original GoalCreated event carries another idempotency key",
      };
    }
    if (!actorsAgree(event.actor, expected.identity.actor)) {
      return { status: "corrupt", reason: "the original GoalCreated event carries another actor" };
    }
    const goalKey = canonicalRefKey({
      aggregateType: "Goal",
      projectId: expected.identity.projectId,
      goalId: expected.goalId,
    });
    const version = receipt.versions.find((entry) => entry.refKey === goalKey);
    if (version === undefined || version.revision !== 1) {
      return {
        status: "corrupt",
        reason: "the original receipt does not record the created Goal at revision 1",
      };
    }
    // Rebuilt from the EVENT only: never the retry payload, the current
    // snapshot or the current clock.
    return { status: "restored", snapshot: goalSnapshotFromCreatedEvent(event) };
  }

  async function lookupCommit(input: GoalLookupInput): Promise<GoalLookupResult> {
    const found = await records.lookupCommit({
      identityKey: input.identityKey,
      fingerprint: input.fingerprint,
    });
    if (found.status !== "ready") {
      switch (found.code) {
        case "not_found":
          return { status: "missing" };
        case "idempotency_conflict":
          return { status: "idempotency_conflict", reason: found.reason };
        case "invalid":
          return { status: "invalid", reason: found.reason };
        case "corrupt":
        case "unsupported":
          return { status: "corrupt", reason: `${found.code}: ${found.reason}` };
        default:
          return { status: "unavailable", reason: found.reason };
      }
    }
    const receipt = copyReceipt(found.value);
    if (receipt.identityKey !== input.identityKey) {
      return {
        status: "corrupt",
        reason: "idempotency lookup returned a receipt for another identity",
      };
    }
    const restored = await readCreatedGoal(receipt, input.expected);
    if (restored.status !== "restored") return restored;
    return {
      status: "found",
      // A lookup result is always a replay of the recorded outcome.
      receipt: { ...receipt, replayed: true },
      snapshot: restored.snapshot,
    };
  }

  async function commit(input: GoalCommitInput): Promise<GoalCommitResult> {
    const raw = await records.commit(input.prepared);
    if (raw.status === "committed") {
      const receipt = copyReceipt(raw);
      if (!receipt.replayed) {
        // A brand-new commit returns the freshly folded value directly; the
        // original-event read is reserved for replays only.
        return { status: "committed", receipt, snapshot: input.folded };
      }
      // A racing request won between the early lookup and this commit: only the
      // ORIGINAL event may be reported, never this call's folded value.
      const restored = await readCreatedGoal(receipt, input.expected);
      if (restored.status !== "restored") return restored;
      return { status: "committed", receipt, snapshot: restored.snapshot };
    }
    const receipt = raw;
    switch (receipt.code) {
      case "revision_conflict":
        return { status: "revision_conflict", reason: receipt.reason, current: receipt.current };
      case "idempotency_conflict":
        return { status: "idempotency_conflict", reason: receipt.reason };
      case "invalid":
        return { status: "invalid", reason: receipt.reason };
      case "corrupt":
      case "unsupported":
        return { status: "corrupt", reason: `${receipt.code}: ${receipt.reason}` };
      default:
        return { status: "unavailable", reason: `${receipt.code}: ${receipt.reason}` };
    }
  }

  return { readGoalScope, lookupCommit, commit, readCreatedGoal };
}
