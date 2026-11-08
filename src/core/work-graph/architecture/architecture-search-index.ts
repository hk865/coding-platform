/**
 * UI1 architecture search index (pure): matching faces, stable tier order,
 * path de-duplication, formal-group containment and the opaque page cursor.
 *
 * It reads nothing: the observed service hands it the already-loaded page nodes
 * and the already-loaded current catalog, so one request still does one
 * pointer/record/chunk/catalog read and then every match in memory.
 */
import type { ModuleContainment, ModuleDefinition } from '../../../contracts/architecture-catalog.js';
import type { ArchitectureFileHitV1, ArchitectureGroupV1, ArchitectureModuleHitV1 } from '../../../contracts/architecture-search.js';
import type { FileGraphPageNodeV1 } from '../../../contracts/architecture-inspection.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { pathOwnershipOf } from '../../../contracts/path-ownership.js';
import { isRecord } from '../../../contracts/validation/common.js';
import { normalizeSearchText } from '../../record-store/lookup-index.js';
import { encodeCursor } from './graph-index.js';

export class ArchitectureFindCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchitectureFindCursorError';
  }
}

export type ArchitectureFindCursorBinding = {
  captureId: string | null;
  catalogRevision: number | null;
  queryKey: string;
};

/** The page identity the cursor is bound to: same query, capture and catalog. */
export function architectureFindQueryKey(needle: string, limit: number): string {
  return sha256Hex(canonicalJson({ kind: 'architecture-find', needle, limit } as unknown as JsonValue));
}

function readArchitectureFindOffset(cursor: string, binding: ArchitectureFindCursorBinding): number {
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); }
  catch { throw new ArchitectureFindCursorError('the architecture find cursor is not decodable'); }
  if (!isRecord(parsed) || parsed['v'] !== 1
    || (parsed['captureId'] !== null && typeof parsed['captureId'] !== 'string')
    || (parsed['catalogRevision'] !== null && !Number.isSafeInteger(parsed['catalogRevision']))
    || typeof parsed['queryKey'] !== 'string'
    || !Number.isSafeInteger(parsed['offset']) || (parsed['offset'] as number) < 0) {
    throw new ArchitectureFindCursorError('the architecture find cursor is malformed');
  }
  if (parsed['captureId'] !== binding.captureId || parsed['catalogRevision'] !== binding.catalogRevision
    || parsed['queryKey'] !== binding.queryKey) {
    throw new ArchitectureFindCursorError('the architecture find cursor belongs to another capture, catalog revision or query');
  }
  return parsed['offset'] as number;
}

export function moduleKey(ref: { projectId: string; moduleId: string }): string {
  return ref.projectId + '\u0000' + ref.moduleId;
}

/**
 * The formal groups: one per catalog module (de-duplicated by
 * `(projectId,moduleId)`), with declared paths and containment ancestors from
 * root to parent. Containment is the adopted structure, not the filesystem.
 */
export function buildArchitectureGroups(modules: readonly ModuleDefinition[],
  containment?: ModuleContainment): ArchitectureGroupV1[] {
  const byKey = new Map<string, ModuleDefinition>();
  for (const module of modules) if (!byKey.has(moduleKey(module.ref))) byKey.set(moduleKey(module.ref), module);
  const parents = new Map<string, { projectId: string; moduleId: string }>();
  for (const edge of containment?.parentOf ?? []) {
    if (!parents.has(moduleKey(edge.child))) parents.set(moduleKey(edge.child), edge.parent);
  }
  return [...byKey.values()].map((module) => {
    const ancestor: ArchitectureGroupV1['ancestor'] = [];
    let parent = parents.get(moduleKey(module.ref));
    while (parent !== undefined) {
      const definition = byKey.get(moduleKey(parent));
      if (definition === undefined) break;
      ancestor.unshift({ ref: definition.ref, name: definition.name });
      parent = parents.get(moduleKey(parent));
    }
    return {
      ref: module.ref, name: module.name,
      path: module.paths.length === 1 ? module.paths[0]! : null,
      paths: [...module.paths], ancestor,
    };
  });
}

type Match = {
  tier: number;
  item: ArchitectureFileHitV1 | ArchitectureModuleHitV1;
};

/** 0 exact label, 1 label prefix, 2 label substring, null no label match. */
function labelTier(label: string, needle: string): number | null {
  const normalized = normalizeSearchText(label);
  if (normalized === needle) return 0;
  if (normalized.startsWith(needle)) return 1;
  if (normalized.includes(needle)) return 2;
  return null;
}

function compareMatches(left: Match, right: Match): number {
  if (left.tier !== right.tier) return left.tier - right.tier;
  const leftKind = left.item.kind === 'module' ? 0 : 1;
  const rightKind = right.item.kind === 'module' ? 0 : 1;
  if (leftKind !== rightKind) return leftKind - rightKind;
  const label = left.item.label < right.item.label ? -1 : left.item.label > right.item.label ? 1 : 0;
  if (label !== 0) return label;
  const leftPath = left.item.kind === 'file' ? left.item.path : left.item.path ?? '';
  const rightPath = right.item.kind === 'file' ? right.item.path : right.item.path ?? '';
  const path = leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  if (path !== 0) return path;
  if (left.item.kind !== 'module' || right.item.kind !== 'module') return 0;
  return left.item.module.ref.moduleId < right.item.module.ref.moduleId ? -1
    : left.item.module.ref.moduleId > right.item.module.ref.moduleId ? 1 : 0;
}

function fileMatch(node: FileGraphPageNodeV1, needle: string, pathNeedle: string,
  pathFiles: boolean, module: ArchitectureGroupV1 | null): Match | null {
  const basename = node.path.slice(node.path.lastIndexOf('/') + 1);
  const onBasename = normalizeSearchText(basename).includes(needle);
  const onPath = pathFiles && normalizeSearchText(node.path).includes(pathNeedle);
  const names = module === null ? [] : [module.name, ...module.ancestor.map(ancestor => ancestor.name)];
  const onModule = names.some(name => normalizeSearchText(name).includes(needle));
  if (!onBasename && !onPath && !onModule) return null;
  const matchedOn: ArchitectureFileHitV1['matchedOn'] = [];
  if (onBasename) matchedOn.push('basename');
  if (onPath) matchedOn.push('path');
  if (onModule) matchedOn.push('module');
  const item: ArchitectureFileHitV1 = {
    kind: 'file', nodeRef: { kind: 'file', path: node.path },
    label: basename, path: node.path, paths: [node.path], module,
    language: node.language, nonBlankLines: node.nonBlankLines, matchedOn,
  };
  return { tier: labelTier(basename, needle) ?? 3, item };
}

function moduleItem(group: ArchitectureGroupV1, needle: string, matchedOn: ArchitectureModuleHitV1['matchedOn'],
  projectPathOf: (path: string) => string): ArchitectureModuleHitV1 {
  const paths = group.paths.map(projectPathOf);
  return {
    kind: 'module', nodeRef: { kind: 'module', ref: group.ref },
    label: group.name, path: group.path === null ? null : projectPathOf(group.path), paths,
    module: { ...group, path: group.path === null ? null : projectPathOf(group.path), paths }, matchedOn,
  };
}

/** Name/ancestor matches on the original project catalog (never narrowed to a workspace). */
function moduleNameMatch(group: ArchitectureGroupV1, needle: string,
  projectPathOf: (path: string) => string): Match | null {
  const onName = normalizeSearchText(group.name).includes(needle);
  const onAncestor = group.ancestor.some(ancestor => normalizeSearchText(ancestor.name).includes(needle));
  if (!onName && !onAncestor) return null;
  const matchedOn: ArchitectureModuleHitV1['matchedOn'] = [];
  if (onName) matchedOn.push('name');
  if (onAncestor) matchedOn.push('ancestor');
  return { tier: labelTier(group.name, needle) ?? 3,
    item: moduleItem(group, needle, matchedOn, projectPathOf) };
}

/** Path matches on the workspace the request path names. */
function modulePathMatch(group: ArchitectureGroupV1, needle: string, pathNeedle: string,
  projectPathOf: (path: string) => string): Match | null {
  if (!group.paths.some(path => normalizeSearchText(path).includes(pathNeedle))) return null;
  return { tier: labelTier(group.name, needle) ?? 3,
    item: moduleItem(group, needle, ['path'], projectPathOf) };
}

/** One module's name/ancestor and path matches merged into one hit. */
function mergeModuleMatch(left: Match, right: Match): Match {
  if (left.item.kind !== 'module' || right.item.kind !== 'module') return left;
  const matchedOn: ArchitectureModuleHitV1['matchedOn'] = [...left.item.matchedOn];
  for (const on of right.item.matchedOn) if (!matchedOn.includes(on)) matchedOn.push(on);
  return { tier: Math.min(left.tier, right.tier), item: { ...left.item, matchedOn } };
}

export type ArchitectureFindPage = {
  needle: string;
  items: (ArchitectureFileHitV1 | ArchitectureModuleHitV1)[];
  counts: { files: number; modules: number; total: number };
  nextCursor: string | null;
};

/**
 * Match every observed node and formal group, order them by
 * `(tier, kind, label, path/moduleId)`, count the full result and return one
 * page. Files are de-duplicated by path (the one `orderedNodes` rule).
 */
export function pageArchitectureFind(input: {
  nodes: readonly FileGraphPageNodeV1[];
  /** The original project catalog: name/ancestor matches never narrow to a workspace. */
  modules: readonly ModuleDefinition[];
  containment?: ModuleContainment;
  /** The workspace projection the request path names; path matches use it. Defaults to `modules`. */
  pathModules?: readonly ModuleDefinition[];
  pathContainment?: ModuleContainment;
  /** The workspace projection the observed files belong to; file ownership uses it. Defaults to `modules`. */
  fileModules?: readonly ModuleDefinition[];
  fileContainment?: ModuleContainment;
  /** Turns a projected relative module path back into its project path. */
  projectPathOf?: (path: string) => string;
  /** The observed files are workspace-relative; a path naming another workspace matches none of them. */
  pathFiles?: boolean;
  needle: string;
  /** The path branch's needle: the request path relative to the workspace it names. */
  pathNeedle?: string;
  afterCursor: string | null;
  limit: number;
  binding: Omit<ArchitectureFindCursorBinding, 'queryKey'>;
}): ArchitectureFindPage {
  const needle = normalizeSearchText(input.needle);
  const pathNeedle = normalizeSearchText(input.pathNeedle ?? input.needle);
  const queryKey = architectureFindQueryKey(needle, input.limit);
  const offset = input.afterCursor === null ? 0 : readArchitectureFindOffset(input.afterCursor, { ...input.binding, queryKey });
  const groups = buildArchitectureGroups(input.modules, input.containment);
  const pathGroups = input.pathModules === undefined ? groups
    : buildArchitectureGroups(input.pathModules, input.pathContainment);
  const fileGroups = input.fileModules === undefined ? groups
    : buildArchitectureGroups(input.fileModules, input.fileContainment);
  const projectPathOf = input.projectPathOf ?? ((path: string) => path);
  const candidates = fileGroups.map(group => ({ value: group, paths: group.paths }));
  const seen = new Set<string>();
  const matches: Match[] = [];
  for (const node of input.nodes) {
    if (seen.has(node.path)) continue;
    seen.add(node.path);
    const ownership = pathOwnershipOf(node.path, candidates);
    const module = ownership.status === 'owner' ? ownership.owner : null;
    const match = fileMatch(node, needle, pathNeedle, input.pathFiles !== false, module);
    if (match !== null) matches.push(match);
  }
  const byModule = new Map<string, Match>();
  for (const group of groups) {
    const match = moduleNameMatch(group, needle, (path: string) => path);
    if (match !== null) byModule.set(moduleKey(group.ref), match);
  }
  for (const group of pathGroups) {
    const match = modulePathMatch(group, needle, pathNeedle, projectPathOf);
    if (match === null) continue;
    const key = moduleKey(group.ref);
    const named = byModule.get(key);
    byModule.set(key, named === undefined ? match : mergeModuleMatch(named, match));
  }
  matches.push(...byModule.values());
  matches.sort(compareMatches);
  const files = matches.filter(match => match.item.kind === 'file').length;
  const modules = matches.length - files;
  const page = matches.slice(offset, offset + input.limit);
  const nextOffset = offset + page.length;
  return {
    needle,
    items: page.map(match => match.item),
    counts: { files, modules, total: matches.length },
    nextCursor: nextOffset < matches.length
      ? encodeCursor({ v: 1, captureId: input.binding.captureId,
        catalogRevision: input.binding.catalogRevision, queryKey, offset: nextOffset })
      : null,
  };
}
