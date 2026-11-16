/**
 * GP-5 (lead 11-16 `gpt-brief.md` row GP-5; `docs/MVP-BEHAVIOR.md:245`, `:247`): a Task with a required independent
 * review, in one `it`, from the Goal driver's start to the completed Goal, in a project that had no review line.
 *
 * World: `openS9ReviewWorld({ reviewLine: 'none', write: true })` (the S9 shared world: the plan's work Task `s9-work`
 * carries a required static and a required `reviewer` requirement, the Host's echo check, a Work line responsible for
 * the Task with the native `write` tool and a write grant, the reviewer binding as Host input, and no review line).
 * Steps: the Work line is scripted (it creates `src/gp5-reviewed.ts` with `edit`, then reports), the person starts the
 * Goal's driver (`workflow/driver-start`, the page's 继续); from there only the Host acts: the Run, the command check,
 * the review arm opens the project's review line itself and sends the `execreview:` round to it; the test scripts the
 * new line once it exists (a scripted model needs its replies before its Query is claimed) and lets the Host's
 * heartbeat consume it: `read_execution_history`, `look_graph` of the round card, `submit_exec_review`; then
 * `record_review` → `finalize_checks` → `complete_task` → the Goal gate → `complete_goal`. End products: ① what the
 * reviewer actually read — the request header's `subjectRunRef`/`checkRefs` (the reviewed Run and its check report),
 * the history page with the reviewed Run's own report and the file its `edit` changed (the tool result's
 * `changedPaths`; the round card's change scope reads "unknown, not empty" for a current-workspace capture), the round
 * card with the check's PASS; ② the verdict is the round's evidence; ③ the Goal reads `COMPLETED`. Memory only
 * (rule S3: a business flow).
 *
 * Green today (b9444921): the G7W-1 lane wait did not stop this world (the Host's heartbeats run here).
 * Mutation shown: the review packet drops the check reports (`exec-review-packet.ts` `execReviewPacketOfRound`,
 * `checkRefs`) → red at ①'s `checkRefs` line.
 */
import { expect, it, vi } from 'vitest';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import type { EvidenceV1 } from '../../src/contracts/evidence.js';
import type { RoundSnapshot } from '../../src/contracts/verification.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { heartbeat, readBody } from '../helpers/IV-host-fixture.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { openS9ReviewWorld } from '../helpers/S9-review-fixture.js';
import { waitFor } from './harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));

const REPORT = 'GP-5 subject report: the reviewed work is done';
const CHANGED = 'src/gp5-reviewed.ts';
type HistoryItem = { body: { text: string } };
/** Every `changedPaths` list anywhere in the history page's Kernel records (a tool result's effects). */
const changedPaths = (value: unknown): unknown[] => typeof value !== 'object' || value === null ? []
  : [...('changedPaths' in value && Array.isArray(value.changedPaths) ? [value.changedPaths] : []),
    ...Object.values(value).flatMap(changedPaths)];

it('GP-5: required reviewer, no review line → the platform opens one → the reviewer reads the Run → verdict → COMPLETED',
  async () => {
    const review = await openS9ReviewWorld({ reviewLine: 'none', write: true });
    const { world, goal, task, workLine } = review;
    try {
      const reviewerRole = JSON.stringify(platformRoleProfile('reviewer').template);
      const reviewLines = async (): Promise<SessionCard[]> => (await world.listSessions())
        .filter(card => JSON.stringify(card.record.role) === reviewerRole);
      expect(await reviewLines()).toEqual([]);
      const read = async <T>(route: string, input: unknown): Promise<T> =>
        ready<T>(await world.post(route, plain(S6A_SCOPE, input)), route);

      await world.scripted.script(workLine, [{ kind: 'calls', calls: [{ callId: 'gp5-edit', name: 'edit',
        args: { mode: 'create', path: CHANGED, newText: 'export const reviewed = true;\n' } }] },
      { kind: 'text', text: REPORT }]);
      await read('workflow/driver-start', { advance: { schemaVersion: 1, goalRef: goal, flowId: 'gp5-driver',
        sessionHint: null, kind: 'select_work' }, queryProfileIds: [] });
      const [card] = await waitFor(reviewLines, lines => lines.length === 1, 'GP-5: the platform-opened review line');
      const line: S6ASession = { label: 'gp5-review-line', aggregateRef: card!.record.ref,
        ref: { projectId: card!.record.ref.projectId, sessionId: card!.record.ref.sessionId },
        role: card!.record.role, createdAt: card!.record.createdAt };

      const planRef = (await read<{ goal: { activePlanRevision: unknown } }>('goals/read', goal)).goal.activePlanRevision;
      const look = async <T>(node: Record<string, unknown>, relation: string): Promise<T[]> => (await read<{ items: T[] }>(
        'graph/look', { goalRef: goal, target: { kind: 'node', node }, relation, page: { afterCursor: null, limit: 10 } })).items;
      const [opened] = (await look<{ round: RoundSnapshot }>({ kind: 'task', ref: task, planRef }, 'checks')).map(item => item.round);
      await world.scripted.script(line, [
        { kind: 'calls', calls: [{ callId: 'gp5-history', name: 'read_execution_history', args: { limit: 20 } }] },
        { kind: 'calls', calls: [{ callId: 'gp5-round', name: 'look_graph',
          args: { mode: 'node', target: { kind: 'round', ref: opened!.ref }, relation: 'card' } }] },
        { kind: 'calls', calls: [{ callId: 'gp5-verdict', name: 'submit_exec_review',
          args: { verdict: 'pass', basis: 'GP-5 basis', report: 'GP-5 review report' } }] }]);
      let phase = '';
      for (let pass = 0; pass < 40 && phase !== 'COMPLETED'; pass += 1) {
        await heartbeat(world);
        phase = (await read<{ display: { phase: string } }>('goals/display', { goalRef: goal })).display.phase;
      }

      // The review round went to the line the platform opened: one `execreview:` request in its inbox.
      const sent = (await listed(world, 'inbox', line)).filter(message => message.sender.kind === 'host'
        && message.sender.actor.id === 'host:plan-round');
      expect(sent).toHaveLength(1);
      expect((await readBody(world, sent[0]!.ref, 'message')).split('\n')[0]).toBe(`execreview:${opened!.ref.roundId}`);

      // ① What the reviewer read: the header names the reviewed Run and its check report; the tools served the Run's
      // own history and the round card with the check's PASS.
      const round = (await look<{ round: RoundSnapshot }>({ kind: 'round', ref: opened!.ref }, 'card'))[0]!.round;
      const check = round.checks.find(entry => entry.checkId === 's7a-static-check');
      expect(check).toMatchObject({ phase: 'finished', outcome: 'PASS' });
      const requests = await world.scripted.requests(line);
      const question = (requests[0]!.messages.find(message => message.role === 'user') as { content: string }).content;
      const header = (label: string): unknown => JSON.parse(question.split('\n')
        .find(entry => entry.startsWith(`${label}: `))!.slice(label.length + 2));
      expect(header('subjectRunRef')).toEqual(round.subjectRunRef);
      expect(header('checkRefs')).toEqual([check!.reportRef]);
      const tool = (callId: string): string => {
        const served = requests.at(-1)!.messages.find(message => message.role === 'tool' && message.callId === callId);
        return JSON.stringify(served?.role === 'tool' ? served.result : null);
      };
      const history = JSON.parse(tool('gp5-history')) as { output: { value: { value: { items: HistoryItem[] } } }[] };
      const records: unknown[] = history.output[0]!.value.value.items.map(item => JSON.parse(item.body.text));
      expect(JSON.stringify(records)).toContain(REPORT);
      expect(changedPaths(records)).toContainEqual([CHANGED]);
      expect(JSON.parse(tool('gp5-round'))).toMatchObject({ status: 'success', output: [{ value: { status: 'ready',
        value: { items: [{ round: { ref: opened!.ref, subjectRunRef: round.subjectRunRef,
          checks: [expect.objectContaining({ checkId: 's7a-static-check', outcome: 'PASS' })] } }] } } }] });

      // ② The verdict is the round's evidence next to the command check's.
      expect(round).toMatchObject({ status: 'finalized', outcome: 'PASS', gaps: [] });
      const evidence = (await look<{ evidence?: EvidenceV1[] }>({ kind: 'round', ref: round.ref }, 'evidence'))[0]?.evidence;
      expect(evidence?.map(item => item.evidenceId)).toEqual(round.evidenceRefs.map(ref => ref.evidenceId));
      expect(evidence?.map(item => [item.outcome, item.coverage])).toEqual([
        ['PASS', [{ obligationId: 's9-obligation', requirementId: 's9-static' }]],
        ['PASS', [{ obligationId: 's9-review-obligation', requirementId: 's9-review' }]]]);

      // ③ The Task is satisfied and the Goal completed.
      const tasks = (await read<{ tasks: { ref: { taskId: string }; effectivePhase: string }[] }>('tasks/query',
        { goalRef: goal })).tasks;
      expect(tasks.map(row => [row.ref.taskId, row.effectivePhase])).toEqual([['s9-work', 'satisfied'], ['s9-gate', 'satisfied']]);
      expect(phase).toBe('COMPLETED');
    } finally {
      await review.close();
    }
  }, 180_000);
