/**
 * KLS-2: the knowledge lines a test that builds an architecture or note service
 * directly hands it. It is the real `createKnowledgeLines` over the test's own
 * temporary root for one (project, workspace); any other workspace is not
 * registered there. Every service of one test world takes the same root, so a
 * write through one is read through another.
 */
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import { createKnowledgeLines } from '../../src/composition/line-knowledge.js';
import type { KnowledgeLines } from '../../src/core/work-graph/model/line-knowledge.js';

export function knowledgeLinesFor(input: { root: string; projectId: string; workspaceId: string;
  records: Pick<GoalRecordTransactionPort, 'readMany'> }): KnowledgeLines {
  return createKnowledgeLines({
    resolveRoot: async workspace => workspace.projectId === input.projectId && workspace.workspaceId === input.workspaceId
      ? { status: 'ready', value: { root: input.root, workspaceRevision: 0 } }
      : { status: 'rejected', code: 'not_found', reason: 'the workspace is not the fixture workspace' },
  }, { records: input.records }, {});
}
