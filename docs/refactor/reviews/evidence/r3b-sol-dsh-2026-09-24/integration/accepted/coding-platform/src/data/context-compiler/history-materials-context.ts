import type { ArtifactOpenResult, ArtifactPort, ArtifactRecord, ArtifactRef } from '../../contracts/artifact.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { ReadResult } from '../../contracts/core/results.js';
import type { MaterialPort } from '../../core/work-graph/materials/contracts.js';
import type { RunRef, RunSnapshot } from '../../contracts/dispatch.js';
import type { StateLedger } from '../../contracts/ledger.js';
import type {
  MaterialAccessGrantSnapshot,
  MaterialAccessGrantV1,
  MaterialAccessResolver,
  MaterialAccessScopeV1,
} from '../../contracts/material-access.js';
import { sameArtifactOwnerRunRef } from '../../contracts/material-access.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { grantIssuerOwnsMaterial } from '../../core/work-graph/materials/applicability.js';
import type { HistoryMaterial, HistoryMaterialContextPort, HistoryMaterialRead } from '../../contracts/history-materials.js';

export type HistoryMaterialsContextDeps = {
  ledger: Pick<StateLedger, 'load'>;
  vault: Pick<ArtifactPort, 'open'>;
  /** Trusted service route binds this only after project/workspace scope validation. */
  materials?: Pick<MaterialPort, 'openArtifact'>;
  readHostContext?: (scope: MaterialAccessScopeV1) => CoreCallContext;
  /** Reuses canonical recorded-grant/current-basis checks before Host body access. */
  grantAuthority?: MaterialAccessResolver;
};

/** The Host path needs the canonical basis check as a real capability: without
 * it the page grant cannot be re-verified before and after the body read. The
 * legacy `MaterialAccessResolver` keeps its optional method for old callers. */
type HostGrantAuthority = MaterialAccessResolver & {
  currentBasisValid(grant: MaterialAccessGrantV1): Promise<boolean>;
};
type HostMaterialPath = {
  materials: Pick<MaterialPort, 'openArtifact'>;
  readHostContext: (scope: MaterialAccessScopeV1) => CoreCallContext;
  grantAuthority: HostGrantAuthority;
};

/** Resolves source provenance, target versions and previously recorded grants.
 * The catalog is only a candidate finder; exact Ledger reads decide whether
 * material can be selected. Ordinary reads go through the trusted Host port so
 * a plain display never impersonates a Run; the page grant still decides body
 * access. Without the Host port the legacy owner/grant read is unchanged. */
export class HistoryMaterialsContext implements HistoryMaterialContextPort {
  private readonly host?: HostMaterialPath;

  constructor(private readonly deps: HistoryMaterialsContextDeps) {
    const injected = [deps.materials, deps.readHostContext, deps.grantAuthority]
      .filter(part => part !== undefined).length;
    // The Host entry is all-or-nothing: a partial injection must not silently
    // fall back to the legacy path and read material as the recorded owner.
    if (injected !== 0 && injected !== 3) {
      throw Error('HistoryMaterialsContext: materials, readHostContext and grantAuthority must be injected together');
    }
    if (deps.materials !== undefined && deps.readHostContext !== undefined && deps.grantAuthority !== undefined) {
      const currentBasisValid = deps.grantAuthority.currentBasisValid;
      if (currentBasisValid === undefined) {
        throw Error('HistoryMaterialsContext: the Host material path requires grantAuthority.currentBasisValid to recheck the canonical basis');
      }
      this.host = {
        materials: deps.materials,
        readHostContext: deps.readHostContext,
        grantAuthority: { grantsFor: deps.grantAuthority.grantsFor, currentBasisValid },
      };
    }
  }

  async available(scope: MaterialAccessScopeV1, candidates: HistoryMaterial[]): ReturnType<HistoryMaterialContextPort['available']> {
    const materials: HistoryMaterial[] = [];
    const hostContext = this.host?.readHostContext(scope);
    for (const item of candidates.filter(item => item.owner.projectId === scope.projectId)) {
      const source = await this.run(item.owner, item.workspaceId);
      if (!source) continue;
      if (this.host && hostContext) {
        const opened = await this.host.materials.openArtifact(hostContext, { ref: item.artifactRef, usage: 'historical_explanation' });
        if (opened.status === 'ready' && sameArtifactOwnerRunRef(opened.value.ownerRunRef ?? null, item.owner)) materials.push(item);
        continue;
      }
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
    const historyOwner = grant.history.owner;
    const ref = grant.materials[0]!;
    if (this.host) {
      // The page grant is a separate authority from the Host body port: the
      // recorded grant must still resolve to the exact canonical record with a
      // current basis and (for another workspace) an explicit human history
      // authorization. A stale basis is returned on the old wire, never open.
      const candidates = await this.host.grantAuthority.grantsFor(ref, grant.reader);
      const canonical = candidates.find(candidate => canonicalJson(candidate) === canonicalJson(grant));
      if (canonical === undefined) return forbiddenRead(grant);
      // The resolver only offers canonical candidates; the issuer/history
      // validity is the shared WorkGraph rule the legacy Vault also applies.
      if (!grantIssuerOwnsMaterial(canonical, historyOwner)) return forbiddenRead(grant);
      if (!await this.host.grantAuthority.currentBasisValid(canonical)) return staleRead(grant);
      const hostContext = this.host.readHostContext(scope);
      const opened = await this.host.materials.openArtifact(hostContext, { ref, usage: 'historical_explanation' });
      // The recorded history grant must name the material's actual owner; the
      // Host body scope does not replace that exact page-grant check.
      if (opened.status === 'ready' && !sameArtifactOwnerRunRef(opened.value.ownerRunRef ?? null, historyOwner)) return forbiddenRead(grant);
      // One body read only. A revocation or version move that committed during
      // the I/O must still refuse to hand the body back; the workspace is not
      // re-captured and the snapshot is not re-read.
      if (!await this.host.grantAuthority.currentBasisValid(canonical)) return staleRead(grant);
      return { grant, result: mapCoreRead(opened, ref), applicability: 'historical_explanation' };
    }
    const result = await this.deps.vault.open(ref, {
      requesterRunRef: grant.reader, currentBasis: grant.basis, includeOwner: true, usage: 'historical_explanation'
    });
    // The legacy Vault resolver independently rechecks revocation and current
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

/** The page grant exists canonically but is no longer authorized for this reader. */
function forbiddenRead(grant: MaterialAccessGrantV1): HistoryMaterialRead {
  return {
    grant,
    result: { status: 'rejected', code: 'forbidden', issues: ['the recorded history grant is not currently authorized for this reader and scope'] },
    applicability: 'historical_explanation',
  };
}

function staleRead(grant: MaterialAccessGrantV1): HistoryMaterialRead {
  return {
    grant,
    result: { status: 'rejected', code: 'stale', issues: ['the recorded history grant basis is no longer current; re-source the exact material'] },
    applicability: 'historical_explanation',
  };
}

/** Core ReadResult -> legacy ArtifactOpenResult; rejected outcomes keep the reason. */
function mapCoreRead(opened: ReadResult<ArtifactRecord>, ref: ArtifactRef): ArtifactOpenResult {
  if (opened.status === 'ready') return { status: 'ready', record: opened.value };
  if (opened.status === 'not_found') return { status: 'unavailable', ref };
  switch (opened.code) {
    case 'forbidden': return { status: 'rejected', code: 'forbidden', issues: [opened.reason] };
    case 'source_stale': return { status: 'rejected', code: 'stale', issues: [opened.reason] };
    default: return { status: 'rejected', code: 'invalid', issues: [opened.reason] };
  }
}
