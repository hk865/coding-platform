import { mkdir, readdir, realpath, stat, open, readFile, writeFile, rename, mkdtemp } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, relative, isAbsolute, sep, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import * as pty from 'node-pty';

type Input = Record<string, unknown>;
export type MountedProject = { projectId: string; workspaceId: string; root: string; name: string; bindingDigest?: string };
export type WorkspaceToolsOptions = { privatePaths?: string[]; workspaceRoots?: Record<string, string> };
type Session = { id: string; owner: string; cwd: string; process: pty.IPty; createdAt: string; status: 'running' | 'exited'; exitCode: number | null; seq: number; chunks: Array<{ seq: number; data: string; cols: number; rows: number }>; bytes: number; cols: number; rows: number; writes: Map<string, string> };
const LIMIT = 256 * 1024;

export async function createWorkspaceTools(dir: string, options: WorkspaceToolsOptions = {}) {
  await mkdir(dir, { recursive: true });
  const privatePaths = await Promise.all((options.privatePaths ?? []).map(p => realpath(p)));
  const overlapsPrivate = (root: string) => privatePaths.some(p => root === p || root.startsWith(p + sep) || p.startsWith(root + sep));
  const registryPath = resolve(dir, 'project-folders.json');
  let mounts: MountedProject[] = [];
  try { mounts = JSON.parse(await readFile(registryPath, 'utf8')) as MountedProject[]; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const id of ['acceptance-alpha', 'acceptance-beta']) if (!mounts.some(m => m.projectId === id)) {
    const root = options.workspaceRoots?.[id] ?? (id === 'acceptance-alpha' ? process.cwd() : resolve(dir, 'workspaces', id));
    await mkdir(root, { recursive: true });
    mounts.push({ projectId: id, workspaceId: 'workspace-main', root: await realpath(root), name: id === 'acceptance-alpha' ? '主验收项目' : '隔离对照项目' });
  }
  const sandboxSource = await readFile(new URL('./terminal-sandbox.py', import.meta.url), 'utf8');
  const nodeRuntime = dirname(dirname(await realpath(process.execPath)));
  const sessions = new Map<string, Session>(), creates = new Map<string, string>();
  let registryQueue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>) { const result = registryQueue.then(fn); registryQueue = result.catch(() => {}); return result; }
  function scope(input: Input) { const mount = mounts.find(m => m.projectId === input['projectId'] && m.workspaceId === input['workspaceId']); if (!mount) throw Error('项目文件夹尚未绑定或范围无效'); return mount; }
  const ownerKey = (mount: MountedProject) => JSON.stringify([mount.projectId, mount.workspaceId]);
  function text(input: Input, key: string, max = 4096) { const value = input[key]; if (typeof value !== 'string' || !value.length || value.length > max || value.includes('\0')) throw Error(`无效字段：${key}`); return value; }
  async function pathIn(root: string, input: unknown = '') {
    if (typeof input !== 'string' || input.includes('\0') || isAbsolute(input)) throw Error('需要项目内的相对路径');
    const inside = (path: string) => path === root || path.startsWith(root + sep);
    const requested = resolve(root, input); if (!inside(requested)) throw Error('文件路径超出项目目录');
    const actual = await realpath(requested); if (!inside(actual)) throw Error('链接目标超出项目目录');
    if (privatePaths.some(p => actual === p || actual.startsWith(p + sep))) throw Error('此目录用于本机凭据，不能在项目中读取');
    return { actual, path: relative(root, requested).split(sep).join('/') };
  }
  function integer(value: unknown, fallback: number, min: number, max: number) { if (value === undefined) return fallback; const n = Number(value); if (!Number.isSafeInteger(n) || n < min || n > max) throw Error('终端尺寸或游标无效'); return n; }
  function getSession(input: Input) { const mount = scope(input), session = sessions.get(text(input, 'sessionId', 100)); if (!session || session.owner !== ownerKey(mount)) throw Error('终端不存在或不属于当前工作区'); return session; }
  function summary(s: Session) { return { id: s.id, cwd: s.cwd, createdAt: s.createdAt, status: s.status, exitCode: s.exitCode, cols: s.cols, rows: s.rows }; }
  function append(s: Session, data: string) {
    for (let start = 0; start < Math.max(1, data.length); start += 8192) {
      const chunk = data.slice(start, start + 8192);
      s.chunks.push({ seq: ++s.seq, data: chunk, cols: s.cols, rows: s.rows });
      s.bytes += Buffer.byteLength(chunk) + 32;
    }
    while (s.bytes > LIMIT && s.chunks.length > 1) s.bytes -= Buffer.byteLength(s.chunks.shift()!.data) + 32;
  }
  async function prepareProject(input: Input) {
    let path = text(input, 'path').trim();
    if (/^[a-zA-Z]:[\\/]/.test(path)) path = '/mnt/' + path[0]!.toLowerCase() + '/' + path.slice(3).replaceAll('\\', '/');
    if (!isAbsolute(path)) throw Error('请输入绝对目录路径');
    const root = await realpath(path); if (root === '/' || !(await stat(root)).isDirectory()) throw Error('请选择实际项目目录');
    if (overlapsPrivate(root)) throw Error('项目目录不能包含本机凭据目录，请选择更具体的项目文件夹');
    const existing = mounts.find(m => m.root === root); if (existing) return existing;
    return { projectId: `local-${createHash('sha256').update(root).digest('hex').slice(0, 20)}`, workspaceId: 'workspace-main', root, name: basename(root) };
  }
  async function prepareWorkspace(input: Input): Promise<MountedProject> {
    const projectId = text(input, 'projectId', 256);
    if (!mounts.some(mount => mount.projectId === projectId)) throw Error('项目尚未登记');
    const prepared = await prepareProject(input), root = prepared.root;
    const prior = mounts.find(mount => mount.root === root);
    if (prior) { if (prior.projectId !== projectId) throw Error('此目录已属于另一项目'); return prior; }
    const bindingDigest = createHash('sha256').update(JSON.stringify([projectId, root])).digest('hex');
    return { projectId, workspaceId: 'workspace-' + bindingDigest.slice(0, 24), root, name: basename(root), bindingDigest };
  }
  async function register(mount: MountedProject) { return serial(async () => { const prior = mounts.find(m => m.projectId === mount.projectId && m.workspaceId === mount.workspaceId); if (prior) { if (prior.root !== mount.root) throw Error('工作区不能重新绑定到不同目录'); return; } const next = [...mounts, mount]; const temp = registryPath + '.' + randomUUID(); await writeFile(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 }); await rename(temp, registryPath); mounts = next; }); }
  async function read(path: string, input: Input) {
    const mount = scope(input), root = mount.root;
    if (path === '/api/workspace') return { ...mount, shell: '受限 Bash', terminalPolicy: '项目内读写；系统工具只读；网络关闭' };
    if (path === '/api/files') {
      const target = await pathIn(root, input['path'] ?? '');
      const list = (await readdir(target.actual, { withFileTypes: true })).filter(e => e.name !== '.git').sort((a,b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      return { root, path: target.path, entries: list.slice(0, 500).map(e => ({ name: e.name, path: [target.path, e.name].filter(Boolean).join('/'), kind: e.isDirectory() ? 'directory' : e.isSymbolicLink() ? 'link' : 'file' })), truncated: list.length > 500 };
    }
    if (path === '/api/files/preview') {
      const target = await pathIn(root, text(input, 'path')); const info = await stat(target.actual);
      if (info.isDirectory()) return { kind: 'directory', path: target.path };
      if (!info.isFile()) throw Error('不支持预览此类型文件');
      if (info.size > LIMIT) return { kind: 'too_large', path: target.path, size: info.size };
      const file = await open(target.actual, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        if (!(await file.stat()).isFile()) throw Error('不支持预览此类型文件');
        const buffer = Buffer.alloc(LIMIT + 1); let length = 0;
        while (length < buffer.length) { const result = await file.read(buffer, length, buffer.length - length, null); if (!result.bytesRead) break; length += result.bytesRead; }
        if (length > LIMIT) return { kind: 'too_large', path: target.path, size: length };
        const bytes = buffer.subarray(0, length); if (bytes.includes(0)) return { kind: 'binary', path: target.path, size: length };
        try { return { kind: 'text', path: target.path, size: length, sha256: createHash('sha256').update(bytes).digest('hex'), content: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }; } catch { return { kind: 'binary', path: target.path, size: length }; }
      } finally { await file.close(); }
    }
    if (path === '/api/terminals') return { root, sessions: [...sessions.values()].filter(s => s.owner === ownerKey(mount)).map(summary) };
    if (path === '/api/terminals/output') { const s = getSession(input), after = integer(input['after'], 0, 0, Number.MAX_SAFE_INTEGER); return { ...summary(s), chunks: s.chunks.filter(c => c.seq > after), through: s.seq, truncated: after < (s.chunks[0]?.seq ?? s.seq + 1) - 1 }; }
    throw Error('未知工作区查询');
  }
  async function write(path: string, input: Input) {
    const mount = scope(input);
    if (path === '/api/files/mkdir') {
      const parent = await pathIn(mount.root, input['path'] ?? ''), name = text(input, 'name', 255).trim();
      if (name === '.' || name === '..' || !name || /[\\/]/.test(name)) throw Error('请输入单个文件夹名称');
      await mkdir(resolve(parent.actual, name)); return { path: [parent.path, name].filter(Boolean).join('/') };
    }
    if (path === '/api/terminals/create') {
      if (overlapsPrivate(mount.root)) throw Error('项目包含本机凭据目录，不能启动终端');
      if (process.platform !== 'linux' || process.arch !== 'x64') throw Error('受限终端目前需要 Linux/WSL x86_64');
      const cwd = await pathIn(mount.root, input['path'] ?? ''); if (!(await stat(cwd.actual)).isDirectory()) throw Error('终端启动路径不是目录');
      const key = JSON.stringify([mount.projectId, mount.workspaceId, text(input, 'requestId', 100)]), prior = creates.get(key);
      if (prior) { const existing = sessions.get(prior)!; if (existing.cwd !== cwd.actual) throw Error('重试的启动目录发生变化'); return summary(existing); }
      const owned = [...sessions.values()].filter(s => s.owner === ownerKey(mount));
      if (owned.filter(s => s.status === 'running').length >= 4) throw Error('此项目已有 4 个运行终端，请先结束一个');
      if (owned.length >= 32) { const old = owned.find(s => s.status === 'exited'); if (old) { sessions.delete(old.id); for (const [k, id] of creates) if (id === old.id) creates.delete(k); } }
      const scratch = await mkdtemp(resolve(tmpdir(), 'platform-terminal-'));
      const cols = integer(input['cols'], 80, 10, 500), rows = integer(input['rows'], 24, 2, 200);
      const env: Record<string,string> = { TERM: 'xterm-256color', COLORTERM: 'truecolor', PS1: '\\[\\e[36m\\]\\W\\[\\e[0m\\] $ ', LANG: process.env['LANG'] ?? 'C.UTF-8' };
      for (const key of ['HOME', 'USER', 'LOGNAME']) if (process.env[key]) env[key] = process.env[key]!;
      // Trusted launcher is snapshotted at server startup. No unrestricted-shell fallback.
      const child = pty.spawn('/usr/bin/python3', ['-c', sandboxSource, mount.root, scratch, nodeRuntime], { name: 'xterm-256color', cols, rows, cwd: cwd.actual, env });
      const s: Session = { id: randomUUID(), owner: ownerKey(mount), cwd: cwd.actual, process: child, createdAt: new Date().toISOString(), status: 'running', exitCode: null, seq: 0, chunks: [], bytes: 0, cols, rows, writes: new Map() };
      sessions.set(s.id, s); creates.set(key, s.id); child.onData(data => append(s, data)); child.onExit(event => { s.status = 'exited'; s.exitCode = event.exitCode; }); return summary(s);
    }
    const s = getSession(input);
    if (path === '/api/terminals/close') { if (s.status === 'running') s.process.kill('SIGHUP'); return summary(s); }
    if (s.status !== 'running') throw Error('终端已退出，请新建会话');
    if (path === '/api/terminals/input') { const data = input['data']; if (typeof data !== 'string' || data.length > 16384) throw Error('终端输入过长'); const key = text(input, 'requestId', 100), prior = s.writes.get(key); if (prior !== undefined) { if (prior !== data) throw Error('重复输入内容不一致'); return { accepted: true, replayed: true }; } s.process.write(data); s.writes.set(key, data); if (s.writes.size > 2048) s.writes.delete(s.writes.keys().next().value!); return { accepted: true, replayed: false }; }
    if (path === '/api/terminals/resize') { s.cols = integer(input['cols'], s.cols, 10, 500); s.rows = integer(input['rows'], s.rows, 2, 200); append(s, ''); s.process.resize(s.cols, s.rows); return summary(s); }
    throw Error('未知工作区操作');
  }
  return { projects: () => mounts.map(m => ({ ...m })), prepareProject, prepareWorkspace, register, read, write: (path: string, input: Input) => serial(() => write(path, input)), close: () => { for (const s of sessions.values()) if (s.status === 'running') { try { s.process.kill('SIGHUP'); } catch {} } } };
}
