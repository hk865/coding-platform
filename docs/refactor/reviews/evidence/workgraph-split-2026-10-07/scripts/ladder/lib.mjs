// Shared helpers of the ladder checkers and the DSH runner.
//  - integrity: sha256 manifest of base and of the ladder definitions, compared with the golden manifest that sync.sh
//    writes (a checker refuses to judge when base, _common or a level's data changed since the sync);
//  - records: what setup wrote OUTSIDE the copy (setup commit SHA, a backup of the set-up .git, ignored files at setup);
//  - check clones: every checker judges a throwaway clone (pristine base node_modules + the agent's tree + the recorded
//    .git), never the copy DSH works in, so a killed checker leaves nothing in the copy;
//  - timed commands (coreutils `timeout` kills the whole process group, vitest workers included).
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, lstatSync, readlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';

export const HOME = homedir();
export const LADDER = join(HOME, 'dsh-work/ladder');
export const COMMON = join(LADDER, '_common');
export const BASE = join(HOME, 'dsh-work/base');
export const RECORDS = join(LADDER, '_records');
export const CHECKS = join(LADDER, '_check');
export const RUNS = join(LADDER, '_runs');
export const GOLDEN = join(RECORDS, 'golden.json');
export const VENDOR_DEPS = '/home/han001/projects/agents/coding-agent/node_modules';
export const LEVEL_DIR = /^L[A-Z0-9][a-z0-9]*$/; // L2, L3, L3a, L4, L5, L5b, L6, LD (copies have a '-': L2-run)

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// ---- integrity ---------------------------------------------------------------------------------------------------
function walk(root, skip, rel = '', out = {}) {
  for (const name of readdirSync(join(root, rel)).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    if (skip(r)) continue;
    const abs = join(root, r);
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) out[r] = 'link:' + readlinkSync(abs);
    else if (st.isDirectory()) walk(root, skip, r, out);
    else if (st.isFile()) out[r] = sha256(readFileSync(abs));
  }
  return out;
}
/** base: every file except .git (its index changes on a plain `git status`) and the Vite cache; ladder: _common and the level directories. */
export function computeManifest() {
  const base = walk(BASE, (r) => r === '.git' || r === 'node_modules/.vite');
  const ladder = walk(LADDER, (r) => {
    const top = r.split('/')[0];
    return !(top === '_common' || LEVEL_DIR.test(top));
  });
  return { base: { files: Object.keys(base).length, digest: sha256(JSON.stringify(base)), entries: base },
    ladder: { files: Object.keys(ladder).length, digest: sha256(JSON.stringify(ladder)), entries: ladder } };
}
export function verifyIntegrity() {
  if (!existsSync(GOLDEN)) return { ok: false, problems: [`no golden manifest at ${GOLDEN} (run _tools/sync.sh)`] };
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const now = computeManifest();
  const problems = [];
  for (const part of ['base', 'ladder']) {
    if (golden[part].digest === now[part].digest) continue;
    const a = golden[part].entries, b = now[part].entries;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[k] !== b[k]) problems.push(`${part}: ${k} ${a[k] === undefined ? 'added' : b[k] === undefined ? 'deleted' : 'changed'}`);
    }
  }
  return { ok: problems.length === 0, problems: problems.slice(0, 20), problemCount: problems.length,
    baseDigest: now.base.digest, ladderDigest: now.ladder.digest };
}

// ---- records -----------------------------------------------------------------------------------------------------
export const recordDir = (copy) => join(RECORDS, basename(resolve(copy)));
export function readRecord(copy) {
  const file = join(recordDir(copy), 'record.json');
  if (!existsSync(file)) return null;
  const record = JSON.parse(readFileSync(file, 'utf8'));
  return record.copy === resolve(copy) ? record : null;
}
const IGNORED_NOISE = (p) => p.split('/').includes('node_modules') || p.endsWith('.tsbuildinfo');
/** Ignored files present in a working tree (git status --ignored), without node_modules and tsbuildinfo. */
export function ignoredFiles(dir) {
  const out = execFileSync('git', ['status', '--porcelain', '--ignored', '--untracked-files=all', '-z'], { cwd: dir, maxBuffer: 1 << 28 }).toString();
  return out.split('\0').filter((l) => l.startsWith('!! ')).map((l) => l.slice(3)).filter((p) => !IGNORED_NOISE(p)).sort();
}

// ---- the agent's own git state (read only) -----------------------------------------------------------------------
export function agentGitState(copy, record) {
  const rev = (ref) => {
    const r = spawnSync('git', ['rev-parse', '-q', '--verify', ref], { cwd: copy, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const head = rev('HEAD'), tag = rev('ladder-setup^{commit}');
  return { head, tag, agentCommits: head !== record.setupCommit, tagMoved: tag !== record.setupCommit };
}

// ---- check clones ------------------------------------------------------------------------------------------------
const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr ?? '').slice(0, 300)}`);
  return r.stdout;
};
/** A throwaway clone: base (pristine node_modules) + the vendor packages + the agent's tree (rsync, without .git and
 *  node_modules) + the .git recorded at setup. Returns its path. */
export function makeClone(copy, record) {
  mkdirSync(CHECKS, { recursive: true });
  const clone = join(CHECKS, `${record.name}-${Date.now()}`);
  sh('cp', ['-a', BASE, clone]);
  sh('chmod', ['-R', 'u+w', clone]);
  rmSync(join(clone, '.git'), { recursive: true, force: true });
  rmSync(join(clone, 'node_modules/.vite'), { recursive: true, force: true });
  mkdirSync(join(clone, 'vendor/coding-agent/node_modules'), { recursive: true });
  sh('cp', ['-a', join(VENDOR_DEPS, 'zod'), join(VENDOR_DEPS, 'openai'), join(clone, 'vendor/coding-agent/node_modules/')]);
  sh('rsync', ['-a', '--delete', '--exclude=/.git', '--exclude=/node_modules', '--exclude=/vendor/coding-agent/node_modules',
    resolve(copy) + '/', clone + '/']);
  sh('cp', ['-a', join(recordDir(copy), 'git'), join(clone, '.git')]);
  sh('chmod', ['-R', 'u+w', join(clone, '.git')]);
  return clone;
}
export function removeClone(clone) {
  if (clone && clone.startsWith(CHECKS + '/')) rmSync(clone, { recursive: true, force: true });
}

// ---- timed commands ----------------------------------------------------------------------------------------------
export function runTimed(cmd, args, { cwd, timeoutSec = 600, env } = {}) {
  const started = Date.now();
  const r = spawnSync('timeout', ['-k', '20', String(timeoutSec), cmd, ...args],
    { cwd, env: env ?? process.env, encoding: 'utf8', maxBuffer: 1 << 28 });
  const seconds = Math.round((Date.now() - started) / 1000);
  const timedOut = r.status === 124 || (r.status === 137 && seconds >= timeoutSec);
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut, seconds };
}
export const tail = (s, n = 6) => (s ?? '').trim().split('\n').slice(-n);

/** Files changed in a clone against the setup commit (tracked + untracked, not ignored), via a private index. */
export function changedFiles(clone, setupCommit, tmpIndex, { renames = false } = {}) {
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  execFileSync('git', ['read-tree', setupCommit], { cwd: clone, env });
  execFileSync('git', ['add', '-A'], { cwd: clone, env });
  const raw = execFileSync('git', ['diff', '--cached', renames ? '-M50%' : '--no-renames', '--name-status', '-z', setupCommit],
    { cwd: clone, env, maxBuffer: 1 << 28 }).toString();
  const parts = raw.split('\0').filter((x) => x.length > 0);
  const entries = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i++];
    if (status.startsWith('R') || status.startsWith('C')) entries.push({ status: status[0], score: Number(status.slice(1)), old: parts[i++], new: parts[i++] });
    else entries.push({ status: status[0], path: parts[i++] });
  }
  return entries;
}

/** The common preamble of every checker: integrity, record, the agent's git state. Returns {error} or the pieces. */
export function preamble(copyArg) {
  const copy = resolve(copyArg);
  const integrity = verifyIntegrity();
  if (!integrity.ok) return { verdict: 'invalid', error: 'ladder or base changed since the last sync; no verdict', integrity };
  const record = readRecord(copy);
  if (!record) return { verdict: 'fail', error: `${copy} has no setup record in ${RECORDS} (not made by a setup.sh)`, integrity };
  if (!existsSync(join(copy, '.git'))) return { verdict: 'fail', error: `${copy} has no .git`, integrity };
  return { copy, record, integrity, git: agentGitState(copy, record) };
}
