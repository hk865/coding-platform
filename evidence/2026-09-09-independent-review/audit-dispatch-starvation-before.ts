import { expect, it } from 'vitest';
import { InMemoryLedger } from '../../src/ledger/in-memory-ledger.js';
import { DispatchEngineImpl } from '../../src/control/dispatch-engine.js';
import { buildDispatchClaimCommand } from '../../src/contracts/commands/dispatch.js';
import { DISPATCH_PLAN_REVISION_FIXTURE_V1 as draft, ROLE_BINDING_FIXTURE_V1 } from '../../src/contracts/fixtures/dispatch-fixtures.js';
import { reviewFixture, scope, cmd } from '../../tests/control/reviewer-work-fixture.js';
it('records a pending Reviewer consuming the entire ordinary-dispatch fetch window', async () => {
  const saved = structuredClone(draft);
  const ledger = new InMemoryLedger();
  let h: Awaited<ReturnType<typeof reviewFixture>>;
  try { draft.executionDag.dependsOn = []; h = await reviewFixture(ledger, { reviewers: 1 }); }
  finally { Object.assign(draft, saved); }
  expect(await h.ports.lifecycle.createWork(h.create)).toMatchObject({ status: 'accepted' });
  expect(await h.control.claimTask(buildDispatchClaimCommand({ ...cmd('normal'), ...scope, taskId: 'task-verify-view', attemptId: 'zz-normal', runId: 'normal-other-task', roleBinding: ROLE_BINDING_FIXTURE_V1, declaredPermissions: { tools: ['read'], writeScope: [] }, budget: { tokenBudget: 128000, deadline: null } }))).toMatchObject({ status: 'committed' });
  const entries = await ledger.pendingDispatchIntents(10);
  console.log('audit pending intents', entries.map(e => ({ task: e.intent.taskId, work: e.intent.work?.kind })));
  expect(entries).toHaveLength(2);
  expect(entries[0]!.intent.work?.kind).toBe('review');
  let selected = 0;
  const dispatch = new DispatchEngineImpl({ ledger, control: h.control, contextCompiler: { assemble: async () => { selected++; return { status: 'needs_material', gaps: [] }; } } as never, runtime: { start: async () => { throw Error('unreachable'); } } as never });
  for (let i = 0; i < 3; i++) expect(await dispatch.drive({ reason: 'audit', maxIntents: 1 })).toMatchObject({ scanned: 0, started: 0, failures: [] });
  expect(selected).toBe(0);
  expect(await dispatch.drive({ reason: 'audit', maxIntents: 2 })).toMatchObject({ scanned: 1 });
  expect(selected).toBe(1);
});
