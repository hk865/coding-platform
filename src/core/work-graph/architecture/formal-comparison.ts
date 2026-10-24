/**
 * Slice 8A (decision 72 post-note; spec L7 lines 116-123; task book item 5):
 * the pure formal-catalog-vs-observed-file-graph comparison.
 *
 * Read-only and deterministic: no I/O, no store, no clock. Ownership is the one
 * shared decision `pathOwnershipOf` (`.` matches at length 0, the longest prefix
 * wins, an equal-longest tie owns nothing), so `ambiguous`, `ungrouped` and the
 * per-module aggregation all agree with the rest of WorkGraph.
 */
import type { AdoptedArchitecture, ModuleDefinition } from '../../../contracts/architecture-catalog.js';
import type { FormalObservedFindingV1 } from '../../../contracts/architecture-inspection.js';
import type { ModuleRef } from '../../../contracts/core/identity.js';
import { pathOwnershipOf, type PathOwnershipV1 } from '../../../contracts/architecture-source.js';
import type { ProjectFileGraphNodeV1, ProjectFileGraphV1 } from '../../workspace/architecture-language-provider.js';
import { stronglyConnectedCycles } from './architecture-delta.js';

/** Input of `compareFormalObservedGraphs`; kept exported for the wiring task. */
export type CompareFormalObservedGraphsInputV1 = {
  architecture: AdoptedArchitecture;
  fileGraph: ProjectFileGraphV1;
};

const refKey = (ref: ModuleRef | null): string =>
  ref === null ? '' : `${ref.projectId}\u0000${ref.moduleId}`;

/** Module identity: `projectId` and `moduleId` only; other fields are ignored. */
const sameModuleIdentity = (a: ModuleRef, b: ModuleRef): boolean =>
  a.projectId === b.projectId && a.moduleId === b.moduleId;

export function compareFormalObservedGraphs(input: CompareFormalObservedGraphsInputV1): FormalObservedFindingV1[] {
  const { architecture, fileGraph } = input;
  const modules = architecture.modules;
  const candidates = modules.map(module => ({ value: module, paths: module.paths }));
  const ownershipCache = new Map<string, PathOwnershipV1<ModuleDefinition>>();
  const ownershipOf = (path: string): PathOwnershipV1<ModuleDefinition> => {
    let result = ownershipCache.get(path);
    if (result === undefined) {
      result = pathOwnershipOf(path, candidates);
      ownershipCache.set(path, result);
    }
    return result;
  };
  const ownerOf = (path: string): ModuleDefinition | null => {
    const ownership = ownershipOf(path);
    return ownership.status === 'owner' ? ownership.owner : null;
  };
  const nodeByPath = new Map<string, ProjectFileGraphNodeV1>(fileGraph.nodes.map(node => [node.path, node]));
  const coverageByLanguage = new Map(fileGraph.languages.map(coverage => [coverage.language, coverage]));
  const unresolvedFrom = new Set(fileGraph.unresolved.map(entry => entry.from));
  /** Modules one of whose candidate files lost to an equal-longest tie. */
  const ambiguousModules = new Set<string>();

  const collected: FormalObservedFindingV1[] = [];
  const push = (finding: FormalObservedFindingV1): void => { collected.push(finding); };

  // Ownership findings: a file with no owner is `ungrouped`; a tie is `ambiguous`.
  for (const node of fileGraph.nodes) {
    const ownership = ownershipOf(node.path);
    if (ownership.status === 'owner') continue;
    if (ownership.status === 'none') {
      push({ kind: 'ungrouped', moduleRef: null, path: node.path, detail: '不在任何模块 path 下', certainty: 'unknown' });
      continue;
    }
    // A tie on a file of language `other` is still `ambiguous`, but `other`
    // files carry no references by nature, so they never make a module's
    // missing dependencies unknown (lead ruling 2).
    if (node.language !== 'other') {
      for (const owner of ownership.owners) ambiguousModules.add(refKey(owner.ref));
    }
    const ids = [...new Set(ownership.owners.map(owner => owner.ref.moduleId))].sort((a, b) => a.localeCompare(b));
    push({
      kind: 'ambiguous', moduleRef: null, path: node.path,
      detail: `${ownership.prefix} 命中 ${ids.join('、')}`,
      certainty: 'unknown',
    });
  }

  // Unresolved imports: one finding each; moduleRef is null when the file is
  // unowned or ambiguous. §11.5: `reason: null` keeps the bare specifier, a
  // provider reason appends `（<reason>）` (full-width parentheses).
  for (const entry of fileGraph.unresolved) {
    const owner = ownerOf(entry.from);
    const detail = entry.reason === null ? entry.specifier : entry.specifier + '（' + entry.reason + '）';
    push({ kind: 'unresolved', moduleRef: owner ? owner.ref : null, path: entry.from, detail, certainty: 'unknown' });
  }

  const dependencyPairKey = (from: ModuleRef, to: ModuleRef): string => `${refKey(from)}\u0001${refKey(to)}`;
  const declaredPairs = new Set(architecture.dependencies.map(dependency => dependencyPairKey(dependency.from, dependency.to)));
  const observedPairs = new Set<string>();
  /** Modules owning a file with an outgoing edge to an unowned or tied file. */
  const unknownReachModules = new Set<string>();
  for (const edge of fileGraph.edges) {
    const fromOwner = ownerOf(edge.from);
    if (fromOwner && ownershipOf(edge.to).status !== 'owner') unknownReachModules.add(refKey(fromOwner.ref));
    const toOwner = ownerOf(edge.to);
    if (!fromOwner || !toOwner) continue;
    // Item 3(a): an intra-module import is never a finding.
    if (sameModuleIdentity(fromOwner.ref, toOwner.ref)) continue;
    const pair = dependencyPairKey(fromOwner.ref, toOwner.ref);
    observedPairs.add(pair);
    if (!declaredPairs.has(pair)) {
      push({ kind: 'import_undeclared', moduleRef: fromOwner.ref, path: edge.from, detail: edge.to, certainty: 'proven' });
    }
  }

  // Observed cycles are reported as they are; the formal DAG is never applied.
  // The ONE detector lives in `architecture-delta.ts` (book §3 "reuse").
  for (const component of stronglyConnectedCycles(
    fileGraph.edges.flatMap(edge => [edge.from, edge.to]), fileGraph.edges)) {
    push({ kind: 'cycle', moduleRef: null, path: component[0]!, detail: component.join(' ⇄ '), certainty: 'proven' });
  }

  // A file's language makes its dependency evidence proven only when that
  // language's edges are supported, every file of the language parsed, and the
  // file itself is not a failed/skipped issue.
  const languageProven = (path: string): boolean => {
    const node = nodeByPath.get(path);
    if (!node) return false;
    const coverage = coverageByLanguage.get(node.language);
    if (!coverage) return false;
    if (coverage.edges !== 'supported') return false;
    if (coverage.parsed < coverage.files) return false;
    return !coverage.issues.some(issue => issue.path === path && (issue.kind === 'skipped' || issue.kind === 'failed'));
  };

  // Item 3(b): truncated `issues` on a source language make every missing
  // dependency unknown, because the missing list itself is incomplete.
  const issuesTruncated = fileGraph.languages.some(
    coverage => coverage.language !== 'other' && coverage.issueCount > coverage.issues.length);
  // A skipped/failed file owned by a module makes that module's missing
  // dependencies unknown. Language `other` has no references by nature and
  // never does.
  const skippedOrFailedModules = new Set<string>();
  for (const coverage of fileGraph.languages) {
    if (coverage.language === 'other') continue;
    for (const issue of coverage.issues) {
      if (issue.kind !== 'skipped' && issue.kind !== 'failed') continue;
      // Consume the shared ownership result directly: on an equal-longest tie
      // EVERY tied module loses its skipped/failed evidence, not just none.
      const ownership = ownershipOf(issue.path);
      if (ownership.status === 'owner') skippedOrFailedModules.add(refKey(ownership.owner.ref));
      else if (ownership.status === 'tie') {
        for (const owner of ownership.owners) skippedOrFailedModules.add(refKey(owner.ref));
      }
      // `other` is already excluded by the language check above.
    }
  }
  const dependencyIsUnknown = (fromModule: ModuleDefinition): boolean => {
    const key = refKey(fromModule.ref);
    if (unknownReachModules.has(key) || skippedOrFailedModules.has(key)) return true;
    for (const node of fileGraph.nodes) {
      const owned = ownerOf(node.path);
      if (!owned || !sameModuleIdentity(owned.ref, fromModule.ref)) continue;
      // A file of language `other` never alone makes a dependency unknown.
      if (node.language === 'other') continue;
      if (unresolvedFrom.has(node.path) || !languageProven(node.path)) return true;
    }
    return false;
  };

  for (const dependency of architecture.dependencies) {
    if (observedPairs.has(dependencyPairKey(dependency.from, dependency.to))) continue;
    const fromModule = modules.find(module => sameModuleIdentity(module.ref, dependency.from)) ?? null;
    let certainty: FormalObservedFindingV1['certainty'] = 'proven';
    if (issuesTruncated) certainty = 'unknown';
    else if (ambiguousModules.has(refKey(dependency.from))) certainty = 'unknown';
    else if (fromModule && dependencyIsUnknown(fromModule)) certainty = 'unknown';
    push({
      kind: 'dependency_missing', moduleRef: dependency.from,
      path: fromModule ? fromModule.paths[0] ?? null : null,
      detail: `${dependency.from.moduleId}→${dependency.to.moduleId}`,
      certainty,
    });
  }

  // One finding per (kind, moduleRef, path, detail); sort by path (null last),
  // then by kind.
  const seen = new Set<string>();
  const deduped: FormalObservedFindingV1[] = [];
  for (const finding of collected) {
    const key = [finding.kind, refKey(finding.moduleRef), finding.path ?? '\u0000', finding.detail].join('\u0001');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  deduped.sort((a, b) => {
    if (a.path === null && b.path === null) return a.kind.localeCompare(b.kind);
    if (a.path === null) return 1;
    if (b.path === null) return -1;
    return a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind);
  });
  return deduped;
}
