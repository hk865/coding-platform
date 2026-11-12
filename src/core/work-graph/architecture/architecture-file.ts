/**
 * The architecture files of one line: a key-sorted,
 * indented `architecture.json` and one `modules/<fileId>.json` per module of
 * this line's workspace. Pure: the composition root reads and writes the bytes.
 *
 * Ids in a module file are the raw ids of its own workspace (`id`, `contains`,
 * `dependsOn`). Paths and every reference to another workspace are written in
 * the file frame (the file's workspace is the main one). An edge belongs to the
 * workspace of its `from`/`parent`, so a cross-workspace edge sits in that
 * workspace's `architecture.json`; the baseline fields sit only in the main
 * workspace's. A read-back validates the raw catalog with the catalog's own
 * validator before it turns into the project view, and any bad file, duplicate
 * id or dangling reference makes the whole read invalid: never half a catalog.
 */
import type { ModuleRef } from '../../../contracts/core/identity.js';
import { ARCHITECTURE_FILE_PATH, type KnowledgeConflictV1 } from '../../../contracts/knowledge.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { isSafeProjectPath } from '../../../contracts/workspace-path.js';
import { messageOf } from '../../../contracts/error-message.js';
import { hasOnlyKeys, isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import {
  fileModuleId, fileProjectPath, projectModuleId, projectModuleIdOfFile, projectPathOfFile, rawModuleId,
} from '../../../contracts/workspace-module-id.js';
import type { DecodeResult } from '../../record-store/ports.js';
import type { KnowledgeArchitecture, KnowledgeBaselineV1, KnowledgeLineScope } from '../model/line-knowledge.js';
import type { AdoptedArchitecture } from './catalog-contracts.js';
import { readArchitectureBaselineContent, validateAdoptedArchitecture } from './catalog-record-codecs.js';


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
  if (!keysAre(value, ['modules', 'crossWorkspace'], main ? ['baseline'] : [])) {
    return `${where}: the architecture file carries exactly modules, crossWorkspace${main ? ' and an optional baseline' : ''}`;
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
  if (value['baseline'] === undefined) return { modules, crossWorkspace: { dependsOn, contains } };
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
 * One line's architecture files from the whole project view: this workspace's
 * modules (`moduleId` is the raw id written in the file) and its
 * `architecture.json`. `invalid` when a reference cannot be written in the
 * file frame, or a module or interface path is not one the read-back takes
 * (`isCatalogPath`, stack review 3).
 */
export function architectureFilesOf(project: AdoptedArchitecture, baseline: KnowledgeBaselineV1,
  scope: KnowledgeLineScope): DecodeResult<{ architecture: Uint8Array; modules: readonly { moduleId: string; bytes: Uint8Array }[] }> {
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
    return { status: 'decoded', value: { architecture: encoder.encode(prettyJson(architecture)), modules: files } };
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
