/**
 * Slice 2C row 2C-40 (LE4, L23, L12; 2B spec L12 "检查的横条"): a Goal gate's
 * verification round lands on the line that currently holds the gate's open
 * `responsible` link, records the producer Run it was opened against (often on
 * another line), does not appear under the producer's own `executions.checks`
 * and is not duplicated when two Sessions of one line both hold the link.
 *
 * Entry LE4: `openHostScenario`, the real `sessions/create` /
 * `sessions/link` / `lines/read` / `lines/page` routes, and the real evidence
 * owner through the composition root for the round open (the registered check
 * process itself is not run; the round open is the step under test). No
 * database is read for verification.
 */
import { afterEach, expect, it } from 'vitest';
import { cleanupScenarios, hostCtx, openHostScenario, performs, type HostScenario } from './harness.js';
import {
  AG2B_RESULT_FILE, AG2B_RESULT_TEXT, AG2B_GATE_TASK_ID, AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_ROLE,
  createAG2bSession, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution } from '../helpers/A2-restart-fixture.js';
import { lineRead, lineSection, ready } from '../helpers/S2C-K-scenario-support.js';
import { createFileReplies } from './support/common.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { SessionRef, WorkLinkTarget } from '../../src/contracts/core/identity.js';

afterEach(cleanupScenarios);

const GATE: TaskTriple = { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: AG2B_GATE_TASK_ID };
const GATE_TARGET: WorkLinkTarget = { kind: 'task', ref: GATE };

type SessionCardLike = { record: { ref: unknown; revision: number }; links: { ref: { target: WorkLinkTarget; relation: string };
  revision: number; until: unknown }[] };

async function sessionCard(h: HostScenario, ref: SessionRef): Promise<SessionCardLike> {
  return ready(await h.post<ReadResult<SessionCardLike>>('sessions/read', plain(AG2B_SCOPE, ref)), 'sessions/read');
}

/** Link a Session responsibly to the seeded gate task through the real route. */
async function linkGate(h: HostScenario, ref: SessionRef, requestId: string): Promise<void> {
  const card = await sessionCard(h, ref);
  const linkRef = { ...ref, aggregateType: 'SessionWorkLink' as const, target: GATE_TARGET, relation: 'responsible' as const };
  const answer = await h.answer('sessions/link', graphWrite(AG2B_SCOPE,
    { sessionRef: ref, target: GATE_TARGET, relation: 'responsible', active: true }, requestId,
    [{ ref: card.record.ref, revision: card.record.revision }, { ref: linkRef, revision: 0 }]));
  expect(answer.status, JSON.stringify(answer)).toBe('committed');
}

/** Close the open responsible link to the gate task through the real route. */
async function unlinkGate(h: HostScenario, ref: SessionRef, requestId: string): Promise<void> {
  const card = await sessionCard(h, ref);
  const link = card.links.find(candidate => candidate.ref.relation === 'responsible'
    && candidate.ref.target.kind === 'task' && candidate.ref.target.ref.taskId === GATE.taskId);
  expect(link, 'the open gate link must exist').toBeDefined();
  const answer = await h.answer('sessions/link', graphWrite(AG2B_SCOPE,
    { sessionRef: ref, target: GATE_TARGET, relation: 'responsible', active: false }, requestId,
    [{ ref: card.record.ref, revision: card.record.revision }, { ref: link!.ref, revision: link!.revision }]));
  expect(answer.status, JSON.stringify(answer)).toBe('committed');
}

it('2C-40 a gate round lands once on the line holding the gate responsibility, names the producer Run on the other line, and is absent from the producer line and from its executions.checks', async () => {
  let h: HostScenario | undefined;
  let workRun: RunRef | undefined;
  h = await openHostScenario({ script: {
    replies: createFileReplies('s2c40-work', AG2B_RESULT_FILE, AG2B_RESULT_TEXT),
    duringReply: async () => {
      if (workRun !== undefined || h === undefined) return;
      const runRef = (await h.taskRow()).execution;
      if (runRef !== null) workRun = runRef;
    } } });

  // End the producer work Run and stop before its own check process runs.
  await h.advance(h.select('s2c40-work-run'), { stopBefore: performs('run_check') });
  if (workRun === undefined) throw new Error('the producer work Run must exist');
  const pCard = (await readExecution(h.host, workRun)).session;
  const pRef: SessionRef = { projectId: pCard.ref.projectId, sessionId: pCard.ref.sessionId };

  // G holds the gate's responsible link; G2 is its continuation, so both share one line.
  const gRef = (await createAG2bSession(h.host, 's2c40-g', AG2B_WORK_ROLE)).sessionRef;
  const created2 = await h.post<{ status: string; value: { ref: { projectId: string; sessionId: string } } }>(
    'sessions/create', plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, role: AG2B_WORK_ROLE, recommendedRefs: [],
      initialLinks: [], provenance: { schemaVersion: 1, kind: 'continuation', from: gRef, reason: 'interrupted', task: GATE },
      meta: { requestId: 's2c40-g2', expected: [] } }));
  expect(created2.status).toBe('completed');
  const g2Ref: SessionRef = { projectId: created2.value.ref.projectId, sessionId: created2.value.ref.sessionId };
  await linkGate(h, gRef, 's2c40-link-g');
  await linkGate(h, g2Ref, 's2c40-link-g2');

  // The gate's round opens against the producer work Run on P through the real evidence owner.
  const platform = await h.direct();
  const graph = await platform.plans.queryTaskGraph(hostCtx(), { goalRef: AG2B_GOAL_REF });
  if (graph.status !== 'ready') throw new Error(`the task graph must be readable: ${JSON.stringify(graph)}`);
  const opened = await platform.evidence.openVerification(hostCtx(), { input: { subjectRunRef: workRun,
    subject: GATE, planRef: graph.value.plan.ref, gateSubject: 'goal' }, meta: { requestId: 's2c40-open', expected: [] } });
  expect(opened.status, JSON.stringify(opened)).toBe('committed');
  if (opened.status !== 'committed') throw new Error(JSON.stringify(opened));

  // G2's line (which contains G) lists the round exactly once, anchored on P's Run.
  const detail = ready(await lineRead(h, g2Ref), 'lines/read after the gate open');
  if (detail.kind !== 'line') throw new Error('expected one line detail');
  expect(detail.gateChecks).toHaveLength(1);
  expect(detail.gateChecks[0]).toMatchObject({ gateTask: GATE, producerRunRef: { runId: workRun.runId } });

  // P's line does not list it, nor does P's executions section carry it as a check.
  const producer = ready(await lineRead(h, pRef), 'lines/read of the producer line');
  if (producer.kind !== 'line') throw new Error('expected the producer line detail');
  expect(producer.gateChecks).toEqual([]);
  const executions = ready(await lineSection(h, pRef, 'executions', { limit: 100 }), 'lines/page executions of the producer');
  if (executions.section !== 'executions') throw new Error('expected the executions section');
  const producerItem = executions.items.find(item => item.kind === 'execution' && item.runRef.runId === workRun!.runId);
  expect(producerItem, 'the producer execution is listed').toBeDefined();
  // L12/L23: the gate round is not found by subject execution, so it is not among
  // the producer execution's own `checks` (only the work Run's own round is).
  const producerChecks = producerItem?.kind === 'execution' ? producerItem.checks : [];
  expect(producerChecks.some(check => check.roundRef.taskId === GATE.taskId)).toBe(false);

  // With every gate responsibility closed, no line lists the round (2B's horizontal bar rule).
  await unlinkGate(h, g2Ref, 's2c40-unlink-g2');
  await unlinkGate(h, gRef, 's2c40-unlink-g');
  const afterClose = ready(await lineRead(h, g2Ref), 'lines/read after the unlink');
  if (afterClose.kind !== 'line') throw new Error('expected one line detail after the unlink');
  expect(afterClose.gateChecks).toEqual([]);
}, 240_000);
