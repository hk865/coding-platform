/**
 * WorkGraph legacy Goal commit adapter — the `StateLedger.commit(goal-create)`
 * compatibility entry.
 *
 * The batch arrives already compiled, so this adapter performs the legacy batch
 * contract checks and encoding only; it invents no second set of business
 * decisions and never recomputes the raw batch fingerprint:
 *
 *   1. the ORIGINAL structural validator (moved to the compiler, semantics
 *      preserved) runs first;
 *   2. then the idempotency lookup on the caller's own fingerprint — a hit
 *      returns the ORIGINAL receipt even when a retry changed its eventId, time
 *      or body, and a different fingerprint stays `idempotency_conflict`;
 *   3. only a NEW identity is checked against the approved strict raw-input
 *      rule and compiled into the same `PreparedCommit` shape the Goal kernel
 *      produces;
 *   4. the store receipt is mapped back to the original `LedgerCommitReceipt`
 *      shape (`identity`, `aggregateRevisions`, `eventIds`, `commitCursor`,
 *      `replayed`), with `revision: null` reported as the legacy revision 0.
 */
import type { AggregateRef, GoalCreateLedgerCommitV1, LedgerCommitReceipt, VersionedRef } from "../../../contracts/ledger.js";
import type { GoalRecordTransactionPort, StoreCommitReceipt } from "../../record-store/ports.js";
import type { LegacyGoalCommitAdapterDependencies, LegacyGoalCommitPort } from "../tasks/contracts.js";
import { compileLegacyGoalCreate, goalCreateIdentityKey, validateGoalCreateCommit } from "./commit-compiler.js";

function toVersionedRefs(
  entries: readonly { refKey: string; revision: number }[],
): VersionedRef[] | null {
  const refs: VersionedRef[] = [];
  for (const entry of entries) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(entry.refKey);
    } catch {
      return null;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const ref = parsed as AggregateRef;
    if (typeof (ref as { aggregateType?: unknown }).aggregateType !== "string") return null;
    refs.push({ ref, revision: entry.revision });
  }
  return refs;
}

function mapCommittedReceipt(
  receipt: Extract<StoreCommitReceipt, { status: "committed" }>,
  batch: GoalCreateLedgerCommitV1,
  replayed: boolean,
): LedgerCommitReceipt {
  const aggregateRevisions = toVersionedRefs(receipt.versions);
  if (aggregateRevisions === null) {
    // A receipt whose own ref keys cannot be read is unusable; it is reported
    // as unavailable rather than as a fabricated success.
    return { status: "rejected", code: "unavailable" };
  }
  return {
    status: "committed",
    replayed,
    identity: batch.identity,
    aggregateRevisions,
    eventIds: [...receipt.eventIds],
    commitCursor: receipt.cursor,
  };
}

function mapStoreReceipt(
  receipt: StoreCommitReceipt,
  batch: GoalCreateLedgerCommitV1,
): LedgerCommitReceipt {
  if (receipt.status === "committed") {
    return mapCommittedReceipt(receipt, batch, receipt.replayed);
  }
  switch (receipt.code) {
    case "revision_conflict": {
      // The versions observed INSIDE the failed transaction are preserved;
      // `null` (the row genuinely did not exist) maps to the legacy revision 0.
      const currentVersions = toVersionedRefs(
        receipt.current.map((entry) => ({ refKey: entry.refKey, revision: entry.revision ?? 0 })),
      );
      return {
        status: "rejected",
        code: "revision_conflict",
        ...(currentVersions === null ? {} : { currentVersions }),
      };
    }
    case "idempotency_conflict":
      return { status: "rejected", code: "idempotency_conflict" };
    case "invalid":
      return { status: "rejected", code: "invalid_commit" };
    case "not_found":
    case "corrupt":
    case "unsupported":
    case "unavailable":
    default:
      return { status: "rejected", code: "unavailable" };
  }
}

/**
 * The batch must be owned BEFORE the first await: a caller that mutates the
 * object it passed to `ledger.commit(batch)` must not be able to change what is
 * validated, compiled or reported. A plain legacy batch is JSON, so the clone
 * always succeeds; the fallback only preserves the original behaviour for a
 * value the structured-clone algorithm refuses.
 */
function ownBatch(batch: GoalCreateLedgerCommitV1): GoalCreateLedgerCommitV1 {
  try {
    return structuredClone(batch);
  } catch {
    return batch;
  }
}

async function commitLegacyGoalCreate(
  records: GoalRecordTransactionPort,
  batch: GoalCreateLedgerCommitV1,
): Promise<LedgerCommitReceipt> {
  const owned = ownBatch(batch);

  // (1) the original raw envelope rule, unchanged.
  if (!validateGoalCreateCommit(owned)) {
    return { status: "rejected", code: "invalid_commit" };
  }

  const identityKey = goalCreateIdentityKey(owned.identity);

  // (2) idempotency decides replay versus conflict on identity + the STORED
  // fingerprint. `corrupt`/`unavailable` are never treated as not_found.
  const lookup = await records.lookupCommit({
    identityKey,
    fingerprint: String(owned.fingerprint),
  });
  if (lookup.status === "ready") {
    // Same identity + same fingerprint always replays the ORIGINAL outcome,
    // even when this retry minted a new eventId/causationId/occurredAt.
    return mapCommittedReceipt(lookup.value, owned, true);
  }
  if (lookup.status === "rejected") {
    if (lookup.code === "idempotency_conflict") {
      return { status: "rejected", code: "idempotency_conflict" };
    }
    if (lookup.code !== "not_found") {
      return { status: "rejected", code: "unavailable" };
    }
  }

  // (3) NEW identity: the approved strict raw-input check (exactly the
  // Project/Workspace/Goal expected versions with Goal=0, consistent fold,
  // fully agreeing body/identity/version) and compilation.
  const compiled = compileLegacyGoalCreate(owned);
  if (compiled.status !== "compiled") {
    return { status: "rejected", code: "invalid_commit" };
  }

  // (4) the ONE generic store transaction performs the final re-lookup, CAS,
  // event/snapshot/idempotency writes and COMMIT.
  const receipt = await records.commit(compiled.prepared);
  return mapStoreReceipt(receipt, owned);
}

export function createLegacyGoalCommitAdapter(
  deps: LegacyGoalCommitAdapterDependencies,
): LegacyGoalCommitPort {
  const records = deps.records;
  return { commit: (batch) => commitLegacyGoalCreate(records, batch) };
}
