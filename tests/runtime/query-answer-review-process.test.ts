import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

it('SIGKILL after review admission remains unknown in a new process without resampling', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'query-review-crash-'));
  const driver = resolve('tests/runtime/query-answer-review-process.mjs');
  const child = spawn(process.execPath, [driver, 'start', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '', output = ''; child.stderr.on('data', b => { errors += b; });
  try {
    await new Promise<void>((done, reject) => {
      child.stdout.on('data', b => { output += b; if (output.includes('REVIEW_ENTERED')) done(); });
      child.on('error', reject); child.on('exit', code => reject(Error('Child ended before review admission: ' + code + ' ' + errors)));
    });
    const exited = once(child, 'exit'); child.kill('SIGKILL'); expect((await exited)[1]).toBe('SIGKILL');
    const recover = spawn(process.execPath, [driver, 'recover', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let recovered = '', recoveryErrors = ''; recover.stdout.on('data', b => { recovered += b; }); recover.stderr.on('data', b => { recoveryErrors += b; });
    const [code] = await once(recover, 'exit'); expect(code, recoveryErrors).toBe(0);
    const result = JSON.parse(recovered.trim());
    expect(result.pid).not.toBe(child.pid);
    expect(result).toMatchObject({ status: 'outcome_unknown', reviewStatus: 'outcome_unknown', reservedReview: 'reserved', calls: 0, inspect: { status: 'unavailable' }, result: { outcome: 'failed', answer: null } });
    expect(result.repeated).toEqual(result.result);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await rm(dir, { recursive: true, force: true }); }
}, 60000);
