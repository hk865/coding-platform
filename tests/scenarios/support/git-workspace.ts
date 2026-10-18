/**
 * K3 §5.1 "git 工作区" scenario support (spec lines 1394-1401, K3-01/K3-02/K3-40).
 *
 * `HostScenario.open({ gitWorkspace: true })` calls `initGitWorkspace` on the
 * scenario's OWN temporary root (never the repository): `git init`, the tracked
 * defaults, one initial commit, then one file under a Host-denied prefix
 * (`WORKSPACE_DENIED_PREFIXES`, first of which is `.evaluator`). The denied file
 * stays on disk, is never added, and is listed in the repository-local
 * `.git/info/exclude` (not a tracked `.gitignore`) so `git status --porcelain`
 * stays clean while the file is invisible to `git ls-files`.
 *
 * Later R1 tests run git in the scenario root with `gitIn(root, ...args)` and
 * read the baseline commit from `HostScenario.gitWorkspace.commit`. The tracked
 * defaults include the `tsconfig.json` `writeAG2bWorkspace` would otherwise add
 * after the commit (it writes only missing files), so the Host start adds no
 * untracked file.
 *
 * No crash-point helper lives here: K3-01/K3-02 are expressed by the existing
 * `lockLedgerAfter` observer in `tests/scenarios/support/common.ts`. The exact
 * recipes are documented in tests/scenarios/K3-r1-seams.test.ts.
 */
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** One tracked file of the initial commit (repository-relative path -> content). */
export type GitWorkspaceFiles = Record<string, string>;

export type GitWorkspaceOptions = {
  /** Tracked files committed as the baseline; defaults to `src/module.ts`, `tsconfig.json` and `README.md`. */
  files?: GitWorkspaceFiles;
  /** One file under a Host-denied prefix: on disk, never tracked, never in git status. Default `.evaluator/hidden.ts`. */
  deniedFile?: { path: string; content: string };
  /** The initial commit message; default `scenario initial`. */
  message?: string;
};

/** `true` (or `{}`) enables the defaults; a value tunes the files. */
export type GitWorkspaceOption = boolean | GitWorkspaceOptions;

/** What `initGitWorkspace` leaves behind, exposed as `HostScenario.gitWorkspace`. */
export type GitWorkspaceInfo = {
  /** The initial commit hash (`git rev-parse HEAD`). */
  commit: string;
  /** The tracked files of that commit, repository-relative. */
  files: readonly string[];
  /** The Host-denied file written under the denied-prefix exclusion. */
  deniedFile: string;
};

/** The tracked defaults: the AG2b seed's `src/module.ts` and `tsconfig.json`, plus a README. */
export const DEFAULT_GIT_WORKSPACE_FILES: GitWorkspaceFiles = {
  'src/module.ts': 'export const ag2bMarker = "SCENARIO_GIT_BASELINE";\n',
  'tsconfig.json': JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true }, include: ['src/**/*.ts'],
  }),
  'README.md': '# Scenario git workspace\n\nThe initial commit is the K3 start baseline.\n',
};

/** The default denied-prefix file (`.evaluator` is the first `WORKSPACE_DENIED_PREFIXES` entry). */
export const DEFAULT_DENIED_FILE = { path: '.evaluator/hidden.ts', content: '// host-denied fixture file\n' };

/**
 * Run one git command in `root` and return its stdout (utf8). A deterministic
 * author/committer identity is supplied because this sandbox has no git config.
 */
export function gitIn(root: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? 'K3 Scenario',
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? 'k3-scenario@example.invalid',
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? 'K3 Scenario',
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? 'k3-scenario@example.invalid',
      GIT_TERMINAL_PROMPT: '0',
    },
  }).toString();
}

/** The denied-prefix exclusion for one path: its first segment plus `/`. */
function deniedPrefixOf(path: string): string {
  const first = path.split('/', 1)[0] ?? path;
  return `${first}/`;
}

/**
 * Initialise the git baseline in a scenario's own temporary root. Call it before
 * the first Host starts (the harness does). Never call it on the repository.
 */
export async function initGitWorkspace(root: string, options: GitWorkspaceOptions = {}): Promise<GitWorkspaceInfo> {
  const files = options.files ?? DEFAULT_GIT_WORKSPACE_FILES;
  const denied = options.deniedFile ?? DEFAULT_DENIED_FILE;
  gitIn(root, 'init', '-q', '-b', 'main');
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  gitIn(root, 'add', '--', ...Object.keys(files));
  gitIn(root, 'commit', '-q', '-m', options.message ?? 'scenario initial');
  // Keep the untracked Host-denied file out of `git status` as well. `.git/info/exclude`
  // is repository-local metadata, not a tracked file; the baseline commit stays the two
  // declared tracked defaults plus README.
  await appendFile(join(root, '.git', 'info', 'exclude'), `${deniedPrefixOf(denied.path)}\n`);
  const deniedPath = join(root, denied.path);
  await mkdir(dirname(deniedPath), { recursive: true });
  await writeFile(deniedPath, denied.content);
  return {
    commit: gitIn(root, 'rev-parse', 'HEAD').trim(),
    files: Object.keys(files),
    deniedFile: denied.path,
  };
}
