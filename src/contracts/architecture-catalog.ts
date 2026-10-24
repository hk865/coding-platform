/**
 * R6 cold-start architecture catalog contracts (Stage 1 lift).
 *
 * The four pure DTOs below are lifted verbatim from the existing WorkGraph
 * `core/work-graph/architecture/catalog-contracts.ts` so the initial-planning
 * contract can reference `AdoptInitialArchitectureInput` without a
 * Contracts -> WorkGraph dependency. There is exactly ONE definition: the
 * original module imports and re-exports these names and keeps its service
 * port/record shapes unchanged.
 *
 * Only the pure structural shapes live here. The catalog port, record row and
 * baseline body stay with the existing WorkGraph owner because they depend on
 * WorkGraph call/write/guard types.
 */
import type { ArchitectureSourceMapping } from './architecture-source.js';
import type { ModuleRef } from './core/identity.js';
import type { ArchitectureBaselinePin, ArchitectureBaselineRevisionRef } from './governance.js';

/** One formal module with its responsibility, path mapping and interfaces. */
export type ModuleDefinition = {
  ref: ModuleRef;
  name: string;
  responsibility: string;
  paths: string[];
  interfaces: { id: string; description: string; paths: string[] }[];
};

/**
 * Explicit formal containment declared by the adopter. Absence of the field on
 * an `AdoptedArchitecture` means that revision declared no containment at all;
 * an explicit `{parentOf: []}` means every module is flat. Containment is NOT
 * inferred from `paths` or `dependencies`.
 */
export type ModuleContainment = {
  parentOf: { parent: ModuleRef; child: ModuleRef }[];
};

/** The adopted module graph. `requireDag` is part of the adopted structure; a
 * caller cannot pass `false` to bypass the formal module DAG. `containment` is
 * additive and optional exactly as described above. */
export type AdoptedArchitecture = {
  modules: ModuleDefinition[];
  dependencies: { from: ModuleRef; to: ModuleRef; reason: string }[];
  requireDag: boolean;
  containment?: ModuleContainment;
};

export type AdoptInitialArchitectureInput = {
  baselineId: string;
  catalog: AdoptedArchitecture;
  description: string;
  /**
   * Exact structural shape of `ArchitectureBaselineContentV1['constraints']`,
   * kept literal here so the Contracts layer never imports the WorkGraph
   * baseline body. It is the same `{ name, scope }[]` array type.
   */
  constraints: { name: string; scope: string }[];
};

/**
 * Slice 8A (decision 72 post-note, spec §2/L7): the pure catalog identity.
 * Lifted here as the ONE definition because the formal-vs-observed comparison
 * and the repair pins both live in Contracts; the WorkGraph
 * `catalog-contracts.ts` module imports and re-exports it.
 */
export type ArchitectureCatalogRef = Omit<ArchitectureBaselineRevisionRef, 'aggregateType'> & {
  aggregateType: 'ArchitectureCatalog';
};

/** Complete immutable catalog identity: catalog ref plus baseline pin. */
export type ArchitectureCatalogPinV1 = {
  catalogRef: ArchitectureCatalogRef;
  baseline: ArchitectureBaselinePin;
};

/**
 * L8 (book ruling 6): the ONE module-mapping rule shared by the settings page's
 * manual capture and the automatic capture driver. An adopted catalog maps each
 * formal module to its declared paths; interfaces are not source owners here.
 */
export function moduleMappingsOf(catalog: AdoptedArchitecture): ArchitectureSourceMapping[] {
  return catalog.modules.map(module => ({
    id: module.ref.moduleId,
    kind: 'module' as const,
    paths: module.paths,
  }));
}

import { defineShape, f, type ShapeRule } from './data-format.js';
import { id } from './data-format-refs.js';

/** `ArchitectureBaselineRevisionRef` (`governance.ts:11`). */
export const architectureBaselineRevisionRefShape = defineShape({ name: 'ArchitectureBaselineRevisionRef', fields: {
  aggregateType: f.literal('ArchitectureBaselineRevision'), projectId: id, baselineId: id,
  revision: f.integer({ min: 1 }) } });

/** `ArchitectureCatalogRef` (:66). */
export const architectureCatalogRefShape = defineShape({ name: 'ArchitectureCatalogRef', fields: {
  aggregateType: f.literal('ArchitectureCatalog'), projectId: id, baselineId: id,
  revision: f.integer({ min: 1 }) } });

const CATALOG_BESIDE_BASELINE =
  'ArchitectureCatalogPinV1.catalogRef must name the project, baseline and revision of baseline.ref';
/** The catalog row is keyed by its baseline revision (`catalog-service.ts:126`); runs after the fields hold. */
const catalogBesideBaseline: ShapeRule = (value) => {
  const { catalogRef, baseline: { ref } } = value as ArchitectureCatalogPinV1;
  return catalogRef.projectId === ref.projectId && catalogRef.baselineId === ref.baselineId
    && catalogRef.revision === ref.revision ? null : CATALOG_BESIDE_BASELINE;
};

/** `ArchitectureCatalogPinV1` (:71) as an R1 fragment, checked inside the old PlanProposal codec (8B §3.2). */
export const architectureCatalogPinShape = defineShape({ name: 'ArchitectureCatalogPinV1', fields: {
  catalogRef: f.ref(architectureCatalogRefShape),
  baseline: f.object({ ref: f.ref(architectureBaselineRevisionRefShape), digest: f.sha256() }),
}, rules: [catalogBesideBaseline] });
