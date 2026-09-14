import type { ArtifactPort, ArtifactRef } from '../../contracts/artifact.js';
import type { ControlEngine } from '../../contracts/modules.js';
import { materialAccessGrantIdFor } from '../../contracts/material-access.js';
import { buildGrantMaterialAccessCommand, buildMaterialAccessGrantV1 } from '../../contracts/commands/material-access.js';
import { ExplorationContextCompiler, parseExplorationManifest, type ExplorationContextRequest } from '../../data/context-compiler/exploration-context-compiler.js';
import type { RunSpec } from '../../contracts/runtime-preparation.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type { ExplorationMaterialSourcePort } from '../../contracts/exploration-materials.js';
import type { ExplorationContextDrivePort } from '../../contracts/exploration-session.js';
import { canonicalJson } from '../../contracts/fingerprint.js';

const scopeKey = (scope: { projectId: string; workspaceId: string; goalId: string }) =>
    canonicalJson([scope.projectId, scope.workspaceId, scope.goalId]);
/** Dispatch prepares exact grants after Context selection and before model start.
 * The compiler never depends on Control; Vault revalidates each current read. */
export class ExplorationContextDrive implements ExplorationContextDrivePort {
    constructor(private readonly deps: {
        context: Pick<ExplorationContextCompiler, 'prerequisites' | 'select' | 'assemble'>;
        control: Pick<ControlEngine, 'grantMaterialAccess'>;
        vault: ArtifactPort;
        materials: ExplorationMaterialSourcePort;
    }) { }
    prerequisites(...args: Parameters<ExplorationContextCompiler['prerequisites']>) {
        return this.deps.context.prerequisites(...args);
    }
    async assembleRun(spec: RunSpec, envelope: TaskEnvelopeV1) {
        if (spec.mode !== 'explore' || scopeKey(spec) !== scopeKey(envelope) ||
            spec.taskId !== envelope.taskId || spec.runId !== envelope.runRef.runId) {
            throw Error('探索上下文范围不匹配');
        }
        const scope = { projectId: envelope.projectId, workspaceId: envelope.workspaceId, goalId: envelope.goalId };
        const materials = await this.deps.materials.read(scope);
        return this.assemble({ envelope, ...materials });
    }
    private async assemble(request: ExplorationContextRequest) {
        const selected = await this.deps.context.select(request);
        const { envelope: e, basis } = selected;
        const scope = {
            projectId: e.projectId, workspaceId: e.workspaceId, goalId: e.goalId
        };
        for (const { report, reviewRef } of selected.predecessors) {
            const grant = async (materials: ArtifactRef[], purpose: string) => {
                const record = buildMaterialAccessGrantV1({
                    grantId: materialAccessGrantIdFor(e.runRef, materials, basis), scope, materials, reader: e.runRef,
                    issuedBy: {
                        aggregateType: 'Control', projectId: e.projectId, goalId: e.goalId
                    }, purpose, basis, grantedAt: report.completedAt
                });
                const receipt = await this.deps.control.grantMaterialAccess(buildGrantMaterialAccessCommand(record, {
                    commandId: 'grant-' + record.grantId, projectId: e.projectId, actorKind: 'system', actorId: 'exploration-material-sharing',
                    idempotencyKey: record.grantId, correlationId: record.grantId, submittedAt: report.completedAt
                }));
                if (receipt.status !== 'committed')
                    throw Error('材料共享授权被拒绝：' + JSON.stringify(receipt));
            };
            await grant([report.artifactRef, reviewRef], '直接前驱报告清单及操作者审阅：精确消费者、计划与源码版本');
            const opened = await this.deps.vault.open(report.artifactRef, {
                requesterRunRef: e.runRef, currentBasis: basis, usage: 'current'
            });
            if (opened.status !== 'ready')
                throw Error('跨运行材料不可读或来源版本已失效');
            const manifest = parseExplorationManifest(opened.record.body, report);
            await grant(manifest.chunks, '直接前驱报告正文分块：同一消费者运行、同一来源版本');
        }
        return this.deps.context.assemble(selected);
    }
}
