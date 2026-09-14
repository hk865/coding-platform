import type { ArtifactPort } from '../../contracts/artifact.js';
import type { RunRef, RunSnapshot } from '../../contracts/dispatch.js';
import type { StateLedger } from '../../contracts/ledger.js';
import type { MaterialAccessGrantSnapshot, MaterialAccessScopeV1 } from '../../contracts/material-access.js';
import { sameArtifactOwnerRunRef } from '../../contracts/material-access.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import type { HistoryMaterial, HistoryMaterialContextPort } from '../../contracts/history-materials.js';

export type HistoryMaterialsContextDeps = {
  ledger: Pick<StateLedger, 'load'>;
  vault: Pick<ArtifactPort, 'open'>;
};

/** Resolves source provenance, target versions and previously recorded grants.
 * The catalog is only a candidate finder; exact Ledger and Vault reads decide
 * whether material can be selected. Vault remains the read authority. */
export class HistoryMaterialsContext implements HistoryMaterialContextPort {
  constructor(private readonly deps: HistoryMaterialsContextDeps) {}

  async available(scope: MaterialAccessScopeV1, candidates: HistoryMaterial[]): ReturnType<HistoryMaterialContextPort['available']> {
    const materials: HistoryMaterial[] = [];
    for (const item of candidates.filter(item => item.owner.projectId === scope.projectId)) {
      const source = await this.run(item.owner, item.workspaceId);
      if (!source) continue;
      const opened = await this.deps.vault.open(item.artifactRef, { requesterRunRef: item.owner, includeOwner: true });
      if (opened.status === 'ready' && sameArtifactOwnerRunRef(opened.record.ownerRunRef ?? null, item.owner)) materials.push(item);
    }
    return materials;
  }

  async grantMaterials({ scope, materialId, runId, grantId, candidates }: Parameters<HistoryMaterialContextPort['grantMaterials']>[0]): ReturnType<HistoryMaterialContextPort['grantMaterials']> {
    const item = (await this.available(scope, candidates)).find(item => item.id === materialId);
    if (!item) throw Error('来源报告不存在、已不可读或不属于当前项目');
    const reader: RunRef = { aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId };
    const run = await this.run(reader, scope.workspaceId);
    if (!run) throw Error('目标运行不属于当前目标和工作区');
    const ref = { aggregateType: 'Workspace' as const, projectId: scope.projectId, workspaceId: scope.workspaceId };
    const workspace = await this.deps.ledger.load(ref);
    if (workspace.status !== 'found' || canonicalJson(workspace.snapshot.ref) !== canonicalJson(ref)) throw Error('目标工作区不存在');
    const original = await this.grant(scope, grantId);
    return { item, reader,
      basis: original?.grant.basis ?? { planRef: run.planRef, workspaceRevision: workspace.snapshot.revision, sourceDigest: null },
      originalGrantedAt: original?.grant.grantedAt ?? null };
  }

  async read({ scope, grantId }: Parameters<HistoryMaterialContextPort['read']>[0]): ReturnType<HistoryMaterialContextPort['read']> {
    const snapshot = await this.grant(scope, grantId);
    if (!snapshot) throw Error('授权不存在');
    const grant = snapshot.grant;
    if (!grant.history || snapshot.revocation || snapshot.revision !== 1) throw Error('历史授权已撤销或不可用');
    const result = await this.deps.vault.open(grant.materials[0]!, {
      requesterRunRef: grant.reader, currentBasis: grant.basis, includeOwner: true, usage: 'historical_explanation'
    });
    // The canonical Vault resolver independently rechecks revocation and current
    // Workspace/Plan authority. Historical content never asserts current use.
    return { grant, result, applicability: 'historical_explanation' };
  }

  private async run(ref: RunRef, workspaceId: string): Promise<RunSnapshot | null> {
    const loaded = await this.deps.ledger.load(ref);
    if (loaded.status !== 'found' || canonicalJson(loaded.snapshot.ref) !== canonicalJson(ref)) return null;
    const snapshot = loaded.snapshot as RunSnapshot;
    return snapshot.workspaceSnapshot.workspaceId === workspaceId ? snapshot : null;
  }

  private async grant(scope: MaterialAccessScopeV1, grantId: string): Promise<MaterialAccessGrantSnapshot | null> {
    const ref = { aggregateType: 'MaterialAccessGrant' as const, ...scope, grantId };
    const loaded = await this.deps.ledger.load(ref);
    if (loaded.status !== 'found' || canonicalJson(loaded.snapshot.ref) !== canonicalJson(ref)) return null;
    const snapshot = loaded.snapshot as MaterialAccessGrantSnapshot;
    if (canonicalJson(snapshot.grant.scope) !== canonicalJson(scope) || snapshot.grant.grantId !== grantId) throw Error('历史授权作用域不匹配');
    return snapshot;
  }
}
