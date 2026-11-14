/**
 * B06 witness checks, public flow (spec rows W1a, W2–W7b, W9, W10, W13). Entries: `plans/propose` → `plans/apply` →
 * `workflow/advance`, `verification/reverify` (W7b), then `graph/look`, `tasks/query`, `materials/open`. Memory, Git
 * root (W5 the plain root); literals hand-worked from the witness rules; no store read.
 * Red today (bed5b343): no capability covers `witness` (`evidence-service.ts:1092`, `plan-readers.ts:2875`), so the
 * plan lists the witness requirement as `uncovered`, the round has no `platform:witness` check and finalizes
 * INCONCLUSIVE; rows fail at "SB06: no run_check", at `graph/look`'s unknown `evidence` relation, or at the missing
 * check. Green when B06 G2 appends the capability, synthesizes the check, dispatches `run_check` to `recordWitness`
 * and finalizes its verdict on the subject Run.
 * Mutations (one `src` sentence each): W1a delete the witness dispatch in `runRegisteredCheck`; W2/W3/W4/W6 the
 * changed-effects, zero-read, absent-path and non-blank-report branches; W5 non-Git made PASS; W7a the
 * `source!=='matched'` gap; W7b the successor skips witness synthesis; W9 `compileVerificationPlan`'s subject filter;
 * W10 the reviewer pair merged into the witness coverage; W13 empty paths made INCONCLUSIVE.
 * W6 has no `''` entry: an empty final text never completes the Run (the Workflow requeues it), so whitespace stays.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6AReply } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { receiptOf } from '../helpers/S7A-fixture.js';
import {
  bodySB06, driveSB06, opOf, openSB06World, roundSB06, sb06Draft, sb06Reads, sb06Witness, taskRowSB06,
  witnessOf, SB06_PATHS, SB06_TASK, SB06_WITNESS, type SB06Obligation, type SB06World,
} from '../helpers/SB06-witness-fixture.js';

const worlds: SB06World[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const sb of worlds.splice(0)) await sb.close(); });
const openRow = async (obligations: readonly SB06Obligation[], options: { git?: boolean; write?: boolean; tasks?: string[] } = {}) => {
  const sb = await openSB06World({ git: options.git, write: options.write,
    draft: goal => sb06Draft(goal, obligations, options.tasks) });
  worlds.push(sb); return sb; };
const pairOf = (id: string) => ({ obligationId: id, requirementId: `${id}-req` });
const READ = pairOf('sb06-read');
const REPORT = 'SB06 report: the three files read';

describe('W1a: the read-only Task passes on the platform witness', () => {
  it('three native reads + a final text → PASS, its verdict Evidence on the subject Run, Task satisfied', async () => {
    const sb = await openRow([sb06Witness([...SB06_PATHS])]);
    const atCheck = await driveSB06(sb, { to: 'run_check', replies: sb06Reads(SB06_PATHS, REPORT) });
    const probe = vi.spyOn(ProcessSandbox, 'probe');
    const drive = await driveSB06(sb, { to: 'end', from: atCheck });
    expect(probe).not.toHaveBeenCalled();
    expect(receiptOf(drive.receipts, 'complete_task')?.result).toMatchObject({ status: 'committed' });
    const { round, evidence } = await roundSB06(sb, drive.roundRef, 'evidence');
    const witness = witnessOf(round);
    expect(witness).toMatchObject({ phase: 'finished', outcome: 'PASS', invocationId: null, sourceStatus: 'matched' });
    expect(witness?.reportRef).not.toBeNull();
    expect(round).toMatchObject({ status: 'finalized', outcome: 'PASS', gaps: [] });
    expect(evidence).toEqual([expect.objectContaining({ kind: 'verdict', outcome: 'PASS', coverage: [READ],
      source: expect.objectContaining({ runRef: drive.runRef, checkId: SB06_WITNESS }),
      summary: expect.objectContaining({ artifactRef: witness?.reportRef }) })]);
    expect((await taskRowSB06(sb))?.effectivePhase).toBe('satisfied');
    expect(await sb.world.scripted.requests(sb.lines.get(SB06_TASK)!)).toHaveLength(4);
  }, 180_000);
});

const WRITE: S6AReply = { kind: 'calls', calls: [{ callId: 'sb06-write', name: 'edit',
  args: { mode: 'create', path: 'src/sb06-note.ts', newText: 'export const note = 1;\n' } }] };
describe('W2/W3/W4/W6: a known failure is FAIL, never completes the Task', () => {
  it.each([
    { row: 'W2 wrote a file', paths: [...SB06_PATHS], write: true, report: true,
      replies: [...sb06Reads(SB06_PATHS, REPORT).slice(0, 3), WRITE, { kind: 'text', text: REPORT } as S6AReply] },
    { row: 'W3 no successful read', paths: [], write: false, report: true, replies: sb06Reads([], REPORT) },
    { row: 'W4 one required path unread', paths: [...SB06_PATHS], write: false, report: true,
      replies: sb06Reads(SB06_PATHS.slice(0, 2), REPORT) },
    { row: 'W6 a whitespace final text', paths: [...SB06_PATHS], write: false, report: false,
      replies: sb06Reads(SB06_PATHS, ' \n\t') },
  ])('$row → FAIL; one FAIL verdict over the witness pair; next is not complete_task', async ({ paths, replies, write, report }) => {
    const sb = await openRow([sb06Witness(paths)], { write });
    const drive = await driveSB06(sb, { to: 'finalized', replies });
    const { round, evidence } = await roundSB06(sb, drive.roundRef, 'evidence');
    const witness = witnessOf(round);
    expect(witness).toMatchObject({ phase: 'finished', outcome: 'FAIL', invocationId: null });
    expect(witness).not.toHaveProperty('missingPaths');
    expect(witness?.reportRef === null).toBe(!report);
    expect(round.outcome).toBe('FAIL');
    expect(evidence).toEqual([expect.objectContaining({ kind: 'verdict', outcome: 'FAIL', coverage: [READ] })]);
    expect(opOf(drive.next)).not.toBe('complete_task');
  }, 180_000);
});

describe('W5: a non-Git workspace cannot prove the Run read-only', () => {
  it('reads and a report → INCONCLUSIVE; the report body is still stored and opens', async () => {
    // The plain root (`writeAG2bWorkspace`) has `src/module.ts` and `tsconfig.json` but no `README.md`: reading a
    // missing required file would be an absent path, a known FAIL that wins over the non-Git gap (W4's rule).
    const plainPaths = SB06_PATHS.slice(0, 2);
    const sb = await openRow([sb06Witness(plainPaths)], { git: false });
    const drive = await driveSB06(sb, { to: 'finalized', replies: sb06Reads(plainPaths, REPORT) });
    const witness = witnessOf((await roundSB06(sb, drive.roundRef)).round);
    expect(witness).toMatchObject({ phase: 'finished', outcome: 'INCONCLUSIVE' });
    expect(JSON.parse(await bodySB06(sb, witness?.reportRef))).toMatchObject({ reportText: REPORT });
    expect(opOf(drive.next)).not.toBe('complete_task');
  }, 180_000);
});

describe('W7a/W7b: the source changed after the round opened', () => {
  it('a read file edited before run_check → INCONCLUSIVE source_not_matched; the successor re-synthesizes it pending', async () => {
    const sb = await openRow([sb06Witness([...SB06_PATHS])]);
    const atCheck = await driveSB06(sb, { to: 'run_check', replies: sb06Reads(SB06_PATHS, REPORT) });
    await writeFile(join(sb.world.root, 'README.md'), '# changed by the person after the round opened\n');
    const drive = await driveSB06(sb, { to: 'finalized', from: atCheck });
    const prior = witnessOf((await roundSB06(sb, drive.roundRef)).round);
    expect(prior).toMatchObject({ phase: 'finished', outcome: 'INCONCLUSIVE', sourceStatus: 'changed',
      incompleteCause: 'source_not_matched' });
    expect(opOf(drive.next)).not.toBe('complete_task');
    const { revision } = (await roundSB06(sb, drive.roundRef)).round;
    const reverified = (await sb.world.post('verification/reverify', graphWrite(S6A_SCOPE, { predecessorRoundRef:
      drive.roundRef }, 'sb06-w7b', [{ ref: drive.roundRef, revision }]))).body as { value?: { round?: { ref: typeof drive.roundRef } } };
    expect(reverified).toMatchObject({ status: 'committed', value: { kind: 'reverified' } });
    const successor = (await roundSB06(sb, reverified.value!.round!.ref)).round;
    expect(witnessOf(successor)).toEqual({ checkId: SB06_WITNESS, definition: prior?.definition, coverage: [READ],
      phase: 'pending', invocationId: null, outcome: null, reportRef: null, sourceStatus: null });
    expect(prior?.definition).toEqual({ checkId: SB06_WITNESS, kind: 'witness', requiredReadPaths: [...SB06_PATHS] });
  }, 180_000);
});

describe('W9: each round takes only its subject Task\'s witness obligations', () => {
  it('explore and work rounds: own + shared witness pairs and paths; the command item unchanged; explore completes', async () => {
    const sb = await openRow([sb06Witness(['src/module.ts']), { id: 'sb06-work-read', taskIds: ['sb06-work'], kind: 'witness',
      paths: ['README.md'] }, { id: 'sb06-shared', taskIds: [SB06_TASK, 'sb06-work'], kind: 'witness', paths: ['tsconfig.json'] },
    { id: 'sb06-cmd', taskIds: [SB06_TASK, 'sb06-work'], kind: 'static' }], { tasks: [SB06_TASK, 'sb06-work'] });
    const explore = await driveSB06(sb, { to: 'end', replies: sb06Reads(['src/module.ts', 'tsconfig.json'], REPORT) });
    expect(receiptOf(explore.receipts, 'complete_task')?.result).toMatchObject({ status: 'committed' });
    const work = await driveSB06(sb, { to: 'run_check', taskId: 'sb06-work', replies: sb06Reads(['README.md'], REPORT) });
    const items = async (drive: typeof work) => (await roundSB06(sb, drive.roundRef)).round.verificationPlan.checks
      .map(item => ({ checkId: item.checkId, coverage: item.coverage, requiredReadPaths: item.requiredReadPaths }));
    expect(await items(explore)).toEqual(expect.arrayContaining([
      { checkId: SB06_WITNESS, coverage: [READ, pairOf('sb06-shared')], requiredReadPaths: ['src/module.ts', 'tsconfig.json'] },
      { checkId: 's7a-static-check', coverage: [pairOf('sb06-cmd')], requiredReadPaths: undefined }]));
    expect(await items(work)).toEqual(expect.arrayContaining([
      { checkId: SB06_WITNESS, coverage: [pairOf('sb06-work-read'), pairOf('sb06-shared')], requiredReadPaths: ['README.md', 'tsconfig.json'] },
      { checkId: 's7a-static-check', coverage: [pairOf('sb06-cmd')], requiredReadPaths: undefined }]));
  }, 240_000);
});

describe('W10: a required reviewer beside the witness', () => {
  it('stops at the review wait with the witness PASS; each item keeps its own coverage; round still open', async () => {
    const sb = await openRow([sb06Witness([...SB06_PATHS]), { id: 'sb06-review', taskIds: [SB06_TASK], kind: 'reviewer' }]);
    const drive = await driveSB06(sb, { to: 'end', replies: sb06Reads(SB06_PATHS, REPORT) });
    const { round } = await roundSB06(sb, drive.roundRef);
    expect(witnessOf(round)).toMatchObject({ phase: 'finished', outcome: 'PASS' });
    const coverage = (checkId: string) => round.verificationPlan.checks.find(item => item.checkId === checkId)?.coverage;
    expect(coverage(SB06_WITNESS)).toEqual([READ]);
    expect(coverage('review-packet')).toEqual([pairOf('sb06-review')]);
    expect(round).toMatchObject({ status: 'open', evidenceRefs: [] });
  }, 180_000);
});

describe('W13: a witness without required paths passes on one read', () => {
  it.each([{ paths: undefined }, { paths: [] }])('requiredReadPaths $paths → PASS, [] on the check, Task satisfied',
    async ({ paths }) => {
      const sb = await openRow([sb06Witness(paths)]);
      const drive = await driveSB06(sb, { to: 'end', replies: sb06Reads(['src/module.ts'], REPORT) });
      const witness = witnessOf((await roundSB06(sb, drive.roundRef)).round);
      expect(witness).toMatchObject({ phase: 'finished', outcome: 'PASS', definition: { requiredReadPaths: [] } });
      expect((await taskRowSB06(sb))?.effectivePhase).toBe('satisfied');
    }, 180_000);
});
