/**
 * 8C C1: the pure repair contract and op engine.
 *
 * The row calls only the five frozen pure entries; no store, platform, Host,
 * Workflow, Runtime or stub port. Expected values are the frozen repair rules
 * and a hand-computed canonical digest.
 */
import { describe, expect, it } from 'vitest';
import type { AdoptedArchitecture, ArchitectureCatalogPinV1, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { ModuleRef } from '../../src/contracts/core/identity.js';
import type { CatalogRepairOpV1, NoteBodyV1, RepairPayloadV1, ResponsibilityMoveV1 } from '../../src/contracts/note.js';
import { applyRepairOps, parseRepairOps, repairBindingDigest, repairNeedsCard, structuralOfRepair }
  from '../../src/core/work-graph/architecture/repair-ops.js';

const P = 'p1';
const ref = (moduleId: string): ModuleRef => ({ projectId: P, moduleId });
const moduleOf = (moduleId: string, overrides: Partial<ModuleDefinition> = {}): ModuleDefinition => ({
  ref: ref(moduleId), name: moduleId.toUpperCase(), responsibility: `${moduleId} responsibility`,
  paths: [`src/${moduleId}`], interfaces: [], ...overrides,
});
const IFACE = { id: 'i1', description: 'i1 description', paths: ['src/m1/i1'] };

const BASE: AdoptedArchitecture = {
  requireDag: true,
  dependencies: [],
  modules: [
    moduleOf('m1', { interfaces: [{ ...IFACE }] }),
    moduleOf('m2'),
  ],
};
const LINKED: AdoptedArchitecture = {
  ...structuredClone(BASE),
  dependencies: [{ from: ref('m2'), to: ref('m1'), reason: 'm2 reads m1' }],
  containment: { parentOf: [{ parent: ref('m1'), child: ref('m2') }] },
};
type Rules = { ruleId: string; kind: 'forbid_dependency'; fromModule: string; toModule: string }[];
const NO_RULES: Rules = [];
const LINKED_RULES: Rules = [{ ruleId: 'r1', kind: 'forbid_dependency', fromModule: 'm1', toModule: 'm2' }];
const EMPTY: AdoptedArchitecture = { requireDag: true, modules: [], dependencies: [] };
const clone = <T>(value: T): T => structuredClone(value);

const SET_RESPONSIBILITY: CatalogRepairOpV1 = { op: 'set_responsibility', moduleId: 'm1', text: 'm1 repaired' };
const SET_MODULE_NAME: CatalogRepairOpV1 = { op: 'set_module_name', moduleId: 'm1', name: 'M1 renamed' };
const ADD_PATH: CatalogRepairOpV1 = { op: 'add_path', moduleId: 'm1', path: 'src/m1/extra' };
const REMOVE_PATH: CatalogRepairOpV1 = { op: 'remove_path', moduleId: 'm1', path: 'src/m1' };
const ADD_INTERFACE: CatalogRepairOpV1 = { op: 'add_interface', moduleId: 'm1',
  interface: { id: 'i2', description: 'i2 description', paths: ['src/m1/i2'] } };
const SET_INTERFACE: CatalogRepairOpV1 = { op: 'set_interface', moduleId: 'm1', interfaceId: 'i1', description: 'changed' };
const REMOVE_INTERFACE: CatalogRepairOpV1 = { op: 'remove_interface', moduleId: 'm1', interfaceId: 'i1' };
const SET_DEPENDENCY_REASON: CatalogRepairOpV1 = { op: 'set_dependency_reason', from: ref('m2'), to: ref('m1'), reason: 'changed' };
const ADD_MODULE: CatalogRepairOpV1 = { op: 'add_module', module: moduleOf('m3') };
const REMOVE_MODULE: CatalogRepairOpV1 = { op: 'remove_module', moduleId: 'm2' };
const ADD_DEPENDENCY: CatalogRepairOpV1 = { op: 'add_dependency', from: ref('m2'), to: ref('m1'), reason: 'new edge' };
const REMOVE_DEPENDENCY: CatalogRepairOpV1 = { op: 'remove_dependency', from: ref('m2'), to: ref('m1') };
const ADD_FORBID_RULE: CatalogRepairOpV1 = { op: 'add_forbid_rule', from: ref('m1'), to: ref('m2'), reason: 'no m2' };
const REMOVE_FORBID_RULE: CatalogRepairOpV1 = { op: 'remove_forbid_rule', from: ref('m1'), to: ref('m2') };
const SET_PARENT: CatalogRepairOpV1 = { op: 'set_parent', moduleId: 'm2', parentId: 'm1' };
const SET_RESPONSIBILITY_MODULE_Z: CatalogRepairOpV1 = { op: 'set_responsibility', moduleId: 'mZ', text: 'new' };

const BASE_M1 = moduleOf('m1', { interfaces: [{ ...IFACE }] });
const LINK_PARENT = { parentOf: [{ parent: ref('m1'), child: ref('m2') }] };
/** The hand-computed final catalog: BASE with this row's module change, no edges or rules unless named. */
const finalCatalog = (m1: Partial<ModuleDefinition> = {}, change: Partial<AdoptedArchitecture> = {}): AdoptedArchitecture =>
  ({ requireDag: true, dependencies: [], modules: [{ ...BASE_M1, ...m1 }, moduleOf('m2')], ...change });
type RepairCase = { name: string; catalog: AdoptedArchitecture; rules: Rules; ops: CatalogRepairOpV1[];
  expectedCatalog: AdoptedArchitecture; expectedRules: Rules };
const REPAIR_TABLE: RepairCase[] = [
  { name: 'set_responsibility', catalog: BASE, rules: NO_RULES, ops: [SET_RESPONSIBILITY],
    expectedCatalog: finalCatalog({ responsibility: 'm1 repaired' }), expectedRules: NO_RULES },
  { name: 'set_module_name', catalog: BASE, rules: NO_RULES, ops: [SET_MODULE_NAME],
    expectedCatalog: finalCatalog({ name: 'M1 renamed' }), expectedRules: NO_RULES },
  { name: 'add_path', catalog: BASE, rules: NO_RULES, ops: [ADD_PATH],
    expectedCatalog: finalCatalog({ paths: ['src/m1', 'src/m1/extra'] }), expectedRules: NO_RULES },
  { name: 'remove_path', catalog: BASE, rules: NO_RULES, ops: [REMOVE_PATH],
    expectedCatalog: finalCatalog({ paths: [] }), expectedRules: NO_RULES },
  { name: 'add_interface', catalog: BASE, rules: NO_RULES, ops: [ADD_INTERFACE],
    expectedCatalog: finalCatalog({ interfaces: [{ ...IFACE },
      { id: 'i2', description: 'i2 description', paths: ['src/m1/i2'] }] }), expectedRules: NO_RULES },
  { name: 'set_interface', catalog: BASE, rules: NO_RULES, ops: [SET_INTERFACE],
    expectedCatalog: finalCatalog({ interfaces: [{ id: 'i1', description: 'changed', paths: ['src/m1/i1'] }] }), expectedRules: NO_RULES },
  { name: 'remove_interface', catalog: BASE, rules: NO_RULES, ops: [REMOVE_INTERFACE],
    expectedCatalog: finalCatalog({ interfaces: [] }), expectedRules: NO_RULES },
  { name: 'set_dependency_reason', catalog: LINKED, rules: LINKED_RULES, ops: [SET_DEPENDENCY_REASON],
    expectedCatalog: finalCatalog({}, { dependencies: [{ from: ref('m2'), to: ref('m1'), reason: 'changed' }],
      containment: LINK_PARENT }), expectedRules: LINKED_RULES },
  { name: 'add_module', catalog: BASE, rules: NO_RULES, ops: [ADD_MODULE],
    expectedCatalog: finalCatalog({}, { modules: [BASE_M1, moduleOf('m2'), moduleOf('m3')] }), expectedRules: NO_RULES },
  { name: 'remove_module and its edges', catalog: LINKED, rules: LINKED_RULES,
    ops: [REMOVE_DEPENDENCY, REMOVE_FORBID_RULE, REMOVE_MODULE],
    expectedCatalog: finalCatalog({}, { modules: [BASE_M1], containment: { parentOf: [] } }), expectedRules: NO_RULES },
  { name: 'add_dependency', catalog: BASE, rules: NO_RULES, ops: [ADD_DEPENDENCY],
    expectedCatalog: finalCatalog({}, { dependencies: [{ from: ref('m2'), to: ref('m1'), reason: 'new edge' }] }),
    expectedRules: NO_RULES },
  { name: 'remove_dependency', catalog: LINKED, rules: LINKED_RULES, ops: [REMOVE_DEPENDENCY], expectedCatalog: finalCatalog({}, { containment: LINK_PARENT }), expectedRules: LINKED_RULES },
  { name: 'add_forbid_rule', catalog: BASE, rules: NO_RULES, ops: [ADD_FORBID_RULE], expectedCatalog: finalCatalog(),
    expectedRules: [{ ruleId: '["m1","m2"]', kind: 'forbid_dependency', fromModule: 'm1', toModule: 'm2' }] },
  { name: 'remove_forbid_rule', catalog: LINKED, rules: LINKED_RULES, ops: [REMOVE_FORBID_RULE],
    expectedCatalog: finalCatalog({}, { dependencies: [{ from: ref('m2'), to: ref('m1'), reason: 'm2 reads m1' }],
      containment: LINK_PARENT }), expectedRules: NO_RULES },
  { name: 'set_parent', catalog: BASE, rules: NO_RULES, ops: [SET_PARENT],
    expectedCatalog: finalCatalog({}, { containment: LINK_PARENT }), expectedRules: NO_RULES },
];
/** One representative op per row (the row's own op type), so each of the 15 shapes keeps its unknown-key refusal. */
const OPS_IN_TABLE = REPAIR_TABLE.map(entry => entry.ops.find(op => entry.name.startsWith(op.op)) ?? entry.ops[0]!);

function withoutKey(op: CatalogRepairOpV1, key: string): unknown {
  const copy = { ...(op as unknown as Record<string, unknown>) };
  delete copy[key];
  return copy;
}

describe('C1 repair op shapes', () => {
  it.each(REPAIR_TABLE)('parses and applies $name', ({ catalog, rules, ops, expectedCatalog, expectedRules }) => {
    const parsed = parseRepairOps(ops);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.ops).toEqual(ops);
    const result = applyRepairOps(clone(catalog), clone(rules), parsed.ops, P);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.catalog).toEqual(expectedCatalog);
    expect(result.rules).toEqual(expectedRules);
  });

  it.each(OPS_IN_TABLE.map(op => ({ name: op.op, op })))('refuses an unknown key on $name', ({ op }) => {
    const raw = { ...(op as unknown as Record<string, unknown>), unknownKey: true };
    expect(parseRepairOps([raw])).toMatchObject({ ok: false, problem: { status: 'invalid' } });
  });

  it.each([
    { name: 'set_responsibility', op: SET_RESPONSIBILITY, field: 'text' },
    { name: 'set_module_name', op: SET_MODULE_NAME, field: 'name' },
    { name: 'add_path', op: ADD_PATH, field: 'path' },
    { name: 'remove_path', op: REMOVE_PATH, field: 'path' },
    { name: 'add_interface', op: ADD_INTERFACE, field: 'interface' },
    { name: 'set_interface', op: SET_INTERFACE, field: 'interfaceId' },
    { name: 'remove_interface', op: REMOVE_INTERFACE, field: 'interfaceId' },
    { name: 'set_dependency_reason', op: SET_DEPENDENCY_REASON, field: 'reason' },
    { name: 'add_module', op: ADD_MODULE, field: 'module' },
    { name: 'remove_module', op: REMOVE_MODULE, field: 'moduleId' },
    { name: 'add_dependency', op: ADD_DEPENDENCY, field: 'reason' },
    { name: 'remove_dependency', op: REMOVE_DEPENDENCY, field: 'to' },
    { name: 'add_forbid_rule', op: ADD_FORBID_RULE, field: 'reason' },
    { name: 'remove_forbid_rule', op: REMOVE_FORBID_RULE, field: 'to' },
    { name: 'set_parent', op: SET_PARENT, field: 'parentId' },
  ])('refuses $name without $field', ({ op, field }) => {
    expect(parseRepairOps([withoutKey(op, field)])).toMatchObject({ ok: false, problem: { status: 'invalid' } });
  });

  it('accepts one op and the 20-op boundary, and refuses 0 and 21', () => {
    const twenty = Array.from({ length: 20 }, (_, index): CatalogRepairOpV1 =>
      ({ op: 'set_responsibility', moduleId: 'm1', text: `text ${String(index)}` }));
    expect(parseRepairOps(twenty.slice(0, 1))).toMatchObject({ ok: true });
    expect(parseRepairOps(twenty)).toMatchObject({ ok: true });
    expect(parseRepairOps([])).toMatchObject({ ok: false, problem: { status: 'invalid', reason: 'noop_op' } });
    expect(parseRepairOps([...twenty, { op: 'set_responsibility', moduleId: 'm1', text: 'extra' }]))
      .toMatchObject({ ok: false, problem: { status: 'invalid' } });
  });
});

describe('C1 array order', () => {
  it('sees a module added earlier in the same array', () => {
    const ops: CatalogRepairOpV1[] = [
      { op: 'add_module', module: moduleOf('m3') },
      { op: 'add_interface', moduleId: 'm3', interface: { id: 'i3', description: 'i3 description', paths: ['src/m3/i3'] } },
      { op: 'set_parent', moduleId: 'm3', parentId: 'm1' },
      { op: 'add_dependency', from: ref('m1'), to: ref('m3'), reason: 'm1 uses m3' },
    ];
    const result = applyRepairOps(clone(BASE), [], ops, P);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.catalog.modules.map(module => module.ref.moduleId)).toEqual(['m1', 'm2', 'm3']);
    expect(result.catalog.containment?.parentOf).toEqual([{ parent: ref('m1'), child: ref('m3') }]);
    expect(result.catalog.dependencies).toEqual([{ from: ref('m1'), to: ref('m3'), reason: 'm1 uses m3' }]);
  });

  it('refuses a change to a module that a later op would add', () => {
    const ops: CatalogRepairOpV1[] = [SET_RESPONSIBILITY_MODULE_Z, { op: 'add_module', module: moduleOf('mZ') }];
    expect(applyRepairOps(clone(BASE), [], ops, P))
      .toMatchObject({ ok: false, problem: { status: 'invalid', reason: 'unknown_module' } });
  });
});

describe('C1 duplicate and no-op refusals', () => {
  it('refuses an exact duplicate op while parsing', () => {
    expect(parseRepairOps([SET_RESPONSIBILITY, SET_RESPONSIBILITY]))
      .toMatchObject({ ok: false, problem: { status: 'invalid', reason: 'noop_op' } });
  });

  it.each([
    ['set_responsibility same text', BASE, NO_RULES, { op: 'set_responsibility', moduleId: 'm1', text: 'm1 responsibility' }],
    ['set_module_name same name', BASE, NO_RULES, { op: 'set_module_name', moduleId: 'm1', name: 'M1' }],
    ['add_path existing path', BASE, NO_RULES, { op: 'add_path', moduleId: 'm1', path: 'src/m1' }],
    ['remove_path absent path', BASE, NO_RULES, { op: 'remove_path', moduleId: 'm1', path: 'src/missing' }],
    ['add_interface existing id', BASE, NO_RULES, { op: 'add_interface', moduleId: 'm1', interface: { ...IFACE } }],
    ['set_interface same description', BASE, NO_RULES, { op: 'set_interface', moduleId: 'm1', interfaceId: 'i1', description: 'i1 description' }],
    ['set_dependency_reason same reason', LINKED, LINKED_RULES, { op: 'set_dependency_reason', from: ref('m2'), to: ref('m1'), reason: 'm2 reads m1' }],
    ['add_dependency existing edge', LINKED, LINKED_RULES, { op: 'add_dependency', from: ref('m2'), to: ref('m1'), reason: 'different' }],
    ['remove_dependency absent edge', BASE, NO_RULES, REMOVE_DEPENDENCY],
    ['add_forbid_rule existing rule', LINKED, LINKED_RULES, { op: 'add_forbid_rule', from: ref('m1'), to: ref('m2'), reason: 'different' }],
    ['remove_forbid_rule absent rule', BASE, NO_RULES, REMOVE_FORBID_RULE],
    ['set_parent same parent', LINKED, LINKED_RULES, { op: 'set_parent', moduleId: 'm2', parentId: 'm1' }],
    ['set_parent null with no parent', BASE, NO_RULES, { op: 'set_parent', moduleId: 'm2', parentId: null }],
  ] as const)('refuses %s as a no-op', (_name, catalog, rules, op) => {
    expect(applyRepairOps(clone(catalog), clone(rules), [op as CatalogRepairOpV1], P))
      .toMatchObject({ ok: false, problem: { status: 'invalid', reason: 'noop_op' } });
  });

  it('refuses an empty ops array', () => {
    expect(applyRepairOps(clone(BASE), [], [], P))
      .toMatchObject({ ok: false, problem: { status: 'invalid', reason: 'noop_op' } });
  });
});

describe('C1 structural classification', () => {
  it.each([
    { name: 'add_module', op: ADD_MODULE, structural: true },
    { name: 'remove_module', op: REMOVE_MODULE, structural: true },
    { name: 'add_dependency', op: ADD_DEPENDENCY, structural: true },
    { name: 'remove_dependency', op: REMOVE_DEPENDENCY, structural: true },
    { name: 'add_forbid_rule', op: ADD_FORBID_RULE, structural: true },
    { name: 'remove_forbid_rule', op: REMOVE_FORBID_RULE, structural: true },
    { name: 'set_parent', op: SET_PARENT, structural: true },
    { name: 'set_responsibility', op: SET_RESPONSIBILITY, structural: false },
    { name: 'set_module_name', op: SET_MODULE_NAME, structural: false },
    { name: 'add_path', op: ADD_PATH, structural: false },
    { name: 'remove_path', op: REMOVE_PATH, structural: false },
    { name: 'add_interface', op: ADD_INTERFACE, structural: false },
    { name: 'set_interface', op: SET_INTERFACE, structural: false },
    { name: 'remove_interface', op: REMOVE_INTERFACE, structural: false },
    { name: 'set_dependency_reason', op: SET_DEPENDENCY_REASON, structural: false },
  ])('$name', ({ op, structural }) => {
    expect(structuralOfRepair([op])).toBe(structural);
  });
});

describe('C1 repairNeedsCard', () => {
  it.each([
    { name: 'structural at automatic autonomy', input: { structural: true, rename: false, autonomy: 'after_plan_confirmation' as const, footprintUnknown: false }, expected: true },
    { name: 'rename at automatic autonomy', input: { structural: false, rename: true, autonomy: 'after_plan_confirmation' as const, footprintUnknown: false }, expected: true },
    { name: 'small at automatic autonomy', input: { structural: false, rename: false, autonomy: 'after_plan_confirmation' as const, footprintUnknown: false }, expected: false },
    { name: 'small at every-step autonomy', input: { structural: false, rename: false, autonomy: 'every_step' as const, footprintUnknown: false }, expected: true },
    { name: 'small with an unknown footprint', input: { structural: false, rename: false, autonomy: 'after_plan_confirmation' as const, footprintUnknown: true }, expected: true },
  ])('$name', ({ input, expected }) => {
    expect(repairNeedsCard(input)).toBe(expected);
  });
});

describe('C1 applyRepairOps refusals', () => {
  it('refuses an unsafe path', () => {
    expect(applyRepairOps(clone(BASE), [], [{ op: 'add_path', moduleId: 'm1', path: '../escape' }], P))
      .toMatchObject({ ok: false, problem: { status: 'invalid' } });
  });

  it('refuses an unknown interface', () => {
    expect(applyRepairOps(clone(BASE), [], [{ op: 'remove_interface', moduleId: 'm1', interfaceId: 'iZ' }], P))
      .toMatchObject({ ok: false, problem: { status: 'invalid', reason: 'unknown_interface' } });
  });

  it('refuses a bad interface shape', () => {
    expect(applyRepairOps(clone(BASE), [], [{ op: 'add_interface', moduleId: 'm1',
      interface: { id: 'i2', description: '', paths: ['src/m1/i2'] } }], P))
      .toMatchObject({ ok: false, problem: { status: 'invalid' } });
  });

  it('refuses a rule with no reason', () => {
    expect(applyRepairOps(clone(BASE), [], [{ op: 'add_dependency', from: ref('m2'), to: ref('m1'), reason: '' }], P))
      .toMatchObject({ ok: false, problem: { status: 'invalid' } });
  });

  it('checks project ownership on an empty catalog', () => {
    expect(applyRepairOps(clone(EMPTY), [], [{ op: 'add_module', module: moduleOf('m1') }], P).ok).toBe(true);
    expect(applyRepairOps(clone(EMPTY), [], [{ op: 'add_module',
      module: { ...moduleOf('m1'), ref: { projectId: 'p2', moduleId: 'm1' } } }], P))
      .toMatchObject({ ok: false, problem: { status: 'invalid' } });
  });

  it('refuses a dangling dependency left by remove_module', () => {
    const ops: CatalogRepairOpV1[] = [REMOVE_FORBID_RULE, { op: 'set_parent', moduleId: 'm2', parentId: null }, REMOVE_MODULE];
    expect(applyRepairOps(clone(LINKED), clone(LINKED_RULES), ops, P))
      .toMatchObject({ ok: false, problem: { status: 'invalid', reason: 'module_has_edges' } });
  });

  it('refuses a forbid rule that names a removed module', () => {
    const ops: CatalogRepairOpV1[] = [REMOVE_DEPENDENCY, { op: 'set_parent', moduleId: 'm2', parentId: null }, REMOVE_MODULE];
    expect(applyRepairOps(clone(LINKED), clone(LINKED_RULES), ops, P))
      .toMatchObject({ ok: false, problem: { status: 'invalid', reason: 'module_has_edges' } });
  });

  it('refuses duplicate (from, to) forbid rules', () => {
    const duplicates: Rules = [...LINKED_RULES, { ...LINKED_RULES[0]!, ruleId: 'r2' }];
    expect(applyRepairOps(clone(BASE), duplicates, [SET_RESPONSIBILITY], P))
      .toMatchObject({ ok: false, problem: { status: 'invalid', reason: 'noop_op' } });
  });
});

describe('C1 repairBindingDigest', () => {
  const PIN: ArchitectureCatalogPinV1 = {
    catalogRef: { aggregateType: 'ArchitectureCatalog', projectId: P, baselineId: 'b1', revision: 2 },
    baseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: P, baselineId: 'b1', revision: 2 },
      digest: '0'.repeat(64) },
  };
  const REPAIR: RepairPayloadV1 = {
    pin: PIN,
    ops: [{ op: 'set_responsibility', moduleId: 'm1', text: 'new' }],
    responsibilityMoves: [],
    structural: false,
  };
  const BODY: NoteBodyV1 = {
    kind: 'repair', topic: 't', topicKey: 't', conclusion: 'c', body: 'b',
    anchor: { kind: 'module', moduleId: 'm1' }, extraAnchors: [], facts: [],
    basis: { planRevision: null, catalogRevision: 2, files: [] },
    structural: false, replaces: [], contradicts: [], coexistWith: [], repair: REPAIR,
  };
  const MOVE: ResponsibilityMoveV1 = {
    link: { aggregateType: 'SessionWorkLink', projectId: P, sessionId: 's1',
      target: { kind: 'module', ref: ref('m1') }, relation: 'responsible' },
    to: { kind: 'modules', destinations: [ref('m2')] },
  };
  const MOVED: NoteBodyV1 = { ...BODY, repair: { ...REPAIR, responsibilityMoves: [MOVE] } };
  const OTHER_TOPIC: NoteBodyV1 = { ...BODY, topic: 't2', topicKey: 't2' };

  it('covers responsibilityMoves', () => {
    expect(repairBindingDigest(BODY)).not.toBe(repairBindingDigest(MOVED));
  });

  it('covers the whole body, not only repair', () => {
    expect(repairBindingDigest(BODY)).not.toBe(repairBindingDigest(OTHER_TOPIC));
  });

  it('is the hand-computed canonical JSON digest', () => {
    expect(repairBindingDigest(BODY)).toBe('03b8f508121d258706ada4af3745ea45181d07670bc670055fa758448f1e8611');
  });
});
