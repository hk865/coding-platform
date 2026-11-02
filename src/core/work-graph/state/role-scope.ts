// pure; imports src/contracts + this file only
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ModuleRef, ProjectScope, SessionRef, SessionWorkLinkRef } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import { roleScopeClaimKey, roleScopeOfTarget, type RoleLineDutyV1, type RoleScopeClaimChangeV1 } from '../../../contracts/role-lines.js';
export type RegionClaimV1 = { session: SessionRef; duty: RoleLineDutyV1; moduleRef: ModuleRef };
export type EffectiveScopeV1 = { kind: 'project' } | { kind: 'goal'; goalRef: GoalRef }
  | { kind: 'region'; moduleRef: ModuleRef; modules: ModuleRef[] };
// `EffectiveScopeReaderDependencies` is G4's, in `W/views/role-scope-reader.ts`: it names W/model,
// W/sessions, W/architecture and W/persistence ports, which `state/` may not import.
export type EffectiveScopeReadPort = {
  readEffectiveScope(ctx: CoreCallContext, input: { session: SessionRef }): Promise<ReadResult<EffectiveScopeV1[]>>;
  effectiveRegionOf(ctx: CoreCallContext, input: { projectRef: ProjectScope; duty: RoleLineDutyV1;
    moduleRef: ModuleRef }): Promise<ReadResult<ModuleRef[]>>; };
// moved byte for byte from W/notes/scribe-scope.ts:103-137, the loop :248-257
export function regionContains(catalog: AdoptedArchitecture | null, root: string, moduleId: string): boolean {
  if (root === moduleId) return true;
  if (catalog?.containment === undefined) return false;
  const children = new Map<string, string[]>();
  for (const edge of catalog.containment.parentOf) {
    const list = children.get(edge.parent.moduleId) ?? [];
    list.push(edge.child.moduleId);
    children.set(edge.parent.moduleId, list);
  }
  const stack = [...(children.get(root) ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === moduleId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(children.get(current) ?? []));
  }
  return false;
}
export function moduleDepth(catalog: AdoptedArchitecture | null, moduleId: string): number {
  if (catalog?.containment === undefined) return 0;
  const parents = new Map<string, string>();
  for (const edge of catalog.containment.parentOf) parents.set(edge.child.moduleId, edge.parent.moduleId);
  let depth = 0;
  let current = moduleId;
  const seen = new Set<string>();
  while (parents.has(current) && !seen.has(current)) {
    seen.add(current);
    current = parents.get(current)!;
    depth += 1;
  }
  return depth;
}
export function deepestContainingRegion(catalog: AdoptedArchitecture | null,
  roots: readonly string[], modules: readonly string[]): string | null {
  let best: string | null = null;
  let bestDepth = -1;
  for (const root of roots) {
    if (!modules.every(moduleId => regionContains(catalog, root, moduleId))) continue;
    const depth = moduleDepth(catalog, root);
    if (depth > bestDepth || (depth === bestDepth && (best === null || root.localeCompare(best) < 0))) {
      best = root;
      bestDepth = depth;
    }
  }
  return best;
}
export function effectiveRegions(input: { regions: readonly RegionClaimV1[]; catalog: AdoptedArchitecture | null }):
  { session: SessionRef; modules: ModuleRef[] }[] {
  const { regions, catalog } = input;
  return regions.map((region) => {
    const modules: ModuleRef[] = [region.moduleRef];             // the root is never subtracted
    if (catalog !== null) for (const { ref } of catalog.modules)
      if (ref.moduleId !== region.moduleRef.moduleId && ref.projectId === region.moduleRef.projectId
        && regionContains(catalog, region.moduleRef.moduleId, ref.moduleId)) modules.push(ref);
    const rootDepth = moduleDepth(catalog, region.moduleRef.moduleId);
    const effective = modules.filter((candidate) => !regions.some((other) => other !== region
      && other.duty === region.duty && other.moduleRef.projectId === region.moduleRef.projectId
      && moduleDepth(catalog, other.moduleRef.moduleId) > rootDepth
      && regionContains(catalog, other.moduleRef.moduleId, candidate.moduleId)));
    effective.sort((left, right) => left.moduleId < right.moduleId ? -1 : left.moduleId > right.moduleId ? 1 : 0);
    return { session: region.session, modules: effective };
  });
}
// §3.3 item 3: adviser/scribe claim one scope per duty; secretary and (in 7D1) executor take none.
export function responsibilityClaimChanges(input: { projectRef: ProjectScope;
  close: readonly { link: SessionWorkLinkRef; duty: RoleLineDutyV1 }[];
  open: readonly { link: SessionWorkLinkRef; duty: RoleLineDutyV1 }[] }): RoleScopeClaimChangeV1[] {
  const changes: RoleScopeClaimChangeV1[] = [];
  for (const e of input.close) { const c = claimOf(e.link, e.duty); if (c !== null) changes.push({ ...c, expectedOwner: e.link, nextOwner: null }); }
  for (const e of input.open) { const c = claimOf(e.link, e.duty); if (c !== null) changes.push(c); }
  return changes;
}
function claimOf(link: SessionWorkLinkRef, duty: RoleLineDutyV1): RoleScopeClaimChangeV1 | null {
  if (link.relation !== 'responsible') return null;               // every caller reuses this predicate
  if (duty !== 'adviser' && duty !== 'scribe') return null;       // the executor module arm is added by a later slice
  const target = roleScopeOfTarget(link.target);                  // task/work → null: dispatch history
  return target === null ? null : { duty, target, expectedOwner: null, nextOwner: link };
}
export function foldRoleScopeClaimChanges(projectRef: ProjectScope,
  entries: readonly RoleScopeClaimChangeV1[]): RoleScopeClaimChangeV1[] {
  const order: string[] = []; const byKey = new Map<string, RoleScopeClaimChangeV1>();
  for (const entry of entries) {
    const key = roleScopeClaimKey({ projectRef, duty: entry.duty, target: entry.target });
    const existing = byKey.get(key);
    if (existing === undefined) { order.push(key); byKey.set(key, { ...entry }); }
    else byKey.set(key, { ...existing, nextOwner: entry.nextOwner });
  }
  return order.map((key) => byKey.get(key)!).filter((c) => canonicalKey(c.expectedOwner) !== canonicalKey(c.nextOwner));
}
