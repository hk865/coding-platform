import { resolveFileReferences } from './file-references.js';
import { CodingAgentRuntime } from '../execution/worker-runtime/coding-agent-runtime.js';
import { createModelSettings, type ModelSettingsOptions } from './model-settings.js';
import { randomUUID } from 'node:crypto';
import { createWorkspaceTools, type WorkspaceToolsOptions } from './workspace-tools.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createGuiService } from './service.js';
export async function createGuiServer(dir: string, options: WorkspaceToolsOptions & { modelSettings?: ModelSettingsOptions; explorationContextOnlyRoots?: string[]; contextOnlyTask?: { root: string; requestId: string }; fixtureExecution?: boolean } = {}) {
  const modelSettings = await createModelSettings(dir, options.modelSettings);
  const workspace = await createWorkspaceTools(dir, { ...options, privatePaths: [...(options.privatePaths ?? []), modelSettings.directory] });
  const realRuntime = new CodingAgentRuntime(resolve(dir, 'real-runs'), modelSettings.bindRun, [resolve(import.meta.dirname, '../..'), modelSettings.directory, '/mnt/d/1.project/Software/agent_learn']);
  await realRuntime.init();
  const reviewerModelMetadata = { current: async () => {
    const saved = await modelSettings.read(), configuration = saved.configuration;
    return saved.keyConfigured && configuration ? {
      configurationRevision: configuration.revision, provider: configuration.provider, model: configuration.model, baseUrl: configuration.baseUrl,
    } : null;
  } };
  const service = await createGuiService(dir, workspace.projects(), { ...(options.contextOnlyTask ? { contextOnlyTask: options.contextOnlyTask } : {}), explorationContextOnlyRoots: options.explorationContextOnlyRoots ?? [], runtime: realRuntime, ...(options.fixtureExecution ? { fixtureExecution: true } : {}), reviewerModelMetadata, resolveReferences: (scope, refs) => resolveFileReferences(scope, refs, input => workspace.read('/api/files/preview',input)), rootFor: (projectId, workspaceId) => { const p = workspace.projects().find(p => p.projectId === projectId && p.workspaceId === workspaceId); if (!p) throw Error('项目未登记'); return p.root; } });
  const workspaceToken = randomUUID();
  const styleNonce = randomUUID();
  const toolRoute = (path: string) => path === '/api/workspace' || path === '/api/projects/add' || path === '/api/workspaces/add' || path === '/api/files' || path.startsWith('/api/files/') || path === '/api/terminals' || path.startsWith('/api/terminals/');
  const settingsRoute = (path: string) => path === '/api/model-settings' || path.startsWith('/api/model-settings/');
  const workbenchRoot = new URL('./public/workbench/', import.meta.url);
  const workbenchTypes = new Map([['.js', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'], ['.map', 'application/json; charset=utf-8'], ['.svg', 'image/svg+xml'], ['.woff2', 'font/woff2'], ['.png', 'image/png'], ['.ico', 'image/x-icon']]);
  const assets = new Map([['/real-tasks.js', ['real-tasks.js', 'text/javascript; charset=utf-8']], ['/model-settings.js', ['model-settings.js', 'text/javascript; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/layout.js', ['layout.js', 'text/javascript; charset=utf-8']], ['/workspace.js', ['workspace.js', 'text/javascript; charset=utf-8']], ['/vendor/xterm.js', ['vendor/xterm.js', 'text/javascript; charset=utf-8']], ['/vendor/addon-fit.js', ['vendor/addon-fit.js', 'text/javascript; charset=utf-8']], ['/vendor/xterm.css', ['vendor/xterm.css', 'text/css; charset=utf-8']], ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]]);
  for (const name of ['live-runs.js','markdown.js','file-references.js','dock-views.js','verification-ui.js','exploration-ui.js','context-view.js']) assets.set('/'+name,[name,'text/javascript; charset=utf-8']);
  for (const name of ['live-runs.css','dock-views.css','exploration-ui.css']) assets.set('/'+name,[name,'text/css; charset=utf-8']);
  const vendor = new Map([['/vendor/xterm.js', '@xterm/xterm/lib/xterm.js'], ['/vendor/xterm.css', '@xterm/xterm/css/xterm.css'], ['/vendor/addon-fit.js', '@xterm/addon-fit/lib/addon-fit.js']]);
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      const host = req.headers.host ?? '';
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return send(403, { error: '仅限本机访问' });
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (req.headers.origin && req.headers.origin !== url.origin) return send(403, { error: '请求来源不匹配' });
      if ((toolRoute(url.pathname) || settingsRoute(url.pathname) || url.pathname.startsWith('/api/real/')) && req.headers['x-platform-token'] !== workspaceToken) return send(403, { error: '本地会话已过期，请刷新页面' });
      if (req.method === 'GET') {
        if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
        if (url.pathname === '/api/meta') return send(200, { scopes: workspace.projects(), ...service.capability(), executionCapability: service.capability(), exploration: { available: true, contextOnlyProjectIds: workspace.projects().filter(p => options.explorationContextOnlyRoots?.includes(p.root)).map(p => p.projectId) }, workspaceToken });
        if (toolRoute(url.pathname)) return send(200, await workspace.read(url.pathname, Object.fromEntries(url.searchParams)));
        if (url.pathname === '/api/model-settings') return send(200, await modelSettings.read());
        if (url.pathname === '/api/state') return send(200, await service.state(Object.fromEntries(url.searchParams)));
        // The React workbench is the default entry; the previous frontend stays reachable at /legacy
        // until the migrated views have a full rollback cycle.
        if (url.pathname === '/' || url.pathname === '/workbench' || url.pathname === '/workbench/') {
          const page = await readFile(new URL('index.html', workbenchRoot));
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
          res.end(page); return;
        }
        if (url.pathname === '/legacy' || url.pathname === '/legacy/') {
          const page = (await readFile(new URL('./public/index.html', import.meta.url))).toString('utf8').replace('__TERMINAL_STYLE_NONCE__', styleNonce);
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'content-security-policy': `default-src 'self'; style-src 'self' 'nonce-${styleNonce}'; script-src 'self'; frame-ancestors 'none'` });
          res.end(page); return;
        }
        if (url.pathname.startsWith('/workbench/assets/')) {
          const name = url.pathname.slice('/workbench/assets/'.length);
          if (!/^[A-Za-z0-9._-]+$/.test(name)) return send(404, { error: '页面不存在' });
          let body: Buffer; try { body = await readFile(new URL('assets/' + name, workbenchRoot)); } catch { return send(404, { error: '页面不存在' }); }
          const type = workbenchTypes.get(name.slice(name.lastIndexOf('.'))) ?? 'application/octet-stream';
          res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' }); res.end(body); return;
        }
        const asset = assets.get(url.pathname);
        if (!asset) return send(404, { error: '页面不存在' });
        let body: Buffer | string = await readFile(new URL(vendor.has(url.pathname) ? `../../node_modules/${vendor.get(url.pathname)}` : `./public/${asset[0]}`, import.meta.url));
        if (url.pathname === '/') body = body.toString('utf8').replace('__TERMINAL_STYLE_NONCE__', styleNonce);
        res.writeHead(200, { 'content-type': asset[1]!, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'content-security-policy': `default-src 'self'; style-src 'self' 'nonce-${styleNonce}'; script-src 'self'; frame-ancestors 'none'` }); res.end(body); return;
      }
      if (req.method !== 'POST') return send(405, { error: '不支持的方法' });
      if (req.headers.origin && req.headers.origin !== url.origin) return send(403, { error: '请求来源不匹配' });
      if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: '需要 JSON 请求' });
      const bodyLimit = ['/api/real/verifications/candidates','/api/real/verifications/import'].includes(url.pathname)
        ? 2 * 1024 * 1024
        : ['/api/real/verifications/rounds/start', '/api/real/verifications/verify'].includes(url.pathname)
          ? 256 * 1024 // Allow the bounded 128 KiB check registry plus its request scope.
          : 65536;
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > bodyLimit) return send(413, { error: '请求过大' }); }
      let input: unknown; try { input = JSON.parse(body); } catch { return send(400, { error: 'JSON 格式错误' }); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return send(400, { error: '请求必须是对象' });
      if (url.pathname === '/api/model-settings') return send(200, await modelSettings.save(input as Record<string, unknown>));
      if (url.pathname === '/api/model-settings/clear') return send(200, await modelSettings.clear());
      if (url.pathname === '/api/model-settings/test') return send(200, await modelSettings.testConnection());
      if (settingsRoute(url.pathname)) return send(404, { error: '未知模型设置操作' });
      if (url.pathname === '/api/projects/add') { const project = await workspace.prepareProject(input as Record<string, unknown>); await service.addProject(project); await workspace.register(project); return send(200, project); }
      if (url.pathname === '/api/workspaces/add') { const mount = await workspace.prepareWorkspace(input as Record<string, unknown>); await service.addProject(mount); await workspace.register(mount); return send(200, mount); }
      if (toolRoute(url.pathname)) return send(200, await workspace.write(url.pathname, input as Record<string, unknown>));
      send(200, await service.action(url.pathname, input as Record<string, unknown>));
    } catch (error) { send(400, { error: error instanceof Error ? error.message : String(error) }); }
  });
  return { server, close: async () => {
    modelSettings.close();
    const draining = service.close();
    await realRuntime.close();
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    workspace.close();
    await draining;
  } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // B-1: the bundled host enables the sample/fixture executor explicitly. This
  // restores the historical default behavior (the previous guard let a
  // `gui-plan-*` sample plan reach the fixture executor) WITHOUT inferring it
  // from an identifier shape. Real task plans never run on the fixture: the
  // fixture branches require this flag, and a real plan is refused by
  // `OperatorPlanCompiler.isRealTaskPlan` when it reuses a sample plan.
  const app = await createGuiServer(resolve(process.env['PLATFORM_GUI_DATA'] ?? '.local/gui'), { fixtureExecution: true });
  const port = Number(process.env['PORT'] ?? 4317);
  app.server.listen(port, '127.0.0.1', () => console.log(`Agent Platform GUI: http://localhost:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
