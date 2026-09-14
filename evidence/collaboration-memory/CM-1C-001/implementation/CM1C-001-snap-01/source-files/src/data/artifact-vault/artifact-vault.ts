/**
 * ArtifactVault — P1-03 ArtifactPort implementation (first consumer freeze).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN). Lane C fills the
 * implementation. Frozen semantics:
 *   - content-addressed immutable bodies (digest = SHA-256 of the UTF-8 body);
 *     identical content replays the SAME ref;
 *   - size cap ARTIFACT_MAX_SIZE_BYTES; missing/empty sourceRefs rejected;
 *   - open() authorizes the recorded owner run (accessScope) by DEFAULT;
 *   - body-first: the vault keeps the body even if Control registration
 *     afterwards fails (never fakes a cross-storage transaction); the
 *     reference only becomes queryable after the run start commit.
 *
 * P1-18 versioned extension (see contracts/material-access.ts): a host may
 * inject a MaterialAccessResolver, and then a non-owner reader is authorized
 * only by a RECORDED grant that names it, covers the exact material, matches
 * the reader's declared basis, and was issued by the material owner or Control.
 * A mismatched basis is refused as "stale" so inherited material never advances
 * a new version. With no resolver the P1-03 owner-only rule is unchanged.
 *
 * Storage defaults to an internal Map for isolated tests; persistent hosts
 * inject SQLite storage through SqliteArtifactVault. The vault does NOT
 * depend on ControlEngine and never judges business truth.
 */
import {
  ARTIFACT_MAX_SIZE_BYTES,
  artifactBodyDigest,
  artifactBodySize,
} from "../../contracts/artifact.js";
import type {
  ArtifactOpenQuery,
  ArtifactOwnerRunRef,
  ArtifactOpenResult,
  ArtifactPort,
  ArtifactPutRecord,
  ArtifactPutResult,
  ArtifactRecord,
  ArtifactRef,
} from "../../contracts/artifact.js";
import type { SourceRefV1 } from "../../contracts/dispatch.js";
import {
  materialBasisEquals,
  materialBasisIsUnconditional,
  materialPrincipalInScope,
  sameArtifactOwnerRunRef,
  sameArtifactRef,
  validMaterialSourcePin,
} from "../../contracts/material-access.js";
import type { MaterialAccessGrantV1, MaterialAccessResolver } from "../../contracts/material-access.js";

export type StoredRecord = {
  ref: ArtifactRef;
  body: string;
  sourceRefs: SourceRefV1[];
  /** The run allowed to open this artifact (null for a TaskAttempt owner). */
  ownerRunRef: ArtifactOwnerRunRef | null;
};

/** Storage seam + the optional P1-18 grant resolver (host-injected). */
export type ArtifactVaultOptions = {
  /**
   * Returns the grants RECORDED for this reader that include the requested
   * material. The vault still applies its own rules; a resolver answer is a
   * candidate, never a decision. Without a resolver the vault is owner-only.
   */
  grants?: MaterialAccessResolver;
};

export class ArtifactVault implements ArtifactPort {
  constructor(
    private readonly byKey: {
      get(key: string): StoredRecord | undefined;
      set(key: string, value: StoredRecord): unknown;
    } = new Map<string, StoredRecord>(),
    private readonly options: ArtifactVaultOptions = {},
  ) {}

  async put(record: ArtifactPutRecord): Promise<ArtifactPutResult> {
    if (record.sourceRefs.length === 0) {
      return { status: "rejected", code: "missing_source", issues: ["sourceRefs must not be empty"] };
    }
    if (record.ownerRef === null || record.ownerRef === undefined) {
      return { status: "rejected", code: "missing_source", issues: ["ownerRef is required"] };
    }
    if (typeof record.contentType !== "string" || record.contentType.length === 0) {
      return { status: "rejected", code: "invalid", issues: ["contentType must be a non-empty string"] };
    }
    if (typeof record.body !== "string") {
      return { status: "rejected", code: "invalid", issues: ["body must be a string"] };
    }

    const sizeBytes = artifactBodySize(record.body);
    if (sizeBytes > ARTIFACT_MAX_SIZE_BYTES) {
      return {
        status: "rejected",
        code: "size_exceeded",
        issues: [`body size ${sizeBytes} exceeds ${ARTIFACT_MAX_SIZE_BYTES}`],
      };
    }

    const digest = artifactBodyDigest(record.body);
    const key = this.keyFor(record.contentType, digest, sizeBytes);
    const existing = this.byKey.get(key);
    if (existing) {
      return { status: "stored", ref: existing.ref, replayed: true };
    }

    const firstSource = record.sourceRefs[0]!;
    const ref: ArtifactRef = {
      kind: "artifact",
      contentType: record.contentType,
      digest,
      sizeBytes,
      source: firstSource,
    };
    const ownerRunRef = record.ownerRef.aggregateType === "Run" || record.ownerRef.aggregateType === "QueryRun"
      ? { ...record.ownerRef } : null;
    this.byKey.set(key, { ref, body: record.body, sourceRefs: [...record.sourceRefs], ownerRunRef });
    return { status: "stored", ref, replayed: false };
  }

  async open(ref: ArtifactRef, query: ArtifactOpenQuery): Promise<ArtifactOpenResult> {
    if (typeof ref !== "object" || ref === null || typeof ref.digest !== "string" || ref.digest.length === 0) {
      return { status: "rejected", code: "invalid", issues: ["ref must be a valid ArtifactRef"] };
    }
    const key = this.keyFor(ref.contentType, ref.digest, ref.sizeBytes);
    const stored = this.byKey.get(key);
    if (!stored) {
      return { status: "unavailable", ref };
    }
    if (artifactBodyDigest(stored.body) !== ref.digest || artifactBodySize(stored.body) !== ref.sizeBytes) {
      return { status: "rejected", code: "invalid", issues: ["artifact body integrity mismatch"] };
    }
    const owner = stored.ownerRunRef;
    const requester = query.requesterRunRef;
    const sameOwner = sameArtifactOwnerRunRef(owner, requester);
    if (!sameOwner || query.usage === 'current') {
      const granted = await this.authorizeByGrant(ref, stored, query);
      if (granted !== null) return granted;
      return {
        status: "rejected",
        code: "forbidden",
        issues: ["requester is neither the recorded owner run nor authorized by a recorded grant"],
      };
    }
    const record: ArtifactRecord = { ref: stored.ref, body: stored.body, sourceRefs: stored.sourceRefs, ...(query.includeOwner ? { ownerRunRef: stored.ownerRunRef } : {}), ...(query.usage === 'historical_explanation' ? { applicability: 'historical_explanation' as const } : {}) };
    return { status: "ready", record };
  }

  /**
   * P1-18 non-owner read path. All four conditions must hold:
   *   1. a recorded grant includes this EXACT material and names this reader;
   *   2. the grant is either unconditional or bound to the requester's declared
   *      current basis — otherwise the material is `stale` (inherited material
   *      must be re-sourced, never silently reused under a new version);
   *   3. the grant was issued by the material's recorded owner or by Control;
   *   4. (implicitly) the body already passed the integrity check in open().
   * Returns null when no recorded grant exists at all (the caller maps that to
   * the unchanged P1-03 `forbidden`).
   */
  private async authorizeByGrant(
    ref: ArtifactRef,
    stored: StoredRecord,
    query: ArtifactOpenQuery,
  ): Promise<ArtifactOpenResult | null> {
    const resolver = this.options.grants;
    if (resolver === undefined) return null;
    const candidates = await resolver.grantsFor(ref, query.requesterRunRef);
    const forMaterial = candidates.filter(
      (grant) => sameArtifactOwnerRunRef(grant.reader, query.requesterRunRef) &&
        materialPrincipalInScope(grant.reader, grant.scope) &&
        grant.materials.some((m) => sameArtifactRef(m, ref)) && grantIssuerOwnsMaterial(grant, stored.ownerRunRef),
    );
    if (forMaterial.length === 0) return null;

    const current = query.currentBasis;
    const applicable: MaterialAccessGrantV1[] = [];
    for (const grant of forMaterial) {
      if (query.usage === 'current' && (grant.history || !validMaterialSourcePin(grant.basis.sourcePin) || !resolver.currentBasisValid)) continue;
      if (!grant.history && (grant.basis.sourceDigest !== null || grant.basis.sourcePin !== undefined) && (!validMaterialSourcePin(grant.basis.sourcePin) || !resolver.currentBasisValid)) continue;
      if (!(materialBasisIsUnconditional(grant.basis) || (current !== undefined && materialBasisEquals(grant.basis, current)))) continue;
      if (resolver.currentBasisValid && !await resolver.currentBasisValid(grant)) continue;
      applicable.push(grant);
    }
    if (applicable.length === 0) {
      return {
        status: "rejected",
        code: "stale",
        issues: [
          "a recorded grant covers this material but its current basis/source cannot be verified or it only authorizes history; re-source and authorize the exact current material",
        ],
      };
    }
    const authorized = applicable.some((grant) => grantIssuerOwnsMaterial(grant, stored.ownerRunRef));
    if (!authorized) {
      return {
        status: "rejected",
        code: "forbidden",
        issues: ["recorded grant was not issued by the material owner or by Control"],
      };
    }
    const historyOnly = applicable.every(grant => !!grant.history);
    const record: ArtifactRecord = { ref: stored.ref, body: stored.body, sourceRefs: stored.sourceRefs, ...(query.includeOwner ? { ownerRunRef: stored.ownerRunRef } : {}),
      ...(historyOnly || query.usage === 'historical_explanation' ? { applicability: 'historical_explanation' as const } : query.usage === 'current' ? { applicability: 'current' as const } : {}) };
    return { status: "ready", record };
  }

  private keyFor(contentType: string, digest: string, sizeBytes: number): string {
    return `${contentType}|${digest}|${sizeBytes}`;
  }
}

/** Only the recorded owner run or a Control principal may authorize sharing. */
function grantIssuerOwnsMaterial(grant: MaterialAccessGrantV1, ownerRunRef: ArtifactOwnerRunRef | null): boolean {
  if (grant.history) return grant.history.usage === 'historical_explanation' &&
    sameArtifactOwnerRunRef(grant.history.owner, ownerRunRef) && ownerRunRef?.projectId === grant.scope.projectId &&
    grant.issuedBy.aggregateType === 'Control' && grant.issuedBy.projectId === grant.scope.projectId && grant.issuedBy.goalId === grant.scope.goalId;
  if (ownerRunRef === null || !materialPrincipalInScope(ownerRunRef, grant.scope)) return false;
  if (grant.issuedBy.aggregateType === "Control") return grant.issuedBy.projectId === grant.scope.projectId && grant.issuedBy.goalId === grant.scope.goalId;
  return sameArtifactOwnerRunRef(ownerRunRef, grant.issuedBy);
}

export function createArtifactVault(options: ArtifactVaultOptions = {}): ArtifactVault {
  return new ArtifactVault(new Map<string, StoredRecord>(), options);
}
