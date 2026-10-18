/**
 * K3 group 4 rework 2 item 12 (decision 75): ONE shared set of `RunRef`,
 * `TaskTriple` and `SessionMessageRef` field checks for the UCR and CRR codecs.
 *
 * The label is part of the decoded rejection reason, so the same check must
 * keep each caller's exact sentence. These are pure functions (input → output),
 * so they are called directly; the two body decoders prove each caller still
 * passes its own label.
 */
import { describe, expect, it } from 'vitest';
import {
  runRefProblem, sessionMessageRefProblem, taskTripleProblem,
} from '../../src/core/work-graph/tasks/codec-shape-checks.js';
import { commandRerunRequestBodyProblem } from '../../src/core/work-graph/tasks/command-rerun-request-codecs.js';
import { unknownCallReviewBodyProblem } from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';

const RUN = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r' };
const TASK = { projectId: 'p', goalId: 'g', taskId: 't' };
const MESSAGE = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'w', messageId: 'm' };

describe('K3-50 codec shape checks: one shared set, the caller keeps the label', () => {
  it('accepts exactly the complete shapes and refuses an extra or empty field', () => {
    expect(runRefProblem(RUN, 'review runRef')).toBeNull();
    expect(runRefProblem({ ...RUN, extra: 1 }, 'review runRef'))
      .toBe('review runRef must be a complete RunRef');
    expect(runRefProblem({ ...RUN, runId: '' }, 'review runRef'))
      .toBe('review runRef must be a complete RunRef');
    expect(taskTripleProblem(TASK, 'review task')).toBeNull();
    expect(taskTripleProblem({ projectId: 'p', goalId: '', taskId: 't' }, 'review task'))
      .toBe('review task must be a complete TaskTriple');
    expect(sessionMessageRefProblem(MESSAGE, 'request answerMessageRef')).toBeNull();
    expect(sessionMessageRefProblem({ ...MESSAGE, messageId: '' }, 'request answerMessageRef'))
      .toBe('request answerMessageRef must be a complete SessionMessageRef');
  });

  it('the UCR decoder keeps its "review task"/"review runRef" sentences', () => {
    const base = {
      ref: { aggregateType: 'UnknownCallReview', projectId: 'p', goalId: 'g', runId: 'r' },
      schemaVersion: 1, revision: 1, workspaceId: 'w', task: TASK, runRef: RUN,
    };
    expect(unknownCallReviewBodyProblem({ ...base, task: { projectId: 'p', goalId: '', taskId: 't' } }))
      .toBe('review task must be a complete TaskTriple');
    expect(unknownCallReviewBodyProblem({ ...base, runRef: { ...RUN, runId: '' } }))
      .toBe('review runRef must be a complete RunRef');
  });

  it('the CRR decoder keeps its "task"/"request runRef" sentences', () => {
    const base = {
      ref: { aggregateType: 'CommandRerunRequest', projectId: 'p', goalId: 'g', taskId: 't', requestId: 'q' },
      schemaVersion: 1, revision: 1, workspaceId: 'w', task: TASK,
      reviewRef: { aggregateType: 'UnknownCallReview', projectId: 'p', goalId: 'g', runId: 'r' },
      runRef: RUN,
    };
    expect(commandRerunRequestBodyProblem({ ...base, task: { projectId: 'p', goalId: '', taskId: 't' } }))
      .toBe('task must be a complete TaskTriple');
    expect(commandRerunRequestBodyProblem({ ...base, runRef: { ...RUN, runId: '' } }))
      .toBe('request runRef must be a complete RunRef');
  });
});
