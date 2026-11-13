/**
 * The architecture files of one line: a key-sorted,
 * indented `architecture.json` and one `modules/<fileId>.json` per module of
 * this line's workspace. Pure: the composition root reads and writes the bytes.
 *
 * Ids in a module file are the raw ids of its own workspace (`id`, `contains`,
 * `dependsOn`). Paths and every reference to another workspace are written in
 * the file frame (the file's workspace is the main one). An edge belongs to the
 * workspace of its `from`/`parent`, so a cross-workspace edge sits in that
 * workspace's `architecture.json`; the baseline fields are written only in the
 * main workspace's, and a second workspace's read leaves them out (the same
 * checkout may be another project's main workspace). A read-back validates the raw catalog with the catalog's own
 * validator before it turns into the project view, and any bad file, duplicate
 * id or dangling reference makes the whole read invalid: never half a catalog.
 */
import type { ModuleRef } from '../../../contracts/core/identity.js';
import {
  ARCHITECTURE_FILE_PATH, type KnowledgeConflictV1, type KnowledgeFileSourceV1, type KnowledgeIssueV1,
  type KnowledgeProblemKindV1, type KnowledgeProblemV1,
} from '../../../contracts/knowledge.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { isSafeProjectPath } from '../../../contracts/workspace-path.js';
import { messageOf } from '../../../contracts/error-message.js';
import { hasOnlyKeys, isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import {
  fileModuleId, fileProjectPath, projectModuleId, projectModuleIdOfFile, projectPathOfFile, rawModuleId,
} from '../../../contracts/workspace-module-id.js';
import type { DecodeResult } from '../../record-store/ports.js';
import type {
  KnowledgeArchitecture, KnowledgeBaselineV1, KnowledgeDiskFileV1, KnowledgeLineScope, KnowledgeRecordedArchitecture,
} from '../model/line-knowledge.js';
import type { AdoptedArchitecture } from './catalog-contracts.js';
import { readArchitectureBaselineContent, validateAdoptedArchitecture } from './catalog-record-codecs.js';
import { stronglyConnectedCycles } from './architecture-delta.js';


export type ModuleFileV1 = {
  id: string; name: string; responsibility: string; paths: string[];
  interfaces: { id: string; description: string; paths: string[] }[];
  contains?: string[];
  dependsOn: { to: string; reason: string }[];
};
export type ArchitectureFileV1 = {
  modules: string[];
  crossWorkspace: { dependsOn: { from: string; to: string; reason: string }[]; contains: { parent: string; child: string }[] };
  baseline?: KnowledgeBaselineV1;
};

/** `canonicalJson`'s key order, two-space indentation and a final newline. */
export function prettyJson(value: unknown): string {
  return `${JSON.stringify(JSON.parse(canonicalJson(value as JsonValue)), null, 2)}\n`;
}

const encoder = new TextEncoder();
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const byEnds = (left: { from: ModuleRef; to: ModuleRef }, right: { from: ModuleRef; to: ModuleRef }): number =>
  compare(left.from.moduleId, right.from.moduleId) || compare(left.to.moduleId, right.to.moduleId);
const byPair = (left: { parent: ModuleRef; child: ModuleRef }, right: { parent: ModuleRef; child: ModuleRef }): number =>
  compare(left.parent.moduleId, right.parent.moduleId) || compare(left.child.moduleId, right.child.moduleId);

/** Ruling G1: modules by id, dependencies by (from, to), containment by (parent, child) — the one read-back order. */
export function inModuleIdOrder(catalog: AdoptedArchitecture): AdoptedArchitecture {
  return { ...catalog,
    modules: [...catalog.modules].sort((left, right) => compare(left.ref.moduleId, right.ref.moduleId)),
    dependencies: [...catalog.dependencies].sort(byEnds),
    ...(catalog.containment === undefined ? {} : { containment: { ...catalog.containment,
      parentOf: [...catalog.containment.parentOf].sort(byPair) } }) };
}

/** A JSON object of the file's UTF-8 bytes, or null. */
function jsonObjectOf(bytes: Uint8Array): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  return isRecord(parsed) ? parsed : null;
}

/** Exactly the required keys plus any of the optional ones. */
export function keysAre(value: Record<string, unknown>, required: readonly string[],
  optional: readonly string[] = []): boolean {
  return hasOnlyKeys(value, [...required, ...optional]) && required.every(key => Object.hasOwn(value, key));
}

/**
 * A catalog path: the project-path rule (`isSafeProjectPath`) on the path without the one trailing `/` a catalog
 * path may carry (RW-13: `pathOwnershipOf` strips it), so `src/` reads back and `../outside` does not.
 */
function isCatalogPath(path: string): boolean {
  return isSafeProjectPath(path.endsWith('/') ? path.slice(0, -1) : path);
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(nonEmpty) ? [...value] : null;
}

export function moduleFileOf(path: string, bytes: Uint8Array): ModuleFileV1 | string {
  const value = jsonObjectOf(bytes);
  if (value === null) return `${path}: the module file is not a JSON object`;
  if (!keysAre(value, ['id', 'name', 'responsibility', 'paths', 'interfaces', 'dependsOn'], ['contains'])) {
    return `${path}: a module file carries exactly id, name, responsibility, paths, interfaces, dependsOn and an optional contains`;
  }
  const { id, name, responsibility } = value;
  if (!nonEmpty(id) || !nonEmpty(name) || !nonEmpty(responsibility)) {
    return `${path}: id, name and responsibility must be non-empty strings`;
  }
  const paths = stringList(value['paths']);
  if (paths === null || !paths.every(isCatalogPath)) return `${path}: paths must be project paths`;
  const interfaces: ModuleFileV1['interfaces'] = [];
  if (!Array.isArray(value['interfaces'])) return `${path}: interfaces must be an array`;
  for (const entry of value['interfaces']) {
    const interfacePaths = isRecord(entry) ? stringList(entry['paths']) : null;
    if (!isRecord(entry) || !keysAre(entry, ['id', 'description', 'paths']) || !nonEmpty(entry['id'])
      || !nonEmpty(entry['description']) || interfacePaths === null || !interfacePaths.every(isCatalogPath)) {
      return `${path}: every interface carries exactly a non-empty id, description and project paths`;
    }
    interfaces.push({ id: entry['id'], description: entry['description'], paths: interfacePaths });
  }
  const contains = value['contains'] === undefined ? undefined : stringList(value['contains']);
  if (contains === null) return `${path}: contains must be non-empty module ids`;
  const dependsOn: ModuleFileV1['dependsOn'] = [];
  if (!Array.isArray(value['dependsOn'])) return `${path}: dependsOn must be an array`;
  for (const entry of value['dependsOn']) {
    if (!isRecord(entry) || !keysAre(entry, ['to', 'reason']) || !nonEmpty(entry['to']) || !nonEmpty(entry['reason'])) {
      return `${path}: every dependsOn entry carries exactly a non-empty to and reason`;
    }
    dependsOn.push({ to: entry['to'], reason: entry['reason'] });
  }
  return { id, name, responsibility, paths, interfaces, ...(contains === undefined ? {} : { contains }), dependsOn };
}

/** The id of a module file the read-back parse accepts, or why the file is bad (writers do not guess around it). */
export function moduleFileIdOf(path: string, bytes: Uint8Array): DecodeResult<string> {
  const file = moduleFileOf(path, bytes);
  return typeof file === 'string' ? { status: 'invalid', reason: file } : { status: 'decoded', value: file.id };
}

export function architectureFileOf(bytes: Uint8Array, main: boolean): ArchitectureFileV1 | string {
  const where = ARCHITECTURE_FILE_PATH;
  const value = jsonObjectOf(bytes);
  if (value === null) return `${where}: the architecture file is not a JSON object`;
  // R6: one checkout may be one project's main workspace and another's second, so any file may carry a baseline; only
  // the main workspace's read takes it (a second workspace's project has its own main one's).
  if (!keysAre(value, ['modules', 'crossWorkspace'], ['baseline'])) {
    return `${where}: the architecture file carries exactly modules, crossWorkspace and an optional baseline`;
  }
  const modules = stringList(value['modules']);
  if (modules === null) return `${where}: modules must be non-empty module ids`;
  const cross = value['crossWorkspace'];
  if (!isRecord(cross) || !keysAre(cross, ['dependsOn', 'contains'])
    || !Array.isArray(cross['dependsOn']) || !Array.isArray(cross['contains'])) {
    return `${where}: crossWorkspace carries exactly dependsOn and contains`;
  }
  const dependsOn: ArchitectureFileV1['crossWorkspace']['dependsOn'] = [];
  for (const entry of cross['dependsOn']) {
    if (!isRecord(entry) || !keysAre(entry, ['from', 'to', 'reason']) || !nonEmpty(entry['from'])
      || !nonEmpty(entry['to']) || !nonEmpty(entry['reason'])) {
      return `${where}: every crossWorkspace.dependsOn entry carries exactly a non-empty from, to and reason`;
    }
    dependsOn.push({ from: entry['from'], to: entry['to'], reason: entry['reason'] });
  }
  const contains: ArchitectureFileV1['crossWorkspace']['contains'] = [];
  for (const entry of cross['contains']) {
    if (!isRecord(entry) || !keysAre(entry, ['parent', 'child']) || !nonEmpty(entry['parent']) || !nonEmpty(entry['child'])) {
      return `${where}: every crossWorkspace.contains entry carries exactly a non-empty parent and child`;
    }
    contains.push({ parent: entry['parent'], child: entry['child'] });
  }
  if (value['baseline'] === undefined || !main) return { modules, crossWorkspace: { dependsOn, contains } };
  const baseline = baselineOf(value['baseline']);
  if (baseline === null) {
    return `${where}: the baseline carries exactly description, constraints and optional forbid_dependency rules`;
  }
  return { modules, crossWorkspace: { dependsOn, contains }, baseline };
}

function baselineOf(value: unknown): KnowledgeBaselineV1 | null {
  if (!isRecord(value) || !keysAre(value, ['description', 'constraints'], ['dependencyRules'])) return null;
  const content = readArchitectureBaselineContent({
    schemaVersion: 1, description: value['description'], constraints: value['constraints'] });
  if (content === null) return null;
  const baseline: KnowledgeBaselineV1 = { description: content.description, constraints: content.constraints };
  if (value['dependencyRules'] === undefined) return baseline;
  if (!Array.isArray(value['dependencyRules'])) return null;
  const rules: NonNullable<KnowledgeBaselineV1['dependencyRules']> = [];
  for (const rule of value['dependencyRules']) {
    if (!isRecord(rule) || !keysAre(rule, ['ruleId', 'kind', 'fromModule', 'toModule']) || rule['kind'] !== 'forbid_dependency'
      || !nonEmpty(rule['ruleId']) || !nonEmpty(rule['fromModule']) || !nonEmpty(rule['toModule'])) return null;
    rules.push({ ruleId: rule['ruleId'], kind: 'forbid_dependency', fromModule: rule['fromModule'], toModule: rule['toModule'] });
  }
  return { ...baseline, dependencyRules: rules };
}

/**
 * The three conflicts among this line's module files; a file that does not
 * parse is a bad file, not a conflict, and is left out here. `moduleId` is the
 * project view (the missing target for a dangling reference); `paths` are the
 * module files involved. Sorted by (kind, moduleId).
 */
export function knowledgeConflictsOf(modules: readonly { path: string; bytes: Uint8Array }[],
  scope: KnowledgeLineScope): readonly KnowledgeConflictV1[] {
  const parsed = modules.flatMap(module => {
    const file = moduleFileOf(module.path, module.bytes);
    return typeof file === 'string' ? [] : [{ path: module.path, file }];
  });
  const found = new Map<string, { kind: KnowledgeConflictV1['kind']; moduleId: string; paths: Set<string> }>();
  const add = (kind: KnowledgeConflictV1['kind'], rawId: string, paths: readonly string[]): void => {
    const moduleId = projectModuleId(scope.workspaceId, rawId, scope.mainWorkspaceId);
    const key = `${kind}\u0000${moduleId}`;
    const entry = found.get(key) ?? { kind, moduleId, paths: new Set<string>() };
    for (const path of paths) entry.paths.add(path);
    found.set(key, entry);
  };
  const filesOf = new Map<string, string[]>();
  for (const { path, file } of parsed) filesOf.set(file.id, [...(filesOf.get(file.id) ?? []), path]);
  for (const [id, paths] of filesOf) if (paths.length > 1) add('duplicate_module_id', id, paths);
  const claimers = new Map<string, Set<string>>();
  for (const { file } of parsed) {
    for (const path of file.paths) claimers.set(path, (claimers.get(path) ?? new Set()).add(file.id));
  }
  for (const ids of claimers.values()) {
    if (ids.size < 2) continue;
    const paths = parsed.filter(entry => ids.has(entry.file.id)).map(entry => entry.path);
    for (const id of ids) add('path_claimed_by_two_modules', id, paths);
  }
  for (const { path, file } of parsed) {
    for (const target of [...(file.contains ?? []), ...file.dependsOn.map(entry => entry.to)]) {
      if (!filesOf.has(target)) add('dangling_reference', target, [path]);
    }
  }
  return [...found.values()]
    .map(entry => ({ kind: entry.kind, moduleId: entry.moduleId, paths: [...entry.paths].sort(compare) }))
    .sort((left, right) => compare(left.kind, right.kind) || compare(left.moduleId, right.moduleId));
}

/**
 * The projection's bytes for one path: `architecture.json`, or the module whose raw id is `moduleId`; null when the
 * projection has none. The one lookup the note rebuild (`notes/knowledge-files.ts`) and the source verdict share.
 */
export function projectedFileOf(projection: { architecture: Uint8Array; modules: readonly { moduleId: string; bytes: Uint8Array }[] },
  path: string, moduleId: string | null): Uint8Array | null {
  if (path === ARCHITECTURE_FILE_PATH) return projection.architecture;
  if (moduleId === null) return null;
  return projection.modules.find(module => module.moduleId === moduleId)?.bytes ?? null;
}

/**
 * Ruling 4-2 A, the one verdict (G2, KC-2, KC-3): the platform wrote a file when its bytes are exactly the bytes of
 * the catalog the records last adopted (`projection`); otherwise the person's, committed or not by git. A note file
 * and a module file whose bytes name no module are never the platform's.
 */
export function platformFileSource(projection: { architecture: Uint8Array; modules: readonly { moduleId: string; bytes: Uint8Array }[] } | null,
  file: { path: string; bytes: Uint8Array; committed: boolean }): KnowledgeFileSourceV1 {
  let projected: Uint8Array | null = null;
  if (projection !== null) {
    if (file.path === ARCHITECTURE_FILE_PATH) projected = projection.architecture;
    else {
      const id = moduleFileIdOf(file.path, file.bytes);
      if (id.status === 'decoded') projected = projectedFileOf(projection, file.path, id.value);
    }
  }
  if (projected !== null && Buffer.from(projected).equals(Buffer.from(file.bytes))) return 'platform';
  return file.committed ? 'committed' : 'uncommitted';
}

/** One raw place before the file sources and `itemNo` are added. */
type ProblemPlace = { kind: KnowledgeProblemKindV1; paths: string[]; moduleIds: string[]; reason: string };

/**
 * Every place one line's knowledge files go wrong, from their bytes only (KC-3's gate calls it too, ruling 4-6):
 * the bad files step 7 already found, the module-file conflicts, the index's own structural faults, a cycle, the
 * project merge's failure and one fallback for a graph reason no other place names. The order is draft §2.3-2's
 * judgment order, then `moduleIds`, then `paths`.
 */
export function knowledgeProblemsOf(input: {
  architecture: Uint8Array | null; modules: readonly { path: string; bytes: Uint8Array }[];
  fileIssues: readonly KnowledgeIssueV1[]; graphReason: string | null; projectReason: string | null;
  scope: KnowledgeLineScope;
}): { kind: KnowledgeProblemKindV1; paths: string[]; moduleIds: string[]; reason: string }[] {
  const { workspaceId, mainWorkspaceId } = input.scope;
  const projectViewIdOf = (raw: string): string => projectModuleId(workspaceId, raw, mainWorkspaceId);
  const parsed = new Map<string, { path: string; file: ModuleFileV1 }[]>();
  for (const module of input.modules) {
    const file = moduleFileOf(module.path, module.bytes);
    if (typeof file === 'string') continue;   // already a bad_file row
    parsed.set(file.id, [...(parsed.get(file.id) ?? []), { path: module.path, file }]);
  }
  const filesOfId = (id: string): string[] => (parsed.get(id) ?? []).map(entry => entry.path).sort(compare);
  const places: ProblemPlace[] = [];
  for (const issue of [...input.fileIssues].sort((left, right) => compare(left.path, right.path))) {
    places.push({ kind: 'bad_file', paths: [issue.path], moduleIds: [], reason: `文件读不出：${issue.reason}` });
  }
  for (const [id, entries] of [...parsed].sort(([left], [right]) => compare(left, right))) {
    if (entries.length < 2) continue;
    places.push({ kind: 'duplicate_module_id', paths: entries.map(entry => entry.path).sort(compare),
      moduleIds: [projectViewIdOf(id)],
      reason: `${entries.length} 个模块文件都写了模块号 ${projectViewIdOf(id)}：一个模块号只能有一个文件，删掉或改掉多余的` });
  }
  const claimers = new Map<string, Set<string>>();
  for (const entries of parsed.values()) {
    for (const { file } of entries) {
      for (const path of file.paths) claimers.set(path, (claimers.get(path) ?? new Set()).add(file.id));
    }
  }
  const byClaimants = new Map<string, { ids: string[]; paths: string[] }>();
  for (const [path, ids] of claimers) {
    if (ids.size < 2) continue;
    const sorted = [...ids].sort(compare);
    const key = sorted.join('\u0000');
    const entry = byClaimants.get(key) ?? { ids: sorted, paths: [] };
    entry.paths.push(path);
    byClaimants.set(key, entry);
  }
  for (const { ids, paths } of byClaimants.values()) {
    const moduleIds = ids.map(projectViewIdOf).sort(compare);
    places.push({ kind: 'path_claimed_by_two_modules',
      paths: [...new Set(ids.flatMap(filesOfId))].sort(compare), moduleIds,
      reason: `模块 ${moduleIds.join('、')} 都认领了 ${paths.sort(compare).join('、')}：一个路径只能归一个模块，从其余模块的 paths 里去掉` });
  }
  const dangling = new Map<string, { raw: string; target: string; path: string }>();
  for (const entries of parsed.values()) {
    for (const { path, file } of entries) {
      for (const target of [...(file.contains ?? []), ...file.dependsOn.map(entry => entry.to)]) {
        if (parsed.has(target)) continue;
        const key = `${file.id}\u0000${target}`;
        if (!dangling.has(key)) dangling.set(key, { raw: file.id, target, path });
      }
    }
  }
  for (const { raw, target, path } of dangling.values()) {
    places.push({ kind: 'dangling_reference', paths: [path], moduleIds: [projectViewIdOf(raw), projectViewIdOf(target)],
      reason: `模块 ${projectViewIdOf(raw)} 引用了不存在的模块 ${projectViewIdOf(target)}：改 ${projectViewIdOf(raw)} 的 contains 或 dependsOn，或补上 ${projectViewIdOf(target)} 的模块文件` });
  }
  const index = input.architecture === null ? null : architectureFileOf(input.architecture, workspaceId === mainWorkspaceId);
  if (index !== null && typeof index !== 'string') {
    const named = [...index.modules, ...index.crossWorkspace.dependsOn.map(edge => edge.from),
      ...index.crossWorkspace.contains.map(edge => edge.parent)];
    for (const id of [...new Set(named)].sort(compare)) {
      if (parsed.has(id)) continue;
      places.push({ kind: 'module_without_file', paths: [ARCHITECTURE_FILE_PATH], moduleIds: [projectViewIdOf(id)],
        reason: `architecture.json 点名了模块 ${projectViewIdOf(id)}，但没有它的模块文件：补上文件，或从 architecture.json 去掉` });
    }
    const all = [...parsed.values()].flat();
    const undeclared = all.filter(entry => entry.file.contains === undefined);
    if (undeclared.length > 0 && undeclared.length < all.length) {
      const ids = undeclared.map(entry => projectViewIdOf(entry.file.id)).sort(compare);
      places.push({ kind: 'partial_contains', paths: undeclared.map(entry => entry.path).sort(compare), moduleIds: ids,
        reason: `有的模块文件写了 contains、有的没写（没写的：${ids.join('、')}）：要么都写，要么都不写` });
    }
    const reached = new Set<string>();
    const queue = [...index.modules];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (reached.has(id)) continue;
      reached.add(id);
      queue.push(...(parsed.get(id)?.[0]?.file.contains ?? []));
    }
    const unreached = all.filter(entry => !reached.has(entry.file.id));
    if (unreached.length > 0) {
      const ids = unreached.map(entry => projectViewIdOf(entry.file.id)).sort(compare);
      places.push({ kind: 'unreachable', paths: unreached.map(entry => entry.path).sort(compare), moduleIds: ids,
        reason: `模块 ${ids.join('、')} 从 architecture.json 的 modules 走不到：放进 modules，或放进某个模块的 contains` });
    }
  }
  const cycles = stronglyConnectedCycles([...parsed.keys()], [...parsed.values()].flatMap(entries =>
    entries.flatMap(({ file }) => file.dependsOn.map(edge => ({ from: file.id, to: edge.to })))));
  for (const component of cycles) {
    const ids = component.map(projectViewIdOf).sort(compare);
    places.push({ kind: 'cycle', paths: [...new Set(component.flatMap(filesOfId))].sort(compare), moduleIds: ids,
      reason: `模块 ${ids.join('、')} 的依赖成环：去掉环上的一条 dependsOn` });
  }
  if (input.projectReason !== null) {
    places.push({ kind: 'project_merge', paths: [ARCHITECTURE_FILE_PATH], moduleIds: [],
      reason: `几个工作区的架构图合不起来：${input.projectReason}` });
  }
  // 4-6: one fallback when no other place names a file (a note's bad file does not count).
  const modulePaths = new Set(input.modules.map(module => module.path));
  if (input.graphReason !== null && places.every(place => place.kind === 'project_merge'
    || !place.paths.some(path => path === ARCHITECTURE_FILE_PATH || modulePaths.has(path)))) {
    places.push({ kind: 'other', paths: [ARCHITECTURE_FILE_PATH], moduleIds: [],
      reason: `架构图读不出：${input.graphReason}` });
  }
  const rank = (kind: KnowledgeProblemKindV1): number => ORDER.indexOf(kind);
  return places.sort((left, right) => rank(left.kind) - rank(right.kind)
    || compare(left.moduleIds.join('\u0000'), right.moduleIds.join('\u0000'))
    || compare(left.paths.join('\u0000'), right.paths.join('\u0000')));
}

const ORDER: readonly KnowledgeProblemKindV1[] = ['bad_file', 'duplicate_module_id', 'path_claimed_by_two_modules',
  'dangling_reference', 'cycle', 'module_without_file', 'partial_contains', 'unreachable', 'project_merge', 'other'];

/** `knowledgeProblemsOf` plus each file's source and `itemNo`: the one injected `KnowledgeWriteDeps.problemsOf`. */
export function lineProblemsOf(input: {
  files: readonly KnowledgeDiskFileV1[]; fileIssues: readonly KnowledgeIssueV1[]; graphReason: string | null;
  projectReason: string | null; scope: KnowledgeLineScope; recorded: KnowledgeRecordedArchitecture | null;
}): KnowledgeProblemV1[] {
  const byPath = new Map(input.files.map(file => [file.path, file]));
  const architecture = byPath.get(ARCHITECTURE_FILE_PATH)?.bytes ?? null;
  const projection = input.recorded === null ? null
    : architectureFilesOf(input.recorded.catalog, input.recorded.baseline, input.scope, architecture);
  // A recorded catalog is written by the same function (lists B), so an invalid projection is a programming error.
  if (projection !== null && projection.status !== 'decoded') {
    throw new Error(`the recorded catalog cannot be written as knowledge files: ${projection.reason}`);
  }
  const projected = projection === null ? null : projection.value;
  const modules = input.files.filter(file => file.kind === 'module').map(file => ({ path: file.path, bytes: file.bytes }));
  // KC-2 (121-106 ④, PRODUCT :489): a bad file's place says whether the last commit has another version of it.
  const headHint = (path: string): string => {
    const file = byPath.get(path);
    return file !== undefined && file.headBlob !== null && file.headBlob !== file.blobSha
      ? `。上次提交里有这个文件能用的版本，也可以在工作区根目录用 git restore ${path} 恢复` : '。上次提交里没有能用的版本';
  };
  return knowledgeProblemsOf({ architecture, modules, fileIssues: input.fileIssues, graphReason: input.graphReason,
    projectReason: input.projectReason, scope: input.scope }).map((place, index) => ({
    itemNo: index + 1, kind: place.kind,
    files: place.paths.map(path => {
      const file = byPath.get(path);
      // A path the round did not read (a deleted architecture.json): the person's, never the platform's.
      return file === undefined ? { path, source: 'uncommitted' as const }
        : { path, source: platformFileSource(projected, file) };
    }),
    moduleIds: place.moduleIds,
    reason: place.kind === 'bad_file' ? `${place.reason}${headHint(place.paths[0]!)}` : place.reason,
  }));
}

/**
 * One line's architecture files from the whole project view: this workspace's
 * modules (`moduleId` is the raw id written in the file) and its
 * `architecture.json`. `invalid` when a reference cannot be written in the
 * file frame, or a module or interface path is not one the read-back takes
 * (`isCatalogPath`, stack review 3). `current` is the line's `architecture.json`
 * now (null when none): R6, a second workspace's file may be another project's
 * main one, so the baseline it carries is written back as it is, never read
 * or changed.
 */
export function architectureFilesOf(project: AdoptedArchitecture, baseline: KnowledgeBaselineV1,
  scope: KnowledgeLineScope, current: Uint8Array | null = null):
  DecodeResult<{ architecture: Uint8Array; modules: readonly { moduleId: string; bytes: Uint8Array }[] }> {
  const { workspaceId, mainWorkspaceId } = scope;
  try {
    const own = (id: string): boolean => (rawModuleId(id).workspaceId ?? mainWorkspaceId) === workspaceId;
    const raw = (id: string): string => rawModuleId(id).moduleId;
    const frameId = (id: string): string => fileModuleId(id, workspaceId, mainWorkspaceId);
    const framePath = (path: string): string => {
      const framed = fileProjectPath(path, workspaceId, mainWorkspaceId);
      if (!isCatalogPath(framed)) throw new Error(`${path} is not a project path`);
      return framed;
    };
    const modules = project.modules.filter(module => own(module.ref.moduleId));
    const parentOf = project.containment?.parentOf ?? [];
    const contained = new Set(parentOf.filter(edge => own(edge.parent.moduleId) && own(edge.child.moduleId))
      .map(edge => edge.child.moduleId));
    const files = modules.map(module => {
      const id = module.ref.moduleId;
      const file: ModuleFileV1 = {
        id: raw(id), name: module.name, responsibility: module.responsibility, paths: module.paths.map(framePath),
        interfaces: module.interfaces.map(entry => ({ id: entry.id, description: entry.description,
          paths: entry.paths.map(framePath) })),
        // Only a catalog that declared containment writes `contains` (an empty list included).
        ...(project.containment === undefined ? {} : { contains: parentOf
          .filter(edge => edge.parent.moduleId === id && own(edge.child.moduleId))
          .map(edge => raw(edge.child.moduleId)).sort(compare) }),
        dependsOn: project.dependencies.filter(edge => edge.from.moduleId === id && own(edge.to.moduleId))
          .map(edge => ({ to: raw(edge.to.moduleId), reason: edge.reason }))
          .sort((left, right) => compare(left.to, right.to)),
      };
      return { moduleId: file.id, bytes: encoder.encode(prettyJson(file)) };
    });
    const architecture: ArchitectureFileV1 = {
      modules: modules.map(module => module.ref.moduleId).filter(id => !contained.has(id)).map(raw).sort(compare),
      crossWorkspace: {
        dependsOn: project.dependencies.filter(edge => own(edge.from.moduleId) && !own(edge.to.moduleId))
          .map(edge => ({ from: raw(edge.from.moduleId), to: frameId(edge.to.moduleId), reason: edge.reason }))
          .sort((left, right) => compare(left.from, right.from) || compare(left.to, right.to)),
        contains: parentOf.filter(edge => own(edge.parent.moduleId) && !own(edge.child.moduleId))
          .map(edge => ({ parent: raw(edge.parent.moduleId), child: frameId(edge.child.moduleId) }))
          .sort((left, right) => compare(left.parent, right.parent) || compare(left.child, right.child)),
      },
      ...(workspaceId === mainWorkspaceId ? { baseline: {
        description: baseline.description, constraints: baseline.constraints,
        ...(baseline.dependencyRules === undefined ? {} : { dependencyRules: baseline.dependencyRules.map(rule => ({
          ...rule, fromModule: frameId(rule.fromModule), toModule: frameId(rule.toModule) })) }),
      } } : {}),
    };
    const kept = workspaceId === mainWorkspaceId || current === null ? undefined : jsonObjectOf(current)?.['baseline'];
    return { status: 'decoded', value: { modules: files,
      architecture: encoder.encode(prettyJson(kept === undefined ? architecture : { ...architecture, baseline: kept })) } };
  } catch (error) {
    return { status: 'invalid', reason: `the catalog cannot be written in the file frame: ${messageOf(error)}` };
  }
}

/**
 * One line's architecture files back to the project view: exact keys, then the
 * conflicts that make the catalog unreadable, every module reachable from the
 * roots through `contains`, the catalog validator on the raw ids, and only then
 * the project view. A path claimed by two modules is not a read failure.
 */
export function architectureOfFiles(architecture: Uint8Array, modules: readonly { path: string; bytes: Uint8Array }[],
  scope: KnowledgeLineScope, projectId: string): DecodeResult<KnowledgeArchitecture> {
  const { workspaceId, mainWorkspaceId } = scope;
  const invalid = (reason: string): DecodeResult<never> => ({ status: 'invalid', reason });
  const index = architectureFileOf(architecture, workspaceId === mainWorkspaceId);
  if (typeof index === 'string') return invalid(index);
  const parsed: { path: string; file: ModuleFileV1 }[] = [];
  for (const module of modules) {
    const file = moduleFileOf(module.path, module.bytes);
    if (typeof file === 'string') return invalid(file);
    parsed.push({ path: module.path, file });
  }
  // Duplicate ids are refused by `validateAdoptedArchitecture` below like every other structural fault; the
  // conflict verdict adds only what it alone says: a dangling reference names the missing target id (ruling 1).
  const dangling = knowledgeConflictsOf(modules, scope).filter(entry => entry.kind === 'dangling_reference');
  if (dangling.length > 0) {
    return invalid(dangling.map(entry => `${entry.kind} ${entry.moduleId} (missing): ${entry.paths.join(', ')}`).join('; '));
  }
  const undeclared = parsed.filter(entry => entry.file.contains === undefined).map(entry => entry.path);
  if (undeclared.length > 0 && undeclared.length < parsed.length) {
    return invalid(`either every module file or none carries contains: ${undeclared.sort(compare).join(', ')}`);
  }
  const declared = parsed.length > 0 && undeclared.length === 0;
  const byId = new Map(parsed.map(entry => [entry.file.id, entry.file]));
  const ownIds = [...index.modules, ...index.crossWorkspace.dependsOn.map(edge => edge.from),
    ...index.crossWorkspace.contains.map(edge => edge.parent)];
  const unknown = ownIds.find(id => !byId.has(id));
  if (unknown !== undefined) return invalid(`${ARCHITECTURE_FILE_PATH}: the module ${unknown} has no module file`);
  const reached = new Set<string>();
  const queue = [...index.modules];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    queue.push(...(byId.get(id)?.contains ?? []));
  }
  const unreached = parsed.filter(entry => !reached.has(entry.file.id)).map(entry => entry.path);
  if (unreached.length > 0) {
    return invalid(`not reachable from the roots of ${ARCHITECTURE_FILE_PATH}: ${unreached.sort(compare).join(', ')}`);
  }
  const ref = (id: string): ModuleRef => ({ projectId, moduleId: id });
  const checked = validateAdoptedArchitecture({
    modules: parsed.map(({ file }) => ({ ref: ref(file.id), name: file.name, responsibility: file.responsibility,
      paths: file.paths, interfaces: file.interfaces })),
    dependencies: parsed.flatMap(({ file }) => file.dependsOn.map(edge => ({ from: ref(file.id), to: ref(edge.to),
      reason: edge.reason }))),
    requireDag: true,
    ...(declared ? { containment: { parentOf: parsed.flatMap(({ file }) => (file.contains ?? [])
      .map(child => ({ parent: ref(file.id), child: ref(child) }))) } } : {}),
  }, projectId);
  const allPaths = [ARCHITECTURE_FILE_PATH, ...parsed.map(entry => entry.path).sort(compare)].join(', ');
  if (checked.status !== 'ok') return invalid(`${checked.reason}: ${allPaths}`);
  try {
    const viewRef = (id: string): ModuleRef => ref(projectModuleId(workspaceId, id, mainWorkspaceId));
    const fileRef = (id: string): ModuleRef => ref(projectModuleIdOfFile(id, workspaceId, mainWorkspaceId));
    const viewPath = (path: string): string => projectPathOfFile(path, workspaceId, mainWorkspaceId);
    const raw = checked.value;
    const catalog = inModuleIdOrder({
      modules: raw.modules.map(module => ({ ref: viewRef(module.ref.moduleId), name: module.name,
        responsibility: module.responsibility, paths: module.paths.map(viewPath),
        interfaces: module.interfaces.map(entry => ({ id: entry.id, description: entry.description,
          paths: entry.paths.map(viewPath) })) })),
      dependencies: raw.dependencies.map(edge => ({ from: viewRef(edge.from.moduleId), to: viewRef(edge.to.moduleId),
        reason: edge.reason })),
      requireDag: true,
      ...(raw.containment === undefined ? {} : { containment: { parentOf: raw.containment.parentOf
        .map(edge => ({ parent: viewRef(edge.parent.moduleId), child: viewRef(edge.child.moduleId) })) } }),
    });
    const baseline = index.baseline === undefined ? null : {
      description: index.baseline.description, constraints: index.baseline.constraints,
      ...(index.baseline.dependencyRules === undefined ? {} : { dependencyRules: index.baseline.dependencyRules
        .map(rule => ({ ...rule, fromModule: fileRef(rule.fromModule).moduleId, toModule: fileRef(rule.toModule).moduleId })) }),
    };
    return { status: 'decoded', value: {
      catalog,
      crossWorkspace: {
        dependencies: index.crossWorkspace.dependsOn.map(edge => ({ from: viewRef(edge.from), to: fileRef(edge.to),
          reason: edge.reason })).sort(byEnds),
        parentOf: index.crossWorkspace.contains.map(edge => ({ parent: viewRef(edge.parent), child: fileRef(edge.child) }))
          .sort(byPair),
      },
      baseline,
    } };
  } catch (error) {
    return invalid(`a reference cannot be read in the file frame (${messageOf(error)}): ${allPaths}`);
  }
}
