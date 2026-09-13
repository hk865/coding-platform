import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CommandCheckProvider, type CommandCheckProgress } from '../../src/control/verification-engine/command-check-provider.js';
import { ArtifactVault } from '../../src/data/artifact-vault/artifact-vault.js';
import { CandidateWorkspaceReader } from '../../src/data/workspace-reader/candidate-workspace-reader.js';
import type { CheckContextV1 } from '../../src/contracts/verification.js';
const roots: string[] = [];
const workspace = new CandidateWorkspaceReader();
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const context: CheckContextV1 = { projectId: 'checks', goalId: 'goal', taskId: 'task', planRef: { aggregateType: 'PlanRevision', projectId: 'checks', planId: 'plan' }, workspaceRevision: 1, changeScope: { changedFiles: ['source.txt'], writeSummary: 'test command checks', diffClass: 'code' } };
async function fixture(command: string, timeoutMs = 3000, progress?: (progress: CommandCheckProgress) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'command-check-')); roots.push(root);
  await writeFile(join(root, 'source.txt'), 'source');
  const sourceDigest = await workspace.digest(root), vault = new ArtifactVault();
  const owner = { aggregateType: 'Run' as const, projectId: 'checks', goalId: 'goal', runId: 'run' };
  const provider = new CommandCheckProvider([{ checkId: 'real-command', kind: 'dynamic', command, cwd: '.', timeoutMs }],
    async () => ({ root, workspaceId: 'workspace', owner, context, sourceDigest, currentDigest: () => workspace.digest(root) }), vault, progress);
  const run = async () => {
    const outcome = await provider.runCheck(context, 'real-command');
    expect(outcome.artifactRef).not.toBeNull();
    const body = await vault.open(outcome.artifactRef!, { requesterRunRef: owner });
    if (body.status !== 'ready') throw Error('missing check report');
    return { outcome, report: JSON.parse(body.record.body) };
  };
  return { run, root, provider, vault, owner };
}
it('records execution intent and body-first progress; a rejected intent cannot run the command', async () => {
  const stages: CommandCheckProgress[] = [];
  const accepted = await fixture('printf done', 3000, async event => { stages.push(event); });
  await accepted.run(); expect(stages.map(s => s.phase)).toEqual(['executing', 'report_stored']);
  const recorded = stages[1];
  if (recorded?.phase !== 'report_stored') throw Error('missing report checkpoint');
  expect(await accepted.vault.open(recorded.artifactRef, { requesterRunRef: accepted.owner })).toMatchObject({ status: 'ready' });
  const rejected = await fixture('printf forbidden > source.txt', 3000, async () => { throw Error('journal rejected'); });
  await expect(rejected.provider.runCheck(context, 'real-command')).rejects.toThrow('journal rejected');
  const { readFile } = await import('node:fs/promises');
  expect(await readFile(join(rejected.root, 'source.txt'), 'utf8')).toBe('source');
});
it.each([['printf passed', 'PASS'], ['exit 1', 'FAIL']])('executes an actual command and distinguishes its exit result: %s', async (command, result) => {
  const t = await fixture(command!); const { outcome, report } = await t.run();
  expect(outcome.result).toBe(result); expect(report.category).toBe('tool_check');
  expect(report.execution.exitCode).toBe(result === 'PASS' ? 0 : 1);
  expect(report.context.workspaceRevision).toBe(1); expect(report.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
});
it('keeps timeouts separate from a failed tool check', async () => {
  const t = await fixture('sleep 10', 100); const { outcome, report } = await t.run();
  expect(outcome.result).toBe('INCONCLUSIVE'); expect(report.category).toBe('timeout');
});
it('does not execute an outdated source and does not accept a changed source after checks', async () => {
  const before = await fixture('printf should-not-run'); await writeFile(join(before.root, 'source.txt'), 'changed');
  expect((await before.run()).report).toMatchObject({ category: 'stale_source', execution: null });
  const after = await fixture('printf modified > source.txt');
  expect((await after.run()).report).toMatchObject({ category: 'stale_source', result: 'INCONCLUSIVE' });
});
