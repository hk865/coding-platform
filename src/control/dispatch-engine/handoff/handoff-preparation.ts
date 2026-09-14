import type { StateLedger } from '../../../contracts/ledger.js';
import type { RuntimePreparationPort } from '../../../contracts/runtime-preparation.js';
import type { DispatchIntentV1 } from '../../../contracts/dispatch.js';
import type { HandoffPacketSnapshot, ReplacementAttemptSnapshot } from '../../../contracts/handoff.js';

/** Reconstruct replacement input from the registered packet and source RunSpec.
 * No current UI text, generated transcript or guessed runtime configuration. */
export async function prepareHandoffRun(deps: {
  ledger: Pick<StateLedger, 'load'>; runtime: RuntimePreparationPort;
  rootFor: (projectId: string, workspaceId: string) => string | null;
}, intent: DispatchIntentV1, replacement: ReplacementAttemptSnapshot): Promise<void> {
  const loaded = await deps.ledger.load(replacement.packetRef);
  if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'HandoffPacket') throw Error('Registered handoff packet missing');
  const packet = (loaded.snapshot as HandoffPacketSnapshot).packet;
  const source = deps.runtime.all().find(record => record.spec.projectId === packet.source.runRef.projectId &&
    record.spec.workspaceId === intent.workspaceId && record.spec.goalId === packet.source.runRef.goalId && record.spec.runId === packet.source.runRef.runId);
  if (!source || source.spec.mode !== undefined) throw Error('Ordinary source RunSpec unavailable; cannot infer replacement input');
  if (source.spec.projectId !== intent.projectId || source.spec.goalId !== intent.goalId || source.spec.taskId !== intent.taskId) throw Error('Handoff source scope differs from replacement');
  const root = deps.rootFor(intent.projectId, intent.workspaceId);
  if (root === null) throw Error('Replacement workspace is not registered');
  const spec = { ...source.spec, runId: intent.runRef.runId, root,
    instruction: source.spec.instruction + '\n\n' + packet.objective + '\n\nRead the registered bounded handoff Context. Preserve its constraints and unresolved items; completion claims require independent evidence.' };
  await deps.runtime.preflight(spec);
  await deps.runtime.prepare(spec);
}
