import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, rm, lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { ModelClientPort, ModelEvent, ModelRequest, ProviderRegistry } from '../../vendor/coding-agent/dist/public-api.js';

type Config = { revision: string; provider: string; model: string; baseUrl: string; apiKey: string; updatedAt: string };
type Registry = Pick<ProviderRegistry, 'create' | 'list' | 'get'>;
export type ModelSettingsOptions = { directory?: string; timeoutMs?: number; registry?: Registry };
export function defaultSettingsDirectory(dataDir: string) {
  return join(homedir(), '.config', 'agent-platform', createHash('sha256').update(resolve(dataDir)).digest('hex').slice(0, 24));
}
const messages: Record<string, string> = {
  not_configured: '请先填写提供方、模型、接口地址和 API Key。',
  authentication_failed: 'API Key 无效，请更新密钥。',
  permission_denied: '账户没有访问权限，请核对模型权限。',
  rate_limited: '提供方限流，请稍后手动重试。',
  provider_unavailable: '提供方暂时不可用，请稍后手动重试。',
  provider_request_failed: '请求失败，请核对模型名称、接口地址和网络连接。',
  timeout: '连接测试超时，请检查网络或稍后重试。',
  protocol_incompatible: '响应协议或工具调用不符合要求，请核对提供方、模型和接口地址。',
  truncated: '短连接测试达到输出上限，尚未验证完整响应。',
  busy: '已有连接测试正在进行。',
  configuration_changed: '配置已更新或清除，本次连接测试已取消。',
};
function field(input: Record<string, unknown>, name: string, max: number) {
  const v = input[name];
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x1f\x7f]/.test(v)) throw Error(`请填写有效的 ${name}`);
  return v.trim();
}
export async function createModelSettings(dataDir: string, options: ModelSettingsOptions = {}) {
  // Runtime import keeps the compiled kernel as a separate package; no internal API imports.
  const kernel = await import(pathToFileURL(resolve(import.meta.dirname, '../../vendor/coding-agent/dist/public-api.js')).href) as typeof import('../../vendor/coding-agent/dist/public-api.js');
  const registry = options.registry ?? kernel.createBuiltinProviderRegistry();
  const requested = resolve(options.directory ?? defaultSettingsDirectory(dataDir));
  await mkdir(requested, { recursive: true, mode: 0o700 });
  const info = await lstat(requested);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw Error('模型配置目录需要由当前用户独占（权限 0700）');
  const directory = await realpath(requested), file = join(directory, 'settings.json');
  let queue: Promise<unknown> = Promise.resolve();
  let active: AbortController | undefined;
  const serial = <T>(fn: () => Promise<T>) => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  function validate(input: Record<string, unknown>, previous?: Config): Config {
    if (Object.keys(input).some(k => !['provider', 'model', 'baseUrl', 'apiKey', 'revision', 'updatedAt'].includes(k))) throw Error('模型设置含不支持的字段');
    const provider = field(input, 'provider', 40); if (!registry.list().some(p => p.id === provider)) throw Error('不支持的提供方');
    const model = field(input, 'model', 160), baseUrl = field(input, 'baseUrl', 2048);
    let url: URL; try { url = new URL(baseUrl); } catch { throw Error('接口地址格式错误'); }
    if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw Error('接口地址须使用 HTTPS（本机测试可用 HTTP），且不能包含凭据、查询参数或片段');
    const keep = input['apiKey'] === undefined || input['apiKey'] === '';
    if (keep && previous?.apiKey && (provider !== previous.provider || url.href.replace(/\/$/, '') !== previous.baseUrl)) throw Error('更换提供方或接口地址时，请重新填写 API Key');
    const apiKey = keep ? previous?.apiKey ?? '' : field(input, 'apiKey', 4096);
    if (apiKey && [provider, model, baseUrl].some(v => v.includes(apiKey))) throw Error('密钥只能填写在 API Key 字段');
    return { provider, model, baseUrl: url.href.replace(/\/$/, ''), apiKey, revision: randomUUID(), updatedAt: new Date().toISOString() };
  }
  async function load(): Promise<Config | undefined> {
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const meta = await handle.stat();
      if (!meta.isFile() || meta.size > 16384 || (meta.mode & 0o077) !== 0 || (process.getuid && meta.uid !== process.getuid())) throw Error();
      const stored = JSON.parse(await handle.readFile('utf8')) as Record<string, unknown>;
      const parsed = validate(stored);
      if (typeof stored['revision'] !== 'string' || !/^[0-9a-f-]{36}$/.test(stored['revision']) || typeof stored['updatedAt'] !== 'string' || !Number.isFinite(Date.parse(stored['updatedAt']))) throw Error();
      return { ...parsed, revision: stored['revision'], updatedAt: stored['updatedAt'] };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw Error('模型配置无法安全读取，请检查本机文件权限或恢复配置'); }
    finally { await handle?.close(); }
  }
  function reference(c: Config) { return { revision: c.revision, provider: c.provider, model: c.model, baseUrl: c.baseUrl, protocol: c.provider === 'openai' ? 'responses' : 'chat-completions', updatedAt: c.updatedAt }; }
  function view(c?: Config) { return { configuration: c ? reference(c) : null, keyConfigured: !!c?.apiKey, providers: registry.list().map(p => ({ id: p.id, defaultBaseUrl: p.defaultBaseUrl, protocol: p.id === 'openai' ? 'responses' : 'chat-completions' })) }; }
  async function persist(c: Config) {
    const temp = join(directory, `.settings-${randomUUID()}`);
    try {
      const h = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      try { await h.writeFile(JSON.stringify(c) + '\n'); await h.sync(); } finally { await h.close(); }
      await rename(temp, file);
    } finally { await rm(temp, { force: true }); }
  }
  const failure = (code: string, extra: Record<string, unknown> = {}) => ({ ok: false, code, message: messages[code] ?? messages['provider_request_failed'], ...extra });
  async function bindRun(runId: string) {
    await queue; const c = await load(); if (!c?.apiKey) throw Error(messages['not_configured']);
    return { runId, configuration: reference(c), client: registry.create(c.provider, { apiKey: c.apiKey, model: c.model, baseUrl: c.baseUrl }) };
  }
  return {
    directory,
    read: async () => { await queue; return view(await load()); },
    save: (input: Record<string, unknown>) => serial(async () => { const c = validate(input, await load()); await persist(c); active?.abort('configuration_changed'); return view(c); }),
    clear: () => serial(async () => { const c = await load(); if (c) await persist({ ...c, apiKey: '', revision: randomUUID(), updatedAt: new Date().toISOString() }); active?.abort('configuration_changed'); return view(await load()); }),
    bindRun,
    close: () => active?.abort('configuration_changed'),
    async testConnection() {
      if (active) return failure('busy');
      const controller = new AbortController(); active = controller;
      const startedAt = new Date().toISOString();
      const timeout = setTimeout(() => controller.abort('timeout'), options.timeoutMs ?? 30000);
      let configuration: ReturnType<typeof reference> | undefined;
      const calls: Array<{ kind: string; usage: unknown }> = [];
      try {
        const binding = await bindRun(`connection-${randomUUID()}`); configuration = binding.configuration;
        for (const kind of ['text', 'tool'] as const) {
          if (controller.signal.aborted) return failure(String(controller.signal.reason), { configuration, calls });
          if ((await load())?.revision !== configuration.revision) return failure('configuration_changed', { configuration, calls });
          const requestId = randomUUID(), nonce = randomUUID();
          const request: ModelRequest = {
            schemaVersion: 1, requestId, runId: binding.runId,
            systemPrompt: 'This is a short API connectivity test. Follow the user instruction exactly. Do not access any files or external resources.',
            messages: [{ role: 'user', messageId: randomUUID(), content: kind === 'text' ? `Reply with exactly: ${nonce}` : `Call connectivity_probe exactly once with nonce equal to ${nonce}. Do not answer in text.` }],
            tools: kind === 'tool' ? [{ name: 'connectivity_probe', description: 'Return the connectivity test nonce. This tool is never executed.', inputSchema: { type: 'object', properties: { nonce: { type: 'string' } }, required: ['nonce'], additionalProperties: false } }] : [],
            maxOutputTokens: 256,
          };
          const call: { kind: string; usage: unknown } = { kind, usage: null };
          calls.push(call);
          const events: ModelEvent[] = [];
          const iterator = binding.client.stream(request, { signal: controller.signal })[Symbol.asyncIterator]();
          let rejectAbort: () => void = () => {};
          const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error('cancelled')); controller.signal.addEventListener('abort', rejectAbort, { once: true }); if (controller.signal.aborted) rejectAbort(); });
          try {
            let bytes = 0;
            for (;;) {
              const next = await Promise.race([iterator.next(), aborted]); if (next.done) break;
              bytes += Buffer.byteLength(JSON.stringify(next.value));
              if (bytes > 262144 || events.length >= 4096) { controller.abort('protocol_incompatible'); throw Error('oversized stream'); }
              events.push(next.value);
              if (next.value.type === 'usage_snapshot') call.usage = next.value.usage;
            }
          } finally { controller.signal.removeEventListener('abort', rejectAbort); void iterator.return?.().catch(() => {}); }
          const usage = events.filter(e => e.type === 'usage_snapshot').at(-1)?.usage ?? null;
          call.usage = usage;
          const error = events.find(e => e.type === 'error');
          if (error?.type === 'error') return failure(messages[error.error.code] ? error.error.code : 'protocol_incompatible', { configuration, calls });
          if (events.some(e => e.type === 'truncated')) return failure('truncated', { configuration, calls });
          if (!kernel.validateModelEventSequence(events).ok || events.some(e => e.requestId !== requestId) || events.at(-1)?.type !== 'completed' || !usage) return failure('protocol_incompatible', { configuration, calls });
          if (kind === 'text') {
            if (events.filter(e => e.type === 'text_delta').map(e => e.delta).join('').trim() !== nonce) return failure('protocol_incompatible', { configuration, calls });
          } else {
            const tools = events.filter(e => e.type === 'tool_call_started');
            const args = events.filter(e => e.type === 'tool_arguments_delta').map(e => e.delta).join('');
            if (tools.length !== 1 || tools[0]?.name !== 'connectivity_probe' || JSON.stringify(JSON.parse(args)) !== JSON.stringify({ nonce })) return failure('protocol_incompatible', { configuration, calls });
          }
        }
        if (controller.signal.aborted || (await load())?.revision !== configuration.revision) return failure('configuration_changed', { configuration, calls });
        return { ok: true, code: 'connected', message: '模型响应与工具调用验证通过，未执行任何工具。', configuration, startedAt, finishedAt: new Date().toISOString(), calls, toolsExecuted: 0 };
      } catch {
        return failure(controller.signal.aborted ? String(controller.signal.reason) : configuration ? 'provider_request_failed' : 'not_configured', { configuration, startedAt, calls });
      } finally { clearTimeout(timeout); active = undefined; }
    },
  };
}
