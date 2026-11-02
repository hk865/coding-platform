/**
 * PL L wiring: one goal-loop send through the public Workflow entry reaches the
 * Host's real `sendSystemRound` option, and the `planCandidates` read is no
 * longer where the loop stops. The world is PL's existing F0 composition
 * (`openPlanOnlyWorld`: the real Host, the adopted Plan's plan_only stage
 * placeholder, the adviser line and its input consumer); nothing here opens a
 * second world or hand-builds a record.
 *
 * The row drives the Workflow, not `workflow/driver-start`: once the send step
 * is followed by P4's re-select (`src/business/workflow/workflow.ts:3110`-`:3111`)
 * the driver's own promise no longer settles, so this row performs exactly the
 * one public `send_system_round` step and stops there.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as taskbookExport from '../../src/app/taskbook-export.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { advanceUntil } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { heartbeatUntil, readBody, readPlanningQuery } from '../helpers/IV-host-fixture.js';
import { openPlanOnlyWorld, type PLPlanOnlyWorld } from '../helpers/PL-forms-fixture.js';
import { openPLTaskbookWorld } from '../helpers/PL-taskbook-fixture.js';
import { committedValue, readyValue } from '../helpers/S6A-memory-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';

/**
 * The real ordinary-Query path on the same Host: open a directory through the
 * Host's settings route, select a catalog model for it, then use the published
 * local-workbench profile through `queries/submit` → `queries/claim` →
 * `queries/prepare` and the public `materials/open` of the prepared bundle.
 * Only the bundle's projected budget is read; the Query is never started.
 */
async function ordinaryPerResponseTokens(opened: PLPlanOnlyWorld): Promise<number> {
  const root = await mkdtemp(join(tmpdir(), 'pl-wiring-ordinary-'));
  try {
    const directory = readyValue<{ scope: typeof S6A_SCOPE }>(await opened.world.settings('workspaces/open',
      { path: root, writeAllowed: false, commandsAllowed: false }), 'PL L-01: the ordinary workspace');
    const scope = directory.scope;
    const snapshot = readyValue<{ models: Array<{ id: string }> }>(await opened.world.settings('snapshot', {}),
      'PL L-01: the Host settings snapshot');
    const model = snapshot.models[0];
    if (model === undefined) throw new Error('PL L-01: the Host projects no catalog model for an ordinary Query');
    readyValue(await opened.world.settings('models/select', { scope, modelId: model.id }), 'PL L-01: the ordinary model');
    const profile = (await opened.world.readProfiles()).find(entry =>
      entry.scope.projectId === scope.projectId && entry.scope.workspaceId === scope.workspaceId
      && entry.sessionRole.kind === 'legacy_template' && entry.sessionRole.templateId === 'local-workbench');
    if (profile === undefined) throw new Error('PL L-01: the ordinary local-workbench profile was not published');

    const registration = readyValue<{ project: { revision: number }; workspace: { revision: number } }>(
      (await opened.world.post('workspaces/registration', plain(scope, scope))).body,
      'PL L-01: the ordinary workspace registration');

    const goalId = 'pl-wiring-ordinary-goal';
    const goalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId };
    committedValue((await opened.world.post('goals/create', graphWrite(scope, {
      goalId, workspace: scope, objective: 'An ordinary Query budget on the same Host',
    }, 'pl-wiring-ordinary-goal', [
      { ref: { aggregateType: 'Project', projectId: scope.projectId }, revision: registration.project.revision },
      { ref: { aggregateType: 'Workspace', ...scope }, revision: registration.workspace.revision },
    ]))).body, 'PL L-01: the ordinary Goal');
    const goal = readyValue<{ goal: { revision: number } }>(
      (await opened.world.post('goals/read', plain(scope, goalRef))).body, 'PL L-01: the ordinary Goal read');

    const createdSession = await opened.world.post('sessions/create', plain(scope, {
      workspace: scope, role: profile.sessionRole, recommendedRefs: [], initialLinks: [],
      meta: { requestId: 'pl-wiring-ordinary-session', expected: [] },
    }));
    const sessionBody = createdSession.body as { status?: string;
      value?: { ref: { projectId: string; sessionId: string }; revision: number } };
    if (sessionBody.status !== 'completed' || sessionBody.value === undefined)
      throw new Error(`PL L-01: the ordinary Session was not created: ${JSON.stringify(sessionBody)}`);
    const sessionRef = { projectId: scope.projectId, sessionId: sessionBody.value.ref.sessionId };

    const queryJobId = 'pl-wiring-ordinary-query';
    const runId = 'pl-wiring-ordinary-run';
    const queryJobRef = { aggregateType: 'QueryJob' as const, ...scope, queryJobId };
    const queryRunRef = { aggregateType: 'QueryRun' as const, ...scope, queryJobId, runId };
    committedValue((await opened.world.post('queries/submit', graphWrite(scope, {
      queryJobId, runId,
      intent: {
        schemaVersion: 1, intentId: queryJobId, projectId: scope.projectId, workspaceId: scope.workspaceId,
        goalId, question: 'Which output budget does this ordinary Query project?', focusTaskRefs: [],
        budget: profile.budget, multiTurn: { maxRounds: 1 }, correlationId: 'pl-wiring-ordinary-corr',
        execution: { kind: 'semantic_query', roleBinding: profile.roleBinding, runtimeBudget: profile.runtimeBudget },
      },
    }, 'pl-wiring-ordinary-submit', [
      { ref: { aggregateType: 'Project', projectId: scope.projectId }, revision: registration.project.revision },
      { ref: { aggregateType: 'Workspace', ...scope }, revision: registration.workspace.revision },
      { ref: goalRef, revision: goal.goal.revision },
      { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 },
    ]))).body, 'PL L-01: the ordinary Query submit');

    committedValue((await opened.world.post('queries/claim', graphWrite(scope, {
      queryRunRef, sessionRef,
    }, 'pl-wiring-ordinary-claim', [
      { ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
      { ref: { aggregateType: 'Session', ...sessionRef }, revision: sessionBody.value.revision },
    ]))).body, 'PL L-01: the ordinary Query claim');

    const prepared = readyValue<{ bundleRef: unknown }>((await opened.world.post('queries/prepare', plain(scope, {
      queryRunRef, requestId: 'pl-wiring-ordinary-prepare',
    }))).body, 'PL L-01: the ordinary Query prepare');
    const bundle = readyValue<{ body: string }>((await opened.world.post('materials/open', plain(scope, {
      ref: prepared.bundleRef, usage: 'historical_explanation',
    }))).body, 'PL L-01: the ordinary manifest');
    return (JSON.parse(bundle.body) as PreparedQueryManifestV1).runtimeBudget.perResponseTokens;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('PL L: the goal-loop send', () => {
  it('sends the refine: round through the Host sendSystemRound and no longer stops at planCandidates', async () => {
    const opened = await openPlanOnlyWorld('pl-wiring');
    try {
      // One public Workflow advance reaches the send step (which itself proves
      // `planCandidates` was read); the next one performs the Host's real send.
      const select: WorkflowAdvanceInput = {
        schemaVersion: 1, goalRef: opened.goal, flowId: 'pl-wiring-refine',
        sessionHint: null, kind: 'select_work',
      };
      const sendStep = await advanceUntil(opened.world.ag2b, select, 'send_system_round');
      const sentAnswer = await opened.world.post('workflow/advance', plain(S6A_SCOPE, sendStep));
      expect(sentAnswer.body).toMatchObject({
        status: 'ready',
        value: { receipt: { kind: 'send_system_round', result: { status: 'committed' } } },
      });

      // The real receipt locates the saved message; the request identity and the
      // sender are the spec literals, never values computed by production.
      const sentBody = sentAnswer.body as { value?: { receipt?: { result?: { value?: { ref?: SessionMessageRef } } } } };
      const messageRef = sentBody.value?.receipt?.result?.value?.ref;
      expect(messageRef, 'PL wiring: the send receipt carries no message reference').toBeDefined();
      if (messageRef === undefined) throw new Error('PL wiring: the send receipt carries no message reference');
      const requestId = `refine:${opened.goal.goalId}:${opened.stageId}:1`;

      const inbox = await heartbeatUntil(opened.world,
        () => listed(opened.world, 'inbox', opened.adviser),
        items => items.some(message => message.ref.messageId === messageRef.messageId), 32);
      const sent = inbox.find(message => message.ref.messageId === messageRef.messageId);
      expect(sent, 'the goal loop sent no refine: round to the adviser: the Host sendSystemRound '
        + 'option or the planCandidates injection is not wired').toBeDefined();
      if (sent === undefined) throw new Error('PL wiring: the refine round is not in the adviser inbox');

      // The saved message is the Host's own system round and carries the
      // deterministic request identity; `messages/body` is the public read.
      expect(sent).toMatchObject({
        ref: messageRef,
        sender: { kind: 'host', actor: { kind: 'system', id: 'host:plan-round' } },
        recipient: opened.adviser.ref,
        intent: 'action_request', needsReply: true,
      });
      const body = await readBody(opened.world, messageRef, 'message');
      expect(body.split('\n')[0]).toBe(requestId);

      // One assertion: neither old stop string appears on the send path.
      expect(JSON.stringify({ sentAnswer: sentAnswer.body, body }))
        .not.toMatch(/planCandidates is not wired|the system-round send is not wired/);
    } finally {
      await opened.close();
    }
  }, 120_000);

  it.each([
    ['pl-wiring-1m', 1_000_000, 131_072],
    ['pl-wiring-128k', 128_000, 64_000],
  ])('L-01 %s: a %i-token window reserves %i output tokens', async (label, contextWindowTokens, perResponseTokens) => {
    const opened = await openPlanOnlyWorld(label, { contextWindowTokens });
    try {
      const select: WorkflowAdvanceInput = {
        schemaVersion: 1, goalRef: opened.goal, flowId: `${label}-refine`,
        sessionHint: null, kind: 'select_work',
      };
      const sendStep = await advanceUntil(opened.world.ag2b, select, 'send_system_round');
      const sentAnswer = await opened.world.post('workflow/advance', plain(S6A_SCOPE, sendStep));
      expect(sentAnswer.body).toMatchObject({
        status: 'ready',
        value: { receipt: { kind: 'send_system_round', result: { status: 'committed' } } },
      });
      const sentBody = sentAnswer.body as { value?: { receipt?: { result?: { value?: { ref?: SessionMessageRef } } } } };
      const messageRef = sentBody.value?.receipt?.result?.value?.ref;
      if (messageRef === undefined) throw new Error(`PL L-01 ${label}: the send receipt carries no message reference`);

      // The Host's real consume pass claims and prepares the planning Query; the
      // prepared bundle reference is read publicly, then opened as the manifest.
      const record = await heartbeatUntil(opened.world,
        () => readPlanningQuery(opened.world, messageRef),
        value => value?.run.run.executionState?.prepared !== null
          && value?.run.run.executionState?.prepared !== undefined, 32);
      const prepared = record?.run.run.executionState?.prepared;
      if (prepared === null || prepared === undefined)
        throw new Error(`PL L-01 ${label}: the planning Query was not prepared`);
      const bundle = readyValue<{ body: string }>((await opened.world.post('materials/open', plain(S6A_SCOPE, {
        ref: prepared.bundleRef, usage: 'historical_explanation',
      }))).body, `PL L-01 ${label}: the prepared manifest`);
      const manifest = JSON.parse(bundle.body) as PreparedQueryManifestV1;
      expect(manifest.runtimeBudget.perResponseTokens).toBe(perResponseTokens);
    } finally {
      await opened.close();
    }
  }, 120_000);

  it('L-01 ordinary Query: the same Host keeps the 16384-token profile reserve', async () => {
    const opened = await openPlanOnlyWorld('pl-wiring-ordinary');
    try {
      expect(await ordinaryPerResponseTokens(opened)).toBe(16_384);
    } finally {
      await opened.close();
    }
  }, 120_000);

  /**
   * L-02 (human route): one `plans/propose` + `plans/apply` adoption exports its
   * accepted snapshot exactly once. The expected path and text are the spec
   * literals (§5.3.4), built from the world's real settings directory and the
   * draft's known ids; nothing is read back from the system to form them.
   */
  it('L-02 human-route adoption exports the accepted taskbook exactly once', async () => {
    const exports = vi.spyOn(taskbookExport, 'exportTaskbooksForPlan');
    const world = await openPLTaskbookWorld();
    try {
      await world.adopt({ label: 'l02-b' });
      const planId = 'pl-taskbook-l02-b';
      const goalId = world.goal.goalId;
      const directory = join(world.settingsDirectory, 'taskbooks',
        encodeURIComponent(world.goal.projectId), encodeURIComponent(S6A_SCOPE.workspaceId), encodeURIComponent(goalId));
      const expected = join(directory,
        `goal-${encodeURIComponent(goalId)}__plan-${encodeURIComponent(planId)}__stage-stage-one__rev-1.md`);
      // The export is detached from the adoption; bounded polling only.
      await expect.poll(async () => await readdir(directory).catch(() => [] as string[]), { timeout: 5000 })
        .toContain(`goal-${encodeURIComponent(goalId)}__plan-${encodeURIComponent(planId)}__stage-stage-one__rev-1.md`);
      // A second export would overwrite the same path, so "once" is the one call, read after the detached work ends.
      await world.world.settleDetached();
      expect(exports.mock.calls.filter(([input]) => input.plan.planId === planId)).toHaveLength(1);
      const text = await world.readFile(expected);
      expect(text).toContain('Stage one');
      expect(text).toContain('The first stage.');
      expect(text).toContain('Stage one work');
      expect(text).toContain(planId);
      expect(text).toContain('- Plan revision: 1');
    } finally {
      exports.mockRestore();
      await world.close();
    }
  }, 120_000);


});
