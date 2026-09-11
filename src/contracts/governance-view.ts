// Governance presentation and command-result wire shapes. No state or admission policy.
import type {
  ActorRef
} from './command-event.js';
import type {
  AggregateRef
} from './ledger.js';
import type {
  CompletionPolicyRevisionRef,
  ArchitectureBaselineRevisionRef
} from './governance.js';
import type {
  CoordinationPolicyRevisionRef
} from './human-role-collaboration.js';
import type {
  ArchitectureEvolutionPolicyRevisionRef
} from './architecture-evolution-policy.js';
import {
  projectRoleSpecActiveRefFor,
  type RoleSpecPinV1,
  type RoleSpecRevisionRef,
  type RoleSpecRevisionSnapshot
} from './role-spec.js';
import {
  canonicalJson,
  type JsonValue
} from './fingerprint.js';

export type RoleSpecPinReadinessV1 = {
  status: 'ready' | 'spec_not_installed' | 'spec_not_activated' | 'stale';
  roleId: string;
  message: string;
};
export interface GovernanceRolePolicyExplanationPort {
  roleSpecPinReadiness(facts: { roleId: string; pin: RoleSpecPinV1; pinnedSpec: RoleSpecRevisionSnapshot | null; activeRevision: RoleSpecRevisionRef | null }): RoleSpecPinReadinessV1;
}
export interface GovernanceViewPort {
  view(scope: GovernanceScopeV1): Promise<GovernanceViewV1>;
}

export type GovernanceKindV1 =
  | 'CompletionPolicy'
  | 'ArchitectureBaseline'
  | 'CoordinationPolicy'
  | 'ArchitectureEvolutionPolicy'
  | 'RoleSpecRevision';

/** 固定顺序：界面与测试都按这个顺序读，遍历顺序不影响结论。 */
export const GOVERNANCE_KINDS: readonly GovernanceKindV1[] = [
  'CompletionPolicy',
  'ArchitectureBaseline',
  'CoordinationPolicy',
  'ArchitectureEvolutionPolicy',
  'RoleSpecRevision',
];

/** 五个种类的 revision ref 并集：与各自契约里的 ref 完全相同，不做归一化。 */
export type GovernanceRevisionRefV1 =
  | CompletionPolicyRevisionRef
  | ArchitectureBaselineRevisionRef
  | CoordinationPolicyRevisionRef
  | ArchitectureEvolutionPolicyRevisionRef
  | RoleSpecRevisionRef;

export type GovernanceScopeV1 = { projectId: string; workspaceId: string };

/** 一条已安装的治理 revision：投影/快照事实 + 安装事件里的操作者与时间。 */
export type GovernanceRevisionViewV1 = {
  ref: GovernanceRevisionRefV1;
  /** source 自己的 revision（例如 fixture.revision）。 */
  contentRevision: number;
  contentDigest: string;
  /** 版本化 source 的正文，原样透出（界面只展示，不再解释）。 */
  content: unknown;
  /** 安装事件的 occurredAt；事件扫不到时为 null（不猜）。 */
  installedAt: string | null;
  installedBy: ActorRef | null;
};

export type GovernanceActiveViewV1 = {
  ref: GovernanceRevisionRefV1;
  /** 激活时钉住的 digest（P1-02 事件显式携带；P1-15/P1-13 由 revision 快照确定）。 */
  digest: string;
  /** Project*Active 聚合自身的 revision（第 k 次激活）。 */
  activeAggregateRevision: number;
  activatedAt: string | null;
  activatedBy: ActorRef | null;
  revision: GovernanceRevisionViewV1 | null;
};

export type GovernanceKindViewV1 = {
  kind: GovernanceKindV1;
  /**
   * 当前生效的 revision；没有生效 ref 就是 null（不存在内置默认值）。
   * RoleSpecRevision 恒为 null：它的生效引用是**逐角色**的（ProjectRoleSpecActive 按 roleId 一份），
   * 没有项目级单值——逐角色事实见下面的 roleSpecs，不要把这个 null 读成“没有生效规格”。
   */
  active: GovernanceActiveViewV1 | null;
  /** 已安装的全部 revision（不可变历史）；activate 只能指向这里的精确 ref+digest。 */
  installed: GovernanceRevisionViewV1[];
  /** 只有 RoleSpecRevision 会填：逐角色的规格安装与生效事实。 */
  roleSpecs?: RoleSpecEntryViewV1[];
  /** 这个种类读不完整的地方；非空即表示结论有缺口。 */
  gaps: string[];
};

/**
 * 一个角色的规格事实（RW-14）。roleId 是身份；内容 revision 与 digest 逐字来自**已安装快照**
 * （未安装时取自本产品的内置 source），生效引用来自 canonical 的 ProjectRoleSpecActive。
 */
export type RoleSpecEntryViewV1 = {
  roleId: string;
  /** 规格正文的 label；未安装时取自内置 source；再没有就是 roleId。 */
  label: string;
  /** 已经可以直接拿去当矩阵 pin 的精确引用 + 摘要；没有可用来源时为 null。 */
  pin: RoleSpecPinV1 | null;
  /** 内容 revision（安装时固定为 ROLE_SPEC_REVISION，逐字来自落账快照）。 */
  contentRevision: number | null;
  contentDigest: string | null;
  /** 安装并激活这份 pin 之后，**claim 守卫会怎么看它**（判据复用 Control 的同一份策略）。 */
  readiness: RoleSpecPinReadinessV1;
  active: {
    ref: RoleSpecRevisionRef;
    /** 激活时钉住的摘要（canonical revision 快照的 contentDigest）。 */
    digest: string;
    activeAggregateRevision: number;
    activatedAt: string | null;
    activatedBy: ActorRef | null;
  } | null;
  /** 已安装的全部 revision（不可变历史）。 */
  installed: GovernanceRevisionViewV1[];
  /**
   * 本产品内置的版本化 source（组合根注入；与 CompletionPolicy 的内置来源同一定位：
   * 它不产生授权，必须经 install + activate 才生效）。null 表示这个角色没有内置来源，
   * 要装它必须由调用方显式提交 source。
   */
  builtInSource: { roleId: string; label: string; contentRevision: number; contentDigest: string } | null;
};

/**
 * 「当前生效的协调策略到底有没有角色矩阵」的权威回答（RW-14）。
 *
 * 为什么必须显式给出：没有矩阵时 claim **不做**角色校验（沿用矩阵之前的绑定语义）。这件事不写
 * 出来，人就会把「策略装上了」读成「角色已经被校验过」，从而以为越权绑定会被拦住——静默放行。
 * note 与 automationSwitch 同一个口径：规则只有一处，文字由后端给，界面原样显示。
 */
export type RoleMatrixViewV1 = {
  /**
   * true=含矩阵；false=生效策略正文明确不含 roles；
   * null=**无法判定**（没有生效策略，或生效引用读不到／身份不一致）。
   * null 绝不能读成“不含矩阵”：那是两种事实，note 与 gaps 会写清是哪一种。
   */
  present: boolean | null;
  policyId: string | null;
  policyRevision: number | null;
  coordinator: { roleId: string; note: string } | null;
  /** 矩阵里的每个 pin，以及它现在有没有可用的已激活规格。 */
  pins: Array<{ roleId: string; ref: RoleSpecRevisionRef; digest: string; readiness: RoleSpecPinReadinessV1 }>;
  /** 产品自带的人工派发入口需要的角色（来自组合根注入的固定绑定）。 */
  entryRoles: Array<{ roleId: string; purpose: string }>;
  /** entryRoles 里这份矩阵**没有**登记的角色：非空即表示这些入口会被拒绝。 */
  missingEntryRoles: string[];
  /** 原样显示给人的结论：含矩阵 / 不含矩阵各自会发生什么。 */
  note: string;
  /** 读不完整的地方（例如生效策略的正文读不到）：非空即表示 present 由猜测得来，这里不猜。 */
  gaps: string[];
};

/** 生效 CoordinationPolicy 授予的自动化额度（人做决定所需的信息，逐字段来自策略正文）。 */
export type CoordinationPolicyGrantV1 = {
  policyId: string;
  revision: number;
  contentDigest: string;
  maxAutonomousReworks: number;
  maxClarifications: number;
  inScopeRework: boolean;
  inScopeTesting: boolean;
  changesRequireHumanDecision: string[];
  upgrade: { path: string; note: string };
};

/**
 * RW-10 人的暂停开关：自动返工现在是被授权还是被人停用。
 *
 * 为什么由后端给出这段文字而不是让界面自己解释：规则只有一处（allowed.inScopeRework 与自动受理
 * 四条边界的关系），界面原样显示即可；否则同一条规则会在 UI 里长成第二份、并可能随改动漂移。
 * 它同时服务「治理视图」与「返工面板」两处显示，两边读的是同一个字段。
 */
export type AutomationSwitchViewV1 = {
  /** true=范围内的自动返工已授权；false=人已停用；null=没有生效策略（**不是**“默认开启”）。 */
  inScopeRework: boolean | null;
  /** 当前生效的协调策略身份；没有时全为 null（不编造）。 */
  policyId: string | null;
  policyRevision: number | null;
  /** 原样显示给人的说明：停用时必须写明“之后每条失败都必须由人决定”。 */
  note: string;
};

export type GovernanceViewV1 = {
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  /** Project 聚合当前 revision：activate 的默认 CAS 窗口。 */
  projectRevision: number | null;
  kinds: GovernanceKindViewV1[];
  /** 只有存在生效 CoordinationPolicy 时才非空：界面据此说明“授予了多少自动返工额度”。 */
  automation: CoordinationPolicyGrantV1 | null;
  /** 自动返工是否被人停用（RW-10）；与 automation 同一个来源，逐字取自生效策略正文。 */
  automationSwitch: AutomationSwitchViewV1;
  /** 当前生效的协调策略是否含角色矩阵，以及矩阵 pin 各自的就绪情况。 */
  roleMatrix: RoleMatrixViewV1;
  /**
   * ControlEngine 对 CoordinationPolicy 正文的可接受范围，逐项取自契约常量。
   * 界面据此限制输入，而不是在自己那边再抄一份规则（一份规则只有一个权威定义）。
   */
  coordinationLimits: { maxAutonomousReworksMax: number };
  gaps: string[];
};

export type GovernanceRejectionCodeV1 =
  | 'invalid'
  | 'invalid_source'
  | 'digest_mismatch'
  | 'revision_conflict'
  | 'idempotency_conflict'
  | 'not_found'
  | 'unavailable'
  | 'project_not_found';

export type GovernanceInstallResultV1 = {
  schemaVersion: 1;
  /** 请求里的种类；请求本身没有给出合法种类时为 null（不冒充某个种类）。 */
  kind: GovernanceKindV1 | null;
  status: 'committed' | 'rejected';
  code: GovernanceRejectionCodeV1 | null;
  /** true 表示同一份 source 的幂等重放：没有第二次写入，也没有第二个 revision。 */
  replayed: boolean;
  sourceOrigin: 'built-in-local-fixture' | 'caller-provided';
  /** 本次落账（或幂等重放时既有的）revision；被拒绝时为 null。 */
  revisionRef: GovernanceRevisionRefV1 | null;
  contentDigest: string | null;
  /** 被拒绝且同一身份上已有 revision 时给出：说明“已存在哪一份、没有被覆盖”。 */
  existing: { ref: GovernanceRevisionRefV1; contentDigest: string; contentRevision: number } | null;
  message: string;
};

export type GovernanceActivateResultV1 = {
  schemaVersion: 1;
  /** 请求里的种类；请求本身没有给出合法种类时为 null（不冒充某个种类）。 */
  kind: GovernanceKindV1 | null;
  status: 'committed' | 'rejected';
  code: GovernanceRejectionCodeV1 | null;
  replayed: boolean;
  /** 本次实际使用的 CAS 窗口。 */
  expectedRevision: number;
  expectedRevisionSource: 'caller' | 'current_project_revision';
  /** 被拒绝时给出当前仍生效的 revision（来自 canonical active 聚合），便于判断零写入。 */
  activeRevision: GovernanceRevisionRefV1 | null;
  /** 落账成功后生效的 revision（来自落账收据，不是本地推断）。 */
  activatedRevision: GovernanceRevisionRefV1 | null;
  message: string;
};

export function activeRefFor(kind: GovernanceKindV1, projectId: string, target?: GovernanceRevisionRefV1): AggregateRef {
  switch (kind) {
    case 'CompletionPolicy': return { aggregateType: 'ProjectCompletionPolicyActive', projectId };
    case 'ArchitectureBaseline': return { aggregateType: 'ProjectArchitectureBaselineActive', projectId };
    case 'CoordinationPolicy': return { aggregateType: 'ProjectCoordinationPolicyActive', projectId };
    case 'ArchitectureEvolutionPolicy': return { aggregateType: 'ProjectArchitectureEvolutionPolicyActive', projectId };
    case 'RoleSpecRevision': {
      const roleId = target !== undefined && target.aggregateType === 'RoleSpecRevision' ? target.roleId : null;
      if (roleId === null) throw new Error('RoleSpecRevision 的生效引用是逐角色的：必须给出 pin.ref.roleId');
      return projectRoleSpecActiveRefFor(projectId, roleId);
    }
  }
}

export function activeRevisionOf(snapshot: { activeRevision?: unknown }): GovernanceRevisionRefV1 | null {
  const ref = snapshot.activeRevision;
  return typeof ref === 'object' && ref !== null && !Array.isArray(ref) ? (ref as GovernanceRevisionRefV1) : null;
}

export function sameRef(a: GovernanceRevisionRefV1, b: GovernanceRevisionRefV1): boolean {
  return canonicalJson(a as unknown as JsonValue) === canonicalJson(b as unknown as JsonValue);
}
