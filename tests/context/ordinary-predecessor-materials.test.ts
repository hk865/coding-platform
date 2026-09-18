import { afterEach, expect, it } from 'vitest';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reviewerFixture, scope } from '../verification/reviewer-fixture.js';
import { runP107Task, toP1_07Harness, P107_TASK_READER_A, P107_ROLE_BINDING_READER_V1, P107_BUDGET_READER_V1, P107_SCHEMA } from '../contract-suite/p1-07-harness.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { RunSpec } from '../../src/contracts/runtime-preparation.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import { OrdinaryPredecessorMaterialCompiler } from '../../src/data/context-compiler/ordinary-predecessor-materials.js';
import { WorkRunMaterialCompiler } from '../../src/data/context-compiler/work-run-materials.js';
import { WorkMaterialDrive } from '../../src/control/dispatch-engine/work-material-drive.js';
import { assembleRuntimeContext } from '../../src/data/context-compiler/runtime-context.js';
import { createModelCallAccess } from '../../src/control/dispatch-engine/execution/model-call-access.js';
import { FakeRuntimeAdapter } from '../../src/execution/worker-runtime/fake-runtime-adapter.js';
import { FAKE_RUNTIME_SCRIPT_COMPLETED_V1 } from '../../src/fixtures/dispatch-fixtures.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function world() {
  const s = await reviewerFixture(roots, { successorTaskId: P107_TASK_READER_A });
  const first = await s.service.startReview(scope, s.input);
  expect(first.review.work, JSON.stringify(first.review.gaps)).not.toBeNull();
  const ref = first.review.work!.ref;
  const { packet } = await s.begin(ref);
  const original = await s.report(ref, packet);
  await s.complete(ref, original);
  const settled = await s.service.resumeReview(scope, { requestId: s.input.requestId });
  expect(settled.review.phase, JSON.stringify(settled.review.gaps)).toBe('settled');
  expect(settled.review.formal.taskPhase).toBe('satisfied');
  // Stop the deterministic successor lifecycle at run_started so real Control
  // can bind and authorize its input before any terminal event is ingested.
  const pending = new FakeRuntimeAdapter({ schemaVersion: 1, items: FAKE_RUNTIME_SCRIPT_COMPLETED_V1.items.slice(0, 1) });
  s.h.runtime.start = envelope => pending.start(envelope);
  const successor = await runP107Task(toP1_07Harness(s.h), { taskId: P107_TASK_READER_A, runId: 'ordinary-successor', attemptId: 'ordinary-successor-attempt', roleBinding: P107_ROLE_BINDING_READER_V1,
    declaredPermissions: { tools: ['read'], writeScope: [] }, budget: P107_BUDGET_READER_V1 });
  const loaded = await s.h.ledger.load(successor);
  if (loaded.status !== 'found') throw Error('successor missing');
  const envelope = (loaded.snapshot as RunSnapshot).envelope!;
  expect(envelope).not.toBeNull();
  const spec: RunSpec = { ...scope, root: s.root, taskId: P107_TASK_READER_A, runId: successor.runId, instruction: 'Use verified predecessor material as reference.', budget: { ...DEFAULT_RUNTIME_BUDGET, contextWindowTokens: envelope.budget.tokenBudget } };
  const compiler = new OrdinaryPredecessorMaterialCompiler({ ledger: s.h.ledger, vault: s.h.vault, source: s.source });
  const drive = new WorkMaterialDrive({ ledger: s.h.ledger, control: { resolveTaskWorkIdentity: q => s.h.control.resolveTaskWorkIdentity(q), grantMaterialAccess: c => s.h.grantMaterialAccess(c) }, predecessors: compiler,
    compiler: new WorkRunMaterialCompiler({ ledger: s.h.ledger, vault: s.h.vault, workContext: s.h.workContext, completedWork: s.h.completedWork }) });
  return { ...s, envelope, spec, compiler, drive, original };
}

it('delivers current canonical predecessor Evidence, independent raw review and tool report through exact grants', async () => {
  const s = await world();
  const materials = await s.drive.assembleRun(s.spec, s.envelope);
  expect(materials.predecessors).toHaveLength(1);
  const row = materials.predecessors[0]!;
  expect(row.kind).toBe('canonical-verification');
  if (row.kind !== 'canonical-verification') throw Error('wrong provenance');
  expect(row.documents.some(d => d.kind === 'independent-review')).toBe(true);
  expect(row.documents.some(d => d.kind === 'tool-report')).toBe(true);
  expect(JSON.parse(row.documents.find(d => d.kind === 'independent-review')!.text.content)).toEqual(s.original);
  const input = await assembleRuntimeContext(s.spec, s.envelope, { vault: s.h.vault, materials });
  expect(input.input).toContain('independent-review-result');
  expect(input.input).toContain('tool-count');
  expect(input.manifest.selected.some(d => d.kind === 'independent-review')).toBe(true);
  expect(input.manifest.selected.some(d => d.kind === 'operator-review')).toBe(false);
  expect(input.manifest.permissions).toEqual(s.envelope.permissions);
  await materials.assertCurrent!();
  const access = createModelCallAccess({ ledger: s.h.ledger, control: s.h.control, envelope: s.envelope, now: () => P107_SCHEMA });
  const binding = { inputDigest: input.manifest.inputDigest, manifestDigest: 'a'.repeat(64), materialAccessRefs: materials.deliveryGrantRefs! };
  const bodies = s.compiler.materialsOf(await s.compiler.select(s.envelope));
  expect(materials.additionalMaterialRefs).toEqual(bodies);
  await expect(access.bind(binding)).rejects.toThrow('invalid');
  await expect(access.bind({ ...binding, additionalMaterialRefs: bodies.slice(1) })).rejects.toThrow('invalid');
  await expect(access.bind({ ...binding, additionalMaterialRefs: [...bodies, { ...bodies[0]!, digest: 'c'.repeat(64) }] })).rejects.toThrow('invalid');
  await expect(access.bind({ ...binding, additionalMaterialRefs: [...bodies, bodies[0]!] })).rejects.toThrow('invalid');
  await access.bind({ ...binding, additionalMaterialRefs: materials.additionalMaterialRefs! });
  await access.beforeCall({ requestId: 'predecessor-input', requestDigest: 'b'.repeat(64), contextInputDigest: input.manifest.inputDigest, manifestDigest: 'a'.repeat(64) });
  const grantRef = materials.deliveryGrantRefs![0]!;
  expect(await s.h.control.revokeMaterialAccess({ schemaVersion: 1, commandType: 'RevokeMaterialAccess', commandId: 'revoke-before-provider', aggregateId: grantRef.grantId, expectedRevision: 1,
    correlationId: 'revoke-before-provider', submittedAt: P107_SCHEMA, identity: { projectId: scope.projectId, actor: { kind: 'human', id: 'owner' }, idempotencyKey: 'revoke-before-provider' }, payload: { grantRef, reason: 'Revoked after input binding' } })).toMatchObject({ status: 'committed' });
  await expect(access.beforeCall({ requestId: 'after-revocation', requestDigest: 'd'.repeat(64), contextInputDigest: input.manifest.inputDigest, manifestDigest: 'a'.repeat(64) })).rejects.toThrow();
});

it('rejects revocation both for the fixed selection and full repeated Dispatch material preparation', async () => {
  const s = await world();
  const selection = await s.compiler.select(s.envelope);
  await expect(s.compiler.assemble(selection)).rejects.toThrow('authorized');
  const materials = await s.drive.assembleRun(s.spec, s.envelope), grantRef = materials.deliveryGrantRefs![0]!;
  expect(await s.h.control.revokeMaterialAccess({ schemaVersion: 1, commandType: 'RevokeMaterialAccess', commandId: 'revoke-predecessor', aggregateId: grantRef.grantId, expectedRevision: 1,
    correlationId: 'revoke-predecessor', submittedAt: P107_SCHEMA, identity: { projectId: scope.projectId, actor: { kind: 'human', id: 'owner' }, idempotencyKey: 'revoke-predecessor' }, payload: { grantRef, reason: 'Do not share predecessor reports' } })).toMatchObject({ status: 'committed' });
  await expect(s.compiler.assemble(selection)).rejects.toThrow();
  await expect(materials.assertCurrent!()).rejects.toThrow();
  await expect(s.drive.assembleRun(s.spec, s.envelope)).rejects.toThrow();
});

it('rejects source updates and canonical reduction/plan drift without selecting replacements', async () => {
  const s = await world();
  const materials = await s.drive.assembleRun(s.spec, s.envelope);
  await writeFile(join(s.root, 'source.txt'), 'changed source after formal verification\n');
  await expect(materials.assertCurrent!()).rejects.toThrow('source');
  await expect(s.drive.assembleRun(s.spec, s.envelope)).rejects.toThrow('source');
  await writeFile(join(s.root, 'source.txt'), 'first source line\nsecond source line\n');
  const load = s.h.ledger.load.bind(s.h.ledger);
  s.h.ledger.load = async ref => { const value = await load(ref); return ref.aggregateType === 'TaskReduction' && value.status === 'found' ? { ...value, snapshot: { ...value.snapshot, revision: value.snapshot.revision + 1 } as typeof value.snapshot } : value; };
  await expect(materials.assertCurrent!()).rejects.toThrow('canonical version');
  s.h.ledger.load = async ref => { const value = await load(ref); return ref.aggregateType === 'Goal' && value.status === 'found' ? { ...value, snapshot: { ...value.snapshot, activePlanRevision: null } as typeof value.snapshot } : value; };
  await expect(materials.assertCurrent!()).rejects.toThrow('plan/workspace');
});
