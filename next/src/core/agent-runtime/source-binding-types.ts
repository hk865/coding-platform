import type { ReviewerProfileV1 } from '../../contracts/reviewer-context.js';
import type { ReviewWorkRef } from '../../contracts/reviewer-work.js';

/** Fields of a prepared Work Run that the source binding actually reads. */
export type SourceRunSpec = {
  mode?: 'explore' | 'review';
  review?: { workRef: ReviewWorkRef; profile: ReviewerProfileV1 };
  projectId: string;
  workspaceId: string;
  goalId: string;
  runId: string;
  taskId: string;
  root: string;
};
