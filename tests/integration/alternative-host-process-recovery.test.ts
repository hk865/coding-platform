import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
const execute = promisify(execFile);
const driver = fileURLToPath(new URL('./alternative-host-process-handoff.mjs', import.meta.url));
for (const fault of ['after_commit', 'provider_effect']) {
  it(`production Handoff survives process exit at ${fault} with durable execution accounting`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'alternative-host-process-'));
    const root = join(dir, 'source'); await mkdir(root); await writeFile(join(root, 'README.md'), 'Isolated recovery test.');
    const config = { root, data: join(dir, 'data'), settings: join(dir, 'settings'), counter: join(dir, 'actions.jsonl'), receipt: join(dir, 'receipt.json') };
    const actions = async () => (await readFile(config.counter, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const child = async (name: string, crash?: string) => {
      const path = join(dir, name + '.json'); await writeFile(path, JSON.stringify({ ...config, fault: crash }));
      try { const result = await execute(process.execPath, [driver, path], { maxBuffer: 4 * 1024 * 1024, timeout: 60000 }); return { code: 0, value: JSON.parse(result.stdout) }; }
      catch (error) { const failure = error as { code: number; stderr: string; stdout: string }; if (failure.code !== 86) throw Error(failure.stderr + failure.stdout); return { code: 86, value: null }; }
    };
    try {
      expect((await child('crash', fault)).code).toBe(86);
      const before = await actions(); expect(before.filter(a => a.writer)).toHaveLength(fault === 'after_commit' ? 1 : 2);
      const recovered = (await child('recover')).value;
      expect(recovered.pid).not.toBe(before[0].pid);
      expect(recovered.replay.replayed).toBe(true);
      expect(recovered.run).toMatchObject({ canonicalStatus: 'ended', status: fault === 'after_commit' ? 'completed' : 'outcome_unknown' });
      expect((await actions()).filter(a => a.writer)).toHaveLength(2);
      const stable = await actions();
      const repeated = (await child('repeat')).value;
      expect(repeated.pid).not.toBe(recovered.pid);
      expect(repeated.run).toEqual(recovered.run);
      expect(await actions()).toEqual(stable);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 180000);
}

it('production architecture decision resumes both affected readers after commit and OS process exit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'alternative-host-process-architecture-'));
  const root = join(dir, 'source'); await mkdir(root); await writeFile(join(root, 'README.md'), 'Isolated architecture recovery test.');
  const config = { root, data: join(dir, 'data'), settings: join(dir, 'settings'), counter: join(dir, 'actions.jsonl'), receipt: join(dir, 'receipt.json'), input: join(dir, 'input.json') };
  const architectureDriver = fileURLToPath(new URL('./alternative-host-process-architecture.mjs', import.meta.url));
  const actions = async () => (await readFile(config.counter, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const child = async (name: string, fault?: string) => {
    const path = join(dir, name + '.json'); await writeFile(path, JSON.stringify({ ...config, fault }));
    try { const result = await execute(process.execPath, [architectureDriver, path], { maxBuffer: 4 * 1024 * 1024, timeout: 90000 }); return { code: 0, value: JSON.parse(result.stdout) }; }
    catch (error) { const failure = error as { code: number; stderr: string; stdout: string }; if (failure.code !== 86) throw Error(failure.stderr + failure.stdout); return { code: 86, value: null }; }
  };
  try {
    expect((await child('crash', 'after_decision_commit')).code).toBe(86);
    const committed = JSON.parse(await readFile(config.receipt, 'utf8'));
    expect(committed.receipt.status).toBe('committed');
    expect((await actions()).filter(a => a.returning)).toHaveLength(0);
    const recovered = (await child('recover')).value;
    expect(recovered.pid).not.toBe(committed.pid);
    expect(recovered.replay).toMatchObject({ status: 'committed', replayed: true });
    expect(recovered.row).toMatchObject({ allNotified: true, allRequiredAttempted: true, review: { status: 'accepted' } });
    const targets = recovered.row.targets.filter((t: { mode: string }) => t.mode === 'resume');
    expect(targets).toHaveLength(2);
    expect(targets.every((t: { stage: string }) => t.stage === 'attempted')).toBe(true);
    const stable = await actions();
    const returns = stable.filter(a => a.returning);
    expect(returns).toHaveLength(2);
    expect(returns.every(a => !a.writer && a.pid === recovered.pid)).toBe(true);
    const repeated = (await child('repeat')).value;
    expect(repeated.pid).not.toBe(recovered.pid);
    expect(repeated.row.targets).toEqual(recovered.row.targets);
    expect(await actions()).toEqual(stable);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 240000);
