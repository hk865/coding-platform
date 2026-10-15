/**
 * Slice 2B BE1 acceptance row 2B-04 (spec §5.2, entry BE1).
 *
 * One Run in UTC 10:00–10:59 calls five tools through the real Runtime and the
 * frozen Kernel: `edit` changes `a.ts`, `edit` creates `b.ts`, `edit` replaces
 * `c.ts` with identical old/new text, one `read`, one `look_graph`. Everything
 * is asserted through the public reads only (`readRunActivities`,
 * `readActivityCalendar`, `decisions.queryGoalConflicts`); the fixture
 * (`S2B-be1-platform-fixture.ts`) builds the platform and moves only `Date`.
 */
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import type { ActivityCalendarV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import { createS2BBe1Platform, S2B_SLOW_TIMEOUT_MS, type S2BBe1PlatformFixture } from '../helpers/S2B-be1-platform-fixture.js';

const A_BODY = 'alpha original\n';
const C_BODY = 'c same text\n';
const revOf = (body: string) => createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');

const opened: S2BBe1PlatformFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

it('2B-04 counts five real tool calls (2 edits, 1 identical edit, read, graph look) at Run end and reads the hour cell', async () => {
  const f = await createS2BBe1Platform({
    toolNames: ['read', 'write', 'look_graph'],
    writeScope: ['.'],
    initialAt: '2026-10-15T10:05:00.000Z',
    workspaceFiles: { 'a.ts': A_BODY, 'c.ts': C_BODY },
    scriptedReplies: [
      { kind: 'calls', calls: [
        { callId: 'be1-edit-a', name: 'edit', args: { mode: 'replace', path: 'a.ts',
          oldText: 'alpha', newText: 'beta', expectedRevision: revOf(A_BODY) } },
        { callId: 'be1-create-b', name: 'edit', args: { mode: 'create', path: 'b.ts', newText: 'bravo\n' } },
        { callId: 'be1-edit-c', name: 'edit', args: { mode: 'replace', path: 'c.ts',
          oldText: 'c same text', newText: 'c same text', expectedRevision: revOf(C_BODY) } },
        { callId: 'be1-read', name: 'read', args: { path: 'a.ts' } },
        { callId: 'be1-look', name: 'look_graph', args: { mode: 'node',
          target: { kind: 'task', ref: { projectId: 'r4c-claim-project', goalId: 'r4c-claim-goal', taskId: 'implement-a' },
            planRef: { aggregateType: 'PlanRevision', projectId: 'r4c-claim-project', planId: 'r4c-claim-plan' } } } },
      ] },
      { kind: 'text', text: '2B-04 done' },
    ],
  });
  opened.push(f);

  const record = await f.run('2b04');
  expect(record.run.status).toBe('ended');
  expect(record.run.outcome).toBe('completed');

  // Fixture-observable sanity (not a store read): the identical `c.ts` edit really
  // succeeded with `confirmed` effects, and the graph look really returned, so
  // the tally's exclusion of `c.ts` is the L1 row-1 rule and not a failed call.
  const followUp = f.scripted.requests.at(-1);
  const resultOf = (callId: string) => followUp?.messages.find(message => message.role === 'tool' && message.callId === callId);
  expect(resultOf('be1-edit-c')).toMatchObject({ result: { status: 'success',
    effects: { sideEffect: 'confirmed', changedPaths: ['c.ts'] } } });
  expect(resultOf('be1-look')).toMatchObject({ result: { status: 'success' } });

  const views = await f.readRuns();
  expect(views).toHaveLength(1);
  expect(views[0]).toMatchObject({
    status: 'counted', reason: null, error: false,
    totals: { steps: 5, edits: 2, editsUnknown: 0 },
    changedFiles: { definite: 2, possible: 0, possiblyIncomplete: false },
    recordedBy: 'run_end', countedThroughTurnEnd: true, unresolvedCalls: 0,
  });
  // The end commit's platform time (the fixture's only replaced clock).
  expect(views[0]?.recordedAt).toBe('2026-10-15T10:05:00.000Z');

  const calendar: ActivityCalendarV1 = await f.calendar({ goalRef: f.goalRef,
    from: '2026-10-15T10:00:00.000Z', to: '2026-10-15T11:00:00.000Z', granularity: 'hour', timeZone: 'UTC' });
  const cell = calendar.cells.find(candidate => candidate.localHour === 10);
  expect(cell).toMatchObject({ localDate: '2026-10-15', steps: 5, edits: 2, editsUnknown: 0, complete: true,
    uncountedRuns: 0, inProgressRuns: 0 });
  expect(calendar.totals).toMatchObject({ steps: 5, edits: 2, editsUnknown: 0, complete: true });

  const conflicts = await f.platform.decisions.queryGoalConflicts(f.ctx, { workspace: f.scope });
  expect(conflicts.status).toBe('ready');
  if (conflicts.status !== 'ready') return;
  const completeness = conflicts.value.footprintCompleteness.find(entry => entry.goalRef.goalId === f.goalRef.goalId);
  expect(completeness).toBeDefined();
  expect([...(completeness?.unmappedFiles ?? [])].sort()).toEqual(['a.ts', 'b.ts']);
  expect(completeness?.unmappedFiles).not.toContain('c.ts');
}, S2B_SLOW_TIMEOUT_MS);
