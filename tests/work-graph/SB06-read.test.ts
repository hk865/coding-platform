/**
 * B06 witness checks, read-back (spec rows W12, W12b; decision 104-1, PRODUCT :540). Public reads only: `tasks/query`
 * (`TaskRow.reduction`) → `graph/look` (`evidence`) → `materials/open` (`historical_explanation`), and
 * `verification/round`; W12b the published `platform.evidence.readEvidence` as the Host of a second workspace of the
 * same project (`addS7D2SecondWorkspace`, Host settings `workspaces/open`). Memory, Git root; no store read.
 * Red today (bed5b343): `graph/look` refuses the `evidence` relation ("lookGraph relation is not recognized") and
 * `readEvidence` is not published; no witness check exists. Green when B06 G2 adds the reads and the structured body.
 * Mutations: W12 the body becomes the bare `reportText`, or `TaskRow.reduction` / the `evidence` relation is dropped;
 * W12b `readEvidence` compares the workspace instead of the project (`forbidden`).
 * W12b does not read through `graph/look` from workspace B: the graph reader refuses another workspace's round node by
 * its own scope check ("the Round node is outside the requested scope"), which B06 does not change.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { addS7D2SecondWorkspace } from '../helpers/S7D2-role-line-world.js';
import {
  bodySB06, driveSB06, openSB06World, roundSB06, sb06Draft, sb06Reads, sb06Witness, taskRowSB06, witnessOf,
  SB06_PATHS, SB06_TASK, SB06_WITNESS, type SB06Obligation, type SB06World,
} from '../helpers/SB06-witness-fixture.js';

const worlds: SB06World[] = [];
const removes: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const sb of worlds.splice(0)) await sb.close();
  for (const remove of removes.splice(0)) await remove();
});
/** Leading and trailing blanks stay in the stored text: `reportText` is the executor's text, untrimmed. */
const REPORT = '  SB06 report, kept byte for byte \n';
const passed = async (obligations: readonly SB06Obligation[]) => {
  const sb = await openSB06World({ draft: goal => sb06Draft(goal, obligations) });
  worlds.push(sb);
  return { sb, drive: await driveSB06(sb, { to: 'end', replies: sb06Reads(SB06_PATHS, REPORT) }) };
};

describe('W12: the witness report drills down from the Task row to its stored body', () => {
  it('reduction → evidence → the three-key body, text byte-equal; verification/round shows the witness command null',
    async () => {
      const { sb, drive } = await passed([sb06Witness([...SB06_PATHS]), { id: 'sb06-cmd', taskIds: [SB06_TASK],
        kind: 'static' }]);
      const { round, evidence } = await roundSB06(sb, drive.roundRef, 'evidence');
      const verdict = evidence?.find(item => item.source.checkId === SB06_WITNESS);
      const reduction = (await taskRowSB06(sb))?.reduction as { effectiveEvidenceIds: string[] } | undefined;
      expect(reduction?.effectiveEvidenceIds).toContain(verdict?.evidenceId);
      expect(verdict?.summary.artifactRef).toEqual(witnessOf(round)?.reportRef);
      const body = await bodySB06(sb, verdict?.summary.artifactRef);
      expect(Object.keys(JSON.parse(body) as object)).toEqual(['roundRef', 'subjectRunRef', 'reportText']);
      expect(JSON.parse(body)).toEqual({ roundRef: drive.roundRef, subjectRunRef: drive.runRef, reportText: REPORT });
      const read = ready<{ checks: { checkId: string; command: string | null }[] }>(await sb.world.post(
        'verification/round', plain(S6A_SCOPE, { roundRef: drive.roundRef })), 'SB06: verification/round');
      expect(read.checks.map(check => [check.checkId, check.command])).toEqual(expect.arrayContaining([
        ['s7a-static-check', 'echo S7A_CHECKS_OK'], [SB06_WITNESS, null]]));
    }, 180_000);
});

describe('W12b: another workspace of the same project reads the verdict (decision 104-1)', () => {
  it('readEvidence as the Host of workspace B is ready for workspace A\'s witness verdict', async () => {
    const { sb, drive } = await passed([sb06Witness([...SB06_PATHS])]);
    const ref = (await roundSB06(sb, drive.roundRef)).round.evidenceRefs[0]!;
    const second = await addS7D2SecondWorkspace(sb.world, 'sb06-b');
    removes.push(second.remove);
    expect(await sb.world.platform.evidence.readEvidence(second.workspace.humanContext(), ref)).toMatchObject({
      status: 'ready', value: { ref, evidence: { outcome: 'PASS', source: { checkId: SB06_WITNESS } } } });
  }, 180_000);
});
