/**
 * G8B-1a 施工方补测（lead 11-17 18:2x 裁定 4）：同一份候选同一版的批检查请知悉只有一个身份，不因为种类（批了 / 交人）
 * 不同出第二行；其余种类的身份照旧带种类。改前红在两种批检查请知悉的 noticeId 不同。
 */
import { describe, expect, it } from 'vitest';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { DecisionSubjectV1 } from '../../src/contracts/goal-decisions.js';
import { projectNoticeIdentity } from '../../src/core/work-graph/state/project-notice.js';

const subject: DecisionSubjectV1 = { kind: 'goal', goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' } };
const operation: OperationRef = { aggregateType: 'CoreOperation', projectId: 'p', operationId: 'check-approval:prop:1' };

describe('G8B1a: the check-approval notice identity', () => {
  it('the approved and the to-person notice of one candidate version share one identity', () => {
    expect(projectNoticeIdentity({ subject, kind: 'check_approved', operation }))
      .toEqual(projectNoticeIdentity({ subject, kind: 'check_to_person', operation }));
  });

  it('other kinds keep the kind in their identity', () => {
    expect(projectNoticeIdentity({ subject, kind: 'command_review', operation }).noticeId)
      .not.toBe(projectNoticeIdentity({ subject, kind: 'workspace_removed', operation }).noticeId);
    expect(projectNoticeIdentity({ subject, kind: 'command_review', operation }).noticeId)
      .not.toBe(projectNoticeIdentity({ subject, kind: 'check_approved', operation }).noticeId);
  });
});
