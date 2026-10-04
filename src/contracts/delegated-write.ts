/** Delegated (Agent) write provenance shared by plan writes and rework writes. */
import type { SessionRef } from './core/identity.js';
import type { RoleBindingRefV1, RunRef } from './dispatch.js';

/**
 * Versioned Agent submission provenance (W2 §8.1; spec §4 TD-6).
 *
 * The runtime produces this; candidate input never supplies it. It records the
 * exact formal Run/Session/Role binding and the two authorization generations
 * the write was admitted against. `authorizationRevision` is the entry
 * binding's own revision, never the Run revision. A record without it stays
 * readable under the legacy/Host path and must never be inferred to have an
 * Agent author. The JSON shape is the former `PlanWriteProvenanceV1` unchanged.
 */
export type DelegatedWriteProvenanceV1 = {
  schemaVersion: 1;
  runRef: RunRef;
  sessionRef: SessionRef;
  roleBinding: RoleBindingRefV1;
  sessionGeneration: number;
  entryGeneration: number;
  authorizationRevision: number;
  configurationRevision: string;
};
/** Former name, kept so PlanProposal readers and codecs need no change. */
export type PlanWriteProvenanceV1 = DelegatedWriteProvenanceV1;
