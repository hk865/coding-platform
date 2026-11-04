/**
 * 8E2 H check_links (slice-8E2-SPEC §4.2):
 * - E2-14a (:837): a Work Run with the production `localWorkbenchGrant` (a
 *   read-only workspace, no write prefix, no write tools) is granted
 *   `check_links` — and not `record_note` — and the Kernel-delivered result is
 *   the verified value of K1.
 * - E2-14b (:838): an ordinary Query on the published local-workbench profile
 *   (no request, `noteAdmission: none`) freezes `request: null`,
 *   `answerShape: null`, `check_links` in `permissions.tools` and no
 *   `record_note`; its scripted model calls `check_links` and gets the verified
 *   value; the step builds exactly one second-tier program.
 * - E2-15 (:839): with a short `checkDeadlineMs` and the second tier held on
 *   its gate, the agent call returns `unchecked`/`budget` before the gate
 *   opens, E3 still reads `refs_pending` and builds nothing; after the gate
 *   opens the held verify is remembered (E3 `verified`, one build, no second).
 *
 * Expectations come only from the spec (8E2 §2.5 H3 :362–369, §4.1 :705–713,
 * §4.2 rows :837–:839); the tool names are the spec literals. One world per
 * row, memory only, closed after each row. E3 is the Host route
 * `architecture/semantic-links`; "builds" is `world.linkCheck.builds()`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { ToolResult } from '../../vendor/coding-agent/dist/public-api.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { claimProfile, claimQuery, prepareAttempt } from '../helpers/request-claim-steps.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import {
  openS8ESemanticWorld, runS8ECheckLinks, s8eChangeComposeLine10, s8eLinkVerification, s8eWriteLink,
  S8E_LINKS, S8E_LOCAL_WORKBENCH_PROFILE_ID, S8E_SCOPE, type S8ESemanticWorld,
} from '../helpers/S8E-semantic-world.js';

const worlds: S8ESemanticWorld[] = [];
afterEach(async () => {
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

function remember<T extends S8ESemanticWorld>(world: T): T {
  worlds.push(world);
  return world;
}

/** One successful tool result carrying one JSON value (the spec's `{ items }` shape). */
const jsonItems = (items: readonly { noteId: string; version: number;
  verification: { status: string; reason?: string } }[]) =>
  ({ status: 'success', output: [{ kind: 'json', value: { items } }] });

describe('8E-2 H: the check_links tool', () => {
  it('E2-14a (:837) a no-write-prefix Work Run gets check_links (not record_note) and verifies K1', async () => {
    const world = remember(await openS8ESemanticWorld({ localWorkbench: true }));
    const local = world.localWorkbench;
    if (local === null) throw new Error('E2-14a: the world has no local workbench line');
    const { noteId, version } = await s8eWriteLink(world, S8E_LINKS.K1);
    await s8eChangeComposeLine10(world);

    const run = await runS8ECheckLinks(world, { goalRef: local.goalRef, task: local.task, line: local.line,
      label: 'e2-14a', args: { items: [{ noteId, version }] } });

    // F11: this Run's first model request carries check_links and no record_note.
    const names = run.requests[0]!.tools.map(tool => tool.name);
    expect(names).toContain('check_links');
    expect(names).not.toContain('record_note');

    expect(run.toolResult).toMatchObject(jsonItems([
      { noteId, version, verification: { status: 'verified' } },
    ]));
  }, 300_000);

  it('E2-14b (:838) a plain Query without a request has check_links and verifies K1 with one build', async () => {
    const world = remember(await openS8ESemanticWorld({ localWorkbench: true }));
    const local = world.localWorkbench;
    if (local === null) throw new Error('E2-14b: the world has no local workbench line');
    const { noteId, version } = await s8eWriteLink(world, S8E_LINKS.K1);
    await s8eChangeComposeLine10(world);

    const registration = (await world.post('workspaces/registration',
      plain(S8E_SCOPE, S8E_SCOPE))).body as ReadResult<{
        project: { revision: number }; workspace: { revision: number } }>;
    if (registration.status !== 'ready') {
      throw new Error(`E2-14b: the workspace registration was not ready: ${JSON.stringify(registration)}`);
    }
    // The Goal already exists (the local workbench's own Goal); it is read, never created.
    const goal = (await world.post('goals/read',
      plain(S8E_SCOPE, local.goalRef))).body as ReadResult<{ goal: { revision: number } }>;
    if (goal.status !== 'ready') {
      throw new Error(`E2-14b: the Goal read was not ready: ${JSON.stringify(goal)}`);
    }

    const created = (await world.post('sessions/create', plain(S8E_SCOPE, {
      workspace: S8E_SCOPE, role: local.profile.sessionRole, recommendedRefs: [], initialLinks: [],
      meta: { requestId: 's8e-h-14b-session', expected: [] },
    }))).body as { status?: string;
      value?: { ref: { projectId: string; sessionId: string }; revision: number } };
    if (created.status !== 'completed' || created.value === undefined) {
      throw new Error(`E2-14b: the Session was not created: ${JSON.stringify(created)}`);
    }
    const sessionRef: SessionRef = { projectId: created.value.ref.projectId,
      sessionId: created.value.ref.sessionId };
    const card = await world.readSession(sessionRef);
    const session: S6ASession = { label: 's8e-h-14b', ref: sessionRef,
      aggregateRef: card.record.ref, role: structuredClone(card.record.role),
      createdAt: card.record.createdAt };

    const queryJobId = 's8e-h-14b-query';
    const runId = 's8e-h-14b-run';
    const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', ...S8E_SCOPE, queryJobId };
    const queryRunRef = { aggregateType: 'QueryRun' as const, ...S8E_SCOPE, queryJobId, runId };
    const submitted = (await world.post('queries/submit', graphWrite(S8E_SCOPE, {
      queryJobId, runId,
      intent: {
        schemaVersion: 1, intentId: queryJobId, projectId: S8E_SCOPE.projectId,
        workspaceId: S8E_SCOPE.workspaceId, goalId: local.goalRef.goalId,
        question: 'Does this plain Query carry check_links?', focusTaskRefs: [],
        budget: local.profile.budget, multiTurn: { maxRounds: 1 }, correlationId: 's8e-h-14b-corr',
        execution: { kind: 'semantic_query', roleBinding: local.profile.roleBinding,
          runtimeBudget: local.profile.runtimeBudget },
      },
    }, 's8e-h-14b-submit', [
      { ref: { aggregateType: 'Project', projectId: S8E_SCOPE.projectId },
        revision: registration.value.project.revision },
      { ref: { aggregateType: 'Workspace', ...S8E_SCOPE }, revision: registration.value.workspace.revision },
      { ref: local.goalRef, revision: goal.value.goal.revision },
      { ref: queryJobRef, revision: 0 },
      { ref: queryRunRef, revision: 0 },
    ]))).body;
    expect(submitted).toMatchObject({ status: 'committed' });

    // A plain Query keeps its Job's binding: only a request round is claimed
    // with a secretary profile, so the published profile is read for its
    // consumer identity and the claim carries no profile.
    const claimProfileValue = await claimProfile(world, S8E_LOCAL_WORKBENCH_PROFILE_ID);
    const claimed = await claimQuery(world, queryJobRef, session, null, 's8e-h-14b-claim');
    expect(claimed, JSON.stringify(claimed)).toMatchObject({ status: 'committed' });
    const prepared = await prepareAttempt(world, queryJobRef, 's8e-h-14b-prepare');

    const opened = (await world.post('materials/open', plain(S8E_SCOPE, { ref: prepared.bundleRef,
      usage: 'historical_explanation' }))).body as ReadResult<{ body: string }>;
    if (opened.status !== 'ready') {
      throw new Error(`E2-14b: the frozen manifest was not ready: ${JSON.stringify(opened)}`);
    }
    const manifest = JSON.parse(opened.value.body) as PreparedQueryManifestV1;
    // A plain Query: no request, no answer shape (planningNoteAdmission's noteAdmission: none).
    expect(manifest.request).toBeNull();
    expect(manifest.answerShape).toBeNull();
    expect(manifest.permissions.tools).toContain('check_links');
    expect(manifest.permissions.tools).not.toContain('record_note');

    const callId = 's8e-h-14b-check-links';
    await world.scripted.script(session, [
      { kind: 'calls', calls: [{ callId, name: 'check_links', args: { items: [{ noteId, version }] } }] },
      { kind: 'text', text: 'E2-14b done' },
    ]);
    const before = world.linkCheck.builds();
    const started = (await world.post('queries/start', plain(S8E_SCOPE, { prepared,
      consumerId: claimProfileValue['consumerId'], requestId: 's8e-h-14b-start' }))).body;
    expect(started).toMatchObject({ status: 'ready' });

    // The Query runs to completion in the Kernel; wait for its second model request.
    await expect.poll(async () => (await world.scripted.requests(session)).length,
      { timeout: 30_000, interval: 20 }).toBeGreaterThanOrEqual(2);
    const requests = await world.scripted.requests(session);
    const delivered = requests[1]?.messages.find(message => message.role === 'tool' && message.callId === callId);
    if (delivered === undefined || delivered.role !== 'tool') {
      throw new Error(`E2-14b: the check_links result was not delivered to the model: ${callId}`);
    }
    const toolResult: ToolResult = delivered.result;
    expect(toolResult).toMatchObject(jsonItems([
      { noteId, version, verification: { status: 'verified' } },
    ]));
    expect(world.linkCheck.builds() - before).toBe(1);
  }, 300_000);

  it('E2-15 (:839) the agent call returns budget at the deadline and the held verify settles to verified', async () => {
    const world = remember(await openS8ESemanticWorld({ localWorkbench: true,
      noteLimits: { checkDeadlineMs: 100 } }));
    const local = world.localWorkbench;
    if (local === null) throw new Error('E2-15: the world has no local workbench line');
    const { noteId, version } = await s8eWriteLink(world, S8E_LINKS.K1);
    await s8eChangeComposeLine10(world);
    const b0 = world.linkCheck.builds();
    const gate = world.linkCheck.holdVerify();

    try {
      const run = await runS8ECheckLinks(world, { goalRef: local.goalRef, task: local.task, line: local.line,
        label: 'e2-15', args: { items: [{ noteId, version }] } });

      // The deadline wins while the second tier is still held: the call returns
      // unchecked/budget before the gate opens (assert this BEFORE awaiting the gate).
      expect(run.toolResult).toMatchObject(jsonItems([
        { noteId, version, verification: { status: 'unchecked', reason: 'budget' } },
      ]));
      await gate.entered;

      // The held verify has built nothing yet and E3 still reads refs_pending.
      expect(await s8eLinkVerification(world, noteId, version))
        .toEqual({ status: 'unchecked', reason: 'refs_pending' });
      expect(world.linkCheck.builds() - b0).toBe(0);

      gate.release();
      await gate.settled;

      // The held check answers and R7 remembers it; E3 then reads verified with
      // exactly the one build, and no second build.
      let settled: Awaited<ReturnType<typeof s8eLinkVerification>> | undefined;
      for (let attempt = 0; attempt < 300; attempt += 1) {
        const verification = await s8eLinkVerification(world, noteId, version);
        if (!(verification.status === 'unchecked' && verification.reason === 'refs_pending')) {
          settled = verification;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(settled).toEqual({ status: 'verified' });
      expect(world.linkCheck.builds() - b0).toBe(1);
    } finally {
      // A failed assertion above must not leave the held verify blocking close().
      gate.release();
    }
  }, 300_000);
});
