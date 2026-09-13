import type { ArtifactOpenResult, ArtifactRef } from './artifact.js';
import type { RunRef } from './dispatch.js';
import type { MaterialAccessGrantV1, MaterialAccessGrantViewResult, MaterialAccessScopeV1, MaterialBasisV1, GrantMaterialAccessReceipt, RevokeMaterialAccessReceipt } from './material-access.js';

export type HistoryMaterial = { id: string; label: string; workspaceId: string; owner: RunRef; artifactRef: ArtifactRef };
export type HistoryMaterialRead = { grant: MaterialAccessGrantV1; result: ArtifactOpenResult; applicability: 'historical_explanation' };

/** HumanCollaboration's authenticated human entry point. Invalid intent and
 * refused commands throw; Vault unavailable/rejected results remain explicit.
 * Listing/selecting a report grants no authority. Repeated requestId retains the
 * original grant identity, basis and time; changed intent is a Control conflict. */
export interface HistoryMaterialPort {
  view(scope: MaterialAccessScopeV1): Promise<{ materials: HistoryMaterial[]; grants: MaterialAccessGrantViewResult; coverage: string }>;
  grant(scope: MaterialAccessScopeV1, input: Record<string, unknown>): Promise<{ receipt: Extract<GrantMaterialAccessReceipt, { status: 'committed' }>; grant: MaterialAccessGrantV1 }>;
  revoke(scope: MaterialAccessScopeV1, input: Record<string, unknown>): Promise<Extract<RevokeMaterialAccessReceipt, { status: 'committed' }>>;
  read(scope: MaterialAccessScopeV1, input: Record<string, unknown>): Promise<HistoryMaterialRead>;
}

/** Context selects canonical historical sources and target version materials.
 * It neither grants access nor changes durable facts. A returned original time
 * denotes a previously recorded grant, never a newly inferred authorization. */
export interface HistoryMaterialContextPort {
  available(scope: MaterialAccessScopeV1, candidates: HistoryMaterial[]): Promise<HistoryMaterial[]>;
  grantMaterials(query: { scope: MaterialAccessScopeV1; materialId: string; runId: string; grantId: string; candidates: HistoryMaterial[] }): Promise<{
    item: HistoryMaterial; reader: RunRef; basis: MaterialBasisV1; originalGrantedAt: string | null;
  }>;
  read(query: { scope: MaterialAccessScopeV1; grantId: string }): Promise<HistoryMaterialRead>;
}
