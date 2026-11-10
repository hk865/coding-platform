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
import { canonicalJson } from './fingerprint.js';
import type { ArchitectureBaselinePin, ArchitectureBaselineRevisionRef } from './governance.js';
import { pathOwnershipOf } from './path-ownership.js';

/** One formal module with its responsibility, path mapping and interfaces. */
export type ModuleDefinition = {
  ref: ModuleRef;
  name: string;
  responsibility: string;
  paths: string[];
  interfaces: { id: string; description: string; paths: string[] }[];
};

/** The existing module interface shape, named for the repair op contract. */
export type CatalogInterfaceV1 = ModuleDefinition['interfaces'][number];

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

/** The module half of `mappingsOf`: each formal module to its declared paths. */
export function moduleMappingsOf(catalog: AdoptedArchitecture): ArchitectureSourceMapping[] {
  return catalog.modules.map(module => ({
    id: module.ref.moduleId,
    kind: 'module' as const,
    paths: module.paths,
  }));
}

/**
 * L8 (book ruling 6): the ONE mapping list shared by the settings page's manual
 * capture and the automatic capture driver. Each formal module maps to its
 * declared paths, and each of its interfaces to the interface's own paths under
 * the identity `canonicalJson([moduleId, interfaceId])`: an interface id is
 * unique only inside its module, so two modules may both declare `model`. An
 * interface that declares no path can own no file, so it is not listed.
 */
export function mappingsOf(catalog: AdoptedArchitecture): ArchitectureSourceMapping[] {
  return [
    ...moduleMappingsOf(catalog),
    ...catalog.modules.flatMap(module => module.interfaces
      .filter(entry => entry.paths.length > 0)
      .map(entry => ({ id: canonicalJson([module.ref.moduleId, entry.id]), kind: 'interface' as const, paths: entry.paths }))),
  ];
}

/** One file's layered ownership; `interfaceId` is the bare id inside its module. */
export type OwnershipV1 = { moduleId: string | null; interfaceId: string | null };

/**
 * The ONE layered ownership decision, shared by the capture writer, the
 * stored-body membership recheck, the file anchors and the change-scope read,
 * each over the full mapping list. A file belongs to
 * the module with the longest legal declared path (`pathOwnershipOf`; none or a
 * tie is no module), and then to the interface with the longest legal path among
 * THAT module's interfaces only (none or a tie is no interface). A file in an
 * interface still belongs to its module. An interface mapping is one only under
 * its exact identity `canonicalJson([moduleId, interfaceId])`.
 *
 * The mapping list is prepared once here; a caller that classifies many files
 * over one list keeps the returned function.
 */
export function ownershipRuleOf(mappings: readonly ArchitectureSourceMapping[]): (path: string) => OwnershipV1 {
  const modules = mappings.filter(mapping => mapping.kind === 'module')
    .map(mapping => ({ value: mapping.id, paths: mapping.paths }));
  const interfacesByModule = new Map<string, { value: string; paths: readonly string[] }[]>();
  for (const mapping of mappings) {
    if (mapping.kind !== 'interface') continue;
    const identity = interfaceIdentityOf(mapping.id);
    if (identity === null) continue;
    const interfaces = interfacesByModule.get(identity.moduleId);
    const candidate = { value: identity.interfaceId, paths: mapping.paths };
    if (interfaces === undefined) interfacesByModule.set(identity.moduleId, [candidate]);
    else interfaces.push(candidate);
  }
  return path => {
    const module = pathOwnershipOf(path, modules);
    if (module.status !== 'owner') return { moduleId: null, interfaceId: null };
    const owned = pathOwnershipOf(path, interfacesByModule.get(module.owner) ?? []);
    return { moduleId: module.owner, interfaceId: owned.status === 'owner' ? owned.owner : null };
  };
}

/**
 * The observed nodes one ownership result belongs to: its module's node
 * `module:<moduleId>` and, inside one of that module's interfaces, also
 * `interface:` + `canonicalJson([moduleId, interfaceId])`. A file with no module
 * belongs to no node. The capture writer and the stored-body recheck share it, so
 * node members and edge endpoints always use the same identities.
 */
export function ownerNodesOf(owner: OwnershipV1): string[] {
  if (owner.moduleId === null) return [];
  const module = 'module:' + owner.moduleId;
  return owner.interfaceId === null ? [module] : [module, 'interface:' + canonicalJson([owner.moduleId, owner.interfaceId])];
}

/** The two ids of an exact `canonicalJson([moduleId, interfaceId])`; any other text names no interface. */
function interfaceIdentityOf(identity: string): { moduleId: string; interfaceId: string } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(identity); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') return null;
  return canonicalJson(parsed as string[]) === identity ? { moduleId: parsed[0], interfaceId: parsed[1] } : null;
}

/**
 * A module is "未细分" when it is the catalog's one module and its only declared
 * path is the repository root (decision 61-2: the whole workspace is one root
 * module). One module has no children, so containment plays no part.
 */
export function isUndividedModule(catalog: AdoptedArchitecture, module: ModuleRef): boolean {
  const [only, ...others] = catalog.modules;
  return only !== undefined && others.length === 0
    && only.ref.projectId === module.projectId && only.ref.moduleId === module.moduleId
    && only.paths.length === 1 && only.paths[0] === '.';
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
