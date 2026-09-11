// Reads committed governance facts on demand. No stored authority, writes or admission decisions.
import type {
  ActorRef,
  CommitCursor
} from '../../contracts/command-event.js';
import type {
  EventPage,
  StateLedger
} from '../../contracts/ledger.js';
import type {
  DomainEvent
} from '../../contracts/events.js';
import type {
  ProjectCompletionPolicyActiveSnapshot,
  ProjectArchitectureBaselineActiveSnapshot
} from '../../contracts/governance.js';
import {
  P15_COORDINATION_BUDGET_MAX,
  type CoordinationRoleMatrixV1,
  type ProjectCoordinationPolicyActiveSnapshot,
  type CoordinationPolicyRevisionSnapshot
} from '../../contracts/human-role-collaboration.js';
import type {
  ProjectArchitectureEvolutionPolicyActiveSnapshot
} from '../../contracts/architecture-evolution-policy.js';
import {
  ROLE_SPEC_REVISION,
  projectRoleSpecActiveRefFor,
  roleSpecRevisionRefFor,
  roleSpecContentDigest,
  type RoleSpecContentV1,
  type RoleSpecPinV1,
  type RoleSpecRevisionRef,
  type RoleSpecRevisionSnapshot,
  type ProjectRoleSpecActiveSnapshot
} from '../../contracts/role-spec.js';

import {
  GOVERNANCE_KINDS,
  activeRefFor,
  activeRevisionOf,
  sameRef,
  type GovernanceViewPort,
  type GovernanceRolePolicyExplanationPort,
  type RoleSpecPinReadinessV1,
  type GovernanceKindV1,
  type GovernanceRevisionRefV1,
  type GovernanceScopeV1,
  type GovernanceRevisionViewV1,
  type GovernanceActiveViewV1,
  type GovernanceKindViewV1,
  type RoleSpecEntryViewV1,
  type RoleMatrixViewV1,
  type CoordinationPolicyGrantV1,
  type AutomationSwitchViewV1,
  type GovernanceViewV1
} from '../../contracts/governance-view.js';
export type GovernanceReadModelDeps = {
  ledger: () => Pick<StateLedger, 'load' | 'events'>;
  defaults: { RoleSpecs?: readonly { roleId: string; content: RoleSpecContentV1 }[] };
  entryRoles: readonly { roleId: string; purpose: string }[];
  policyExplanation: GovernanceRolePolicyExplanationPort;
};
const MAX_SCAN_PAGES = 20;
const SCAN_PAGE_SIZE = 1000;

export class GovernanceReadModel implements GovernanceViewPort {
  constructor(private readonly deps: GovernanceReadModelDeps) {}
  async view(scope: GovernanceScopeV1): Promise<GovernanceViewV1> {
    const ledger = this.deps.ledger();
    const project = await ledger.load({ aggregateType: 'Project', projectId: scope.projectId });
    const scan = await this.scan(scope.projectId);
    // RW-14：角色规格事实先算一次（第五个种类的逐角色视图与矩阵就绪预检读的是同一份）。
    const roleSpecs = await this.roleSpecViews(scope.projectId, scan);
    const kinds: GovernanceKindViewV1[] = [];
    for (const kind of GOVERNANCE_KINDS) kinds.push(await this.kindView(kind, scope.projectId, scan, roleSpecs));
    const coordination = kinds.find((entry) => entry.kind === 'CoordinationPolicy');
    const activeCoordination = coordination?.active ?? null;
    const automation = activeCoordination?.revision == null ? null : coordinationGrant(activeCoordination.revision);
    return {
      schemaVersion: 1, projectId: scope.projectId, workspaceId: scope.workspaceId,
      projectRevision: project.status === 'found' ? project.snapshot.revision : null,
      kinds, automation, automationSwitch: automationSwitchOf(automation),
      roleMatrix: await this.roleMatrixView(scope.projectId, activeCoordination),
      coordinationLimits: { maxAutonomousReworksMax: P15_COORDINATION_BUDGET_MAX },
      gaps: scan.complete ? [] : ['治理事件超过扫描上限（' + MAX_SCAN_PAGES * SCAN_PAGE_SIZE + ' 条）：安装者与安装时间可能缺失，本视图不猜。'],
    };
  }

  // --------------------------------------------------------------------- //
  // RW-14：角色规格（逐角色）与角色矩阵（当前生效策略到底含不含）              //
  // --------------------------------------------------------------------- //

  /**
   * 角色的枚举 = 内置 source ∪ 已安装/已激活事件的 roleId ∪ 当前生效矩阵 pin 的 roleId。
   *
   * 为什么要并上矩阵 pin：**从未安装过的 pin** 正是「装上这份矩阵会不会打断派发」的关键事实，
   * 只列已安装的角色就会把它藏起来。排序固定，遍历顺序不影响结论。
   */
  private async roleSpecViews(projectId: string, scan: GovernanceEventScanV1): Promise<RoleSpecEntryViewV1[]> {
    const ledger = this.deps.ledger();
    const builtIns = new Map((this.deps.defaults.RoleSpecs ?? []).map((source) => [source.roleId, source] as const));
    const roleIds = new Set<string>(builtIns.keys());
    for (const fact of scan.installs) if (fact.kind === 'RoleSpecRevision' && fact.ref.aggregateType === 'RoleSpecRevision') roleIds.add(fact.ref.roleId);
    for (const fact of scan.activations) if (fact.kind === 'RoleSpecRevision' && fact.ref.aggregateType === 'RoleSpecRevision') roleIds.add(fact.ref.roleId);
    const matrix = await this.activeMatrix(projectId);
    for (const roleId of Object.keys(matrix?.catalog ?? {})) roleIds.add(roleId);

    const entries: RoleSpecEntryViewV1[] = [];
    for (const roleId of [...roleIds].sort()) {
      const ref = roleSpecRevisionRefFor(projectId, roleId, ROLE_SPEC_REVISION);
      const loaded = await ledger.load(ref);
      const snapshot = loaded.status === 'found' && loaded.snapshot.ref.aggregateType === 'RoleSpecRevision'
        ? (loaded.snapshot as RoleSpecRevisionSnapshot)
        : null;
      const installFact = scan.installs.find((entry) => entry.kind === 'RoleSpecRevision' && sameRef(entry.ref, ref));
      const installed: GovernanceRevisionViewV1[] = [];
      if (snapshot !== null) {
        installed.push({
          ref, contentRevision: snapshot.contentRevision, contentDigest: snapshot.contentDigest, content: snapshot.content,
          // 安装者只能来自已提交事件；扫不到就如实为 null，不用本地推断补一个。
          installedAt: installFact?.occurredAt ?? snapshot.installedAt, installedBy: installFact?.actor ?? null,
        });
      } else if (installFact !== undefined) {
        installed.push({ ref, contentRevision: installFact.contentRevision, contentDigest: installFact.contentDigest, content: installFact.content, installedAt: installFact.occurredAt, installedBy: installFact.actor });
      }

      const builtIn = builtIns.get(roleId) ?? null;
      const builtInDigest = builtIn === null ? null : safeRoleSpecDigest(builtIn.content, roleId);
      const digest = snapshot?.contentDigest ?? installFact?.contentDigest ?? builtInDigest ?? null;
      const pin: RoleSpecPinV1 | null = digest === null ? null : { ref, digest };

      const activeLoaded = await ledger.load(projectRoleSpecActiveRefFor(projectId, roleId));
      let activeRevisionRef: RoleSpecRevisionRef | null = null;
      let active: RoleSpecEntryViewV1['active'] = null;
      if (activeLoaded.status === 'found' && activeLoaded.snapshot.ref.aggregateType === 'ProjectRoleSpecActive') {
        const activeSnapshot = activeLoaded.snapshot as ProjectRoleSpecActiveSnapshot;
        activeRevisionRef = activeSnapshot.activeRevision;
        const activationFact = scan.activations.find((entry) => entry.kind === 'RoleSpecRevision' && sameRef(entry.ref, activeRevisionRef!));
        active = {
          ref: activeRevisionRef,
          digest: sameRef(activeRevisionRef, ref) && snapshot !== null ? snapshot.contentDigest : await this.contentDigestOf(activeRevisionRef),
          activeAggregateRevision: activeSnapshot.revision,
          activatedAt: activationFact?.occurredAt ?? null,
          activatedBy: activationFact?.actor ?? null,
        };
      }

      const label = snapshot?.content.label
        ?? (installFact !== undefined && isRecord(installFact.content) && typeof installFact.content['label'] === 'string' ? installFact.content['label'] : null)
        ?? builtIn?.content.label
        ?? roleId;

      const readiness: RoleSpecPinReadinessV1 = pin === null
        ? { status: 'spec_not_installed', roleId, message: '这个角色既没有内置 source、也没有已安装的规格：没有可 pin 的规格，安装矩阵前必须先由调用方显式提交版本化 source。' }
        : this.deps.policyExplanation.roleSpecPinReadiness({ roleId, pin, pinnedSpec: snapshot, activeRevision: activeRevisionRef });

      entries.push({
        roleId, label, pin, contentRevision: snapshot?.contentRevision ?? installFact?.contentRevision ?? null,
        contentDigest: digest, readiness, active, installed,
        builtInSource: builtIn === null || builtInDigest === null
          ? null
          : { roleId, label: builtIn.content.label, contentRevision: ROLE_SPEC_REVISION, contentDigest: builtInDigest },
      });
    }
    return entries;
  }

  /** 当前生效矩阵里某个 pin 的就绪情况（判据复用 Control 的同一份策略，不在这里重写）。 */
  private async pinReadiness(projectId: string, roleId: string, pin: RoleSpecPinV1): Promise<RoleSpecPinReadinessV1> {
    const ledger = this.deps.ledger();
    const loaded = await ledger.load(pin.ref);
    const pinnedSpec = loaded.status === 'found' && loaded.snapshot.ref.aggregateType === 'RoleSpecRevision'
      ? (loaded.snapshot as RoleSpecRevisionSnapshot)
      : null;
    const activeLoaded = await ledger.load(projectRoleSpecActiveRefFor(projectId, roleId));
    const activeRevision = activeLoaded.status === 'found' && activeLoaded.snapshot.ref.aggregateType === 'ProjectRoleSpecActive'
      ? (activeLoaded.snapshot as ProjectRoleSpecActiveSnapshot).activeRevision
      : null;
    return this.deps.policyExplanation.roleSpecPinReadiness({ roleId, pin, pinnedSpec, activeRevision });
  }

  /** 当前生效协调策略正文里的角色矩阵（没有生效策略或正文没有 roles 即 null）。 */
  private async activeMatrix(projectId: string): Promise<CoordinationRoleMatrixV1 | null> {
    const active = await this.deps.ledger().load({ aggregateType: 'ProjectCoordinationPolicyActive', projectId });
    if (active.status !== 'found' || active.snapshot.ref.aggregateType !== 'ProjectCoordinationPolicyActive') return null;
    const revisionRef = (active.snapshot as ProjectCoordinationPolicyActiveSnapshot).activeRevision;
    const loaded = await this.deps.ledger().load(revisionRef);
    if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'CoordinationPolicyRevision') return null;
    const snapshot = loaded.snapshot as CoordinationPolicyRevisionSnapshot;
    if (snapshot.policyId !== revisionRef.policyId || snapshot.contentRevision !== revisionRef.revision) return null;
    const content = snapshot.content;
    return isRecord(content) && isRecord(content['roles']) ? (content['roles'] as unknown as CoordinationRoleMatrixV1) : null;
  }

  /**
   * 「当前生效的协调策略含不含角色矩阵」的显式回答（RW-14）。
   * 这里不判断任何业务规则：present／pins／missingEntryRoles 全部来自 canonical 事实与
   * Control 的就绪策略；文字只把**会发生什么**写清楚，供人原样阅读。
   */
  private async roleMatrixView(projectId: string, active: GovernanceActiveViewV1 | null): Promise<RoleMatrixViewV1> {
    const revision = active?.revision ?? null;
    const ref = revision?.ref ?? null;
    const gaps: string[] = [];
    const policyId = ref !== null && 'policyId' in ref ? ref.policyId : null;
    // 生效策略存在但正文读不到／身份不一致时，**不能**说成“不含矩阵”：那是把“不知道”写成“否”。
    const readable = ref !== null && ref.aggregateType === 'CoordinationPolicyRevision' && revision?.content !== undefined && revision.content !== null;
    // The matrix and displayed policy identity must come from the same revision.
    // Re-reading the active pointer here could attach a newly activated matrix to an old policy label.
    const content = revision?.content;
    const roles = readable && isRecord(content) && isRecord(content['roles'])
      ? content['roles'] as unknown as CoordinationRoleMatrixV1
      : null;
    if (ref !== null && !readable) gaps.push('当前生效的协调策略 ' + refLabelOf(ref) + ' 的正文读不到：本视图无法判定它是否含角色矩阵，不猜。');
    else if (ref !== null && readable && (revision!.content as Record<string, unknown>)['roles'] !== undefined && roles === null) {
      gaps.push('当前生效的协调策略 ' + refLabelOf(ref) + ' 的 roles 字段形状不是矩阵：按“无法判定”处理，不猜。');
    }
    const present: boolean | null = ref === null ? null : !readable ? null : roles !== null;

    const pins: RoleMatrixViewV1['pins'] = [];
    if (roles !== null && isRecord(roles.catalog)) {
      for (const [roleId, value] of Object.entries(roles.catalog)) {
        if (!isRoleSpecPin(value)) continue;
        pins.push({ roleId, ref: value.ref, digest: value.digest, readiness: await this.pinReadiness(projectId, roleId, value) });
      }
    }
    const coordinator = roles !== null && isRecord(roles.coordinator) && typeof roles.coordinator.roleId === 'string'
      ? { roleId: roles.coordinator.roleId, note: typeof roles.coordinator.note === 'string' ? roles.coordinator.note : '' }
      : null;
    const missingEntryRoles = present === true
      ? this.deps.entryRoles.filter((entry) => !Object.prototype.hasOwnProperty.call(roles!.catalog, entry.roleId)).map((entry) => entry.roleId)
      : [];
    const notReady = pins.filter((entry) => entry.readiness.status !== 'ready').map((entry) => entry.roleId);
    const identity = policyId === null ? '' : policyId + '@' + (revision?.contentRevision ?? '?');
    const note = present === null
      ? ref === null
        ? '当前没有生效的协调策略：没有角色矩阵，claim 不做角色校验（沿用有矩阵之前的绑定语义）。这不是“角色已授权”，也不是“角色规格已登记”。'
        : '当前生效的协调策略读不完整（见缺口说明）：**无法判定**它是否含角色矩阵，因此这里既不说“含”也不说“不含”。claim 的实际行为以 ControlEngine 读取的 canonical 正文为准。'
      : present === false
        ? '当前生效的协调策略 ' + identity + ' 的正文**不含**角色矩阵（roles）：claim 不做角色校验，任何角色绑定都按既有语义受理——安装成功**不表示**角色职责、revision 或权限已经被校验过。要开始校验，请安装并激活一份含 roles 的协调策略。'
        : '当前生效的协调策略 ' + identity + ' 含角色矩阵（' + pins.length + ' 个角色' + (coordinator === null ? '' : '，收敛责任：' + coordinator.roleId) + '）：派发与 claim 的角色绑定**由这份矩阵签发** —— 绑定的 templateId 与 templateRevision 取自矩阵 pin（角色 id 用矩阵的写法，revision 用 pin 的十进制 revision），policyRevision 记录签发的 policy 与 pin 摘要；claim 时该角色还必须在本项目上已安装且已激活的规格与矩阵 pin 的 revision／摘要一致，否则拒绝且零写入。'
          + (notReady.length === 0 ? '矩阵里的 pin 全部有可用的已激活规格。' : '注意：' + notReady.join('、') + ' 这些 pin 还没有可用的已激活规格，涉及它们的 claim 现在会被拒绝。')
          + '**安装顺序**：矩阵 pin 指向的每一份规格都必须先经 install + activate 装齐并激活，再安装并激活这份矩阵 —— 否则签发出来的绑定 revision 没有对应的已激活规格，派发会被守卫拒绝且零写。上面的未就绪清单就是「还差哪些规格」的答案（内置源经「角色规格」种类安装，见 roleSpecs）。'
          + (missingEntryRoles.length === 0 ? '产品自带入口需要的角色都在矩阵里。' : '另外，矩阵没有登记产品自带入口需要的角色：' + missingEntryRoles.join('、') + '——这些入口会被拒绝。');

    return {
      present, policyId, policyRevision: revision?.contentRevision ?? null, coordinator, pins,
      entryRoles: this.deps.entryRoles.map((entry) => ({ ...entry })), missingEntryRoles, note, gaps,
    };
  }

  /** 某个 revision 快照的 contentDigest（读不到就是空串，不猜）。 */
  private async contentDigestOf(ref: GovernanceRevisionRefV1): Promise<string> {
    const loaded = await this.deps.ledger().load(ref);
    if (loaded.status !== 'found') return '';
    const digest = (loaded.snapshot as { contentDigest?: unknown }).contentDigest;
    return typeof digest === 'string' ? digest : '';
  }

  private async kindView(
    kind: GovernanceKindV1,
    projectId: string,
    scan: GovernanceEventScanV1,
    roleSpecs: RoleSpecEntryViewV1[],
  ): Promise<GovernanceKindViewV1> {
    const ledger = this.deps.ledger();
    const gaps: string[] = [];
    const installed: GovernanceRevisionViewV1[] = [];
    for (const fact of scan.installs.filter((entry) => entry.kind === kind)) {
      installed.push({
        ref: fact.ref, contentRevision: fact.contentRevision, contentDigest: fact.contentDigest, content: fact.content,
        installedAt: fact.occurredAt, installedBy: fact.actor,
      });
    }
    installed.sort((a, b) => a.contentRevision - b.contentRevision || a.contentDigest.localeCompare(b.contentDigest));

    if (kind === 'RoleSpecRevision') {
      // 生效引用是逐角色的：没有项目级 active 单值，因此 active 恒为 null（见类型注释），
      // 逐角色事实放在 roleSpecs 里。installed 仍然给出全部已安装规格 revision（按 roleId 区分）。
      return { kind, active: null, installed, roleSpecs, gaps };
    }

    const loaded = await ledger.load(activeRefFor(kind, projectId));
    if (loaded.status !== 'found') {
      // 没有 active 聚合 = 这个种类还没有被激活过（不是“用了默认值”）。
      return { kind, active: null, installed, gaps };
    }
    const activeSnapshot = loaded.snapshot as
      | ProjectCompletionPolicyActiveSnapshot
      | ProjectArchitectureBaselineActiveSnapshot
      | ProjectCoordinationPolicyActiveSnapshot
      | ProjectArchitectureEvolutionPolicyActiveSnapshot;
    const activeRef = activeRevisionOf(activeSnapshot as { activeRevision?: unknown });
    if (activeRef === null) {
      gaps.push('该种类的 active 聚合存在但读不到 activeRevision：生效 revision 不可确认。');
      return { kind, active: null, installed, gaps };
    }
    const fact = scan.activations.find((entry) => sameRef(entry.ref, activeRef));
    const revision = await this.revisionView(activeRef, fact?.digest ?? null, scan, gaps);
    return {
      kind,
      active: {
        ref: activeRef,
        digest: revision?.contentDigest ?? fact?.digest ?? '',
        activeAggregateRevision: loaded.snapshot.revision,
        activatedAt: fact?.occurredAt ?? null,
        activatedBy: fact?.actor ?? null,
        revision,
      },
      installed: mergeInstalled(installed, revision),
      gaps,
    };
  }

  private async revisionView(
    ref: GovernanceRevisionRefV1,
    pinnedDigest: string | null,
    scan: GovernanceEventScanV1,
    gaps: string[],
  ): Promise<GovernanceRevisionViewV1 | null> {
    const fact = scan.installs.find((entry) => sameRef(entry.ref, ref));
    const loaded = await this.deps.ledger().load(ref);
    if (loaded.status !== 'found') {
      if (fact === undefined) {
        gaps.push('revision ' + describeRef(ref) + ' 既不在账本里、也没有安装事件：无法给出内容与来源。');
        return null;
      }
      gaps.push('revision ' + describeRef(ref) + ' 的快照读不到，内容取自已提交的安装事件。');
      return { ref, contentRevision: fact.contentRevision, contentDigest: fact.contentDigest, content: fact.content, installedAt: fact.occurredAt, installedBy: fact.actor };
    }
    const snapshot = loaded.snapshot as { content?: unknown; contentDigest?: unknown; contentRevision?: unknown };
    const contentDigest = typeof snapshot.contentDigest === 'string' ? snapshot.contentDigest : (fact?.contentDigest ?? '');
    if (pinnedDigest !== null && contentDigest !== '' && pinnedDigest !== contentDigest) {
      gaps.push('激活时钉住的 digest 与 revision 快照的 digest 不一致：生效内容不可确认。');
    }
    return {
      ref,
      contentRevision: typeof snapshot.contentRevision === 'number' ? snapshot.contentRevision : ref.revision,
      contentDigest,
      content: snapshot.content,
      installedAt: fact?.occurredAt ?? null,
      installedBy: fact?.actor ?? null,
    };
  }

  /** 扫已提交的治理事件：安装者、安装时间、激活者、激活时间都只来自 canonical 事件。 */
  private async scan(projectId: string): Promise<GovernanceEventScanV1> {
    const ledger = this.deps.ledger();
    const installs: GovernanceInstallFactV1[] = [];
    const activations: GovernanceActivationFactV1[] = [];
    let cursor: CommitCursor | null = null;
    for (let pageIndex = 0; pageIndex < MAX_SCAN_PAGES; pageIndex++) {
      const page: EventPage = await ledger.events({ afterCursor: cursor, limit: SCAN_PAGE_SIZE });
      for (const positioned of page.events) {
        const event = positioned.event as DomainEvent;
        if ((event as { projectId?: unknown }).projectId !== projectId) continue;
        const actor = (event as { actor?: ActorRef }).actor;
        const occurredAt = (event as { occurredAt?: unknown }).occurredAt;
        if (actor === undefined || typeof occurredAt !== 'string') continue;
        const rawPayload = (event as { payload?: unknown }).payload;
        if (!isRecord(rawPayload)) continue;
        const installFact = installFactOf(event.eventType, projectId, rawPayload, actor, occurredAt);
        if (installFact !== null) {
          installs.push(installFact);
          continue;
        }
        const activationFact = activationFactOf(event.eventType, rawPayload, actor, occurredAt);
        if (activationFact !== null) activations.push(activationFact);
      }
      if (!page.hasMore) return { installs, activations, complete: true };
      cursor = page.throughCursor;
    }
    return { installs, activations, complete: false };
  }
}

type GovernanceEventScanV1 = { installs: GovernanceInstallFactV1[]; activations: GovernanceActivationFactV1[]; complete: boolean };
type GovernanceInstallFactV1 = {
  kind: GovernanceKindV1; ref: GovernanceRevisionRefV1; contentRevision: number; contentDigest: string;
  content: unknown; actor: ActorRef; occurredAt: string;
};
type GovernanceActivationFactV1 = { kind: GovernanceKindV1; ref: GovernanceRevisionRefV1; digest: string | null; actor: ActorRef; occurredAt: string };

function installFactOf(
  eventType: string,
  projectId: string,
  payload: Record<string, unknown>,
  actor: ActorRef,
  occurredAt: string,
): GovernanceInstallFactV1 | null {
  if (eventType === 'CompletionPolicyInstalled' || eventType === 'ArchitectureBaselineInstalled') {
    const id = eventType === 'CompletionPolicyInstalled' ? payload['policyId'] : payload['baselineId'];
    const revision = payload['revision'];
    const digest = payload['contentDigest'];
    if (typeof id !== 'string' || typeof revision !== 'number' || typeof digest !== 'string') return null;
    const ref: GovernanceRevisionRefV1 = eventType === 'CompletionPolicyInstalled'
      ? { aggregateType: 'CompletionPolicyRevision', projectId, policyId: id, revision }
      : { aggregateType: 'ArchitectureBaselineRevision', projectId, baselineId: id, revision };
    return {
      kind: eventType === 'CompletionPolicyInstalled' ? 'CompletionPolicy' : 'ArchitectureBaseline',
      ref, contentRevision: revision, contentDigest: digest, content: payload['content'], actor, occurredAt,
    };
  }
  if (eventType === 'CoordinationPolicyInstalled' || eventType === 'ArchitectureEvolutionPolicyInstalled' || eventType === 'RoleSpecInstalled') {
    // P1-13／P1-15／RW-14 的安装事件直接携带完整 revision 快照（RoleSpecRevision 逐角色各一条）。
    const raw = payload['revision'];
    if (!isRecord(raw)) return null;
    const ref = raw['ref'];
    if (!isRecord(ref)) return null;
    const digest = raw['contentDigest'];
    const contentRevision = raw['contentRevision'];
    const revisionRef = ref as unknown as GovernanceRevisionRefV1;
    return {
      kind: eventType === 'CoordinationPolicyInstalled' ? 'CoordinationPolicy' : eventType === 'RoleSpecInstalled' ? 'RoleSpecRevision' : 'ArchitectureEvolutionPolicy',
      ref: revisionRef,
      contentRevision: typeof contentRevision === 'number' ? contentRevision : revisionRef.revision,
      contentDigest: typeof digest === 'string' ? digest : '',
      content: raw['content'], actor, occurredAt,
    };
  }
  return null;
}

function activationFactOf(
  eventType: string,
  payload: Record<string, unknown>,
  actor: ActorRef,
  occurredAt: string,
): GovernanceActivationFactV1 | null {
  if (eventType === 'CompletionPolicyActivated' || eventType === 'ArchitectureBaselineActivated') {
    const target = payload['target'];
    if (!isRecord(target) || !isRecord(target['ref'])) return null;
    const digest = target['digest'];
    return {
      kind: eventType === 'CompletionPolicyActivated' ? 'CompletionPolicy' : 'ArchitectureBaseline',
      ref: target['ref'] as unknown as GovernanceRevisionRefV1,
      digest: typeof digest === 'string' ? digest : null, actor, occurredAt,
    };
  }
  if (eventType === 'CoordinationPolicyActivated' || eventType === 'ArchitectureEvolutionPolicyActivated' || eventType === 'RoleSpecActivated') {
    const ref = payload['activeRevision'];
    if (!isRecord(ref)) return null;
    return {
      kind: eventType === 'CoordinationPolicyActivated' ? 'CoordinationPolicy' : eventType === 'RoleSpecActivated' ? 'RoleSpecRevision' : 'ArchitectureEvolutionPolicy',
      ref: ref as unknown as GovernanceRevisionRefV1, digest: null, actor, occurredAt,
    };
  }
  return null;
}

// ------------------------------------------------------------------------ //
// 形状与身份函数                                                            //
// ------------------------------------------------------------------------ //

function mergeInstalled(installed: GovernanceRevisionViewV1[], active: GovernanceRevisionViewV1 | null): GovernanceRevisionViewV1[] {
  if (active === null || installed.some((entry) => sameRef(entry.ref, active.ref))) return installed;
  return [...installed, active].sort((a, b) => a.contentRevision - b.contentRevision || a.contentDigest.localeCompare(b.contentDigest));
}

/** 生效策略授予的自动化额度：逐字段来自策略正文，不做二次解释、不套默认值。 */
function coordinationGrant(revision: GovernanceRevisionViewV1): CoordinationPolicyGrantV1 | null {
  const content = revision.content;
  if (!isRecord(content)) return null;
  const budget = content['budget'];
  const allowed = content['allowed'];
  const scope = content['scope'];
  const upgrade = content['upgrade'];
  if (!isRecord(budget) || !isRecord(allowed) || !isRecord(scope) || !isRecord(upgrade)) return null;
  const maxAutonomousReworks = budget['maxAutonomousReworks'];
  const maxClarifications = budget['maxClarifications'];
  if (typeof maxAutonomousReworks !== 'number' || typeof maxClarifications !== 'number') return null;
  const changes = Array.isArray(scope['changesRequireHumanDecision'])
    ? scope['changesRequireHumanDecision'].filter((entry): entry is string => typeof entry === 'string')
    : [];
  const ref = revision.ref;
  return {
    policyId: 'policyId' in ref ? ref.policyId : '',
    revision: revision.contentRevision,
    contentDigest: revision.contentDigest,
    maxAutonomousReworks,
    maxClarifications,
    inScopeRework: allowed['inScopeRework'] === true,
    inScopeTesting: allowed['inScopeTesting'] === true,
    changesRequireHumanDecision: changes,
    upgrade: { path: typeof upgrade['path'] === 'string' ? upgrade['path'] : '', note: typeof upgrade['note'] === 'string' ? upgrade['note'] : '' },
  };
}

/**
 * RW-10：自动返工开关的权威说明（唯一文本出处）。三条互斥状态的文字都在这里，界面原样显示。
 * 停用与启用都是同一条机械规则：生效策略的 allowed.inScopeRework 决定自动受理入口的边界 (b)，
 * 因此「怎么停用」「停用后会发生什么」「怎么重新启用」都必须写清楚，且不新增命令或状态。
 */
function automationSwitchOf(automation: CoordinationPolicyGrantV1 | null): AutomationSwitchViewV1 {
  if (automation === null) {
    return {
      inScopeRework: null, policyId: null, policyRevision: null,
      note: '当前没有生效的协调策略：自动返工不会被受理（自动受理返回 governance_unavailable 且零写入），平台不套用任何默认预算——这不是“默认开启”。安装并激活一份协调策略才会授予范围内的自动返工。',
    };
  }
  if (automation.inScopeRework !== true) {
    return {
      inScopeRework: false, policyId: automation.policyId, policyRevision: automation.revision,
      note: '人已停用范围内的自动返工：生效的协调策略 ' + automation.policyId + '@' + automation.revision +
        ' 把 allowed.inScopeRework 设为 false，因此自动受理在边界 (b) 上直接转 needs_human_decision 且零写入，之后每条失败都必须由人决定。' +
        '要重新启用，安装并激活一份 allowed.inScopeRework=true 的协调策略 revision（策略 revision 不可改写，内容不同就是另一个 policyId）。',
    };
  }
  return {
    inScopeRework: true, policyId: automation.policyId, policyRevision: automation.revision,
    note: '范围内的自动返工已授权：生效的协调策略 ' + automation.policyId + '@' + automation.revision +
      ' 允许 inScopeRework，自动受理在四条边界都成立时才会受理（上限 ' + automation.maxAutonomousReworks + ' 次，每目标计数）。' +
      '关闭 inScopeRework（安装并激活一份 inScopeRework=false 的协调策略）即停用自动返工，之后每条失败都必须由人决定。',
  };
}

function describeRef(ref: GovernanceRevisionRefV1): string {
  // 每个种类的身份字段不同（policyId／baselineId／roleId），逐个显式取，不用兜底默认值。
  const id = 'policyId' in ref ? ref.policyId : 'baselineId' in ref ? ref.baselineId : ref.roleId;
  return ref.aggregateType + '(' + id + '@' + ref.revision + ')';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 与 describeRef 同一口径的短标签（供视图说明文字引用某个 revision）。 */
function refLabelOf(ref: GovernanceRevisionRefV1): string {
  return describeRef(ref);
}

/** 摘要口径只有一处（contracts/role-spec.ts）；正文不是可规范化 JSON 时返回 null，不抛。 */
function safeRoleSpecDigest(content: RoleSpecContentV1, roleId: string): string | null {
  try {
    return roleSpecContentDigest(content, roleId, ROLE_SPEC_REVISION);
  } catch {
    return null;
  }
}

/** 矩阵 pin 的形状判据（与安装期校验同一形状；这里只做读取侧的窄化，不重复校验规则）。 */
function isRoleSpecPin(value: unknown): value is RoleSpecPinV1 {
  if (!isRecord(value) || typeof value['digest'] !== 'string') return false;
  const ref = value['ref'];
  return isRecord(ref) && ref['aggregateType'] === 'RoleSpecRevision' && typeof ref['projectId'] === 'string'
    && typeof ref['roleId'] === 'string' && typeof ref['revision'] === 'number';
}
