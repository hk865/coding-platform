import type { ReworkDrivePort, ReworkDriveRequestV1, ReworkDriveResultV1, ReworkDriveScopeV1 } from '../../contracts/rework/drive.js';
import type { ExecutionFeedbackCompiler } from '../../control/plan-compiler/execution-feedback-compiler.js';
import type { OpenIssuesRequestV1, OpenIssuesViewV1 } from '../../contracts/rework/issues.js';

/** Capture public verification/feedback facts at the Host seam. Rework creates
 * canonical plans only; the separate planning scan owns worker scheduling. */
export async function continueRework(deps: {
  drive: Pick<ReworkDrivePort, 'driveRework'>;
  feedback?: Pick<ExecutionFeedbackCompiler, 'requestFailures' | 'renew' | 'failureResolution'>;
  issues: (request: OpenIssuesRequestV1) => Promise<OpenIssuesViewV1>;
  driveQueries: () => Promise<unknown>;
}, scope: ReworkDriveScopeV1): Promise<ReworkDriveResultV1> {
  const request: ReworkDriveRequestV1 = { schemaVersion: 1, ...scope };
  const accepted: ReworkDriveResultV1['acceptedPlanRefs'] = [];
  for (;;) {
    request.issueMaterials = await deps.issues({ ...request, taskIds: [] });
    if (deps.feedback) {
      const refs = await deps.feedback.requestFailures(request.issueMaterials);
      if (refs.length) await deps.feedback.renew(scope);
      await deps.driveQueries();
      request.coordination = [];
      for (const ref of refs) {
        const result = await deps.feedback.failureResolution(ref.queryJobId);
        if (result) request.coordination.push(result);
      }
    }
    const result = await deps.drive.driveRework(request);
    accepted.push(...result.acceptedPlanRefs);
    if (!deps.feedback || !result.acceptedPlanRefs.length) return { ...result, acceptedPlanRefs: accepted };
  }
}
