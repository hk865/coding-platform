/**
 * M1 material grant contracts — the WorkGraph write seam for cross-principal
 * exact-material read authorization.
 *
 * SCOPE OF THIS BATCH (Host-only, current-only, same project/workspace/goal):
 *   - only a trusted human/system Host principal may call either operation;
 *     a work_run or query_run principal is forbidden at the write entry;
 *   - the reader is a Run inside the same goal/workspace as the material owner;
 *   - the grant is bound to the reader's accepted, currently active Plan and to
 *     the real Workspace revision plus a freshly captured source pin;
 *   - owner-Agent grants, QueryRun readers and cross-workspace/historical
 *     sharing remain product work but are explicitly NOT implemented here.
 *
 * This file declares only types and the exact request shape. It must not
 * redeclare CoreCallContext/GraphWrite/GoalRef/RunRef/ArtifactRef/
 * MaterialSourceSetV1/MaterialAccessGrantRef/MaterialAccessGrantSnapshot/
 * WriteResult — those are the existing shared contracts.
 *
 * The service that consumes this port lives in `grant-service.ts`. The
 * production encoder/event validators live in `grant-record-codecs.ts`, which
 * reuses the existing MaterialAccessGrantSnapshot@1 reader validator instead of
 * registering a second copy.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WriteResult } from '../../../contracts/core/results.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type {
  MaterialAccessGrantRef,
  MaterialAccessGrantSnapshot,
  MaterialSourceSetV1,
  SourceApplicabilityPort,
} from '../../../contracts/material-access.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { GraphWrite } from '../tasks/contracts.js';
import type { MaterialAuthorityReads } from './record-ports.js';
import type { MaterialPort } from './contracts.js';

/** A grant authorizes a bounded, auditable set of exact content-addressed materials. */
export const MATERIAL_GRANT_MAX_MATERIALS = 64;
/** Purpose/reason are audit notes, never authority. Bound matches the legacy purpose limit. */
export const MATERIAL_GRANT_PURPOSE_MAX_BYTES = 1024;
export const MATERIAL_GRANT_REASON_MAX_BYTES = 1024;

/**
 * The only source-selection shape this batch accepts. `verification_workspace`
 * is a different producer capability and must not be smuggled through the
 * ordinary workspace source provider.
 */
export type MaterialGrantWorkspaceSourceSet = Extract<MaterialSourceSetV1, { kind: 'workspace_paths' }>;

/**
 * Host-only grant request. The service (never the caller) derives grantId,
 * issuedBy, basis, sourcePin, grantedAt and the CAS@0 revision: a caller that
 * supplies any of those fields must be rejected, not silently ignored.
 */
export type GrantMaterialAccessInput = {
  /** Full GoalRef of the shared decision; the grant scope goal comes from here. */
  goalRef: GoalRef;
  /** The ONE Run reader this grant authorizes. It may be a formal starting Run. */
  reader: RunRef;
  /** 1..64 complete ArtifactRefs, already de-duplicated by material identity. */
  materials: ArtifactRef[];
  /** Ordered, unique workspace-relative paths; the exact set the pin covers. */
  sourceSet: MaterialGrantWorkspaceSourceSet;
  /** Audit note only. Non-empty and at most 1024 UTF-8 bytes. */
  purpose: string;
};

/**
 * Host-only revocation request. It must not require the source/Plan/basis to
 * still be current: an expired grant must remain revocable.
 */
export type RevokeMaterialAccessInput = {
  grantRef: MaterialAccessGrantRef;
  /** Audit note only. Non-empty and at most 1024 UTF-8 bytes. */
  reason: string;
};

/**
 * The target WorkGraph write port. Every method snapshots its inputs before
 * the first await, keeps the original AbortSignal, and commits through the one
 * injected RecordStore transaction.
 */
export interface MaterialGrantPort {
  grantMaterialAccess(
    ctx: CoreCallContext,
    request: GraphWrite<GrantMaterialAccessInput>,
  ): Promise<WriteResult<MaterialAccessGrantSnapshot>>;
  revokeMaterialAccess(
    ctx: CoreCallContext,
    request: GraphWrite<RevokeMaterialAccessInput>,
  ): Promise<WriteResult<MaterialAccessGrantSnapshot>>;
}

/**
 * Injected capabilities. The provider is the SAME real SourceApplicabilityPort
 * instance the read-side resolver uses, so a grant can never be verified
 * against a different source provider than the one that authorizes reads.
 */
export type MaterialGrantDependencies = {
  records: GoalRecordTransactionPort;
  authority: MaterialAuthorityReads;
  materials: MaterialPort;
  source: SourceApplicabilityPort;
  now(): string;
  eventId(): string;
};
