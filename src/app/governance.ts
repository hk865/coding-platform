// Human governance commands and HTTP receipts; queries delegate to GovernanceViewPort.
import type {
  ActorRef
} from '../contracts/command-event.js';
import type {
  StateLedger
} from '../contracts/ledger.js';

import type {
  ArchitectureBaselinePin,
  CompletionPolicyPin,
  GovernanceActivateCommand,
  GovernanceActivateReceipt,
  GovernanceInstallCommand,
  GovernanceInstallReceipt,
  VersionedArchitectureBaselineFixture,
  VersionedCompletionPolicyFixture
} from '../contracts/governance.js';
import {
  buildActivateCommand,
  buildArchitectureEvolutionPolicyActivateCommand,
  buildArchitectureEvolutionPolicyInstallCommand,
  buildCoordinationPolicyActivateCommand,
  buildCoordinationPolicyInstallCommand,
  buildInstallCommand
} from '../contracts/commands/governance.js';
import {
  governanceContentDigest
} from '../contracts/governance.js';
import type {
  ActivateCoordinationPolicyCommand,
  ActivateCoordinationPolicyReceipt,
  CoordinationPolicyContentV1,
  CoordinationPolicyPin,
  InstallCoordinationPolicyCommand,
  InstallCoordinationPolicyReceipt
} from '../contracts/human-role-collaboration.js';
import {
  P15_COORDINATION_POLICY_REVISION,
  coordinationPolicyContentDigest
} from '../contracts/human-role-collaboration.js';
import type {
  ActivateRoleSpecRevisionCommand,
  InstallRoleSpecRevisionCommand,
  InstallRoleSpecRevisionReceipt,
  ActivateRoleSpecRevisionReceipt,
  RoleSpecContentV1,
  RoleSpecPinV1
} from '../contracts/role-spec.js';
import {
  ROLE_SPEC_REVISION,
  roleSpecContentDigest,
  roleSpecRevisionRefFor
} from '../contracts/role-spec.js';

import {
  buildRoleSpecActivateCommand,
  buildRoleSpecInstallCommand
} from '../contracts/commands/governance.js';
import type {
  ActivateProjectArchitectureEvolutionPolicyCommand,
  ArchitectureEvolutionPolicyActivateReceipt,
  ArchitectureEvolutionPolicyInstallReceipt,
  ArchitectureEvolutionPolicyPin,
  InstallArchitectureEvolutionPolicyRevisionCommand,
  VersionedArchitectureEvolutionPolicyFixture
} from '../contracts/architecture-evolution-policy.js';
import {
  architectureEvolutionPolicyContentDigest
} from '../contracts/architecture-evolution-policy.js';

import {
  GOVERNANCE_KINDS,
  activeRefFor,
  activeRevisionOf,
  sameRef,
  type GovernanceViewPort,
  type GovernanceKindV1,
  type GovernanceRevisionRefV1,
  type GovernanceScopeV1,
  type GovernanceViewV1,
  type GovernanceRejectionCodeV1,
  type GovernanceInstallResultV1,
  type GovernanceActivateResultV1
} from '../contracts/governance-view.js';
// Existing importers retain the same wire types during this responsibility move.
export type { GovernanceKindV1, GovernanceRevisionRefV1, GovernanceScopeV1, GovernanceRevisionViewV1, GovernanceActiveViewV1, GovernanceKindViewV1, RoleSpecEntryViewV1, RoleMatrixViewV1, CoordinationPolicyGrantV1, AutomationSwitchViewV1, GovernanceViewV1, GovernanceRejectionCodeV1, GovernanceInstallResultV1, GovernanceActivateResultV1 } from '../contracts/governance-view.js';

export type GovernanceEntryDeps = {
  views: GovernanceViewPort;
  /** Command CAS and replay receipts read canonical snapshots; display uses views. */
  ledger: () => Pick<StateLedger, 'load'>;
  install: (command: GovernanceInstallCommand) => Promise<GovernanceInstallReceipt>;
  activate: (command: GovernanceActivateCommand) => Promise<GovernanceActivateReceipt>;
  installCoordinationPolicy: (command: InstallCoordinationPolicyCommand) => Promise<InstallCoordinationPolicyReceipt>;
  activateCoordinationPolicy: (command: ActivateCoordinationPolicyCommand) => Promise<ActivateCoordinationPolicyReceipt>;
  installArchitectureEvolutionPolicy: (
    command: InstallArchitectureEvolutionPolicyRevisionCommand,
  ) => Promise<ArchitectureEvolutionPolicyInstallReceipt>;
  activateArchitectureEvolutionPolicy: (
    command: ActivateProjectArchitectureEvolutionPolicyCommand,
  ) => Promise<ArchitectureEvolutionPolicyActivateReceipt>;
  /** RW-14：第五个种类的写入入口（ControlEngine 既有的 RoleSpecPort，不新增写入路径）。 */
  installRoleSpec: (command: InstallRoleSpecRevisionCommand) => Promise<InstallRoleSpecRevisionReceipt>;
  activateRoleSpec: (command: ActivateRoleSpecRevisionCommand) => Promise<ActivateRoleSpecRevisionReceipt>;
  /**
   * 内置本地 fixture。只有组合根（唯一被允许引用 fixtures 的位置）能提供；
   * CoordinationPolicy 故意不在这里——它的预算是人的授权决定。
   */
  defaults: {
    CompletionPolicy?: VersionedCompletionPolicyFixture;
    ArchitectureBaseline?: VersionedArchitectureBaselineFixture;
    ArchitectureEvolutionPolicy?: VersionedArchitectureEvolutionPolicyFixture;
    /**
     * RW-14：本产品内置的版本化角色规格 source（按 roleId）。与上面三条同一定位——
     * 它是 source 内容，本身不产生任何授权，必须经 install（CAS@0）+ activate 才生效；
     * 只有组合根（唯一允许引用 fixtures 的位置）能提供它。
     */
    RoleSpecs?: readonly { roleId: string; content: RoleSpecContentV1 }[];
  };
  /**
   * RW-14：产品自带的人工派发入口绑定并会被矩阵校验的角色（组合根从各派发面注入，见
   * src/app/service.ts）。视图据此回答「装这份矩阵会不会把某个入口一起打断」。
   */
  entryRoles: readonly { roleId: string; purpose: string }[];
  actor: ActorRef;
  now: () => string;
  /** 每次调用生成一个新的命令标识（重放由内容派生的幂等键决定，不由命令标识决定）。 */
  commandId: () => string;
};

// ------------------------------------------------------------------------ //
// 入口实现                                                                  //
// ------------------------------------------------------------------------ //

export class GovernanceEntry {
  constructor(private readonly deps: GovernanceEntryDeps) {}

  // --------------------------------------------------------------------- //
  // 写入：install                                                          //
  // --------------------------------------------------------------------- //

  /**
   * 初始安装：永远 CAS@0。同一份 source 重复安装是幂等重放；同一身份上已有不同内容时
   * 返回 revision_conflict 并回报既有的那一份（零写入、不覆盖）。
   */
  async install(scope: GovernanceScopeV1, input: Record<string, unknown>): Promise<GovernanceInstallResultV1> {
    const kind = parseKind(input['kind']);
    if (kind === null) {
      return installRejected('invalid', null, 'caller-provided', '未知治理种类：kind 必须是 ' + GOVERNANCE_KINDS.join(' / '));
    }
    const callerProvided = input['source'] !== undefined && input['source'] !== null;
    // RW-14：角色规格的身份是 roleId。同时给出 roleId 与 source 时两处必须说同一个角色，
    // 否则“装的是谁”就有两个答案——直接拒绝，而不是挑一个用。
    if (kind === 'RoleSpecRevision' && callerProvided && typeof input['roleId'] === 'string' && input['roleId'].length > 0) {
      const sourceRoleId = isRecord(input['source']) ? input['source']['roleId'] : undefined;
      if (typeof sourceRoleId === 'string' && sourceRoleId !== input['roleId']) {
        return installRejected('invalid', kind, origin(callerProvided), 'roleId（' + input['roleId'] + '）与 source.roleId（' + sourceRoleId + '）不一致：一份规格只登记一个角色。');
      }
    }
    const expected = input['expectedRevision'];
    if (expected !== undefined && expected !== 0) {
      // install 的 CAS 窗口固定为 0（revision 聚合不可改写）；给出别的窗口是误解，明确拒绝。
      return installRejected('invalid', kind, origin(callerProvided), 'install 使用 CAS@0：不接受 expectedRevision=' + JSON.stringify(expected) + '（重新激活请用 activate 入口）');
    }
    const source = callerProvided ? input['source'] : this.defaultSource(kind, input['roleId']);
    if (source === undefined || source === null) {
      return installRejected('invalid_source', kind, origin(callerProvided), this.missingSourceMessage(kind, input['roleId']));
    }

    const prepared = this.prepareInstall(scope, kind, source, callerProvided);
    if (prepared.status === 'rejected') return installRejected('invalid_source', kind, origin(callerProvided), prepared.message);

    const deps = { commandId: this.deps.commandId(), correlationId: this.deps.commandId(), submittedAt: this.deps.now() };
    const receipt = await prepared.submit(deps, installIdempotencyKey(kind, prepared.digest));
    if (receipt.status === 'committed') {
      return {
        schemaVersion: 1, kind, status: 'committed', code: null, replayed: receipt.replayed, sourceOrigin: origin(callerProvided),
        revisionRef: receipt.revisionRef, contentDigest: receipt.contentDigest, existing: null,
        message: receipt.replayed
          ? '同一份 source 此前已经安装：本次是幂等重放，revision 未变、也没有第二次写入。'
          : '已安装为新的不可变 revision（安装不会自动激活）。',
      };
    }

    // 被拒绝：如果是“这个身份上已经有 revision”，把既有的那一份回报出来，不静默忽略也不覆盖。
    const existing = await this.existingRevision(prepared.identityRef);
    return {
      schemaVersion: 1, kind, status: 'rejected', code: receipt.code, replayed: false, sourceOrigin: origin(callerProvided),
      revisionRef: null, contentDigest: null, existing,
      message:
        receipt.code === 'revision_conflict'
          ? existing === null
            ? '同一身份上已经存在 revision：revision 不可改写，不覆盖。'
            : '同一身份上已存在 revision ' + existing.ref.revision + '（digest ' + short(existing.contentDigest) + '）：revision 不可改写，不覆盖；要换内容请安装新的 revision。'
          : '安装被既有治理入口拒绝（' + receipt.code + '），零写入。',
    };
  }

  // --------------------------------------------------------------------- //
  // 写入：activate                                                         //
  // --------------------------------------------------------------------- //

  /**
   * 激活：CAS = (Project@expectedRevision, 本种类 active 聚合@k)。
   * 调用方给出 expectedRevision 时用它（过期即 revision_conflict，零写入）；不给时读当前
   * Project revision 作为窗口——这正是“activate 用当前 project revision 做 CAS”的默认口径。
   */
  async activate(scope: GovernanceScopeV1, input: Record<string, unknown>): Promise<GovernanceActivateResultV1> {
    const kind = parseKind(input['kind']);
    if (kind === null) return activateRejected('invalid', null, '未知治理种类：kind 必须是 ' + GOVERNANCE_KINDS.join(' / '), 0, 'caller');

    const pin = parsePin(input['pin']);
    if (pin === null) return activateRejected('invalid', kind, 'activate 需要既有的精确 pin：{ pin: { ref: {...}, digest: "..." } }', 0, 'caller');
    if (!pinMatchesKind(kind, pin.ref)) return activateRejected('invalid', kind, 'pin.ref.aggregateType 与 kind ' + kind + ' 不一致', 0, 'caller');
    if (pin.ref.projectId !== scope.projectId) return activateRejected('invalid', kind, 'pin 属于项目 ' + pin.ref.projectId + '，不属于本次作用域 ' + scope.projectId, 0, 'caller');

    const ledger = this.deps.ledger();
    const callerRevision = input['expectedRevision'];
    let expectedRevision: number;
    let expectedRevisionSource: 'caller' | 'current_project_revision';
    if (callerRevision !== undefined) {
      if (!Number.isSafeInteger(callerRevision) || (callerRevision as number) < 0) {
        return activateRejected('invalid', kind, 'expectedRevision 必须是非负整数', 0, 'caller');
      }
      expectedRevision = callerRevision as number;
      expectedRevisionSource = 'caller';
    } else {
      const project = await ledger.load({ aggregateType: 'Project', projectId: scope.projectId });
      if (project.status !== 'found') {
        return activateRejected('project_not_found', kind, '项目 ' + scope.projectId + ' 不在账本里：没有可用的 CAS 窗口', 0, 'current_project_revision');
      }
      expectedRevision = project.snapshot.revision;
      expectedRevisionSource = 'current_project_revision';
    }

    const active = await ledger.load(activeRefFor(kind, scope.projectId, pin.ref));
    const activeAggregateRevision = active.status === 'found' ? active.snapshot.revision : 0;
    const currentActiveRevision = active.status === 'found' ? activeRevisionOf(active.snapshot as { activeRevision?: unknown }) : null;
    const commandId = this.deps.commandId();
    const identity = {
      projectId: scope.projectId,
      actor: { ...this.deps.actor },
      idempotencyKey: activateIdempotencyKey(kind, pin.digest, expectedRevision),
    };
    const deps = { commandId, correlationId: this.deps.commandId(), submittedAt: this.deps.now(), expectedRevision };

    const receipt = await this.submitActivate(kind, pin, identity, deps);
    if (receipt.status === 'committed') {
      // 幂等重放只证明“这个请求此前落过账”，**不**证明“它现在仍然生效”：后续可能有别的
      // 激活把 active ref 移走。控制守卫必须复核 canonical 事实（ARCHITECTURE「控制 guard
      // 使用 canonical state」），否则就会用一份过期的回执谎报当前生效的 revision。
      const confirmed = receipt.replayed ? await this.activeMatches(kind, scope.projectId, pin) : true;
      if (confirmed !== true) {
        return {
          schemaVersion: 1, kind, status: 'rejected', code: confirmed === false ? 'revision_conflict' : 'unavailable', replayed: receipt.replayed,
          expectedRevision, expectedRevisionSource, activeRevision: await this.currentActive(kind, scope.projectId, pin.ref), activatedRevision: null,
          message: confirmed === false
            ? '这次激活请求此前已经落账过，但当前生效 revision 已经不是它（已被后来的激活移动）：不把过期回执当成现在的结论，请按视图里的生效 revision 重新决定。'
            : '无法从 canonical 事实确认这次激活当前是否生效：不谎报成功。',
        };
      }
      return {
        schemaVersion: 1, kind, status: 'committed', code: null, replayed: receipt.replayed,
        expectedRevision, expectedRevisionSource, activeRevision: receipt.activeRevision, activatedRevision: receipt.activeRevision,
        message: receipt.replayed ? '同一激活请求此前已落账，且已复核当前生效 revision 就是它：本次是幂等重放，没有第二次写入。' : '已激活：Project 的该种类 active ref 现在指向这份 revision。',
      };
    }
    const alreadyActive = currentActiveRevision !== null && sameRef(currentActiveRevision, pin.ref);
    // 第五个种类的 CAS 窗口是「该角色的 ProjectRoleSpecActive@k」，上面的 activeRefFor 已按 pin 解析。
    return {
      schemaVersion: 1, kind, status: 'rejected', code: receipt.code, replayed: false,
      expectedRevision, expectedRevisionSource, activeRevision: currentActiveRevision, activatedRevision: null,
      message:
        receipt.code === 'revision_conflict'
          ? alreadyActive
            ? '该 revision 已经是当前生效的 active ref（更早的一次激活已经落账）：本次零写入，也没有第二次激活。'
            : 'CAS 被拒绝（Project@' + expectedRevision + ' 或该种类 active@' + activeAggregateRevision + ' 已移动）：零写入，生效 revision 未变。'
          : receipt.code === 'not_found'
            ? '要激活的 revision 尚未安装：先安装同一份 source。'
            : receipt.code === 'digest_mismatch'
              ? 'pin 的 digest 与已安装 revision 不一致：激活只接受 identity/revision/digest 精确匹配。'
              : '激活被既有治理入口拒绝（' + receipt.code + '），零写入。',
    };
  }

  /** 复核 canonical：该种类（RoleSpecRevision 则是该角色）当前生效的 active ref 是否就是这次要激活的 revision。 */
  private async activeMatches(kind: GovernanceKindV1, projectId: string, pin: GovernancePinV1): Promise<boolean | null> {
    const current = await this.currentActive(kind, projectId, pin.ref);
    if (current === null) return null;
    return sameRef(current, pin.ref);
  }

  private async currentActive(kind: GovernanceKindV1, projectId: string, target: GovernanceRevisionRefV1): Promise<GovernanceRevisionRefV1 | null> {
    const loaded = await this.deps.ledger().load(activeRefFor(kind, projectId, target));
    if (loaded.status !== 'found') return null;
    return activeRevisionOf(loaded.snapshot as { activeRevision?: unknown });
  }

  // --------------------------------------------------------------------- //
  // 读取：当前生效的是哪一份、谁在什么时候装的、内容是什么                    //
  // --------------------------------------------------------------------- //

  view(scope: GovernanceScopeV1): Promise<GovernanceViewV1> {
    return this.deps.views.view(scope);
  }

  private defaultSource(kind: GovernanceKindV1, roleId?: unknown): unknown {
    switch (kind) {
      case 'CompletionPolicy': return this.deps.defaults.CompletionPolicy;
      case 'ArchitectureBaseline': return this.deps.defaults.ArchitectureBaseline;
      case 'ArchitectureEvolutionPolicy': return this.deps.defaults.ArchitectureEvolutionPolicy;
      // RW-14：角色规格按 roleId 取内置 source（一份规格一个角色，没有“默认角色”这种东西）。
      case 'RoleSpecRevision':
        return typeof roleId === 'string' ? this.deps.defaults.RoleSpecs?.find(source => source.roleId === roleId) : undefined;
      // CoordinationPolicy：没有内置来源，调用方必须显式提交（自动化预算=人的授权）。
      case 'CoordinationPolicy': return undefined;
    }
  }

  /**
   * 没有可用 source 时的拒绝理由。**逐字说明为什么**，不套一句通用文案：
   * 人需要知道「这个种类没有内置来源」与「这个角色没有内置来源」，以及下一步该给什么。
   */
  private missingSourceMessage(kind: GovernanceKindV1, roleId: unknown): string {
    if (kind === 'RoleSpecRevision') {
      if (typeof roleId !== 'string' || roleId.length === 0) {
        return 'RoleSpecRevision 必须给出 roleId（安装一份规格就是登记一个角色）：{ kind: "RoleSpecRevision", roleId: "executor" }，或由调用方显式提交 source { roleId, content }。' + this.builtInRoleHint();
      }
      return '本产品没有角色 ' + JSON.stringify(roleId) + ' 的内置 source：必须由调用方显式提交版本化 source { roleId, content }。' + this.builtInRoleHint();
    }
    return kind + ' 没有可以不给出 source 的内置来源：必须由调用方显式提交版本化 source（自动化预算等授权内容不能被默认值授予）';
  }

  /** 内置角色规格清单（只报 id，正文不在消息里复制）。 */
  private builtInRoleHint(): string {
    const roleIds = (this.deps.defaults.RoleSpecs ?? []).map(source => source.roleId);
    return roleIds.length === 0 ? '本进程没有注入任何内置角色规格 source。' : '本产品内置的角色：' + roleIds.join('、') + '。';
  }

  private prepareInstall(scope: GovernanceScopeV1, kind: GovernanceKindV1, source: unknown, callerProvided: boolean): PreparedInstallV1 {
    const projectId = scope.projectId;
    const actor = { ...this.deps.actor };
    switch (kind) {
      case 'CompletionPolicy':
      case 'ArchitectureBaseline': {
        const fixture = source as VersionedCompletionPolicyFixture | VersionedArchitectureBaselineFixture;
        if (!isVersionedGovernanceFixture(fixture)) {
          return { status: 'rejected', message: '版本化 source 形状不合法：需要 { schemaVersion: 1, identity, revision, content }' };
        }
        const isCompletion = kind === 'CompletionPolicy';
        if (isCompletion !== ('policyId' in fixture.identity)) {
          return { status: 'rejected', message: kind + ' 的 source.identity 与种类不匹配（' + (isCompletion ? '需要 policyId' : '需要 baselineId') + '）' };
        }
        const digest = governanceContentDigest(fixture);
        const identityRef: GovernanceRevisionRefV1 = isCompletion
          ? { aggregateType: 'CompletionPolicyRevision', projectId, policyId: (fixture as VersionedCompletionPolicyFixture).identity.policyId, revision: fixture.revision }
          : { aggregateType: 'ArchitectureBaselineRevision', projectId, baselineId: (fixture as VersionedArchitectureBaselineFixture).identity.baselineId, revision: fixture.revision };
        return {
          status: 'prepared', digest, identityRef, sourceOrigin: origin(callerProvided),
          submit: async (deps, idempotencyKey) => {
            // 既有 P1-02 写入入口：组合根提供的 install → ControlEngine；identity/时间由这里给出。
            const command = buildInstallCommand(fixture, {
              commandId: deps.commandId, correlationId: deps.correlationId, submittedAt: deps.submittedAt,
              projectId, actor, idempotencyKey,
            });
            const receipt = await this.deps.install(command);
            return receipt.status === 'committed'
              ? { status: 'committed', replayed: receipt.replayed, revisionRef: receipt.revisionRef, contentDigest: receipt.contentDigest }
              : { status: 'rejected', code: receipt.code };
          },
        };
      }
      case 'CoordinationPolicy': {
        const candidate = source as { policyId?: unknown; content?: unknown };
        if (typeof candidate?.policyId !== 'string' || candidate.policyId.length === 0 || !isRecord(candidate.content)) {
          return { status: 'rejected', message: '版本化 source 形状不合法：CoordinationPolicy 需要 { policyId, content: { budget, allowed, scope, upgrade } }' };
        }
        const policyId = candidate.policyId;
        const content = candidate.content as unknown as CoordinationPolicyContentV1;
        // digest 口径与 P1-15 安装入口完全一致（content + policyId + P15_COORDINATION_POLICY_REVISION）。
        // 这里仍然自己算一次，是因为它同时是**幂等键**与**视图身份**的输入（落账命令里那份由契约
        // builder 用同一个函数算出来）；规则只有一处，不在这里重新定义。
        const digest = coordinationPolicyContentDigest(content, policyId, P15_COORDINATION_POLICY_REVISION);
        const identityRef: GovernanceRevisionRefV1 = { aggregateType: 'CoordinationPolicyRevision', projectId, policyId, revision: P15_COORDINATION_POLICY_REVISION };
        return {
          status: 'prepared', digest, identityRef, sourceOrigin: origin(callerProvided),
          submit: async (deps, idempotencyKey) => {
            // RW-10（P4）：字段级构造在契约命令层，应用层只给 identity／时间／幂等键。
            const command = buildCoordinationPolicyInstallCommand(
              { policyId, content },
              { commandId: deps.commandId, correlationId: deps.correlationId, submittedAt: deps.submittedAt, projectId, actor, idempotencyKey },
            );
            const receipt = await this.deps.installCoordinationPolicy(command);
            return receipt.status === 'committed'
              ? { status: 'committed', replayed: receipt.replayed, revisionRef: receipt.revisionRef, contentDigest: receipt.contentDigest }
              : { status: 'rejected', code: receipt.code };
          },
        };
      }
      case 'RoleSpecRevision': {
        // 与 CoordinationPolicy 同理：调用方给的是 { roleId, content }，正文不在应用层拼装。
        const candidate = source as { roleId?: unknown; content?: unknown };
        if (typeof candidate?.roleId !== 'string' || candidate.roleId.length === 0 || !isRecord(candidate.content)) {
          return { status: 'rejected', message: '版本化 source 形状不合法：RoleSpecRevision 需要 { roleId, content: { schemaVersion, label, purpose, responsibility, requiredMaterials, optionalMaterials, permissions, budget, requiredOutputs, exit } }' };
        }
        const roleId = candidate.roleId;
        const content = candidate.content as unknown as RoleSpecContentV1;
        let digest: string;
        try {
          // 摘要口径只有一处（contracts/role-spec.ts），与 install 守卫逐字同值；这里同时用它作幂等键与视图身份。
          digest = roleSpecContentDigest(content, roleId, ROLE_SPEC_REVISION);
        } catch {
          return { status: 'rejected', message: 'RoleSpecRevision 的 content 不是可规范化为 JSON 的对象：既不能算摘要，也不能安装' };
        }
        const identityRef: GovernanceRevisionRefV1 = roleSpecRevisionRefFor(projectId, roleId, ROLE_SPEC_REVISION);
        return {
          status: 'prepared', digest, identityRef, sourceOrigin: origin(callerProvided),
          submit: async (deps, idempotencyKey) => {
            // 字段级构造在契约命令层（buildRoleSpecInstallCommand），应用层只给 identity／时间／幂等键。
            const command = buildRoleSpecInstallCommand(
              { roleId, content },
              { commandId: deps.commandId, correlationId: deps.correlationId, submittedAt: deps.submittedAt, projectId, actor, idempotencyKey },
            );
            const receipt = await this.deps.installRoleSpec(command);
            return receipt.status === 'committed'
              ? { status: 'committed', replayed: receipt.replayed, revisionRef: receipt.revisionRef, contentDigest: receipt.contentDigest }
              : { status: 'rejected', code: receipt.code };
          },
        };
      }
      case 'ArchitectureEvolutionPolicy': {
        const fixture = source as VersionedArchitectureEvolutionPolicyFixture;
        if (!isEvolutionPolicyFixture(fixture)) {
          return { status: 'rejected', message: '版本化 source 形状不合法：需要 { schemaVersion: 1, fixtureId, contentType: "ArchitectureEvolutionPolicy", revision, identity, content }' };
        }
        const digest = architectureEvolutionPolicyContentDigest(fixture);
        const identityRef: GovernanceRevisionRefV1 = {
          aggregateType: 'ArchitectureEvolutionPolicyRevision', projectId,
          policyId: fixture.identity.fixtureId, revision: fixture.revision,
        };
        return {
          status: 'prepared', digest, identityRef, sourceOrigin: origin(callerProvided),
          submit: async (deps, idempotencyKey) => {
            // RW-10（P4）：同 CoordinationPolicy，字段级构造在契约命令层。
            const command = buildArchitectureEvolutionPolicyInstallCommand(
              fixture,
              { commandId: deps.commandId, correlationId: deps.correlationId, submittedAt: deps.submittedAt, projectId, actor, idempotencyKey },
            );
            const receipt = await this.deps.installArchitectureEvolutionPolicy(command);
            return receipt.status === 'committed'
              ? { status: 'committed', replayed: receipt.replayed, revisionRef: receipt.revisionRef, contentDigest: receipt.contentDigest }
              : { status: 'rejected', code: receipt.code };
          },
        };
      }
    }
  }

  private async submitActivate(
    kind: GovernanceKindV1,
    pin: GovernancePinV1,
    identity: { projectId: string; actor: ActorRef; idempotencyKey: string },
    deps: { commandId: string; correlationId: string; submittedAt: string; expectedRevision: number },
  ): Promise<
    | { status: 'committed'; replayed: boolean; activeRevision: GovernanceRevisionRefV1 }
    | { status: 'rejected'; code: GovernanceRejectionCodeV1 }
  > {
    switch (kind) {
      case 'CompletionPolicy':
      case 'ArchitectureBaseline': {
        const command = buildActivateCommand(pin as CompletionPolicyPin | ArchitectureBaselinePin, {
          commandId: deps.commandId, correlationId: deps.correlationId, submittedAt: deps.submittedAt,
          projectId: identity.projectId, actor: identity.actor, idempotencyKey: identity.idempotencyKey,
          expectedRevision: deps.expectedRevision,
        });
        const receipt = await this.deps.activate(command);
        return receipt.status === 'committed'
          ? { status: 'committed', replayed: receipt.replayed, activeRevision: receipt.activeRevision }
          : { status: 'rejected', code: receipt.code };
      }
      case 'CoordinationPolicy': {
        const command = buildCoordinationPolicyActivateCommand(pin as CoordinationPolicyPin, {
          commandId: deps.commandId, correlationId: deps.correlationId, submittedAt: deps.submittedAt,
          projectId: identity.projectId, actor: identity.actor, idempotencyKey: identity.idempotencyKey,
          expectedRevision: deps.expectedRevision,
        });
        const receipt = await this.deps.activateCoordinationPolicy(command);
        return receipt.status === 'committed'
          ? { status: 'committed', replayed: receipt.replayed, activeRevision: receipt.activeRevision }
          : { status: 'rejected', code: receipt.code };
      }
      case 'RoleSpecRevision': {
        // aggregateId／target 的字段级构造同样在契约命令层（buildRoleSpecActivateCommand）。
        const command = buildRoleSpecActivateCommand(pin as RoleSpecPinV1, {
          commandId: deps.commandId, correlationId: deps.correlationId, submittedAt: deps.submittedAt,
          projectId: identity.projectId, actor: identity.actor, idempotencyKey: identity.idempotencyKey,
          expectedRevision: deps.expectedRevision,
        });
        const receipt = await this.deps.activateRoleSpec(command);
        return receipt.status === 'committed'
          ? { status: 'committed', replayed: receipt.replayed, activeRevision: receipt.activeRevision }
          : { status: 'rejected', code: receipt.code };
      }
      case 'ArchitectureEvolutionPolicy': {
        const command = buildArchitectureEvolutionPolicyActivateCommand(pin as ArchitectureEvolutionPolicyPin, {
          commandId: deps.commandId, correlationId: deps.correlationId, submittedAt: deps.submittedAt,
          projectId: identity.projectId, actor: identity.actor, idempotencyKey: identity.idempotencyKey,
          expectedRevision: deps.expectedRevision,
        });
        const receipt = await this.deps.activateArchitectureEvolutionPolicy(command);
        return receipt.status === 'committed'
          ? { status: 'committed', replayed: receipt.replayed, activeRevision: receipt.activeRevision }
          : { status: 'rejected', code: receipt.code };
      }
    }
  }

  /** 同一身份上已存在的 revision（安装被拒时回报，不覆盖、也不静默忽略）。 */
  private async existingRevision(
    ref: GovernanceRevisionRefV1,
  ): Promise<{ ref: GovernanceRevisionRefV1; contentDigest: string; contentRevision: number } | null> {
    const loaded = await this.deps.ledger().load(ref);
    if (loaded.status !== 'found') return null;
    const snapshot = loaded.snapshot as { contentDigest?: unknown; contentRevision?: unknown };
    if (typeof snapshot.contentDigest !== 'string' || typeof snapshot.contentRevision !== 'number') return null;
    return { ref, contentDigest: snapshot.contentDigest, contentRevision: snapshot.contentRevision };
  }

  // --------------------------------------------------------------------- //
  // 读侧：Project*Active 投影 + Revision 快照 + 已提交治理事件               //
  // --------------------------------------------------------------------- //

}

type GovernancePinV1 = { ref: GovernanceRevisionRefV1; digest: string };
type PreparedInstallV1 =
  | { status: 'rejected'; message: string }
  | {
      status: 'prepared';
      digest: string;
      identityRef: GovernanceRevisionRefV1;
      sourceOrigin: 'built-in-local-fixture' | 'caller-provided';
      submit: (
        deps: { commandId: string; correlationId: string; submittedAt: string },
        idempotencyKey: string,
      ) => Promise<
        | { status: 'committed'; replayed: boolean; revisionRef: GovernanceRevisionRefV1; contentDigest: string }
        | { status: 'rejected'; code: GovernanceRejectionCodeV1 }
      >;
    };

/**
 * 安装的幂等身份由 **source 自身**（种类 + 内容摘要）决定，而不是由某次 HTTP 调用决定：
 * 同一份 source 重试必然重放；换了内容就是另一个身份，只能撞 CAS@0（revision_conflict）。
 */
function installIdempotencyKey(kind: GovernanceKindV1, digest: string): string {
  return 'governance-install-' + kind + '-' + digest;
}

/**
 * 激活的幂等身份 = 调用方看得见的逻辑请求（种类 + 目标摘要 + 它观察到的 CAS 窗口）。
 * 之所以不把 active 聚合的 k 也算进去：k 会被这次请求自己移动，重试就会拿到另一个身份，
 * 于是"响应丢失后的重试"永远不可能重放。代价是重放可能落在已经过期的请求上——那一半由
 * activate 落账后的 canonical 复核（activeMatches）把住，不靠身份键兜底。
 */
function activateIdempotencyKey(kind: GovernanceKindV1, digest: string, expectedRevision: number): string {
  return 'governance-activate-' + kind + '-' + digest + '-p' + expectedRevision;
}

function parseKind(value: unknown): GovernanceKindV1 | null {
  return typeof value === 'string' && (GOVERNANCE_KINDS as readonly string[]).includes(value) ? (value as GovernanceKindV1) : null;
}

function parsePin(value: unknown): GovernancePinV1 | null {
  if (!isRecord(value)) return null;
  const ref = value['ref'];
  const digest = value['digest'];
  if (!isRecord(ref) || typeof digest !== 'string') return null;
  if (typeof ref['aggregateType'] !== 'string' || typeof ref['projectId'] !== 'string' || typeof ref['revision'] !== 'number') return null;
  return { ref: ref as unknown as GovernanceRevisionRefV1, digest };
}

function pinMatchesKind(kind: GovernanceKindV1, ref: GovernanceRevisionRefV1): boolean {
  switch (kind) {
    case 'CompletionPolicy': return ref.aggregateType === 'CompletionPolicyRevision';
    case 'ArchitectureBaseline': return ref.aggregateType === 'ArchitectureBaselineRevision';
    case 'CoordinationPolicy': return ref.aggregateType === 'CoordinationPolicyRevision';
    case 'ArchitectureEvolutionPolicy': return ref.aggregateType === 'ArchitectureEvolutionPolicyRevision';
    case 'RoleSpecRevision': return ref.aggregateType === 'RoleSpecRevision';
  }
}

function short(digest: string): string {
  return digest.slice(0, 12);
}

function origin(callerProvided: boolean): 'built-in-local-fixture' | 'caller-provided' {
  return callerProvided ? 'caller-provided' : 'built-in-local-fixture';
}

function installRejected(
  code: GovernanceRejectionCodeV1,
  kind: GovernanceKindV1 | null,
  sourceOrigin: 'built-in-local-fixture' | 'caller-provided',
  message: string,
): GovernanceInstallResultV1 {
  return {
    schemaVersion: 1, kind, status: 'rejected', code, replayed: false,
    sourceOrigin, revisionRef: null, contentDigest: null, existing: null, message,
  };
}

function activateRejected(
  code: GovernanceRejectionCodeV1,
  kind: GovernanceKindV1 | null,
  message: string,
  expectedRevision: number,
  expectedRevisionSource: 'caller' | 'current_project_revision',
): GovernanceActivateResultV1 {
  return {
    schemaVersion: 1, kind, status: 'rejected', code, replayed: false,
    expectedRevision, expectedRevisionSource, activeRevision: null, activatedRevision: null, message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVersionedGovernanceFixture(value: unknown): value is VersionedCompletionPolicyFixture | VersionedArchitectureBaselineFixture {
  if (!isRecord(value) || value['schemaVersion'] !== 1) return false;
  if (!isRecord(value['identity']) || typeof value['revision'] !== 'number' || !isRecord(value['content'])) return false;
  const identity = value['identity'];
  return typeof identity['policyId'] === 'string' || typeof identity['baselineId'] === 'string';
}

function isEvolutionPolicyFixture(value: unknown): value is VersionedArchitectureEvolutionPolicyFixture {
  if (!isRecord(value) || value['schemaVersion'] !== 1) return false;
  if (value['contentType'] !== 'ArchitectureEvolutionPolicy' || typeof value['revision'] !== 'number') return false;
  if (!isRecord(value['identity']) || !isRecord(value['content'])) return false;
  return typeof value['identity']['fixtureId'] === 'string';
}
