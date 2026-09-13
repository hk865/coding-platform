import type { ReworkDrivePort } from '../contracts/rework/drive.js';
import type { OpenIssuesRequestV1, OpenIssuesViewV1 } from '../contracts/rework/issues.js';
import { ReworkDriveEngine, type ReworkDriveDeps } from '../control/dispatch-engine/rework-drive.js';
import { ControlReworkDisposition } from '../control/control-engine/rework-disposition.js';
import type { StateLedger } from '../contracts/ledger.js';

/** Host-only reader used to capture Verification material before calling Dispatch. */
export type ReworkIssueReadPort = (request: OpenIssuesRequestV1) => Promise<OpenIssuesViewV1>;

/** Composition only: capture verification material outside Dispatch, then hand
 * it to the module. Control owns currentness; Dispatch owns all sequencing. */
export function composeReworkDrive(deps: Omit<ReworkDriveDeps, 'disposition'> & { issues: ReworkIssueReadPort }): ReworkDrivePort {
  const engine = new ReworkDriveEngine({ ledger: deps.ledger, control: deps.control, disposition: new ControlReworkDisposition(deps.ledger as StateLedger),...(deps.coordination?{coordination:deps.coordination}:{}) });
  const material = async (request: Parameters<ReworkDrivePort['driveRework']>[0]) => ({ ...request,
    issueMaterials: request.issueMaterials ?? await deps.issues({ ...request, taskIds: [] }) });
  return {
    driveRework: async request => engine.driveRework(await material(request)),
    reworkView: async request => engine.reworkView(await material(request)),
  };
}
