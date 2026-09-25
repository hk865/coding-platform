/**
 * A1 formal architecture catalog contracts.
 *
 * The catalog is the formal, adopted module/dependency structure. It shares one
 * `baselineId`/`revision` with an immutable `ArchitectureBaselineRevision` but is
 * a different `aggregateType`, committed in the SAME RecordStore transaction.
 * There is no separate "current catalog" pointer: the only current pointer is the
 * existing `ProjectArchitectureBaselineActive` aggregate (registered through
 * `PLAN_GOVERNANCE_RECORD_SCHEMAS`).
 *
 * This file defines the public shapes. `catalog-service.ts` implements initial
 * adoption and reads; architecture evolution, decision and migration-gate
 * behavior remain outside this initial-adoption port.
 */
import type { ArchitectureSourceSnapshotV1 } from '../../../contracts/architecture-source.js';
import type { ArchitectureBaselineRevisionRef } from '../../../contracts/governance.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ModuleRef } from '../../../contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { RecordGuard } from '../../record-store/ports.js';
import type { GraphWrite } from './contracts.js';

/**
 * Baseline body carried by an adopted revision. It mirrors the frozen
 * governance fixture exactly: the catalog must NOT add fields to this object or
 * the canonical content digest computed by the existing Plan governance reader
 * would change meaning.
 */
export type ArchitectureBaselineContentV1 = {
  schemaVersion: 1;
  description: string;
  constraints: { name: string; scope: string }[];
  /** Additive; old baselines remain readable but cannot prove a source diff. */
  sourceBinding?: ArchitectureSourceSnapshotV1;
  dependencyRules?: { ruleId: string; kind: 'forbid_dependency'; fromModule: string; toModule: string }[];
};

/** Immutable baseline revision, byte-compatible with the schema the existing
 * `plan-readers.ts` validator already accepts (`ArchitectureBaselineRevisionSnapshot@1`). */
export type ArchitectureBaselineRevisionSnapshot = {
  ref: ArchitectureBaselineRevisionRef;
  revision: 1;
  schemaVersion: 1;
  baselineId: string;
  contentRevision: number;
  contentDigest: string;
  content: ArchitectureBaselineContentV1;
};

/** One formal module with its responsibility, path mapping and interfaces. */
export type ModuleDefinition = {
  ref: ModuleRef;
  name: string;
  responsibility: string;
  paths: string[];
  interfaces: { id: string; description: string; paths: string[] }[];
};

/** The adopted module graph. `requireDag` is part of the adopted structure; a
 * caller cannot pass `false` to bypass the formal module DAG. */
export type AdoptedArchitecture = {
  modules: ModuleDefinition[];
  dependencies: { from: ModuleRef; to: ModuleRef; reason: string }[];
  requireDag: boolean;
};

/** Same local identity as the baseline revision, different aggregate type. */
export type ArchitectureCatalogRef = Omit<ArchitectureBaselineRevisionRef, 'aggregateType'> & {
  aggregateType: 'ArchitectureCatalog';
};

/** Immutable catalog row committed with its baseline and active pointer. */
export type ArchitectureCatalogRecord = {
  ref: ArchitectureCatalogRef;
  revision: 1;
  baselineRef: ArchitectureBaselineRevisionRef;
  schemaVersion: 1;
  catalog: AdoptedArchitecture;
};

export type ArchitectureRevision = {
  baseline: ArchitectureBaselineRevisionSnapshot;
  /** `null` means the baseline predates the catalog. It is never guessed as an
   * empty catalog. */
  catalog: ArchitectureCatalogRecord | null;
};

export type AdoptInitialArchitectureInput = {
  baselineId: string;
  catalog: AdoptedArchitecture;
  description: string;
  constraints: ArchitectureBaselineContentV1['constraints'];
};

export type ReadArchitectureRevisionInput =
  | { selection: { kind: 'current' } }
  | { selection: { kind: 'revision'; ref: ArchitectureBaselineRevisionRef } };

/**
 * The thin Host acceptance entry for adopting the FIRST formal architecture.
 * There is deliberately no evolution/decision/gate method in this batch: a
 * project that already has an active baseline must be rejected rather than
 * silently replaced. This is the existing target `propose/apply` initial
 * acceptance, not a new proposal protocol.
 */
export interface ArchitectureCatalogPort {
  adoptInitialArchitecture(
    ctx: CoreCallContext,
    request: GraphWrite<AdoptInitialArchitectureInput>,
  ): Promise<WriteResult<ArchitectureRevision>>;
  readArchitectureRevision(
    ctx: CoreCallContext,
    input: ReadArchitectureRevisionInput,
  ): Promise<ReadResult<ArchitectureRevision>>;
}

/**
 * Internal read-only seam for the Session writer. It resolves one `ModuleRef`
 * against the CURRENT formal catalog and returns the exact record guards that
 * the caller must join into its own CAS. It is a narrow function, not a second
 * provider framework.
 */
export type CatalogModuleFacts = {
  module: ModuleDefinition;
  guards: readonly RecordGuard[];
};
