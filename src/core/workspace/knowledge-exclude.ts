/**
 * "Architecture and notes stay local, not in git" (KLS-2) is the person's choice for one checkout.
 * It lives in git's own local exclude file, `<git-common-dir>/info/exclude`, as one marked block: the marker line and
 * the knowledge directory line right after it. The user's `.gitignore`, the git configuration and the index are never
 * touched, and nothing is added or committed.
 *
 * Turning it on appends the block once; turning it off removes only those two lines, so a knowledge directory line the
 * user wrote stays. When the file already is in the asked state (the block there, or not there) it is left as it is.
 * The file is read and changed as bytes, never decoded, so every other line keeps its bytes, line endings and bytes
 * that are not UTF-8 included. The new file is written whole beside the old one and then renamed over it, so a write
 * that fails leaves the old file as it was.
 *
 * The knowledge directory itself is made here too, by the one function the Host, the Work Run start and the workbench
 * commands all call, and so is the git excludes file the platform's agent and check command sandboxes mount
 * (`knowledgeGitExcludesMount`).
 */
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { messageOf } from '../../contracts/error-message.js';
import { KNOWLEDGE_DIRECTORY } from '../../contracts/knowledge.js';
import type { WorkspaceResult } from './ports.js';

const LF = 0x0a;
const CR = 0x0d;
const MARKER = '# dsh: architecture and notes stay local';
const EXCLUDED = `${KNOWLEDGE_DIRECTORY}/`;
const MARKER_BYTES = Buffer.from(MARKER);
const EXCLUDED_BYTES = Buffer.from(EXCLUDED);
const BLOCK_BYTES = Buffer.from(`${MARKER}\n${EXCLUDED}\n`);

/** Each line as `[start, end)` byte offsets, `end` just past its own LF (or the file's end for a last line without). */
function lineRanges(bytes: Buffer): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (let start = 0; start < bytes.length;) {
    const lf = bytes.indexOf(LF, start);
    const end = lf < 0 ? bytes.length : lf + 1;
    ranges.push([start, end]);
    start = end;
  }
  return ranges;
}

/** Whether one line, without its own LF or CRLF ending, is exactly `text`. */
function lineIs(bytes: Buffer, range: [number, number] | undefined, text: Buffer): boolean {
  if (range === undefined) return false;
  const [start, end] = range;
  let stop = end;
  if (bytes[stop - 1] === LF) {
    stop -= 1;
    if (stop > start && bytes[stop - 1] === CR) stop -= 1;
  }
  return bytes.subarray(start, stop).equals(text);
}

export async function applyKnowledgeExclude(commonDir: string, localOnly: boolean):
  Promise<WorkspaceResult<{ path: string; changed: boolean }>> {
  const path = join(commonDir, 'info', 'exclude');
  try {
    let current = Buffer.alloc(0);
    try { current = await readFile(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const lines = lineRanges(current);
    const at = lines.findIndex((line, index) =>
      lineIs(current, line, MARKER_BYTES) && lineIs(current, lines[index + 1], EXCLUDED_BYTES));
    if (localOnly === (at >= 0)) return { status: 'ready', value: { path, changed: false } };
    const separator = current.length === 0 || current[current.length - 1] === LF ? '' : '\n';
    const next = localOnly
      ? Buffer.concat([current, Buffer.from(separator), BLOCK_BYTES])
      : Buffer.concat([current.subarray(0, lines[at]![0]), current.subarray(lines[at + 1]![1])]);
    await mkdir(dirname(path), { recursive: true });
    const temporary = join(dirname(path), `.exclude.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, next);
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    return { status: 'ready', value: { path, changed: true } };
  } catch (error) {
    return { status: 'rejected', code: 'unavailable', reason: `${path} could not be updated: ${messageOf(error)}` };
  }
}

/**
 * git's default excludes path inside a platform command sandbox. The Kernel sandbox clears the environment and sets
 * HOME=/home/agent with no XDG_CONFIG_HOME, on a fresh root that takes only /usr, /bin, /lib and /lib64 from the Host:
 * with no `core.excludesFile` set git reads `$HOME/.config/git/ignore`, and nothing of the Host's git configuration is
 * there to be replaced.
 */
const SANDBOX_GIT_EXCLUDES_PATH = '/home/agent/.config/git/ignore';
/** The file this process last checked; it is checked again only when it is gone. */
let checkedGitExcludes: string | null = null;

/**
 * Git in a command sandbox the platform starts for an agent or a check (a registered check, the read-only command, a
 * Work Run's Kernel shell) does not see the platform's untracked knowledge directory. The platform writes `.workbench/`
 * when a Plan is adopted and the person commits it through `knowledge/commit`; until then a check that asks
 * `git status` whether only its own file changed would always fail on it, and an executor's `git add -A` would stage
 * it. The person's own workbench commands do not mount it: the person sees `.workbench/` there in order to commit it.
 *
 * One read-only file outside every workspace, holding the knowledge directory line, is mounted at git's default
 * excludes path. No file of the user's repository is written (`.git/info/exclude` stays the person's "stay local"
 * choice) and no user setting is replaced: a `core.excludesFile` in the repository's own `.git/config` still wins over
 * the default path. Excludes hide only untracked files, so a committed `.workbench/` shows as before.
 *
 * There is one such file for the user the Host runs as, at a fixed place in the temporary directory
 * (`workbench-git-excludes-<uid>/ignore`): every Host of that user mounts the same file, a Host that restarts finds it
 * and none is left behind per process. Its directory must be this user's own and closed to others, because whatever
 * the file says git leaves out of a check's view (safety); one that is not is `unavailable` and never used. A file
 * that is missing or changed is written again whole (a temporary file renamed over it). A file that cannot be made is
 * `unavailable` with the reason, which the check or command that asked reports.
 */
export function knowledgeGitExcludesMount():
  WorkspaceResult<{ readonly source: string; readonly target: string; readonly writable: false }> {
  const unavailable = (reason: string) => ({ status: 'rejected' as const, code: 'unavailable' as const,
    reason: `the platform's git excludes file for the command sandbox is unavailable: ${reason}` });
  try {
    if (checkedGitExcludes === null || !existsSync(checkedGitExcludes)) {
      const uid = typeof process.getuid === 'function' ? process.getuid() : null;
      const directory = join(tmpdir(), `workbench-git-excludes-${uid === null ? userInfo().username : String(uid)}`);
      try { mkdirSync(directory, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const owner = lstatSync(directory);
      if (!owner.isDirectory() || (uid !== null && (owner.uid !== uid || (owner.mode & 0o077) !== 0))) {
        return unavailable(`${directory} is not a directory only this user can use`);
      }
      const file = join(directory, 'ignore');
      const current = existsSync(file) && lstatSync(file).isFile() ? readFileSync(file, 'utf8') : null;
      if (current !== `${EXCLUDED}\n`) {
        const temporary = join(directory, `.ignore.${randomUUID()}.tmp`);
        writeFileSync(temporary, `${EXCLUDED}\n`, { mode: 0o444 });
        renameSync(temporary, file);
      }
      checkedGitExcludes = file;
    }
    return { status: 'ready', value: { source: checkedGitExcludes, target: SANDBOX_GIT_EXCLUDES_PATH, writable: false } };
  } catch (error) {
    return unavailable(messageOf(error));
  }
}

/**
 * The one shell prelude a registered check's command runs first (the platform builds that command line), for a
 * repository whose own `.git/config` sets `core.excludesFile`: that setting wins over git's default excludes path, so
 * the mounted file alone would not apply there. The prelude writes, in the sandbox's own `/tmp`, the person's file as
 * git reads it (`~/` from HOME, a relative path from the top of the working tree) followed by the knowledge directory
 * line, and points `core.excludesFile` at it for this one command (`GIT_CONFIG_COUNT`): the person's patterns keep
 * applying and nothing outside the sandbox changes. Without such a setting it does nothing and the mounted default file
 * applies. It prints nothing, sets no exit status for the command and writes nowhere but the sandbox's `/tmp`. The
 * read-only command and a Work Run's Kernel shell run the agent's own command line, so there only the mounted default
 * file applies.
 */
const KNOWLEDGE_GIT_EXCLUDES_PRELUDE = [
  'if __wb_x=$(git config --get core.excludesFile 2>/dev/null) && [ -n "$__wb_x" ]; then',
  '  case "$__wb_x" in /*) ;; "~/"*) __wb_x="$HOME/${__wb_x#"~/"}" ;; '
    + '*) __wb_x="$(git rev-parse --show-toplevel 2>/dev/null)/$__wb_x" ;; esac',
  `  if { cat -- "$__wb_x" 2>/dev/null; printf '\\n%s\\n' '${EXCLUDED}'; } 2>/dev/null >/tmp/.workbench-git-excludes; then`,
  '    export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.excludesFile GIT_CONFIG_VALUE_0=/tmp/.workbench-git-excludes',
  '  fi',
  'fi',
].join('\n');

/** A registered check's command with the knowledge excludes prelude in front (`KNOWLEDGE_GIT_EXCLUDES_PRELUDE`). */
export function withKnowledgeGitExcludes(command: string): string {
  return `${KNOWLEDGE_GIT_EXCLUDES_PRELUDE}\n${command}`;
}

/** Makes `<root>/.workbench/`; an existing one (a workspace-local project store's `.gitignore` included) is left as
 *  it is. Commands mount it read-only and fail to start without it, so a directory deleted, or removed by a branch
 *  switch, comes back before the next command. A missing root is never made: its own open reports it. */
export function ensureKnowledgeDirectory(root: string): void {
  try { mkdirSync(join(root, KNOWLEDGE_DIRECTORY)); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'ENOENT') throw error;
  }
}
