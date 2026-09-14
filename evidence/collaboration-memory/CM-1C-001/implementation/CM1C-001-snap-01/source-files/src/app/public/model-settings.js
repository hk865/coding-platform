export function initializeModelSettings(token) {
  const $ = id => document.getElementById(id);
  const dialog = $('model-settings-dialog'), form = $('model-settings-form'), status = $('model-settings-status');
  let revision = null, providers = [];
  async function request(path, body) {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-platform-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json(); if (!response.ok) throw Error(data.error ?? '模型设置操作失败'); return data;
  }
  function render(data) {
    providers = data.providers;
    $('model-provider').replaceChildren(...providers.map(p => { const option = document.createElement('option'); option.value = p.id; option.textContent = p.id === 'openai' ? 'OpenAI · Responses' : 'DeepSeek · Chat Completions'; return option; }));
    const c = data.configuration; revision = c?.revision ?? null;
    if (c) $('model-provider').value = c.provider;
    $('model-name').value = c?.model ?? '';
    $('model-base-url').value = c?.baseUrl ?? providers.find(p => p.id === $('model-provider').value)?.defaultBaseUrl ?? '';
    $('model-key').value = '';
    $('model-key').placeholder = data.keyConfigured ? '已保存；留空保留，输入新值更新' : '尚未设置';
    $('model-key-state').textContent = data.keyConfigured ? '密钥已保存在本机；刷新和重启后可用。' : '尚未设置密钥。';
    $('model-revision').textContent = revision ? `配置版本：${revision}` : '尚未保存配置';
  }
  function message(text) { status.textContent = text; }
  async function busy(fn) {
    const buttons = [...form.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true);
    try { await fn(); } catch (error) { message(error.message); }
    finally { buttons.forEach(b => b.disabled = false); }
  }
  $('model-settings-open').addEventListener('click', () => { dialog.showModal(); message('正在读取…'); void busy(async () => { render(await request('/api/model-settings')); message(''); }); });
  $('model-provider').addEventListener('change', () => { $('model-base-url').value = providers.find(p => p.id === $('model-provider').value)?.defaultBaseUrl ?? ''; $('model-key').value = ''; });
  form.addEventListener('submit', event => { event.preventDefault(); void busy(async () => {
    const body = { provider: $('model-provider').value, model: $('model-name').value, baseUrl: $('model-base-url').value, apiKey: $('model-key').value };
    $('model-key').value = '';
    try { render(await request('/api/model-settings', body)); message('配置已保存。可以测试连接。'); } finally { body.apiKey = ''; }
  }); });
  $('model-key-clear').addEventListener('click', () => { $('model-key').value = ''; void busy(async () => { render(await request('/api/model-settings/clear', {})); message('密钥已清除，后续连接不能使用旧密钥。'); }); });
  $('model-connection-test').addEventListener('click', () => { void busy(async () => {
    if (!revision) { message('请先保存配置。'); return; }
    const saved = await request('/api/model-settings');
    if (saved.configuration?.revision !== revision || $('model-provider').value !== saved.configuration.provider || $('model-name').value !== saved.configuration.model || $('model-base-url').value !== saved.configuration.baseUrl || $('model-key').value) { message('表单或配置已改变，请先保存或重新打开设置。'); return; }
    message('正在测试已保存配置…最多两次短模型调用，每次输出上限 256 tokens，30 秒超时。');
    const result = await request('/api/model-settings/test', {});
    const usage = (result.calls ?? []).reduce((a, c) => ({ input: a.input + (c.usage?.inputTokens ?? 0), output: a.output + (c.usage?.outputTokens ?? 0) }), { input: 0, output: 0 });
    message(`${result.message} 已报告用量：输入 ${usage.input}、输出 ${usage.output} tokens。${result.ok ? '' : '未报告的消耗以提供方账单为准。'}`);
  }); });
  dialog.addEventListener('close', () => { $('model-key').value = ''; });
}
