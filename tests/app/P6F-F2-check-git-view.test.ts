/**
 * P6F F2 (test writer, decision 117; lead ruling `p6f-rulings.md` F2, P6 diagnosis "iteration"): the platform writes
 * `.workbench/` into the workspace and leaves it uncommitted (the person commits it through `knowledge/commit`), so a
 * check the platform runs that self-checks with `git status` must not see it; the person's repository files stay as
 * they are (`<git-common-dir>/info/exclude` is written only by the 121-74 "keep local" setting, off here).
 *
 * World (one, shared by the two rows): the AG2b Host scenario on a real git root (`openHostScenario({ gitWorkspace })`:
 * README.md, src/module.ts and tsconfig.json committed, `.evaluator/` in the world's own `.git/info/exclude`). The
 * seed's public `architecture/adopt-initial` has written `.workbench/architecture.json` and `.workbench/modules/*.json`.
 * The Host's one registered check (a Host input, A8) is `CLEAN`; the Run answers with text, so it changes no file. The
 * person's own git setting: `core.excludesFile` in the repository's `.git/config`, the relative `.git/f2-user-excludes`
 * (`*.log`), with an untracked `x.log`. A relative repository setting is the only form of the person's own setting git
 * resolves inside the check sandbox today: the sandbox clears the environment, HOME is an empty tmpfs and the workspace
 * is mounted at /workspace, so a global or absolute one never applies there.
 * The Workflow drives the claim, the Run and the check through the real Kernel sandbox (real bubblewrap,
 * `CODING_AGENT_BWRAP_PATH`). No process-sandbox stand-in: it never runs a command (A7.1), and the env a fix builds
 * must reach the real sandboxed process. The verdict is the `run_check` receipt; what the check's git printed is the
 * check report's stdout (`materials/open`). Red on base (efff2dfa): F2-a, the check's git prints `?? .workbench/`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { cleanupScenarios, openHostScenario, performs } from '../scenarios/harness.js';
import { textReply } from '../scenarios/support/common.js';
import { gitIn } from '../scenarios/support/git-workspace.js';

/** Fails (exit 1) when `git status --porcelain` prints anything and (exit 9) when git itself fails; prints what it saw. */
const CLEAN = 's=$(git status --porcelain) || exit 9; printf "%s" "$s"; test -z "$s"';
/** What the person's own git shows: only the platform's untracked folder (`.evaluator/` and `x.log` are excluded). */
const PERSON_VIEW = '?? .workbench/\n';

type Seen = { outcome: unknown; porcelain: string[]; personBefore: string; personAfter: string;
  excludeBefore: Buffer; excludeAfter: Buffer; gitignore: boolean };
let seen: Seen;

/** `<root>/.git/info/exclude` before any Host started: what `git init` writes plus the world's own `.evaluator/` line. */
async function excludeBeforeHost(): Promise<Buffer> {
  const reference = await mkdtemp(join(tmpdir(), 'p6f-f2-'));
  try {
    gitIn(reference, 'init', '-q');
    return Buffer.concat([readFileSync(join(reference, '.git', 'info', 'exclude')), Buffer.from('.evaluator/\n')]);
  } finally {
    await rm(reference, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  const h = await openHostScenario({ gitWorkspace: true, check: { command: CLEAN },
    script: { replies: [textReply('p6f-f2 the work is done')] } });
  await writeFile(join(h.root, '.git', 'f2-user-excludes'), '*.log\n');
  gitIn(h.root, 'config', 'core.excludesFile', '.git/f2-user-excludes');
  await writeFile(join(h.root, 'x.log'), 'p6f-f2\n');
  const personBefore = gitIn(h.root, 'status', '--porcelain');
  const driven = await h.advance(h.select('p6f-f2', AG2B_WORK_TASK_ID), { stopBefore: performs('finalize_checks') });
  const round = driven.steps.flatMap(step => step.receipt?.kind === 'run_check' ? [step.receipt.result] : []).at(-1);
  if (round?.status !== 'ready') throw new Error(`no ready run_check receipt: ${JSON.stringify(driven.steps.at(-1))}`);
  const check = round.value.checks[0];
  if (check?.reportRef == null) throw new Error(`the check has no report: ${JSON.stringify(check)}`);
  const report = await h.post<{ status: string; value: { body: string } }>('materials/open',
    plain(AG2B_SCOPE, { ref: check.reportRef, usage: 'historical_explanation' }));
  if (report.status !== 'ready') throw new Error(`materials/open of the check report: ${JSON.stringify(report)}`);
  const stdout = (JSON.parse(report.value.body) as { observation: { stdout?: { text: string } } }).observation.stdout?.text ?? '';
  seen = { outcome: check.outcome, porcelain: stdout.split('\n').filter(line => line !== ''),
    personBefore, personAfter: gitIn(h.root, 'status', '--porcelain'),
    excludeBefore: await excludeBeforeHost(), excludeAfter: readFileSync(join(h.root, '.git', 'info', 'exclude')),
    gitignore: existsSync(join(h.root, '.gitignore')) };
}, 240_000);
afterAll(cleanupScenarios);

it('F2-a git in the platform-run check does not see the uncommitted .workbench/: the check PASSES, the repository untouched', () => {
  // Guards, green on base (the person's files and own git view as before; only the platform's folder is untracked).
  // Named mutations: the fix writes `.workbench/` into info/exclude → the first line; a root `.gitignore` → the second;
  // it hides `.workbench/` from the person's own git (a self-ignoring `.workbench/.gitignore`, `GIT_CONFIG_*` set on the
  // Host's own process.env) → the third.
  expect(seen.excludeAfter).toEqual(seen.excludeBefore);
  expect(seen.gitignore).toBe(false);
  expect([seen.personBefore, seen.personAfter]).toEqual([PERSON_VIEW, PERSON_VIEW]);
  // Red on base: the check's git prints `?? .workbench/` and the check FAILs. Named mutation: the check's sandboxed
  // process gets no platform exclude for `.workbench/` (today's code, or a fix that reaches only the Host's own git or
  // only the command tools) → this line; an env that breaks git (`GIT_CONFIG_COUNT` without its key: exit 128) → CLEAN
  // exits 9 → this line.
  expect({ outcome: seen.outcome, porcelain: seen.porcelain }).toEqual({ outcome: 'PASS', porcelain: [] });
});

it('F2-b (guard, green on base) the person\'s own core.excludesFile still applies inside the check: x.log stays hidden', () => {
  // Green on base: the check's git reads the repository's `.git/config`; its relative excludesFile resolves under
  // /workspace (`.git` is mounted read-only there). Named mutation: `core.excludesFile` set through
  // `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` to a platform file with `.workbench/` only, the person's
  // own file not merged in (it overrides the repository setting) → `?? x.log` → this line (and F2-a's last line).
  expect(seen.porcelain.filter(line => line.endsWith('x.log'))).toEqual([]);
});
