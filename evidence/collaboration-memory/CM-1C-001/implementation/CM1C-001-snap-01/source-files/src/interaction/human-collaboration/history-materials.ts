import type { ControlEngine } from '../../contracts/modules.js';
import type { ReadModelIndex } from '../../contracts/goal-view.js';
import type { HistoryMaterial, HistoryMaterialContextPort, HistoryMaterialPort } from '../../contracts/history-materials.js';
import type { MaterialAccessGrantV1, MaterialAccessScopeV1 } from '../../contracts/material-access.js';
import { materialAccessGrantRefFor } from '../../contracts/material-access.js';
import { buildGrantMaterialAccessCommand } from '../../contracts/commands/material-access.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';

const actor = { kind: 'human' as const, id: 'local-gui' };
function required(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim() || value.length > 1024) throw Error('无效字段：' + key);
  return value;
}

export type HistoryMaterialsDeps = {
  materials: HistoryMaterialContextPort;
  catalog: () => HistoryMaterial[];
  control: Pick<ControlEngine, 'grantMaterialAccess' | 'revokeMaterialAccess'>;
  grants: Pick<ReadModelIndex, 'materialAccessGrants'>;
  now: () => string;
};

/** Authenticated human intent, command identities and explicit historical
 * authorization. Context owns canonical material selection; Control owns the
 * final grant/revoke guards; display state comes from the cursor-bearing view. */
export class HistoryMaterials implements HistoryMaterialPort {
  constructor(private readonly deps: HistoryMaterialsDeps) {}

  async view(scope: MaterialAccessScopeV1): ReturnType<HistoryMaterialPort['view']> {
    return { materials: await this.deps.materials.available(scope, this.deps.catalog()), grants: await this.deps.grants.materialAccessGrants({ ...scope, limit: 256 }),
      coverage: '当前已保存的命令检查报告；来源选择不会自动授权。授权列表最多显示 256 条。' };
  }

  async grant(scope: MaterialAccessScopeV1, input: Record<string, unknown>): ReturnType<HistoryMaterialPort['grant']> {
    if (input['allowHistoricalRead'] !== true) throw Error('需要明确授权所选原始报告供目标运行读取');
    const requestId = required(input, 'requestId'), materialId = required(input, 'materialId'), runId = required(input, 'runId'), purpose = required(input, 'purpose');
    const id = 'human-history-' + sha256Hex(canonicalJson([scope, requestId])).slice(0, 40);
    const { item, reader, basis, originalGrantedAt } = await this.deps.materials.grantMaterials({ scope, materialId, runId, grantId: id, candidates: this.deps.catalog() });
    const grant: MaterialAccessGrantV1 = { schemaVersion: 1, grantId: id, scope, reader, materials: [item.artifactRef],
      issuedBy: { aggregateType: 'Control', projectId: scope.projectId, goalId: scope.goalId }, purpose, basis,
      grantedAt: originalGrantedAt ?? this.deps.now(), history: { owner: item.owner, usage: 'historical_explanation',
        ...(item.workspaceId !== scope.workspaceId ? { crossWorkspace: { sourceWorkspaceId: item.workspaceId, authorizedBy: actor } } : {}) } };
    const receipt = await this.deps.control.grantMaterialAccess(buildGrantMaterialAccessCommand(grant, {
      commandId: id, projectId: scope.projectId, actorKind: actor.kind, actorId: actor.id, idempotencyKey: id, correlationId: id, submittedAt: grant.grantedAt
    }));
    if (receipt.status !== 'committed') throw Error('历史授权被拒绝：' + receipt.code);
    return { receipt, grant };
  }

  async revoke(scope: MaterialAccessScopeV1, input: Record<string, unknown>): ReturnType<HistoryMaterialPort['revoke']> {
    const id = required(input, 'grantId'), reason = required(input, 'reason'), requestId = required(input, 'requestId');
    const receipt = await this.deps.control.revokeMaterialAccess({ schemaVersion: 1, commandType: 'RevokeMaterialAccess', commandId: requestId,
      identity: { projectId: scope.projectId, actor, idempotencyKey: requestId }, aggregateId: id, expectedRevision: 1, correlationId: requestId, submittedAt: this.deps.now(),
      payload: { grantRef: materialAccessGrantRefFor(scope.projectId, scope.workspaceId, scope.goalId, id), reason } });
    if (receipt.status !== 'committed') throw Error('撤销被拒绝：' + receipt.code);
    return receipt;
  }

  async read(scope: MaterialAccessScopeV1, input: Record<string, unknown>): ReturnType<HistoryMaterialPort['read']> {
    return this.deps.materials.read({ scope, grantId: required(input, 'grantId') });
  }
}
