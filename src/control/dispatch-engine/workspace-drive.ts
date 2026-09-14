import type { WorkspaceDrivePort, WorkspaceDriveTriggerV1 } from '../../contracts/workspace-drive.js';
import type { DispatchEngineImpl } from './dispatch-engine.js';

/** Compatibility adapter: scoped parallel calls use the ordinary consumer's
 * execution slots, material preparation, start authorization and fact handling.
 * It owns neither a second scheduler nor a second recovery protocol.
 */
export class WorkspaceDriveEngineImpl implements WorkspaceDrivePort {
  constructor(private readonly ordinary: Pick<DispatchEngineImpl, 'driveOrdinary'>) {}

  driveParallel(trigger: WorkspaceDriveTriggerV1) {
    return this.ordinary.driveOrdinary(trigger, { projectId: trigger.projectId, goalId: trigger.goalId });
  }
}
