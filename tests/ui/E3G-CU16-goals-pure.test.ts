import { describe, expect, it } from 'vitest';
import { adaptGoals } from '../../src/ui/adapters/goals.js';
import type { GoalRef } from '../../src/contracts/ledger.js';

/** E3G CU16 (batch 16b, Q4): one accepted-risk label per Goal pair, written as
 * 目标 n, conflict first. A pure row (A5). */
const ref = (goalId: string): GoalRef => ({ aggregateType: 'Goal', projectId: 'p', goalId });

function row(goalId: string, ordinal: number, objective: string): Record<string, unknown> {
  return { ref: ref(goalId), revision: 1, ordinal, objective, order: ordinal,
    autonomy: 'after_plan_confirmation', waitForGoalRef: null, display: { phase: 'RUNNING' } };
}

describe('E3G CU16 accepted-risk labels', () => {
  it('P16-3 every Goal pair gets its own 目标 n label, and conflict comes first', () => {
    const data = adaptGoals({
      goals: { goals: [row('g1', 1, '目标一'), row('g2', 2, '目标二'), row('g3', 3, '目标三')] },
      conflicts: {
        cards: [{ state: 'waiting_answer', source: { pins: [{ ref: ref('g1') }, { ref: ref('g3') }] },
          objects: [], options: [] }],
        labels: [
          { goalRef: ref('g1'), otherGoalRef: ref('g2'), text: '与 g2 并行，已接受风险' },
          { goalRef: ref('g2'), otherGoalRef: ref('g1'), text: '与 g1 并行，已接受风险' },
        ],
      },
    }, null);
    const line = (goalId: string): string => data.goals.find((goal) => goal.id === goalId)!.line;
    /* 具名改坏: `labelOfEntry` 继续读 Host 的 `text`；本行的“目标 2”红。 */
    expect(line('g2')).toContain('与目标 1 并行，已接受风险');
    const first = line('g1');
    expect(first).toContain('与目标 3 冲突');
    expect(first).toContain('与目标 2 并行，已接受风险');
    expect(first.indexOf('与目标 3 冲突')).toBeLessThan(first.indexOf('与目标 2 并行，已接受风险'));
    for (const goal of data.goals) {
      for (const raw of ['g1', 'g2', 'g3']) expect(goal.line).not.toContain(raw);
    }
  });

  it('16a(a) the 工作线 fact names the line as the left rail and task map do (lineNameOf)', () => {
    const data = adaptGoals({ goals: { goals: [row('g1', 1, '目标一')] },
      lines: { rows: [{ name: { primary: '甲', extraCount: 2 }, groups: { task: { goalId: 'g1' } } }] } }, null);
    /* 具名改坏: `workLineOf` 回到裸 `primary`；本行少了“等 2 项”而红。 */
    expect(data.goals[0]!.kv.line).toBe('甲 等 2 项');
  });
});
