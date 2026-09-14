import { Alert, Badge, Box, Button, Group, Paper, PasswordInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useState } from 'react';
import { mutationError } from '../api/hooks';
import { useModelSettings } from '../api/hooks';
import { EmptyState, ErrorState, FieldRow, LoadingState } from '../components/states';
import { number } from '../format';
import { GovernanceSection } from './governance';
import type { ViewProps } from '../workbench/view-props';

export function SettingsView({ api, data, store, scope }: ViewProps) {
  const query = useModelSettings(api, true);
  const [form, setForm] = useState({ provider: '', model: '', baseUrl: '', apiKey: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'error' | 'warning' | 'success'; text: string } | null>(null);

  useEffect(() => {
    const data = query.data;
    if (!data) return;
    setForm(current => {
      if (data.configuration) {
        if (current.provider === data.configuration.provider && current.model === data.configuration.model && current.baseUrl === data.configuration.baseUrl) return current;
        return { ...current, provider: data.configuration.provider, model: data.configuration.model, baseUrl: data.configuration.baseUrl };
      }
      const first = data.providers[0];
      if (!first || current.provider) return current;
      return { ...current, provider: first.id, baseUrl: current.baseUrl || first.defaultBaseUrl };
    });
  }, [query.data]);

  const saved = query.data?.configuration ?? null;
  const runRevisions = [...new Set((data?.liveRuns ?? []).map(run => run.configuration?.revision).filter((value): value is string => !!value))];

  const save = async () => {
    setBusy('save'); setMessage(null);
    try {
      const result = await api.modelSettingsSave(form);
      setForm(current => ({ ...current, apiKey: '' }));
      setMessage({ tone: 'success', text: '配置已保存，版本 ' + (result.configuration?.revision ?? '—') });
      void query.refetch();
    } catch (error) { setMessage({ tone: 'error', text: mutationError(error).message }); }
    finally { setBusy(null); }
  };
  const clearKey = async () => {
    setBusy('clear'); setMessage(null);
    try { const result = await api.modelSettingsClear(); setMessage({ tone: 'info', text: result.keyConfigured ? '密钥仍存在。' : '密钥已清除，后续新连接不能使用旧密钥。' }); void query.refetch(); }
    catch (error) { setMessage({ tone: 'error', text: mutationError(error).message }); }
    finally { setBusy(null); }
  };
  const test = async () => {
    setBusy('test'); setMessage(null);
    try {
      const result = await api.modelSettingsTest();
      const usage = (result.calls ?? []).reduce((total, call) => ({ input: total.input + (call.usage?.inputTokens ?? 0), output: total.output + (call.usage?.outputTokens ?? 0) }), { input: 0, output: 0 });
      setMessage({ tone: result.ok ? 'success' : 'warning', text: result.message + ' 已报告用量：输入 ' + number(usage.input) + '、输出 ' + number(usage.output) + ' tokens。' });
    } catch (error) { setMessage({ tone: 'error', text: mutationError(error).message }); }
    finally { setBusy(null); }
  };

  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group px="sm" py={6} className="panel-head"><Text size="sm" fw={600}>设置</Text></Group>
      <Box className="panel-body" style={{ minHeight: 0, overflow: 'auto' }}>
        <Stack gap="sm" p="sm">
          <Paper withBorder p="xs" radius="sm">
            <Group justify="space-between" mb={6}><Text size="xs" fw={600}>模型连接</Text>{saved ? <Badge variant="light" color="gray">版本 {saved.revision.slice(0, 8)}</Badge> : <Badge variant="light" color="yellow">尚未保存</Badge>}</Group>
            {query.isLoading ? <LoadingState /> : null}
            {query.error ? <ErrorState message={(query.error as Error).message} /> : null}
            {query.data ? (
              <Stack gap={6}>
                <Select size="xs" label="提供方与协议" value={form.provider || (query.data.providers[0]?.id ?? '')} onChange={value => { const provider = value ?? ''; setForm(current => ({ ...current, provider, baseUrl: query.data?.providers.find(item => item.id === provider)?.defaultBaseUrl ?? current.baseUrl, apiKey: '' })); }} data={query.data.providers.map(item => ({ value: item.id, label: item.id }))} data-testid="model-provider" />
                <TextInput size="xs" label="模型名称" value={form.model} onChange={event => setForm({ ...form, model: event.currentTarget.value })} data-testid="model-name" />
                <TextInput size="xs" label="接口地址" value={form.baseUrl} onChange={event => setForm({ ...form, baseUrl: event.currentTarget.value })} data-testid="model-base-url" />
                <PasswordInput size="xs" label="API Key" value={form.apiKey} onChange={event => setForm({ ...form, apiKey: event.currentTarget.value })} placeholder={query.data.keyConfigured ? '已保存；留空保留，输入新值更新' : '尚未设置'} data-testid="model-key" />
                <Text size="xs" c="dimmed">{query.data.keyConfigured ? '密钥保存在本机配置目录，不会进入项目或浏览器持久化。' : '尚未设置密钥。'}</Text>
                <Group gap={4}>
                  <Button size="xs" loading={busy === 'save'} onClick={() => void save()} data-testid="save-settings">保存配置</Button>
                  <Button size="xs" variant="light" loading={busy === 'test'} onClick={() => void test()} disabled={!saved}>测试已保存的连接</Button>
                  <Button size="xs" variant="subtle" color="red" loading={busy === 'clear'} onClick={() => void clearKey()}>清除密钥</Button>
                </Group>
                {message ? <Alert color={message.tone === 'error' ? 'red' : message.tone === 'warning' ? 'yellow' : message.tone === 'success' ? 'green' : 'blue'} variant="light" role="status">{message.text}</Alert> : null}
              </Stack>
            ) : null}
          </Paper>

          <Paper withBorder p="xs" radius="sm">
            <Text size="xs" fw={600} mb={6}>设置消费者核对</Text>
            <Text size="xs" c="dimmed" mb={4}>保存的配置版本与真实运行记录的配置版本必须一致，才说明这次运行确实消费了当前设置。</Text>
            <FieldRow label="已保存版本">{saved?.revision ?? '—'}</FieldRow>
            <FieldRow label="运行使用版本">{runRevisions.length ? runRevisions.map(revision => revision.slice(0, 8)).join('、') : '尚无真实运行'}</FieldRow>
            {saved && runRevisions.length ? (
              <Alert mt={6} color={runRevisions.includes(saved.revision) ? 'green' : 'yellow'} variant="light">
                {runRevisions.includes(saved.revision) ? '最近运行使用的正是当前保存的配置版本。' : '运行使用的配置版本与当前保存版本不同；修改设置后需要新的运行才会消费。'}
              </Alert>
            ) : null}
          </Paper>

          <Paper withBorder p="xs" radius="sm">
            <Text size="xs" fw={600} mb={6}>阅读与布局</Text>
            <Text size="xs" c="dimmed">分栏宽度、标签与底部工具区按项目保存在本机；中栏最小 280 px。恢复布局不会恢复任务。</Text>
            <Group gap={4} mt={6}>
              <Button size="xs" variant="light" onClick={() => store.resetLayout()} data-testid="reset-layout">重置布局</Button>
              <Button size="xs" variant="subtle" onClick={() => store.setTheme(store.restoreTheme() === 'dark' ? 'light' : 'dark')}>切换明暗主题</Button>
            </Group>
          </Paper>

          <GovernanceSection api={api} scope={scope} store={store} />

          <Paper withBorder p="xs" radius="sm">
            <Text size="xs" fw={600} mb={6}>语义角色与协作</Text>
            {/* RW-14：这句原先写“角色职责解析、按角色供材与真实协调运行尚未接通”，在治理入口加进
                第五个种类（角色规格）与角色矩阵校验之后已经不成立，按当前事实改写。 */}
            <Text size="xs" c="dimmed">
              角色现在有版本化规格：在上一节「治理与策略」里可以安装并激活每个角色的规格，协调策略正文
              可以登记角色矩阵。矩阵生效后，每条 claim 都按矩阵校验角色——角色不在目录里、绑定的 revision
              不是矩阵 pin 的、规格未安装/未激活、或声明的权限超出规格上界，都会被拒绝且零写入；真实运行的
              材料也按绑定角色取材（缺料按缺口返回，不静默通过）。
            </Text>
            <Text size="xs" c="dimmed" mt={4}>
              仍未接通的是**角色协作本身**：秘书／参谋的自然语言协商与方案回流、按角色路由的补料请求与决定
              回流、多角色的持续收敛都还没有产品入口，这里也不提供会让人误以为已生效的开关。
            </Text>
          </Paper>

          {!data?.goalId ? <EmptyState title="未选择目标" description="部分设置按项目保存，与目标无关。" /> : null}
        </Stack>
      </Box>
    </Stack>
  );
}

