// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
export type InitialDesignProposalRef = {
    aggregateType: "InitialDesignProposal";
    projectId: string;
    workspaceId: string;
    designId: string;
};
export type InitialDesignDecisionRef = {
    aggregateType: "InitialDesignDecision";
    projectId: string;
    workspaceId: string;
    decisionId: string;
};
export type CoordinationPolicyRevisionRef = {
    aggregateType: "CoordinationPolicyRevision";
    projectId: string;
    policyId: string;
    revision: number;
};
export type ProjectCoordinationPolicyActiveRef = {
    aggregateType: "ProjectCoordinationPolicyActive";
    projectId: string;
};

// Completed-capability migration: selected original declarations, no legacy service port.
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { RoleSpecPinV1 } from "./role-spec.js";
// ------------------------------------------------------------------------ //
// Coordination policy (versioned, budgeted, immutable; NOT widenable)       //
// ------------------------------------------------------------------------ //
/**
 * 项目的角色矩阵：哪些角色存在、各自被授权到哪一份 RoleSpecRevision，
 * 以及跨工作包议题由谁负责收敛。
 *
 * 为什么放在协调策略正文里而不是新聚合：ARCHITECTURE「角色、记忆与 Context 的责任归属」把
 * 「接受角色规格版本、绑定 Agent／Task、校验权限」归 Control 的既有治理面；角色矩阵就是
 * 这份治理事实的一部分；另开一个「角色管理器」会变成第二套治理机制，违反当前模块责任分配。
 *
 * 为什么可选：既有已安装的策略正文没有这个字段，收紧安装期形状会让既有正式来源失效。
 * 可选**不等于**「角色已校验」：没有矩阵的项目沿用引入角色矩阵前的绑定语义，Control 不编造默认目录；
 * 只有存在矩阵时 claim 守卫才校验角色存在、revision／digest 未过期与权限相符。
 */
export type CoordinationRoleMatrixV1 = {
    /** roleId -> 该项目授权的规格 pin（revision + 内容摘要）。 */
    catalog: Record<string, RoleSpecPinV1>;
    /** 跨工作包议题的收敛责任；roleId 必须是 catalog 的键（悬空声明在安装期即被拒）。 */
    coordinator: {
        roleId: string;
        note: string;
    };
};
export type CoordinationPolicyContentV1 = {
    schemaVersion: 1;
    budget: {
        maxAutonomousReworks: number;
        maxClarifications: number;
    };
    /**
     * 人的暂停开关：`inScopeRework` 是**运行时**被读的授权位，不是只做形状校验的声明。
     *   - true：范围内的返工（同义务、同验收语义、只换承担者）可以由平台按预算自动受理；
     *   - false：人已停用范围内的自动返工——自动受理入口在**每次受理时**读取当前生效策略的
     *     这一字段，返回 needs_human_decision 且零写入，之后每条失败都必须由人决定。
     * 允许取 false 不是放宽授权（它把授权收紧到零），也不新增命令、聚合或「暂停」状态：
     * 停用与重新启用都只是一次 install + activate。inScopeTesting 仍必须是 true：它目前没有运行时
     * 消费者，放宽它等于在没有判据的地方先降低安装期判据。
     */
    allowed: {
        inScopeRework: boolean;
        inScopeTesting: true;
    };
    scope: {
        changesRequireHumanDecision: [
            "requirement",
            "acceptance",
            "baseline"
        ];
    };
    upgrade: {
        path: "manual-decision";
        note: string;
    };
    /** 角色矩阵（可选；缺省表示该项目尚未登记角色目录，见 CoordinationRoleMatrixV1 注释）。 */
    roles?: CoordinationRoleMatrixV1;
};
export type CoordinationPolicyPin = {
    ref: CoordinationPolicyRevisionRef;
    digest: string;
};
export type CoordinationPolicyRevisionSnapshot = {
    ref: CoordinationPolicyRevisionRef;
    revision: 1;
    schemaVersion: 1;
    policyId: string;
    contentRevision: number;
    content: CoordinationPolicyContentV1;
    contentDigest: string;
    installedAt: string;
};
export type ProjectCoordinationPolicyActiveSnapshot = {
    ref: ProjectCoordinationPolicyActiveRef;
    projectId: string;
    activeRevision: CoordinationPolicyRevisionRef;
    revision: number;
};
export function coordinationPolicyContentDigest(content: CoordinationPolicyContentV1, policyId: string, revision: number): string {
    return sha256Hex(canonicalJson({ schemaVersion: 1, policyId, revision, content }));
}
