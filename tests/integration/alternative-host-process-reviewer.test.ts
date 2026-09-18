import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
const execute = promisify(execFile);
const driver = fileURLToPath(new URL('./alternative-host-process-reviewer.mjs', import.meta.url));
for (const fault of ['after_work_commit', 'provider_effect']) {
  it(`production Reviewer recovers in a new OS process after ${fault} without unsafe model replay`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'alternative-host-process-reviewer-'));
    const root = join(dir, 'source'); await mkdir(root); await writeFile(join(root, 'subject.txt'), 'expected\n');
    const config = { root, data: join(dir, 'data'), settings: join(dir, 'settings'), counter: join(dir, 'actions.jsonl'), receipt: join(dir, 'receipt.json'), input: join(dir, 'input.json') };
    const actions = async () => (await readFile(config.counter, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const child = async (name: string, crash?: string) => {
      const path = join(dir, name + '.json'); await writeFile(path, JSON.stringify({ ...config, fault: crash }));
      try { const result = await execute(process.execPath, [driver, path], { maxBuffer: 8 * 1024 * 1024, timeout: 100000 }); return { code: 0, value: JSON.parse(result.stdout) }; }
      catch (error) { const failure = error as { code: number; stderr: string; stdout: string }; if (failure.code !== 86) throw Error(failure.stderr + failure.stdout); return { code: 86, value: null }; }
    };
    try {
      expect((await child('crash', fault)).code).toBe(86);
      const before = await actions();
      expect(before.filter(a => a.review)).toHaveLength(fault === 'after_work_commit' ? 0 : 1);
      if (fault === 'after_work_commit') {
        const receipt = JSON.parse(await readFile(config.receipt, 'utf8'));
        expect(receipt.work.output).toBeNull();
        expect(receipt.run).toMatchObject({ status: 'starting', envelope: null, lastEventSeq: 0 });
      }
      const recovered = (await child('recover')).value;
      expect(recovered.pid).not.toBe(before[0].pid);
      expect(recovered.replay.replayed).toBe(true);
      expect(recovered.works).toHaveLength(1);
      expect(recovered.run).toMatchObject({ mode: 'review', canonicalStatus: 'ended', status: fault === 'after_work_commit' ? 'completed' : 'outcome_unknown' });
      if (fault === 'after_work_commit') {
        expect(recovered.view).toMatchObject({ phase: 'settled', formal: { taskPhase: 'satisfied' } });
        expect(recovered.view.assessment.body.decision).toMatchObject({ status: 'accepted', requirements: [expect.objectContaining({ outcome: 'PASS' })] });
        expect(recovered.view.formal.evidenceRefs).toHaveLength(1);
        expect(recovered.results).toHaveLength(1);
        expect(recovered.run.toolCompleted).toBe(true);
        expect((await actions()).filter(a => a.review).length).toBeGreaterThan(2);
      } else {
        expect(recovered.results).toHaveLength(0);
        expect(recovered.works[0].output).toBeNull();
        expect(recovered.view.formal.taskPhase).not.toBe('satisfied');
        expect(await actions()).toEqual(before);
      }
      const stable = await actions();
      expect(stable.filter(a => a.review).every(a => !a.writer && a.tools.includes('read_source') && a.tools.includes('read_material'))).toBe(true);
      const repeated = (await child('repeat')).value;
      expect(repeated.pid).not.toBe(recovered.pid);
      expect(repeated.works).toEqual(recovered.works);
      expect(repeated.results).toEqual(recovered.results);
      expect(repeated.evidence).toEqual(recovered.evidence);
      expect(repeated.run).toEqual(recovered.run);
      expect(await actions()).toEqual(stable);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 300000);
}
