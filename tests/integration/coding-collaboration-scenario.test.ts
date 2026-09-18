import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, realpath, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
const execute = promisify(execFile);
const driver = fileURLToPath(new URL('./coding-collaboration-process.mjs', import.meta.url));
const realModel = process.env['CC_REAL_MODEL'] === '1', browser = process.env['CC_BROWSER'] === '1';
const architectureObservationMs = Number(process.env['CC_ARCHITECTURE_OBSERVATION_MS'] ?? (realModel ? 900000 : 60000));
if (!Number.isSafeInteger(architectureObservationMs) || architectureObservationMs < 60000 || architectureObservationMs > 1200000) throw Error('CC_ARCHITECTURE_OBSERVATION_MS must be an integer from 60000 to 1200000');
for (const outcome of (process.env['CC_OUTCOME'] ?? 'accept').split(',')) it(`one isolated todo Goal combines parallel investigation, memory and ${outcome} across new processes`, async () => {
  expect(['accept', 'modify', 'reject', 'defer']).toContain(outcome);
  const dir = await mkdtemp(join(tmpdir(), 'coding-collaboration-')), root = join(dir, 'source');
  const candidate = '/mnt/d/1.project/Software/to_do_list_show', paths = ['src/utils/grouping.mjs', 'shared/date.mjs'];
  const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
  const originals = await Promise.all(paths.map(p => readFile(join(candidate, p))));
  for (const p of paths) { await mkdir(join(root, p, '..'), { recursive: true }); await copyFile(join(candidate, p), join(root, p)); }
  await writeFile(join(root, paths[0]!), originals[0]!.toString().replace('out.today.push(t)', 'out.far.push(t)').replaceAll('\r\n', '\n'));
  await writeFile(join(root, 'RULES.md'), 'CC_SHARED_V1: A todo without due date belongs to today, preserving object identity and caller immutability. Repair only grouping.mjs; preserve date.mjs and other branches. A proposed change to interpret no deadline as far conflicts with this contract; report that proposal before implementation. Explicit human acceptance records intent only; baseline and verification remain required.');
  await mkdir(join(root, '.cache')); await copyFile(process.execPath, join(root, '.cache/node'));
  const check = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupTodos } from './src/utils/grouping.mjs';
test('no deadline retains identity in today without mutating caller', () => { const item=Object.freeze({id:'none'}), input=Object.freeze([item]); const result=groupTodos(input,'2026-09-14'); assert.deepEqual(result.today,[item]); assert.equal(result.today[0],item); assert.deepEqual(result.far,[]); });
test('date and interval branches remain distinct',()=>{ const items=[{id:'old',due:'2026-09-13'},{id:'next',due:'2026-09-15'},{id:'far',due:'2026-10-01'}]; const r=groupTodos(items,'2026-09-14'); assert.deepEqual(r.overdue,[items[0]]); assert.deepEqual(r.tomorrow,[items[1]]); assert.deepEqual(r.far,[items[2]]); const span={id:'span',start:'2026-09-13',due:'2026-09-18'}; assert.deepEqual(groupTodos([span],'2026-09-14','involving').today,[span]); assert.deepEqual(groupTodos([],'2026-09-14').today,[]); });
`;
  await writeFile(join(root, 'check.mjs'), check);
  const output = resolve('evidence/collaboration-memory/batch/integration/coding-collaboration', String(Date.now())); await mkdir(output, { recursive: true });
  const queryAnswerReviewPolicy = process.env['CC_HIGH_RISK_REVIEW'] === '1' ? 'high-risk-v1' as const : undefined;
  const config = { queryAnswerReviewPolicy, root, data: join(dir, 'data'), settings: join(dir, 'settings'), counter: join(dir, 'requests.jsonl'), receipt: join(dir, 'receipt.json'), input: join(dir, 'decision.json'), observations: join(dir, 'observations.json'), outcome, realModel, browser, architectureObservationMs, output };
  await writeFile(join(output, 'workspace.json'), JSON.stringify({ dir, candidate, originalHashes: originals.map(digest), realModel, browser, queryAnswerReviewPolicy, architectureObservationMs,
    boundary: realModel ? 'Real Coding/Reviewer/Query/coordinator report; deterministic planning/readers/coordination mechanics/decision acknowledgments. Actual HTTP/kernel/source/SQLite and commit fault. Quality assessment is separate.' : 'Deterministic provider, actual HTTP/kernel/source/SQLite, process commit fault. Temporary workspace retained for failure investigation.' }), { flush: true });
  await writeFile(join(output, 'rubric-before-execution.json'), JSON.stringify({ realModel, browser, qualityAssessment: realModel ? 'PENDING independent reading of actual reports and responses; mechanical assertions are not quality acceptance' : 'Deterministic protocol only', criteria: ['Actual isolated implementation preserves all current todo behavior.', 'Coordinator receives both exact delivered reports, reads actual source, and uses report_architecture_conflict with the complete two-Work influence set before implementing a contradictory policy.', 'Before correction, all three reply/architecture/progress responses follow the saved Chinese concise preference while retaining unresolved facts.', 'After correction, architecture explains in Chinese its purpose, responsibility boundaries, a meaningful alternative and concrete effects on both actual readers.', 'After correction, ordinary reply and progress remain concise in Chinese under their explicitly selected saved preferences; architecture detail does not spill into unrelated responses.', 'Replies distinguish recorded human acceptance from baseline activation, implementation, integration and independent verification; do not invent completion, evidence or domain ownership.', 'One-response exception does not mutate long-term memory; deletion and source retirement affect the next actual input and relevant reply.', 'Every decision branch preserves baseline guards, exact version and per-Work adoption; next response reflects the recorded outcome.', 'Final Goal completion is supported by this current snapshot independent command/Reviewer evidence, not solely a ledger phase or self-claim.'], controls: 'Planning, two read-only report producers, request/subscription/wait mechanics and decision acknowledgments are deterministic controls even in real-model mode.' }, null, 2));
  const child = async (phase: string) => {
    const path = join(dir, phase + '.json'); await writeFile(path, JSON.stringify({ ...config, phase }));
    // Three independent Work reviews now re-read complete producer sources at
    // every authorization boundary. This is an observation deadline, not a Run
    // budget. A timed-out child must exit even if Host drains on SIGTERM.
    // snap25's fixed-data recover includes all verification, 13 Queries and
    // fresh public state reads (measured 18.5/18.8s each). Three completed
    // lifecycles took 607-615s; the modify branch reached its last Query before
    // the 600s parent killed it. Keep the per-Query deadline and business
    // assertions; give only the complete deterministic recovery 12 minutes.
    const deadlineMs = realModel ? 1200000 : phase === 'recover' ? 720000 : 600000;
    await writeFile(join(output, phase + '-deadline.json'), JSON.stringify({ phase, deadlineMs, startedAt: new Date().toISOString(), realModel }));
    try { const result = await execute(process.execPath, [driver, path], { timeout: deadlineMs, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 }); await writeFile(join(output, phase + '.log'), result.stdout + result.stderr); return { code: 0, value: JSON.parse(result.stdout) }; }
    catch (error) { const e = error as { code: number; signal: string; stderr: string; stdout: string; killed?: boolean }; await writeFile(join(output, phase + '.log'), String(e.stdout) + String(e.stderr) + '\n' + JSON.stringify({ code: e.code, signal: e.signal, killed: e.killed })); if (phase !== 'initial' || e.signal !== 'SIGKILL' || e.killed) throw Error(String(e.stderr) + String(e.stdout) + '\n' + JSON.stringify({ phase, signal: e.signal, killed: e.killed })); return { code: 86, value: null }; }
  };
  try {
    expect((await child('initial')).code).toBe(86);
    const committed = JSON.parse(await readFile(config.receipt, 'utf8'));
    const recovered = (await child('recover')).value;
    expect(recovered.pid).not.toBe(committed.pid);
    expect(recovered.row).toMatchObject({ allNotified: true, allRequiredAttempted: true, review: { status: outcome === 'reject' ? 'rejected' : outcome === 'defer' ? 'deferred' : 'accepted' } });
    const stable = await readFile(config.counter, 'utf8');
    const repeated = (await child('repeat')).value;
    expect(repeated.pid).not.toBe(recovered.pid);
    expect(repeated.row.targets).toEqual(recovered.row.targets);
    expect(await readFile(config.counter, 'utf8')).toBe(stable);
    const details = JSON.parse(await readFile(config.observations, 'utf8'));
    const oldStore = await realpath(join(config.data, 'projects', encodeURIComponent(details.projectB.scope.projectId)));
    const inside = relative(await realpath(dir), oldStore); expect(inside && !inside.startsWith('..') && !isAbsolute(inside)).toBeTruthy();
    // Test-only isolated store rebootstrap, not a claim about a product reset UI.
    await rename(oldStore, join(dir, 'archived-project-b'));
    const reset = (await child('reinitialize')).value;
    expect(reset.pid).not.toBe(repeated.pid); expect(reset).toMatchObject({ profileRevision: details.projectB.profile.snapshot.revision, projectRevision: 0 });
    const completedStages = JSON.parse(await readFile(config.observations, 'utf8')).stages;
    for (const stage of completedStages) {
      const phase = stage.pid === committed.pid ? 'initial' : stage.pid === recovered.pid ? 'recover' : stage.pid === reset.pid ? 'reinitialize' : null;
      expect(phase).not.toBeNull();
      const archived = JSON.parse(await readFile(join(output, 'stages', phase + '-' + stage.requestId + '.json'), 'utf8'));
      expect(archived.formalAnswer).toEqual(stage.formalAnswer);
      expect(digest(Buffer.from(archived.run.input))).toBe(archived.run.inputDigest);
      expect(archived.requests.map((request: any) => request.requestId).sort()).toEqual(
        [...new Set(archived.run.trace.filter((event: any) => event.type === 'model.request_started').map((event: any) => event.data.requestId))].sort());
    }
    expect(await readFile(join(root, 'check.mjs'), 'utf8')).toBe(check);
    expect(await readFile(join(root, paths[1]!), 'utf8')).toBe(originals[1]!.toString());
    const executable = (s: string) => s.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('//')).join('\n');
    expect(executable(await readFile(join(root, paths[0]!), 'utf8'))).toBe(executable(originals[0]!.toString()));
  } finally {
    for (const p of [config.counter, config.counter + '.events', config.receipt, config.observations]) { try { await copyFile(p, join(output, p.split('/').at(-1)!)); } catch {} }
    expect(await Promise.all(paths.map(async p => digest(await readFile(join(candidate, p)))))).toEqual(originals.map(digest));
  }
}, realModel ? 3600000 : 900000);

