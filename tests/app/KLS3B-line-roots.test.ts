/**
 * KLS-3b (test writer, decision 117): row 3B-15 of the start rulings draft v2 §3, item (c) of the five (lead ruling
 * "KLS-3b 草稿按 KLS-3a 实际代码重对"; draft §1 10, §2.8): the registered check of a Run on the second line runs in that
 * line's folder (`check-execution` reads the Run's line through `round.subjectRunRef`). The world is
 * `openJoinedLineScenario` (`tests/helpers/KLS3B-git-lines.ts`, SQLite: the Host reopens its line roots and Kernel
 * stores, S3): `src/marker.ts` is MAIN in the main checkout and LINE in the joined worktree, the Goal is on the
 * worktree's line with a Session of that line (`lineSession`, so the claim takes it, as KLS-3a2's 3A2-01), the Run
 * answers with text, and the registered check is `grep -q KLS3B_LINE src/marker.ts` (a Host input, A8). The Workflow
 * drives the claim, the Run and the checks up to their finalize; the `run_check` receipt is the public answer of the
 * check owner (the round as it stands after the check).
 *
 * Two gap rows of run `7d2-gapkls3b` share the world (`openJoinedLineScenario`): #39 the main line's root after another
 * checkout of the same repository joined (`goalOnLine: false` keeps the Goal on the main line, and a scripted `read` of
 * `src/marker.ts` answers MAIN) and #45 the brief of a Run on the second line (its own dirty file only; a requeue is
 * the first prepare that binds a brief, so Run 1 answers, the Workflow requeues, and the row reads Run 2's brief
 * before its finalize). Both expected values are the test's own markers and files, not `src` constants.
 * Not written: the read-only command variant of the draft's row (`task-gate` → `reviewCapability`, `runtime.ts:572`).
 * Its only public path is the K3 unknown-call review gate (a crashed Run with an unresolved call, the Host's read-only
 * command switch on, a review binding), and the capability only answers available/unavailable for a root; it reads no
 * file, so "reads LINE, not MAIN" has no public observation there (questions for the lead).
 *
 * Red today (a2b618dd): there is no join, so the seed's `workspaces/open` of the worktree answers a new workspace and
 * the world stops there. With the line registered the KLS-3a2 way instead (an exploration on this tree, not kept) the
 * Run is on the line and the check still greps the main checkout: `FAIL` (source `matched`). Green when KLS-3b lands
 * the join and the check's root by the Run's line.
 * Named mutation: `check-execution` resolves the root without the Run's line — the check greps the main checkout
 * (MAIN) and fails; shown by that exploration (it is today's behaviour).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { LineSnapshot } from '../../src/contracts/line.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { AG2B_SCOPE, AG2B_WORK_ROLE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { KLS3B_LINE, KLS3B_MAIN, lineSession, openJoinedLineScenario } from '../helpers/KLS3B-git-lines.js';
import { cleanupScenarios, performs } from '../scenarios/harness.js';
import { briefOf, performsAfterRequeues, selectedRun, textReply } from '../scenarios/support/common.js';

afterEach(async () => { await cleanupScenarios(); });

/** One `read` of `src/marker.ts` (call `<label>-read`). */
const readMarker = (label: string): ScriptedReply =>
  ({ kind: 'calls', calls: [{ callId: `${label}-read`, name: 'read', args: { path: 'src/marker.ts' } }] });

/** The tool message the model got back for `callId`, as JSON text. */
function toolResultText(requests: readonly ModelRequest[], callId: string): string {
  const message = requests.flatMap(request => request.messages)
    .find(candidate => candidate.role === 'tool' && candidate.callId === callId);
  if (message === undefined) throw new Error(`no model request carries the result of ${callId}`);
  return JSON.stringify(message);
}

describe('KLS-3b the registered check of a Run on the second line runs in that line\'s folder', () => {
  it('3B-15 the check greps the second checkout\'s marker (LINE) and passes', async () => {
    const { h, folder } = await openJoinedLineScenario({ script: { replies: [textReply('kls3b-15 the work is done')] },
      check: { command: 'grep -q KLS3B_LINE src/marker.ts' } });
    await lineSession(h, 'kls3b-15-line', AG2B_WORK_ROLE, folder);
    const driven = await h.advance(h.select('kls3b-15', AG2B_WORK_TASK_ID), { stopBefore: performs('finalize_checks') });
    const round = driven.steps.flatMap(step => step.receipt?.kind === 'run_check' ? [step.receipt.result] : []).at(-1);
    if (round?.status !== 'ready') throw new Error(`no ready run_check receipt: ${JSON.stringify(driven.steps.at(-1))}`);
    expect(round.value.checks.map(check => check.outcome)).toEqual(['PASS']);
  });

  it('#39 the main line still reads its own checkout after another checkout of the repo joined as a line', async () => {
    /* Named mutation (mutation reply row 39, `joinAsLine` passes `canonical` instead of the bound root): NOT observable —
     * the main line's entry is `line.folder` either way, so this row stays green. The faithful stronger mutation of the
     * same rule is that plus `registerHostLines` mapping every line to `root` (`host.ts:1830`): the main line's entry
     * becomes the joined checkout, and the Run on the main line reads LINE. */
    const { h } = await openJoinedLineScenario({ goalOnLine: false,
      script: { replies: [readMarker('kls3b-39'), textReply('kls3b-39 read')] } });
    const lines = await h.post<ReadResult<{ lines: LineSnapshot[] }>>('workspaces/lines', plain(AG2B_SCOPE, {}));
    if (lines.status !== 'ready') throw new Error(`workspaces/lines: ${JSON.stringify(lines)}`);
    expect(lines.value.lines).toHaveLength(2);
    await h.advance(h.select('kls3b-39', AG2B_WORK_TASK_ID), { stopBefore: performs('open_checks') });
    const read = toolResultText(h.modelRequests(), 'kls3b-39-read');
    expect([read.includes('KLS3B_MAIN'), read.includes('KLS3B_LINE')]).toEqual([true, false]);
  });

  it('#45 the brief of a Run on the second line counts only that checkout\'s dirty file', async () => {
    /* Named mutation: `context-workspace-facts.ts:46` drops the Run's line from the brief's first `resolveRoot` — the
     * brief reads the main checkout and lists `src/kls3b-45-main.ts` instead. A brief is bound only for a Run prepared
     * after a requeue (C3's rows), so Run 1 answers without the result file (its check FAILs), the Workflow requeues and
     * claims, and Run 2 — on the same line — is the Run whose brief this row reads. */
    const { h, folder } = await openJoinedLineScenario({ script: { replies: [
      textReply('kls3b-45 run 1 answers'), textReply('kls3b-45 the work is done')] } });
    await lineSession(h, 'kls3b-45-line', AG2B_WORK_ROLE, folder);
    writeFileSync(join(h.root, 'src/kls3b-45-main.ts'), 'export const main = 45;\n');
    writeFileSync(join(folder, 'src/kls3b-45-line.ts'), 'export const line = 45;\n');
    const toFinalize = await h.advance(h.select('kls3b-45', AG2B_WORK_TASK_ID), { stopBefore: performs('finalize_checks') });
    if (toFinalize.next === null) throw new Error('Run 1 must stop before its finalize_checks');
    await h.advance(toFinalize.next, { stopBefore: performsAfterRequeues(h, 'finalize_checks', 1) });
    const bound = await briefOf(h.host, await selectedRun(h));
    if (bound === null) throw new Error('the requeued Run on the second line bound no continuation brief');
    expect(bound.brief.workspace.uncommitted.paths).toEqual(['src/kls3b-45-line.ts']);
  });
});
