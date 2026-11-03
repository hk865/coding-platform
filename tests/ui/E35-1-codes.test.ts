import { describe, expect, it } from 'vitest';
import { adaptTaskMap, adaptTaskMapDetail, adaptTaskMapTime, type TaskMapDisplayRead, type TaskMapGoalRead, type TaskMapGraphRead, type TaskMapSummaryRead } from '../../src/ui/adapters/task-map.js';

/** E35-1 (DESIGN `:604`, E3I:21): no English code reaches the page — duty names, relation codes; rework reasons are E35-4's 4.7 row. */

const GOAL = { goal: { ref: { goalId: 'e35-1-g' }, objective: 'E35-1 目标' } } as TaskMapGoalRead;
const RUNNING = { display: { phase: 'RUNNING' } } as TaskMapDisplayRead;
const key = (sessionId: string) => ({ projectId: 'e35-1-p', sessionId });
const DUTY = { primary: 'executor', source: 'duty_only' };
const task = (extra: Record<string, unknown> = {}) => ({ definition: { taskId: 't', title: 'T' }, effectivePhase: 'failed', ...extra });
const graph = (row: unknown) => ({ plan: { stages: [], executionDag: { dependsOn: [] } }, tasks: [row] }) as TaskMapGraphRead;
const summary = (extra: Record<string, unknown> = {}) => ({ section: 'summary', task: { task: { taskId: 't' }, ...extra } }) as TaskMapSummaryRead;

describe('E35-1 codes become words', () => {
  it('E35-1 1.1 a line named only by its duty is 执行者 in the track, the participants and the owner', () => {
    /* Named mutation: keep a duty_only name's code (executor) in the three places. */
    expect(adaptTaskMapTime([], null, null, [{ key: key('s1'), name: DUTY }], '2026-10-04T06:00:00.000Z').rows[0]!.name).toBe('执行者');
    expect(adaptTaskMap(GOAL, graph(task()), RUNNING, { hover: { tasks: [{ task: { taskId: 't' }, owners: [{ name: DUTY }] }] } }).dag.owners.t).toBe('执行者');
    const detail = adaptTaskMapDetail(summary(), [{ items: [{ key: key('s1'), name: DUTY, via: 'participates' }] }], null, null, 'failed');
    expect(detail!.participants[0]!.name).toBe('执行者');
  });

  it('E35-1 1.2 a relation code is 现在负责 or 曾参与, an unknown one is empty', () => {
    /* Named mutation: print the relation code (responsible) as it comes. */
    const items = ['responsible', 'participates', 'investigated', 'claimed', 'e35_new', 'responsible']
      .map((via, i) => ({ key: key('s' + i), name: { primary: '线 ' + i }, via }));
    const detail = adaptTaskMapDetail(summary({ responsibleNow: [{ key: key('s5'), name: { primary: '线 5' } }] }), [{ items }], null, null, 'failed');
    expect(detail!.participants.map((p) => p.text)).toEqual(['曾参与', '曾参与', '曾参与', '曾参与', '', '现在负责']);
  });
});
