// One real Host per world (W-accept, WA, WB, the compaction Host): `node dist/app/main.js <workbench-config.json>`
// (`src/app/main.ts:53`, listening line `:218`) started through the existing smoke start script, which reads the
// provider keys in place inside the Host's own process (`~/smoke-rr/start-host.sh`; the same per-folder copy
// `impl/smoke/srr/host-ctl.sh` makes). The driver never sees a key. Normal close is SIGINT (`main.ts:209-216`).
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from './http.mjs';
import { readLag } from './lag.mjs';
import { Abort } from './report.mjs';

const LAG_MODULE = pathToFileURL(fileURLToPath(new URL('./lag.mjs', import.meta.url))).href;
const LISTENING = /workbench listening at (http:\/\/127\.0\.0\.1:\d+)\/workbench\//;
const TOKEN_META = /<meta name="platform-token" content="([^"]+)">/;

/** The trusted start configuration (`main.ts:31-51`). Workspaces are opened later through settings unless given. */
export function workbenchConfig({ settingsModels, workspaces, runtime, extra }) {
  return {
    sqliteDirectory: './data',
    actor: { kind: 'human', id: 'g6-person' },
    port: 0,
    workspaces: workspaces ?? [{ scope: { projectId: 'g6-placeholder', workspaceId: 'g6-placeholder-ws' },
      name: 'placeholder', root: './placeholder', workspaceRevision: 0, readPrefixes: [] }],
    settingsModels,
    ...(runtime === undefined ? {} : { runtime }),
    ...(extra ?? {}),
  };
}

/**
 * Start (or restart over the same ledger) the Host in `dir`. The first start writes `workbench-config.json`;
 * a restart reuses it. Returns the live handle with its HTTP client.
 */
export async function startHost({ name, dir, tree, launcher, report, config }) {
  mkdirSync(join(dir, 'placeholder'), { recursive: true });
  const configPath = join(dir, 'workbench-config.json');
  if (!existsSync(configPath)) writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const script = readFileSync(launcher.script, 'utf8');
  if (!script.includes(launcher.cdLine)) {
    throw new Abort('env-unavailable', `the start script ${launcher.script} has no line "${launcher.cdLine}" to point at ${dir}`);
  }
  writeFileSync(join(dir, 'start-host.sh'), script.replace(launcher.cdLine, `cd '${dir}'`));
  const start = readdirSync(dir).filter(file => /^host-\d+\.log$/.test(file)).length;
  const logPath = join(dir, `host-${start}.log`);
  const lagFile = join(dir, `lag-${start}.json`);
  const log = createWriteStream(logPath);
  const child = spawn('bash', [join(dir, 'start-host.sh')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TREE: tree, NODE_OPTIONS: `--import=${LAG_MODULE}`, G6_LAG_FILE: lagFile },
  });
  child.stderr.pipe(log);
  const origin = await new Promise((resolve, reject) => {
    let seen = '';
    const timer = setTimeout(() => reject(new Abort('env-unavailable', `${name}: no listening line in 120 s (${logPath})`)), 120_000);
    child.stdout.on('data', chunk => {
      log.write(chunk);
      if (seen === null) return;
      seen += chunk.toString();
      const match = LISTENING.exec(seen);
      if (match !== null) { clearTimeout(timer); seen = null; resolve(match[1]); }
    });
    child.on('exit', code => { clearTimeout(timer); reject(new Abort('env-unavailable', `${name}: the Host exited (${code}) before listening; see ${logPath}`)); });
  });
  report.command(`${name}#${start}: bash start-host.sh (pid ${child.pid}) -> ${origin}/workbench/`);
  // OQ-8 (9-start-rulings.frozen.md:960-961): any `.dc.html` board carries the meta; no file read, no guess.
  let token = null;
  try {
    const page = await fetch(`${origin}/workbench/Main.dc.html`);
    token = TOKEN_META.exec(await page.text())?.[1] ?? null;
  } catch { token = null; }
  if (token === null) {
    report.tokenNotes.push(`${name}#${start}: uncovered (entry-missing)`);
    child.kill('SIGINT');
    throw new Abort('entry-missing', `${name}: /workbench/Main.dc.html carries no platform-token meta`);
  }
  report.tokenNotes.push(`${name}#${start}: 已取得令牌`);
  const client = new Client({ base: origin, token, label: name, log: report });
  token = null;
  const entry = { name, start, lag: null, closed: null };
  report.hosts.push(entry);
  const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
  return {
    name, dir, origin, client, configPath, logPath, lagFile, child, started: new Date().toISOString(),
    /** Normal close: SIGINT, then wait for the Host's own close and exit; `normal` only for exit code 0 (`main.ts:209-216`). */
    async close() {
      client.flush();
      const started = Date.now();
      child.kill('SIGINT');
      const result = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve(null), 120_000))]);
      entry.lag = readLag(lagFile);
      if (result === null) {
        entry.closed = 'SIGINT, not exited after 120 s';
        report.command(`${name}#${start}: SIGINT; still running after 120 s`);
        return { exited: false, normal: false, text: entry.closed };
      }
      entry.closed = `SIGINT, exit ${result.code ?? result.signal} after ${Date.now() - started} ms`;
      report.command(`${name}#${start}: ${entry.closed}`);
      log.end();
      return { exited: true, normal: result.code === 0, text: entry.closed };
    },
  };
}
