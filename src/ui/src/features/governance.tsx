/**
 * 治理设置区块（RW-08 / RW-14）：五个治理种类的 install / activate 与「当前生效的是哪一份」。
 *
 * 界面只做三件事：把服务端视图原样呈现、把人的输入变成既有 install/activate 的 source／pin、
 * 把服务端的明确 code 显示出来。它不判断策略含义、不缓存治理状态、也不在本地推断“应该生效
 * 哪一份”：安装与激活的结论一律以 ControlEngine 的回执和随后的视图为准。
 *
 * 为什么把「等于授予多少自动返工额度」写在安装按钮旁边：CoordinationPolicy 的
 * budget.maxAutonomousReworks 是自动返工的运行时上限，scope.changesRequireHumanDecision
 * 决定哪些变更必须问人，upgrade.path 说明怎么升格。人需要先看到这三件事再决定装不装。
 */
import { Alert, Badge, Box, Button, Checkbox, Group, NumberInput, Paper, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type {
  GovernanceActiveViewV1,
  GovernanceKindV1,
  GovernanceKindViewV1,
  GovernanceRevisionRefV1,
  GovernanceViewV1,
} from '../../../contracts/governance-view.js';
import type { Api } from '../api/client';
import { errorMessage } from '../api/client';
import { ErrorState, FieldRow, LoadingState, RawDetails } from '../components/states';
import type { AppStore } from '../state/app-store';

const KIND_LABEL: Record<GovernanceKindV1, string> = {
  CompletionPolicy: '完成策略',
  ArchitectureBaseline: '架构基线',
  CoordinationPolicy: '协调策略（自动化额度与角色矩阵）',
  ArchitectureEvolutionPolicy: '架构演进策略',
  RoleSpecRevision: '角色规格（角色目录）',
};

const KIND_MEANING: Record<GovernanceKindV1, string> = {
  CompletionPolicy: '决定一个验收义务至少要编译出多少条必验要求，以及平台承认哪些证据种类。',
  ArchitectureBaseline: '规定应当满足的架构约束；计划在接受时钉住当时的生效 revision。',
  CoordinationPolicy: '规定自动返工的额度、哪些变更必须问人、策略升级路径，以及可选的**角色矩阵**（哪些角色存在、各自被授权到哪一份角色规格）。没有生效的策略时，平台不会自动受理返工，也不做角色校验。',
  ArchitectureEvolutionPolicy: '规定哪些架构漂移可以在白名单内自动修复、每个周期的修复预算与升级路径。',
  RoleSpecRevision: '一个角色的版本化职责：能拿哪些工具、必须读哪些材料、必须产出什么、什么条件下退出。角色矩阵只能 pin 已经安装并激活的规格；一个 roleId 只有一份不可改写的规格。',
};

/** 矩阵 pin 就绪状态的中文说法（状态本身由服务端判定，界面只标注，不重新判断）。 */
const READINESS_LABEL: Record<string, string> = {
  ready: '可用',
  spec_not_installed: '规格未安装',
  spec_not_activated: '规格未激活',
  stale: '与 pin 不一致',
};

const shortDigest = (digest: string) => (digest ? digest.slice(0, 12) : '—');
const actorLabel = (actor: { kind: string; id: string } | null) => (actor === null ? '未记录' : actor.kind + ':' + actor.id);
const refLabel = (ref: GovernanceRevisionRefV1) => {
  // 每个种类的身份字段不同：策略/演进策略用 policyId、基线用 baselineId、角色规格用 roleId。
  const id = 'policyId' in ref ? ref.policyId : 'baselineId' in ref ? ref.baselineId : ref.roleId;
  return id + '@' + ref.revision;
};
/** 是否是同一条 revision（比较三个身份字段，不依赖对象键顺序）。 */
const sameRef = (a: GovernanceRevisionRefV1, b: GovernanceRevisionRefV1) =>
  a.aggregateType === b.aggregateType && a.revision === b.revision && refLabel(a) === refLabel(b);

function ActiveFacts({ active }: { active: GovernanceActiveViewV1 }) {
  return (
    <Stack gap={0}>
      <FieldRow label="生效 revision" mono>{active.ref.aggregateType} · {refLabel(active.ref)}</FieldRow>
      <FieldRow label="钉住的摘要" mono>{shortDigest(active.digest)}</FieldRow>
      <FieldRow label="激活者">{actorLabel(active.activatedBy)}</FieldRow>
      <FieldRow label="激活时间">{active.activatedAt ?? '未记录'}</FieldRow>
      <FieldRow label="第几次激活">{active.activeAggregateRevision}</FieldRow>
      {active.revision ? <RawDetails value={active.revision.content} label="查看生效内容" /> : null}
    </Stack>
  );
}

export function GovernanceSection({ api, scope, store }: { api: Api; scope: { projectId: string; workspaceId: string } | null; store: AppStore }) {
  const key = scope ? scope.projectId + ':' + scope.workspaceId : 'none';
  const query = useQuery({
    queryKey: ['governance', key],
    enabled: scope !== null,
    queryFn: () => api.governanceView(scope!),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'error' | 'warning' | 'success'; text: string } | null>(null);
  // CoordinationPolicy 的安装参数：额度是人的授权决定，因此界面必须把数字显式交出去。
  const [policyId, setPolicyId] = useState('coordination-policy-main');
  const [maxReworks, setMaxReworks] = useState(1);
  const [maxClarifications, setMaxClarifications] = useState(3);
  const [note, setNote] = useState('策略升级需要人的决定');
  // RW-10 人的暂停开关：这一位直接决定自动受理的边界 (b)。界面不自己解释规则——
  // 开关的后果由服务端视图的 automationSwitch.note 给成文字，这里只负责把它作为输入交出去。
  // 初值在读到服务端开关状态后同步（见下方 effect）：用 true 硬编码会让「已停用」时
  // 打开设置页再提交一次就**悄悄重新授权**。null 表示尚未读到，表单此时不允许提交。
  const [inScopeRework, setInScopeRework] = useState<boolean | null>(null);
  const [switchTouched, setSwitchTouched] = useState(false);
  // RW-14：这份协调策略是否登记角色矩阵。含矩阵 ⇒ claim 会按角色校验；不含 ⇒ 不做角色校验。
  // 界面不替人做这个决定，只把选定之后的后果（哪些 pin 还没有可用的已激活规格）摆出来。
  const [withMatrix, setWithMatrix] = useState(false);
  const [matrixRoles, setMatrixRoles] = useState<string[] | null>(null);
  const [coordinator, setCoordinator] = useState<string | null>(null);

  const afterWrite = async (tone: 'success' | 'warning', text: string) => {
    setMessage({ tone, text });
    store.notify(tone === 'success' ? 'success' : 'warning', text);
    await query.refetch();
  };

  const installBuiltIn = async (kind: GovernanceKindV1) => {
    if (!scope) return;
    setBusy('install-' + kind); setMessage(null);
    try {
      const result = await api.governanceInstall(scope, { kind });
      await afterWrite(
        result.status === 'committed' ? 'success' : 'warning',
        result.status === 'committed'
          ? KIND_LABEL[kind] + '：' + result.message + '（来源：内置本地 ' + result.sourceOrigin + '）'
          : KIND_LABEL[kind] + ' 安装被拒绝（' + result.code + '）：' + result.message,
      );
    } catch (error) { setMessage({ tone: 'error', text: errorMessage(error) }); }
    finally { setBusy(null); }
  };

  /**
   * RW-14：安装并激活一个角色的规格。
   *
   * 不给出 source ⇒ 用服务端注入的内置 source（与 CompletionPolicy 同一定位：它是 source 内容，
   * 不产生授权，必须经 install + activate 才生效）。激活用的是**视图给出的那个 pin**（安装后
   * 落账快照的 revision + digest），界面不自己算摘要。
   */
  const installRoleSpec = async (roleId: string) => {
    if (!scope) return;
    setBusy('install-role-' + roleId); setMessage(null);
    try {
      const result = await api.governanceInstall(scope, { kind: 'RoleSpecRevision', roleId });
      if (result.status !== 'committed') {
        setMessage({ tone: 'warning', text: '角色 ' + roleId + ' 的规格安装被拒绝（' + result.code + '）：' + result.message });
        await query.refetch();
        return;
      }
      const fresh = (await query.refetch()).data;
      const pin = rolePinOf(fresh, roleId);
      if (pin === null) {
        setMessage({ tone: 'warning', text: '角色 ' + roleId + ' 的规格已安装，但视图里还没有它的精确 pin：请刷新后重试激活。' });
        return;
      }
      const activated = await api.governanceActivate(scope, { kind: 'RoleSpecRevision', pin });
      await afterWrite(
        activated.status === 'committed' ? 'success' : 'warning',
        activated.status === 'committed'
          ? '角色 ' + roleId + ' 的规格已生效（' + activated.message + '）'
          : '角色 ' + roleId + ' 的规格激活被拒绝（' + activated.code + '）：' + activated.message,
      );
    } catch (error) { setMessage({ tone: 'error', text: errorMessage(error) }); }
    finally { setBusy(null); }
  };

  const installCoordination = async () => {
    // 尚未读到生效状态时不提交：否则会用界面默认值覆盖掉人当前的授权状态。
    if (!scope || inScopeRework === null) return;
    setBusy('install-CoordinationPolicy'); setMessage(null);
    try {
      // RW-14：选了矩阵就把视图给出的 pin 原样装进策略正文（界面不自己算 revision／摘要）。
      const catalog = withMatrix ? Object.fromEntries(selectedRoles.map(roleId => [roleId, rolePinOf(view, roleId)!])) : null;
      if (withMatrix && (catalog === null || Object.values(catalog).some(pin => pin === null) || selectedRoles.length === 0)) {
        setMessage({ tone: 'warning', text: '选中的角色里还有没有可用 pin 的：请先安装并激活这些角色的规格，或把它们从矩阵里去掉。' });
        return;
      }
      const result = await api.governanceInstall(scope, {
        kind: 'CoordinationPolicy',
        source: {
          policyId,
          content: {
            schemaVersion: 1,
            budget: { maxAutonomousReworks: maxReworks, maxClarifications },
            allowed: { inScopeRework, inScopeTesting: true },
            scope: { changesRequireHumanDecision: ['requirement', 'acceptance', 'baseline'] },
            upgrade: { path: 'manual-decision', note },
            ...(catalog === null ? {} : { roles: { catalog, coordinator: { roleId: resolvedCoordinator, note: '跨工作包议题由该角色收敛并上报需要人决定的事项' } } }),
          },
        },
      });
      if (result.status !== 'committed') {
        setMessage({ tone: 'warning', text: '安装被拒绝（' + result.code + '）：' + result.message });
        await query.refetch();
        return;
      }
      // 安装不会自动激活（ARCHITECTURE 不变量 #11）：装完立刻用同一份 source 的精确 pin 激活。
      const view = (await query.refetch()).data;
      const pin = pinForDigest(view, 'CoordinationPolicy', result.contentDigest ?? '');
      if (pin === null) {
        setMessage({ tone: 'warning', text: '安装已落账，但视图里还没有本次 source 的精确 pin：请刷新后重试激活。' });
        return;
      }
      const activated = await api.governanceActivate(scope, { kind: 'CoordinationPolicy', pin });
      await afterWrite(
        activated.status === 'committed' ? 'success' : 'warning',
        activated.status === 'committed'
          ? (inScopeRework
              ? '协调策略已生效：自动返工上限 ' + maxReworks + ' 次；' + activated.message
              : '协调策略已生效，并且已停用范围内的自动返工（inScopeRework=false）：从这一刻起每条失败都必须由人决定；' + activated.message)
          : '激活被拒绝（' + activated.code + '）：' + activated.message,
      );
    } catch (error) { setMessage({ tone: 'error', text: errorMessage(error) }); }
    finally { setBusy(null); }
  };

  const activateInstalled = async (kind: GovernanceKindV1, pin: { ref: unknown; digest: string }) => {
    if (!scope) return;
    setBusy('activate-' + kind); setMessage(null);
    try {
      const result = await api.governanceActivate(scope, { kind, pin });
      await afterWrite(
        result.status === 'committed' ? 'success' : 'warning',
        result.status === 'committed'
          ? KIND_LABEL[kind] + '：' + result.message + '（CAS 窗口 Project@' + result.expectedRevision + '，来源：' + result.expectedRevisionSource + '）'
          : KIND_LABEL[kind] + ' 激活被拒绝（' + result.code + '）：' + result.message,
      );
    } catch (error) { setMessage({ tone: 'error', text: errorMessage(error) }); }
    finally { setBusy(null); }
  };

  const view: GovernanceViewV1 | undefined = query.data;
  // RW-14：角色目录来自服务端视图（内置 source ∪ 已安装/已激活 ∪ 当前矩阵 pin），
  // pin 也由服务端给出——界面不自己算 revision 与摘要。
  const roleSpecEntries = view?.kinds.find(entry => entry.kind === 'RoleSpecRevision')?.roleSpecs ?? [];
  const readyRoleIds = roleSpecEntries.filter(entry => entry.pin !== null).map(entry => entry.roleId);
  // 人没有改过选择之前跟随服务端能提供的角色；改过之后跟随人的选择（不静默覆盖）。
  const selectedRoles = matrixRoles ?? readyRoleIds;
  const resolvedCoordinator = coordinator ?? (selectedRoles.includes('planner') ? 'planner' : selectedRoles[0] ?? '');
  const matrixBlockers = selectedRoles.filter(roleId => roleSpecEntries.find(entry => entry.roleId === roleId)?.readiness.status !== 'ready');
  const matrixMissingEntries = (view?.roleMatrix.entryRoles ?? []).filter(entry => !selectedRoles.includes(entry.roleId));
  const limits = view?.coordinationLimits;
  const automation = view?.automation ?? null;
  const automationSwitch = view?.automationSwitch;
  // 生效状态是权威值：人没有显式改过之前，表单跟随它，避免默认勾选造成重新授权。
  const currentSwitch = automationSwitch?.inScopeRework ?? null;
  useEffect(() => { if (!switchTouched) setInScopeRework(currentSwitch); }, [currentSwitch, switchTouched]);

  return (
    <Paper withBorder p="xs" radius="sm" data-testid="governance-section">
      <Group justify="space-between" mb={6}>
        <Text size="xs" fw={600}>治理与策略（安装 / 激活）</Text>
        {view ? <Badge variant="light" color="gray">Project revision {view.projectRevision ?? '—'}</Badge> : null}
      </Group>
      <Text size="xs" c="dimmed" mb={6}>
        这里回答三件事：当前生效的是哪一份策略或基线、谁在什么时候装的、内容是什么。安装与激活都走既有的
        ControlEngine 命令面（install 用 CAS@0、activate 用当前 Project revision 做 CAS），被拒绝时会给出明确 code，不会静默忽略。
        人的暂停开关也在这一页：<b>关闭 inScopeRework 即停用自动返工</b>，之后每条失败都必须由人决定；
        重新启用则安装并激活一份 inScopeRework=true 的策略 revision。
      </Text>
      {scope === null ? <Alert color="yellow" variant="light">请先选择项目</Alert> : null}
      {query.isLoading && scope ? <LoadingState label="正在读取治理状态…" /> : null}
      {query.error ? <ErrorState message={errorMessage(query.error)} /> : null}
      {message ? <Alert mb={6} color={message.tone === 'error' ? 'red' : message.tone === 'warning' ? 'yellow' : message.tone === 'success' ? 'green' : 'blue'} variant="light" role="status">{message.text}</Alert> : null}

      {view ? (
        <Stack gap="sm">
          {/* RW-10：状态、后果与“怎么停用/重新启用”都取自服务端视图，界面不自己解释规则。 */}
          <Alert
            color={automation === null ? 'yellow' : automationSwitch?.inScopeRework === true ? 'green' : 'orange'}
            variant="light"
            data-testid="automation-state"
            title={automationSwitch?.inScopeRework === false ? '自动返工：已被人停用' : automationSwitch?.inScopeRework === true ? '自动返工：已授权（范围内）' : '自动返工：没有生效策略'}
          >
            {automationSwitch !== undefined ? automationSwitch.note : '正在读取自动返工开关状态…'}
            {automation !== null ? (
              <Text size="xs" mt={4}>
                当前生效的协调策略 {automation.policyId}@{automation.revision}{' '}
                {automationSwitch?.inScopeRework === false
                  ? '记录的上限是 ' + automation.maxAutonomousReworks + ' 次自动返工，但这一位已被关闭，额度不会被消费；'
                  : '授予的自动化额度：最多 ' + automation.maxAutonomousReworks + ' 次自动返工（每目标计数，用满后必须由人决定）；'}
                {automation.changesRequireHumanDecision.length ? '改变 ' + automation.changesRequireHumanDecision.join('、') + ' 必须由人决定；' : ''}
                升级路径 {automation.upgrade.path}（{automation.upgrade.note}）——策略不能自动放宽。
              </Text>
            ) : null}
          </Alert>

          {/*
            RW-14：这条 Alert 回答的是一个**否命题**——「这份策略到底有没有角色矩阵、没有矩阵时 claim
            会不会做角色校验」。没有它，人会把“策略装上了”读成“角色已经被校验过”（静默放行）。
            文字与 pin 就绪状态都由服务端给出（判据与 claim 守卫同一份实现），界面原样显示。
          */}
          <Alert
            color={view.roleMatrix.present === true ? (matrixBlockers.length === 0 ? 'green' : 'yellow') : 'blue'}
            variant="light"
            data-testid="role-matrix-state"
            title={view.roleMatrix.present === true
              ? '协调策略：含角色矩阵（claim 按角色校验）'
              : view.roleMatrix.present === false
                ? '协调策略：不含角色矩阵（claim 不做角色校验）'
                : view.roleMatrix.gaps.length > 0
                  ? '协调策略：状态不可判定（不猜）'
                  : '没有生效的协调策略（claim 不做角色校验）'}
          >
            {view.roleMatrix.note}
            {view.roleMatrix.pins.length > 0 ? (
              <Text size="xs" mt={4}>
                矩阵 pin 就绪情况：
                {view.roleMatrix.pins.map(pin => pin.roleId + '=' + (READINESS_LABEL[pin.readiness.status] ?? pin.readiness.status)).join('、')}
              </Text>
            ) : null}
            {view.roleMatrix.gaps.map((gap, index) => <Text key={index} size="xs" c="yellow.8">{gap}</Text>)}
          </Alert>

          {view.kinds.map(kindView => (
            <Paper key={kindView.kind} withBorder p="xs" radius="sm" data-testid={'governance-' + kindView.kind}>
              <Group justify="space-between" mb={4}>
                <Text size="xs" fw={600}>{KIND_LABEL[kindView.kind]}</Text>
                {kindView.kind === 'RoleSpecRevision'
                  // 这个种类的生效引用是逐角色的：用“尚未激活”会读成“一份都没有生效”。
                  ? <Badge size="sm" color={(kindView.roleSpecs ?? []).some(entry => entry.active !== null) ? 'green' : 'gray'} variant="light">按角色生效（{refCount(kindView.roleSpecs ?? [])}）</Badge>
                  : kindView.active
                    ? <Badge size="sm" color="green" variant="light">生效 {refLabel(kindView.active.ref)}</Badge>
                    : <Badge size="sm" color="gray" variant="light">尚未激活</Badge>}
              </Group>
              <Text size="xs" c="dimmed" mb={4}>{KIND_MEANING[kindView.kind]}</Text>
              {kindView.active ? <ActiveFacts active={kindView.active} /> : null}
              {kindView.gaps.map((gap, index) => <Text key={index} size="xs" c="yellow.8">{gap}</Text>)}

              {kindView.kind === 'RoleSpecRevision' ? (
                <RoleSpecTable
                  roles={kindView.roleSpecs ?? []}
                  busy={busy}
                  onInstall={installRoleSpec}
                  onActivate={pin => activateInstalled('RoleSpecRevision', pin)}
                />
              ) : kindView.kind === 'CoordinationPolicy' ? (
                <Stack gap={4} mt={6}>
                  <Text size="xs" fw={500}>安装一份新的协调策略</Text>
                  <Group gap={6} align="flex-end">
                    <TextInput size="xs" label="策略标识" value={policyId} onChange={event => setPolicyId(event.currentTarget.value)} w={200} data-testid="policy-id" />
                    <NumberInput size="xs" label="自动返工额度" value={maxReworks} min={1} max={limits?.maxAutonomousReworksMax ?? 4} onChange={value => setMaxReworks(Math.max(1, Number(value) || 1))} w={140} data-testid="policy-rework-budget" />
                    <NumberInput size="xs" label="澄清上限" value={maxClarifications} min={1} max={8} onChange={value => setMaxClarifications(Math.max(1, Number(value) || 1))} w={120} data-testid="policy-clarification-budget" />
                    <TextInput size="xs" label="升级说明" value={note} onChange={event => setNote(event.currentTarget.value)} w={240} />
                  </Group>
                  <Checkbox
                    size="xs"
                    checked={inScopeRework === true}
                    disabled={inScopeRework === null}
                    onChange={event => { setSwitchTouched(true); setInScopeRework(event.currentTarget.checked); }}
                    data-testid="policy-in-scope-rework"
                    label="允许范围内的自动返工（allowed.inScopeRework）"
                    description="取消勾选即停用自动返工：之后每条失败都必须由人决定。停用不需要新命令或新状态，就是安装并激活一份 inScopeRework=false 的策略。"
                  />
                  <Alert color={inScopeRework ? 'blue' : 'orange'} variant="light" data-testid="grant-preview">
                    {inScopeRework ? (
                      <>安装并激活这份策略等于授予平台最多 <b>{maxReworks}</b> 次自动返工额度（每目标计数；用满后转人工）。</>
                    ) : (
                      <>安装并激活这份策略等于<b>停用范围内的自动返工</b>：自动受理会在边界 (b) 直接返回 needs_human_decision 且零写入，之后每条失败都必须由人决定（额度数字仍然记录，但不会被消费）。</>
                    )}
                    改变 requirement、acceptance、baseline 仍然必须由人决定；升级路径固定为 manual-decision（平台强制，策略不能自动放宽）。
                    安装使用 CAS@0（已存在同一份则返回既有 revision，不会覆盖），激活使用当前 Project revision 做 CAS。
                    {inScopeRework ? null : '注意：同一策略标识只能安装一份不可改写的 revision，停用（或重新启用）请换一个策略标识再安装并激活。'}
                  </Alert>
                  {/*
                    RW-14：矩阵是可选的，但选它之前人必须能看出**哪些 pin 还没有对应的已激活规格**，
                    否则无法判断这次安装会不会把派发打断。就绪状态逐项来自服务端（与 claim 守卫同一判据）。
                  */}
                  <Checkbox
                    size="xs"
                    checked={withMatrix}
                    onChange={event => setWithMatrix(event.currentTarget.checked)}
                    data-testid="policy-with-role-matrix"
                    label="登记角色矩阵（roles）"
                    description="含矩阵：每条 claim 必须命中矩阵里的角色，且该角色的规格已安装、已激活并与 pin 的 revision／摘要一致，否则拒绝且零写入。不含矩阵：claim 不做角色校验（沿用既有绑定语义）。"
                  />
                  {withMatrix ? (
                    <Stack gap={4}>
                      <Text size="xs">矩阵登记哪些角色（只列出本产品有内置来源或已安装规格的角色）</Text>
                      <Group gap={8}>
                        {roleSpecEntries.map(entry => (
                          <Checkbox
                            key={entry.roleId}
                            size="xs"
                            checked={selectedRoles.includes(entry.roleId)}
                            onChange={event => {
                              const next = event.currentTarget.checked
                                ? [...selectedRoles, entry.roleId]
                                : selectedRoles.filter(roleId => roleId !== entry.roleId);
                              setMatrixRoles(next);
                            }}
                            label={entry.roleId + '（' + entry.label + '）'}
                            data-testid={'matrix-role-' + entry.roleId}
                          />
                        ))}
                      </Group>
                      <Select
                        size="xs"
                        label="收敛角色（coordinator，必须是上面选中的角色之一）"
                        value={resolvedCoordinator}
                        onChange={value => setCoordinator(value)}
                        data={selectedRoles.map(roleId => ({ value: roleId, label: roleId }))}
                        w={260}
                        data-testid="matrix-coordinator"
                      />
                      <Alert color={matrixBlockers.length === 0 && matrixMissingEntries.length === 0 ? 'green' : 'yellow'} variant="light" data-testid="matrix-readiness">
                        {matrixBlockers.length === 0
                          ? '选中的角色都有可用的已激活规格：矩阵会按这些 pin 签发角色绑定（revision 与摘要都取自 pin），这些角色仍然能被派发。'
                          : '以下 pin 还没有对应的已激活规格，装上这份矩阵会让这些角色的 claim 被拒绝：' + matrixBlockers.map(roleId => roleId + '（' + (READINESS_LABEL[roleSpecEntries.find(entry => entry.roleId === roleId)?.readiness.status ?? ''] ?? '未知') + '）').join('、') + '。派发与 claim 的角色绑定由矩阵 pin 签发，所以请**先**在「角色规格」区块把这些 pin 指向的规格安装并激活，再安装并激活这份矩阵。'}
                        {matrixMissingEntries.length === 0
                          ? ''
                          : ' 另外这份矩阵没有登记产品自带入口需要的角色：' + matrixMissingEntries.map(entry => entry.roleId + '（' + entry.purpose + '）').join('、') + '，这些入口会被拒绝。'}
                      </Alert>
                    </Stack>
                  ) : null}
                  <Group gap={4}>
                    <Button size="xs" color={inScopeRework === false ? 'orange' : undefined} disabled={inScopeRework === null} loading={busy === 'install-CoordinationPolicy'} onClick={() => void installCoordination()} data-testid="install-coordination-policy">{inScopeRework === null ? '正在读取生效状态…' : inScopeRework ? '安装并激活' : '安装并激活（停用自动返工）'}</Button>
                  </Group>
                </Stack>
              ) : (
                <Group gap={4} mt={6}>
                  <Button size="xs" variant="light" loading={busy === 'install-' + kindView.kind} onClick={() => void installBuiltIn(kindView.kind)} data-testid={'install-' + kindView.kind}>安装内置本地来源</Button>
                </Group>
              )}

              {/* 角色规格的逐角色清单已经给出安装/激活入口，这里不再重复一张扁平 revision 表。 */}
              {kindView.kind === 'RoleSpecRevision' ? null : <RevisionTable kindView={kindView} busy={busy} onActivate={activateInstalled} />}
            </Paper>
          ))}

          {view.gaps.map((gap, index) => <Text key={index} size="xs" c="yellow.8">{gap}</Text>)}
          <RawDetails value={view} label="查看治理视图原始记录" />
        </Stack>
      ) : null}
    </Paper>
  );
}

/** 已安装 revision 的清单：activate 只能指向这里的精确 ref+digest。 */
function RevisionTable({
  kindView,
  busy,
  onActivate,
}: {
  kindView: GovernanceKindViewV1;
  busy: string | null;
  onActivate: (kind: GovernanceKindV1, pin: { ref: unknown; digest: string }) => Promise<void>;
}) {
  if (kindView.installed.length === 0) {
    return <Text size="xs" c="dimmed" mt={4}>还没有安装过任何 revision。</Text>;
  }
  return (
    <Box mt={6}>
      <Text size="xs" fw={500} mb={2}>已安装 revision（不可变；激活只会移动 active ref）</Text>
      <Table withTableBorder verticalSpacing={2} fz="xs">
        <Table.Thead><Table.Tr><Table.Th>revision</Table.Th><Table.Th>摘要</Table.Th><Table.Th>安装者 / 时间</Table.Th><Table.Th>操作</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {kindView.installed.map(revision => {
            const isActive = kindView.active !== null && sameRef(kindView.active.ref, revision.ref);
            return (
              <Table.Tr key={revision.ref.aggregateType + ':' + refLabel(revision.ref) + ':' + revision.contentDigest}>
                <Table.Td><Text size="xs">{refLabel(revision.ref)}{isActive ? '（生效中）' : ''}</Text></Table.Td>
                <Table.Td><Text size="xs" style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{shortDigest(revision.contentDigest)}</Text></Table.Td>
                <Table.Td><Text size="xs">{actorLabel(revision.installedBy)} · {revision.installedAt ?? '未记录'}</Text></Table.Td>
                <Table.Td>
                  <Button
                    size="compact-xs" variant="subtle" disabled={isActive || busy !== null}
                    onClick={() => void onActivate(kindView.kind, { ref: revision.ref, digest: revision.contentDigest })}
                    data-testid={'activate-' + kindView.kind}
                  >激活</Button>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Box>
  );
}

/** 已生效的角色数（第五个种类的生效引用是逐角色的，没有单一“当前生效”）。 */
const refCount = (roles: { active: unknown }[]) => roles.filter(role => role.active !== null).length;

/**
 * RW-14 角色规格清单：一行一个角色，逐项给出内容 revision、digest、生效引用、安装者与时间，
 * 以及「这个 pin 现在装上去会怎样」（服务端判定的就绪状态）。没有规格的角色可以一键安装并激活
 * 内置 source——安装仍然是 CAS@0、激活仍然要落账，界面不产生任何授权。
 */
function RoleSpecTable({
  roles,
  busy,
  onInstall,
  onActivate,
}: {
  roles: import('../../../contracts/governance-view.js').RoleSpecEntryViewV1[];
  busy: string | null;
  onInstall: (roleId: string) => Promise<void>;
  onActivate: (pin: { ref: unknown; digest: string }) => Promise<void>;
}) {
  if (roles.length === 0) return <Text size="xs" c="dimmed" mt={4}>当前没有可登记的角色（装载时没有注入内置 source，也没有已安装的规格）。</Text>;
  return (
    <Box mt={6}>
      <Text size="xs" c="dimmed" mb={4}>
        生效引用是逐角色的：每个角色有自己的生效规格，没有“当前生效的那一份角色规格”。矩阵只能 pin
        这里显示为「可用」的角色。
      </Text>
      <Table withTableBorder verticalSpacing={2} fz="xs">
        <Table.Thead><Table.Tr><Table.Th>角色</Table.Th><Table.Th>内容 revision / 摘要</Table.Th><Table.Th>生效引用</Table.Th><Table.Th>安装者 / 时间</Table.Th><Table.Th>pin 就绪</Table.Th><Table.Th>操作</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {roles.map(role => (
            <Table.Tr key={role.roleId} data-testid={'role-spec-' + role.roleId}>
              <Table.Td><Text size="xs">{role.roleId} · {role.label}</Text></Table.Td>
              <Table.Td><Text size="xs" style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{role.contentRevision ?? '—'} / {shortDigest(role.contentDigest ?? '')}</Text></Table.Td>
              <Table.Td>
                <Text size="xs">
                  {role.active === null
                    ? '未激活'
                    : refLabel(role.active.ref) + ' · ' + shortDigest(role.active.digest) + ' · ' + actorLabel(role.active.activatedBy) + ' · ' + (role.active.activatedAt ?? '未记录')}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs">
                  {role.installed.length === 0
                    ? '未安装'
                    : actorLabel(role.installed[0]!.installedBy) + ' · ' + (role.installed[0]!.installedAt ?? '未记录')}
                </Text>
              </Table.Td>
              <Table.Td>
                <Badge size="sm" variant="light" color={role.readiness.status === 'ready' ? 'green' : role.readiness.status === 'spec_not_installed' ? 'gray' : 'yellow'}>
                  {READINESS_LABEL[role.readiness.status] ?? role.readiness.status}
                </Badge>
                <Text size="xs" c="dimmed">{role.readiness.message}</Text>
              </Table.Td>
              <Table.Td>
                <Group gap={4}>
                  <Button
                    size="compact-xs" variant="light" disabled={busy !== null || role.builtInSource === null}
                    loading={busy === 'install-role-' + role.roleId}
                    onClick={() => void onInstall(role.roleId)}
                    data-testid={'install-role-' + role.roleId}
                  >{role.builtInSource === null ? '无内置来源' : role.installed.length === 0 ? '安装并激活内置规格' : '重新安装并激活'}</Button>
                  {role.installed.length > 0 && role.pin !== null && role.readiness.status !== 'ready' ? (
                    <Button size="compact-xs" variant="subtle" disabled={busy !== null} onClick={() => void onActivate(role.pin!)} data-testid={'activate-role-' + role.roleId}>激活</Button>
                  ) : null}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Box>
  );
}

/** 某个角色当前可用的精确 pin（服务端视图给出：已安装规格的 revision + digest）。 */
function rolePinOf(view: GovernanceViewV1 | undefined, roleId: string): { ref: unknown; digest: string } | null {
  const entry = view?.kinds.find(kind => kind.kind === 'RoleSpecRevision')?.roleSpecs?.find(spec => spec.roleId === roleId);
  return entry?.pin == null ? null : { ref: entry.pin.ref, digest: entry.pin.digest };
}

/**
 * 刚安装的那一份的精确 pin（激活必须钉 identity/revision/digest 三元组）。
 * 按摘要匹配，而不是按"列表里最后一个"——激活对象必须是本次 source。
 */
function pinForDigest(view: GovernanceViewV1 | undefined, kind: GovernanceKindV1, digest: string): { ref: GovernanceRevisionRefV1; digest: string } | null {
  const kindView = view?.kinds.find(entry => entry.kind === kind);
  const match = kindView?.installed.find(entry => entry.contentDigest === digest);
  return match === undefined ? null : { ref: match.ref, digest: match.contentDigest };
}
