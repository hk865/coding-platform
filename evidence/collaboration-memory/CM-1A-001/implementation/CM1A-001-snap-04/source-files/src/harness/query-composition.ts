import { QueryJobDriveEngineImpl, type QueryJobDriveDeps } from '../control/dispatch-engine/query-drive.js';

/** Host projection sequencing only. Dispatch owns grants, queries and runs. */
export function composeQueryDrive(deps: QueryJobDriveDeps, advanceProjection: () => Promise<unknown>): QueryJobDriveEngineImpl {
  const control = deps.control;
  return new QueryJobDriveEngineImpl({ ...deps, control: {
    closeQueryJob: command => control.closeQueryJob(command),
    startQueryJob: command => control.startQueryJob(command),
    recordQueryAnswer: command => control.recordQueryAnswer(command),
    grantMaterialAccess: async command => {
      const receipt = await control.grantMaterialAccess(command);
      if (receipt.status === 'committed') await advanceProjection();
      return receipt;
    },
  } });
}
