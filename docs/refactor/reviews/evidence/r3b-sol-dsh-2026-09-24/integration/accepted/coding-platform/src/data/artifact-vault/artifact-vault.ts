/**
 * ArtifactVault — legacy ArtifactPort surface over the shared WorkGraph material
 * service and the RecordStore raw-body store.
 *
 * The physical body rules (content addressing, size cap, putIfAbsent,
 * integrity/open decoding), the material access rules (exact grant / basis /
 * provenance) and the Core material port all have exactly one owner:
 *   - `core/record-store/body-store.ts` + `body-codec.ts`;
 *   - `core/work-graph/materials/{material-service,applicability}.ts`.
 *
 * This class keeps the constructor seam and the old `ArtifactPort.put/open`
 * wire for existing callers, and publishes the read-only `materials` port for
 * the trusted Host. `put`/`open` delegate to `createLegacyArtifactPort`; they
 * never re-implement authorization or body validation.
 *
 * The `byKey` seam is read/written live on every call (never copied at
 * construction): the default in-memory Map, and any caller-supplied shared Map,
 * stays observable. Rows are converted through the `ArtifactBodyRows` seam so
 * the memory Map and SQLite differ only in how a row survives. A new row may
 * carry the canonical `origin`; an old row is decoded from `ownerRunRef`.
 */
import type {
  ArtifactOpenQuery,
  ArtifactOpenResult,
  ArtifactOwnerRunRef,
  ArtifactPort,
  ArtifactPutRecord,
  ArtifactPutResult,
  ArtifactRef,
} from "../../contracts/artifact.js";
import type { SourceRefV1 } from "../../contracts/dispatch.js";
import type { MaterialAccessResolver } from "../../contracts/material-access.js";
import type { MaterialPort } from "../../core/work-graph/materials/contracts.js";
import { createLegacyArtifactPort, createMaterialService } from "../../core/work-graph/materials/material-service.js";
import type { MaterialAuthorityReads } from "../../core/work-graph/materials/applicability.js";
import type { MaterialOrigin, RawArtifactStorePort } from "../../core/record-store/body-ports.js";
import { RawArtifactBodyStore, type ArtifactBodyRows } from "../../core/record-store/body-store.js";

export type StoredRecord = {
  ref: ArtifactRef;
  body: string;
  sourceRefs: SourceRefV1[];
  /** The run allowed to open this artifact (null for a TaskAttempt owner). */
  ownerRunRef: ArtifactOwnerRunRef | null;
  /** Canonical provenance for rows written after R3b; old rows decode it from ownerRunRef. */
  origin?: MaterialOrigin;
};

/** The legacy caller-owned storage seam. `putIfAbsent` is used when present so
 * the first writer wins without a read-before-write round trip. */
export type ArtifactVaultStore = {
  get(key: string): StoredRecord | undefined;
  set(key: string, value: StoredRecord): unknown;
  putIfAbsent?(key: string, value: StoredRecord): { record: StoredRecord; inserted: boolean };
};

/** Storage seam + the optional material access grant resolver (host-injected). */
export type ArtifactVaultOptions = {
  /**
   * Returns the grants RECORDED for this reader that include the requested
   * material. The WorkGraph rules still apply; a resolver answer is a
   * candidate, never a decision. Without a resolver the vault is owner-only.
   */
  grants?: MaterialAccessResolver;
  /** Canonical authority reads for the Host material port. Absent -> no Host scope. */
  authority?: MaterialAuthorityReads;
  /** Clock for the Host write entry. */
  now?: () => string;
};

const NO_GRANTS: MaterialAccessResolver = { grantsFor: async () => [] };
const NO_AUTHORITY: MaterialAuthorityReads = { load: async ref => ({ status: "not_found", ref }) };

export class ArtifactVault implements ArtifactPort {
  /** Read-only Core material port; the raw body store is never published. */
  readonly materials: MaterialPort;
  private readonly legacy: ArtifactPort;

  constructor(
    byKey: ArtifactVaultStore = new Map<string, StoredRecord>(),
    options: ArtifactVaultOptions = {},
    rawStore?: RawArtifactStorePort,
  ) {
    const deps = {
      bodies: rawStore ?? new RawArtifactBodyStore(rowsFromStore(byKey)),
      authority: options.authority ?? NO_AUTHORITY,
      grants: options.grants ?? NO_GRANTS,
      now: options.now ?? (() => new Date().toISOString()),
    };
    // One dependency set: the legacy wire and the Host port share the private
    // body/authorization primitives; neither keeps a second copy of the rules.
    this.materials = createMaterialService(deps);
    this.legacy = createLegacyArtifactPort(deps);
  }

  put(record: ArtifactPutRecord): Promise<ArtifactPutResult> {
    return this.legacy.put(record);
  }

  open(ref: ArtifactRef, query: ArtifactOpenQuery): Promise<ArtifactOpenResult> {
    return this.legacy.open(ref, query);
  }
}

/** Live JSON <-> StoredRecord bridge over a caller-owned store; no snapshot copy. */
function rowsFromStore(byKey: ArtifactVaultStore): ArtifactBodyRows {
  return {
    get(key) {
      const record = byKey.get(key);
      return record === undefined ? undefined : JSON.stringify(record);
    },
    putIfAbsent(key, json) {
      const candidate = JSON.parse(json) as StoredRecord;
      if (byKey.putIfAbsent) {
        const winner = byKey.putIfAbsent(key, candidate);
        return { json: JSON.stringify(winner.record), inserted: winner.inserted };
      }
      // The necessary get/set adaptation of an in-memory Map: first writer wins.
      const existing = byKey.get(key);
      if (existing !== undefined) return { json: JSON.stringify(existing), inserted: false };
      byKey.set(key, candidate);
      return { json, inserted: true };
    },
  };
}

export function createArtifactVault(options: ArtifactVaultOptions = {}): ArtifactVault {
  return new ArtifactVault(new Map<string, StoredRecord>(), options);
}
