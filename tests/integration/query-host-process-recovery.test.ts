import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const execute = promisify(execFile);
const driver = fileURLToPath(new URL('./query-host-process.mjs', import.meta.url));
for (const fault of ['before_answer_commit', 'provider_effect'] as const) {
  it(`real HTTP Query survives a new process after ${fault} without another provider action`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'query-host-process-'));
    const root = join(dir, 'source'); await mkdir(root); await writeFile(join(root, 'README.md'), 'Public query recovery source.');
    const config = { root, data: join(dir, 'data'), settings: join(dir, 'settings'), counter: join(dir, 'provider-actions.jsonl') };
    const child = async (name: string, crash?: string) => {
      const path = join(dir, name + '.json'); await writeFile(path, JSON.stringify({ ...config, fault: crash }));
      try { const result = await execute(process.execPath, [driver, path], { maxBuffer: 4 * 1024 * 1024, timeout: 60000 }); return { code: 0, value: JSON.parse(result.stdout) }; }
      catch (error) { const failure = error as { code: number; stdout: string; stderr: string }; if (failure.code !== 86) throw Error(failure.stderr + failure.stdout); return { code: 86, value: null }; }
    };
    try {
      expect((await child('crash', fault)).code).toBe(86);
      const actions = (await readFile(config.counter, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(actions).toHaveLength(1);
      const recovered = await child('recover');
      expect(recovered.value.pid).not.toBe(actions[0].pid);
      if (fault === 'before_answer_commit') {
        expect(recovered.value.runs).toMatchObject([{ status: 'completed', result: { outcome: 'answered', answer: 'Explanation：Durable query process witness.' } }]);
        expect(recovered.value.queries.some((row: { currentAnswer?: { answer: string } }) => row.currentAnswer?.answer === 'Explanation：Durable query process witness.')).toBe(true);
      } else {
        expect(recovered.value.runs).toMatchObject([{ status: 'outcome_unknown' }]);
        expect(recovered.value.queries.every((row: { currentAnswer?: unknown }) => !row.currentAnswer)).toBe(true);
      }
      await child('repeat');
      expect((await readFile(config.counter, 'utf8')).trim().split('\n')).toHaveLength(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 180000);
}
