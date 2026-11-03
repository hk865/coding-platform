/**
 * 8C G1 repair op engine.
 *
 * This is the one pure parse/trial path: the note write, the catalog revision
 * planner and the structural proposal all call it. It never reads a catalog or
 * a baseline, never commits and never checks the footprint.
 */
import type { AdoptedArchitecture, CatalogInterfaceV1, ModuleDefinition } from '../../../contracts/architecture-catalog.js';
import type { ModuleRef } from '../../../contracts/core/identity.js';
import type { GoalAutonomyV1 } from '../../../contracts/goal-decisions.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { CatalogRepairOpV1, NoteBodyV1, ResponsibilityMoveV1 } from '../../../contracts/note.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import { checkWorkLinkRef } from '../persistence/decision-record-codecs.js';
import { exactKeys, safeMappingPath } from './architecture-service.js';
import type { ArchitectureBaselineContentV1 } from './catalog-contracts.js';
import type { AdoptedArchitectureValidation } from './catalog-record-codecs.js';
import { readModuleRef, validateAdoptedArchitecture } from './catalog-record-codecs.js';

export type RepairProblemV1 = { status: 'invalid'; reason: string; detail: string };

type DependencyRules = NonNullable<ArchitectureBaselineContentV1['dependencyRules']>;
type RepairOpsResult = { ok: true; ops: CatalogRepairOpV1[] } | { ok: false; problem: RepairProblemV1 };
type RepairApplyResult =
  | { ok: true; catalog: AdoptedArchitecture; rules: DependencyRules }
  | { ok: false; problem: RepairProblemV1 };

const MAX_OPS = 20;
const MODULE_KEYS = ['ref', 'name', 'responsibility', 'paths', 'interfaces'] as const;
const INTERFACE_KEYS = ['id', 'description', 'paths'] as const;

function problem(reason: string, detail: string): RepairProblemV1 {
  return { status: 'invalid', reason, detail };
}
/** Shape refusals are `invalid`; the named reasons cover the domain refusals. */
function invalidOp(detail: string): RepairProblemV1 {
  return problem('invalid_op', detail);
}
function noopOp(detail: string): RepairProblemV1 {
  return problem('noop_op', detail);
}
function unknownModule(detail: string): RepairProblemV1 {
  return problem('unknown_module', detail);
}
function moduleHasEdges(detail: string): RepairProblemV1 {
  return problem('module_has_edges', detail);
}
function unknownInterface(detail: string): RepairProblemV1 {
  return problem('unknown_interface', detail);
}
function validationProblem(validation: Exclude<AdoptedArchitectureValidation, { status: 'ok' }>,
  detail?: string): RepairProblemV1 {
  // A module of another project is not a module of this project's trial catalog.
  const reason = validation.code === 'forbidden' ? 'unknown_module' : 'invalid_op';
  return problem(reason, detail === undefined ? validation.reason : `${detail}: ${validation.reason}`);
}

function parseInterface(value: unknown): CatalogInterfaceV1 | null {
  if (!isRecord(value) || !exactKeys(value, INTERFACE_KEYS)) return null;
  if (!nonEmpty(value['id']) || !nonEmpty(value['description'])) return null;
  const paths = value['paths'];
  if (!Array.isArray(paths) || !paths.every(nonEmpty)) return null;
  return { id: value['id'], description: value['description'], paths: [...paths] };
}

function parseModule(value: unknown): ModuleDefinition | null {
  if (!isRecord(value) || !exactKeys(value, MODULE_KEYS)) return null;
  const ref = readModuleRef(value['ref']);
  if (ref === null) return null;
  if (!nonEmpty(value['name']) || !nonEmpty(value['responsibility'])) return null;
  const paths = value['paths'];
  if (!Array.isArray(paths) || !paths.every(nonEmpty)) return null;
  const rawInterfaces = value['interfaces'];
  if (!Array.isArray(rawInterfaces)) return null;
  const interfaces: ModuleDefinition['interfaces'] = [];
  for (const raw of rawInterfaces) {
    const parsed = parseInterface(raw);
    if (parsed === null) return null;
    interfaces.push(parsed);
  }
  return { ref, name: value['name'], responsibility: value['responsibility'], paths: [...paths], interfaces };
}

function parseOp(value: unknown, at: string): { op: CatalogRepairOpV1 } | { problem: RepairProblemV1 } {
  if (!isRecord(value) || typeof value['op'] !== 'string') return { problem: invalidOp(`${at}.op is required`) };
  const op = value['op'];
  const badField = (detail: string) => ({ problem: invalidOp(`${at}.${detail}`) });
  switch (op) {
    case 'set_responsibility':
      if (!exactKeys(value, ['op', 'moduleId', 'text'])) return badField('must carry exactly op, moduleId and text');
      if (!nonEmpty(value['moduleId']) || !nonEmpty(value['text'])) return badField('moduleId and text must be non-empty strings');
      return { op: { op, moduleId: value['moduleId'], text: value['text'] } };
    case 'set_module_name':
      if (!exactKeys(value, ['op', 'moduleId', 'name'])) return badField('must carry exactly op, moduleId and name');
      if (!nonEmpty(value['moduleId']) || !nonEmpty(value['name'])) return badField('moduleId and name must be non-empty strings');
      return { op: { op, moduleId: value['moduleId'], name: value['name'] } };
    case 'add_path':
    case 'remove_path':
      if (!exactKeys(value, ['op', 'moduleId', 'path'])) return badField(`must carry exactly op, moduleId and path`);
      if (!nonEmpty(value['moduleId']) || !safeMappingPath(value['path'])) return badField('moduleId and path must name a module and a relative path');
      return { op: { op, moduleId: value['moduleId'], path: value['path'] } };
    case 'add_interface': {
      if (!exactKeys(value, ['op', 'moduleId', 'interface'])) return badField('must carry exactly op, moduleId and interface');
      if (!nonEmpty(value['moduleId'])) return badField('moduleId must be a non-empty string');
      const parsed = parseInterface(value['interface']);
      if (parsed === null) return badField('interface must carry exactly id, description and paths');
      return { op: { op, moduleId: value['moduleId'], interface: parsed } };
    }
    case 'set_interface': {
      if (!isRecord(value) || !Object.keys(value).every(key => ['op', 'moduleId', 'interfaceId', 'description', 'paths'].includes(key))) {
        return badField('must carry exactly op, moduleId, interfaceId and at least one of description and paths');
      }
      if (!nonEmpty(value['moduleId']) || !nonEmpty(value['interfaceId'])) return badField('moduleId and interfaceId must be non-empty strings');
      if (!('description' in value) && !('paths' in value)) return badField('needs description or paths');
      if ('description' in value && !nonEmpty(value['description'])) return badField('description must be a non-empty string');
      if ('paths' in value && (!Array.isArray(value['paths']) || !value['paths'].every(nonEmpty))) {
        return badField('paths must be non-empty strings');
      }
      const opValue: Extract<CatalogRepairOpV1, { op: 'set_interface' }> = {
        op, moduleId: value['moduleId'], interfaceId: value['interfaceId'] };
      if ('description' in value) opValue.description = value['description'] as string;
      if ('paths' in value) opValue.paths = [...(value['paths'] as string[])];
      return { op: opValue };
    }
    case 'remove_interface':
      if (!exactKeys(value, ['op', 'moduleId', 'interfaceId'])) return badField('must carry exactly op, moduleId and interfaceId');
      if (!nonEmpty(value['moduleId']) || !nonEmpty(value['interfaceId'])) return badField('moduleId and interfaceId must be non-empty strings');
      return { op: { op, moduleId: value['moduleId'], interfaceId: value['interfaceId'] } };
    case 'set_dependency_reason': {
      if (!exactKeys(value, ['op', 'from', 'to', 'reason'])) return badField('must carry exactly op, from, to and reason');
      const from = readModuleRef(value['from']);
      const to = readModuleRef(value['to']);
      if (from === null || to === null) return badField('from and to must be module refs');
      if (!nonEmpty(value['reason'])) return badField('reason must be a non-empty string');
      return { op: { op, from, to, reason: value['reason'] } };
    }
    case 'add_module': {
      if (!exactKeys(value, ['op', 'module'])) return badField('must carry exactly op and module');
      const module = parseModule(value['module']);
      if (module === null) return badField('module must carry exactly ref, name, responsibility, paths and interfaces');
      return { op: { op, module } };
    }
    case 'remove_module':
      if (!exactKeys(value, ['op', 'moduleId'])) return badField('must carry exactly op and moduleId');
      if (!nonEmpty(value['moduleId'])) return badField('moduleId must be a non-empty string');
      return { op: { op, moduleId: value['moduleId'] } };
    case 'add_dependency': {
      if (!exactKeys(value, ['op', 'from', 'to', 'reason'])) return badField('must carry exactly op, from, to and reason');
      const from = readModuleRef(value['from']);
      const to = readModuleRef(value['to']);
      if (from === null || to === null) return badField('from and to must be module refs');
      if (!nonEmpty(value['reason'])) return badField('reason must be a non-empty string');
      return { op: { op, from, to, reason: value['reason'] } };
    }
    case 'remove_dependency': {
      if (!exactKeys(value, ['op', 'from', 'to'])) return badField('must carry exactly op, from and to');
      const from = readModuleRef(value['from']);
      const to = readModuleRef(value['to']);
      if (from === null || to === null) return badField('from and to must be module refs');
      return { op: { op, from, to } };
    }
    case 'add_forbid_rule': {
      if (!exactKeys(value, ['op', 'from', 'to', 'reason'])) return badField('must carry exactly op, from, to and reason');
      const from = readModuleRef(value['from']);
      const to = readModuleRef(value['to']);
      if (from === null || to === null) return badField('from and to must be module refs');
      if (!nonEmpty(value['reason'])) return badField('reason must be a non-empty string');
      return { op: { op, from, to, reason: value['reason'] } };
    }
    case 'remove_forbid_rule': {
      if (!exactKeys(value, ['op', 'from', 'to'])) return badField('must carry exactly op, from and to');
      const from = readModuleRef(value['from']);
      const to = readModuleRef(value['to']);
      if (from === null || to === null) return badField('from and to must be module refs');
      return { op: { op, from, to } };
    }
    case 'set_parent':
      if (!exactKeys(value, ['op', 'moduleId', 'parentId'])) return badField('must carry exactly op, moduleId and parentId');
      if (!nonEmpty(value['moduleId'])) return badField('moduleId must be a non-empty string');
      if (value['parentId'] !== null && !nonEmpty(value['parentId'])) return badField('parentId must be a non-empty string or null');
      return { op: { op, moduleId: value['moduleId'], parentId: value['parentId'] } };
    default:
      return badField(`op ${op} is not a repair op`);
  }
}

/**
 * Exact keys, array shape and the 1–20 bound. Existence and no-change rules
 * need the ordered trial state and live in `applyRepairOps`.
 */
export function parseRepairOps(raw: unknown): RepairOpsResult {
  if (!Array.isArray(raw)) return { ok: false, problem: invalidOp('ops must be an array') };
  if (raw.length === 0) return { ok: false, problem: noopOp('ops must contain at least one op') };
  if (raw.length > MAX_OPS) return { ok: false, problem: invalidOp(`ops carries ${String(raw.length)} entries; the maximum is ${String(MAX_OPS)}`) };
  const ops: CatalogRepairOpV1[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    const parsed = parseOp(entry, `ops[${String(index)}]`);
    if ('problem' in parsed) return { ok: false, problem: parsed.problem };
    const key = canonicalJson(parsed.op as unknown as JsonValue);
    if (seen.has(key)) return { ok: false, problem: noopOp(`ops[${String(index)}] duplicates an earlier op`) };
    seen.add(key);
    ops.push(parsed.op);
  }
  return { ok: true, ops };
}

function findModule(catalog: AdoptedArchitecture, moduleId: string): ModuleDefinition | undefined {
  return catalog.modules.find(module => module.ref.moduleId === moduleId);
}

function findRef(catalog: AdoptedArchitecture, ref: ModuleRef, projectId: string): ModuleDefinition | RepairProblemV1 {
  if (ref.projectId !== projectId) return unknownModule(`module ${ref.projectId}/${ref.moduleId} belongs to another project`);
  const module = findModule(catalog, ref.moduleId);
  return module ?? unknownModule(`module ${ref.moduleId} is not in the trial catalog`);
}

function dependencyIndex(catalog: AdoptedArchitecture, from: ModuleRef, to: ModuleRef): number {
  return catalog.dependencies.findIndex(dependency => dependency.from.moduleId === from.moduleId
    && dependency.to.moduleId === to.moduleId);
}

function ruleIndex(rules: DependencyRules, from: ModuleRef, to: ModuleRef): number {
  return rules.findIndex(rule => rule.fromModule === from.moduleId && rule.toModule === to.moduleId);
}

function setSamePaths(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

function applyOp(catalog: AdoptedArchitecture, rules: DependencyRules, op: CatalogRepairOpV1,
  projectId: string, at: string): RepairProblemV1 | null {
  switch (op.op) {
    case 'set_responsibility': {
      const module = findModule(catalog, op.moduleId);
      if (module === undefined) return unknownModule(`${at}: module ${op.moduleId} is not in the trial catalog`);
      if (module.responsibility === op.text) return noopOp(`${at}: responsibility is unchanged`);
      module.responsibility = op.text;
      return null;
    }
    case 'set_module_name': {
      const module = findModule(catalog, op.moduleId);
      if (module === undefined) return unknownModule(`${at}: module ${op.moduleId} is not in the trial catalog`);
      if (module.name === op.name) return noopOp(`${at}: module name is unchanged`);
      module.name = op.name;
      return null;
    }
    case 'add_path': {
      // The final catalog validator checks only that paths are non-empty strings,
      // so the footprint rule for an added path is checked here as well.
      if (!safeMappingPath(op.path)) return invalidOp(`${at}: path must be a relative path`);
      const module = findModule(catalog, op.moduleId);
      if (module === undefined) return unknownModule(`${at}: module ${op.moduleId} is not in the trial catalog`);
      if (module.paths.includes(op.path)) return noopOp(`${at}: path ${op.path} is already declared`);
      module.paths.push(op.path);
      return null;
    }
    case 'remove_path': {
      const module = findModule(catalog, op.moduleId);
      if (module === undefined) return unknownModule(`${at}: module ${op.moduleId} is not in the trial catalog`);
      const index = module.paths.indexOf(op.path);
      if (index < 0) return noopOp(`${at}: path ${op.path} is not declared`);
      module.paths.splice(index, 1);
      return null;
    }
    case 'add_interface': {
      const module = findModule(catalog, op.moduleId);
      if (module === undefined) return unknownModule(`${at}: module ${op.moduleId} is not in the trial catalog`);
      if (module.interfaces.some(entry => entry.id === op.interface.id)) {
        return noopOp(`${at}: interface ${op.interface.id} already exists; use set_interface`);
      }
      module.interfaces.push(structuredClone(op.interface));
      return null;
    }
    case 'set_interface': {
      const module = findModule(catalog, op.moduleId);
      if (module === undefined) return unknownModule(`${at}: module ${op.moduleId} is not in the trial catalog`);
      const entry = module.interfaces.find(candidate => candidate.id === op.interfaceId);
      if (entry === undefined) return unknownInterface(`${at}: interface ${op.interfaceId} is not in module ${op.moduleId}`);
      const description = op.description ?? entry.description;
      const paths = op.paths ?? entry.paths;
      if (description === entry.description && setSamePaths(paths, entry.paths)) return noopOp(`${at}: interface is unchanged`);
      entry.description = description;
      entry.paths = [...paths];
      return null;
    }
    case 'remove_interface': {
      const module = findModule(catalog, op.moduleId);
      if (module === undefined) return unknownModule(`${at}: module ${op.moduleId} is not in the trial catalog`);
      const index = module.interfaces.findIndex(candidate => candidate.id === op.interfaceId);
      if (index < 0) return unknownInterface(`${at}: interface ${op.interfaceId} is not in module ${op.moduleId}`);
      module.interfaces.splice(index, 1);
      return null;
    }
    case 'set_dependency_reason': {
      const from = findRef(catalog, op.from, projectId);
      if ('status' in from) return from;
      const to = findRef(catalog, op.to, projectId);
      if ('status' in to) return to;
      const index = dependencyIndex(catalog, op.from, op.to);
      if (index < 0) return noopOp(`${at}: dependency ${op.from.moduleId}->${op.to.moduleId} is not declared`);
      if (catalog.dependencies[index]!.reason === op.reason) return noopOp(`${at}: dependency reason is unchanged`);
      catalog.dependencies[index]!.reason = op.reason;
      return null;
    }
    case 'add_module': {
      if (findModule(catalog, op.module.ref.moduleId) !== undefined) return noopOp(`${at}: module ${op.module.ref.moduleId} already exists`);
      const checked = validateAdoptedArchitecture({ modules: [op.module], dependencies: [], requireDag: true }, projectId);
      if (checked.status !== 'ok') return validationProblem(checked, `${at}: module ${op.module.ref.moduleId}`);
      catalog.modules.push(checked.value.modules[0]!);
      return null;
    }
    case 'remove_module': {
      if (findModule(catalog, op.moduleId) === undefined) return unknownModule(`${at}: module ${op.moduleId} is not in the trial catalog`);
      // A dependency or forbid rule that still touches this module, or a
      // containment edge whose parent is this module, must be cleared by an op
      // before the removal. An incoming containment edge is the exception:
      // removing the child clears it.
      const hasDependency = catalog.dependencies.some(dependency =>
        dependency.from.moduleId === op.moduleId || dependency.to.moduleId === op.moduleId);
      const hasForbid = rules.some(rule =>
        rule.fromModule === op.moduleId || rule.toModule === op.moduleId);
      const hasChild = (catalog.containment?.parentOf ?? []).some(relation => relation.parent.moduleId === op.moduleId);
      if (hasDependency || hasForbid || hasChild) {
        return moduleHasEdges(`${at}: module ${op.moduleId} still has dependency, forbid or containment edges`);
      }
      catalog.modules = catalog.modules.filter(module => module.ref.moduleId !== op.moduleId);
      if (catalog.containment !== undefined) {
        catalog.containment.parentOf = catalog.containment.parentOf
          .filter(relation => relation.child.moduleId !== op.moduleId);
      }
      return null;
    }
    case 'add_dependency': {
      const from = findRef(catalog, op.from, projectId);
      if ('status' in from) return from;
      const to = findRef(catalog, op.to, projectId);
      if ('status' in to) return to;
      if (dependencyIndex(catalog, op.from, op.to) >= 0) return noopOp(`${at}: dependency ${op.from.moduleId}->${op.to.moduleId} already exists`);
      catalog.dependencies.push({ from: from.ref, to: to.ref, reason: op.reason });
      return null;
    }
    case 'remove_dependency': {
      const from = findRef(catalog, op.from, projectId);
      if ('status' in from) return from;
      const to = findRef(catalog, op.to, projectId);
      if ('status' in to) return to;
      const index = dependencyIndex(catalog, op.from, op.to);
      if (index < 0) return noopOp(`${at}: dependency ${op.from.moduleId}->${op.to.moduleId} is not declared`);
      catalog.dependencies.splice(index, 1);
      return null;
    }
    case 'add_forbid_rule': {
      const from = findRef(catalog, op.from, projectId);
      if ('status' in from) return from;
      const to = findRef(catalog, op.to, projectId);
      if ('status' in to) return to;
      if (ruleIndex(rules, op.from, op.to) >= 0) return noopOp(`${at}: forbid rule ${op.from.moduleId}->${op.to.moduleId} already exists`);
      // The baseline shape has no reason field; the endpoint key is the rule identity.
      rules.push({ ruleId: canonicalJson([from.ref.moduleId, to.ref.moduleId] as unknown as JsonValue),
        kind: 'forbid_dependency', fromModule: from.ref.moduleId, toModule: to.ref.moduleId });
      return null;
    }
    case 'remove_forbid_rule': {
      const from = findRef(catalog, op.from, projectId);
      if ('status' in from) return from;
      const to = findRef(catalog, op.to, projectId);
      if ('status' in to) return to;
      const index = ruleIndex(rules, op.from, op.to);
      if (index < 0) return noopOp(`${at}: forbid rule ${op.from.moduleId}->${op.to.moduleId} is not declared`);
      rules.splice(index, 1);
      return null;
    }
    case 'set_parent': {
      const module = findModule(catalog, op.moduleId);
      if (module === undefined) return unknownModule(`${at}: module ${op.moduleId} is not in the trial catalog`);
      const parentOf = catalog.containment?.parentOf ?? [];
      const index = parentOf.findIndex(relation => relation.child.moduleId === op.moduleId);
      if (op.parentId === null) {
        if (index < 0) return noopOp(`${at}: module ${op.moduleId} has no declared parent`);
        parentOf.splice(index, 1);
        if (catalog.containment !== undefined) catalog.containment.parentOf = parentOf;
        return null;
      }
      if (op.parentId === op.moduleId) return invalidOp(`${at}: a module cannot be its own parent`);
      const parent = findModule(catalog, op.parentId);
      if (parent === undefined) return unknownModule(`${at}: parent ${op.parentId} is not in the trial catalog`);
      if (index >= 0 && parentOf[index]!.parent.moduleId === op.parentId) return noopOp(`${at}: module ${op.moduleId} already has that parent`);
      if (index >= 0) parentOf[index] = { parent: parent.ref, child: module.ref };
      else parentOf.push({ parent: parent.ref, child: module.ref });
      catalog.containment = { parentOf };
      return null;
    }
    default:
      return invalidOp(`${at}: op is not a repair op`);
  }
}

/**
 * Applies the ops in array order to a clone of the pinned catalog and the
 * pinned baseline's dependency rules, then runs the one module/graph validator
 * on the final catalog (with its `requireDag: true`) and the `(from, to)` rule
 * checks. `projectId` is the pin's project: an empty catalog cannot name it.
 */
export function applyRepairOps(
  catalog: AdoptedArchitecture,
  rules: DependencyRules,
  ops: CatalogRepairOpV1[],
  projectId: string,
): RepairApplyResult {
  if (ops.length === 0) return { ok: false, problem: noopOp('ops must contain at least one op') };
  if (ops.length > MAX_OPS) {
    return { ok: false, problem: invalidOp(`ops carries ${String(ops.length)} entries; the maximum is ${String(MAX_OPS)}`) };
  }
  const working = structuredClone(catalog);
  const workingRules = structuredClone(rules);
  for (const [index, op] of ops.entries()) {
    const failure = applyOp(working, workingRules, op, projectId, `ops[${String(index)}]`);
    if (failure !== null) return { ok: false, problem: failure };
  }
  const checked = validateAdoptedArchitecture(working, projectId);
  if (checked.status !== 'ok') return { ok: false, problem: validationProblem(checked) };
  const declared = new Set(checked.value.modules.map(module => module.ref.moduleId));
  const ruleKeys = new Set<string>();
  for (const rule of workingRules) {
    if (!declared.has(rule.fromModule) || !declared.has(rule.toModule)) {
      return { ok: false, problem: unknownModule(`forbid rule ${rule.fromModule}->${rule.toModule} names an undeclared module`) };
    }
    const key = canonicalJson([rule.fromModule, rule.toModule] as unknown as JsonValue);
    if (ruleKeys.has(key)) return { ok: false, problem: noopOp(`duplicate forbid rule ${rule.fromModule}->${rule.toModule}`) };
    ruleKeys.add(key);
  }
  return { ok: true, catalog: checked.value, rules: workingRules };
}

/**
 * The one responsibility-move shape check: exact per-move keys, one source link
 * at most once, non-empty de-duplicated destinations of this project, and every
 * destination present in the trial catalog when the caller names one. The note
 * write's staged refusal and the planner's live integrity check share it; source
 * openness and completeness stay with those callers.
 */
export function catalogRevisionMovesProblem(moves: readonly ResponsibilityMoveV1[], projectId: string,
  trialModules: ReadonlySet<string> | null): string | null {
  if (!Array.isArray(moves)) return 'the responsibilityMoves must be an array';
  const sources = new Set<string>();
  for (const [index, move] of moves.entries()) {
    const at = `responsibilityMoves[${String(index)}]`;
    if (!isRecord(move) || !exactKeys(move, ['link', 'to'])) return `${at} carries exactly link and to`;
    const link = move['link'];
    if (!isRecord(link) || checkWorkLinkRef(link) !== null) return `${at}.link is not a session work link`;
    if (link['projectId'] !== projectId) return `${at}.link names another project`;
    const sourceKey = canonicalJson(link as unknown as JsonValue);
    if (sources.has(sourceKey)) return 'duplicate_responsibility_move';
    sources.add(sourceKey);
    const to = move['to'];
    if (!isRecord(to) || typeof to['kind'] !== 'string') return `${at}.to is invalid`;
    if (to['kind'] === 'standby') {
      if (!exactKeys(to, ['kind'])) return `${at}.to carries only kind for standby`;
      continue;
    }
    if (to['kind'] !== 'modules' || !exactKeys(to, ['kind', 'destinations'])) return `${at}.to is neither standby nor modules`;
    const destinations = to['destinations'];
    if (!Array.isArray(destinations) || destinations.length === 0) {
      return 'responsibility_destination_missing';
    }
    const seen = new Set<string>();
    for (const rawDestination of destinations) {
      const destination = readModuleRef(rawDestination);
      if (destination === null || destination.projectId !== projectId) {
        return `${at} has an invalid destination module ref`;
      }
      const key = canonicalJson(destination as unknown as JsonValue);
      if (seen.has(key)) return 'noop_op';
      seen.add(key);
      if (trialModules !== null && !trialModules.has(destination.moduleId)) return 'responsibility_destination_missing';
    }
  }
  return null;
}

const STRUCTURAL_OPS: ReadonlySet<CatalogRepairOpV1['op']> = new Set([
  'add_module', 'remove_module', 'add_dependency', 'remove_dependency',
  'add_forbid_rule', 'remove_forbid_rule', 'set_parent',
]);

/** Structural is exactly the add/remove module, dependency, forbid and parent rows. */
export function structuralOfRepair(ops: readonly CatalogRepairOpV1[]): boolean {
  return ops.some(op => STRUCTURAL_OPS.has(op.op));
}

/** Structural, a rename, every-step autonomy or an unknown footprint needs the card. */
export function repairNeedsCard(input: {
  structural: boolean; rename: boolean; autonomy: GoalAutonomyV1; footprintUnknown: boolean;
}): boolean {
  return input.structural || input.rename || input.autonomy === 'every_step' || input.footprintUnknown;
}

/** Canonical-JSON digest of the whole stored body, including `repair`. */
export function repairBindingDigest(body: NoteBodyV1): string {
  return sha256Hex(canonicalJson(body as unknown as JsonValue));
}
