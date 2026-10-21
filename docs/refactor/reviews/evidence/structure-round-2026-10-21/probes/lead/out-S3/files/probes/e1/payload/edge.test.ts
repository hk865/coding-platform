/**
 * Copy-only edge-input harness (inventory §4 item 2). It calls the real
 * renderers on the same input table in the base copy and in the result copy and
 * writes one JSON line per case to `S85_EDGE_OUT`.
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EDGE_CASES } from './edge-inputs.js';
import { renderContinuationBriefZh, approvedMethodLinesZh, probeBlockedCommandsLinesZh } from '../../src/contracts/continuation-brief.js';
import { renderUnknownCallReviewZh } from '../../src/contracts/core/prepared-execution.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { formatDecisionResponseInput } from '../../src/core/agent-runtime/execution-inputs.js';
import { architectureReminderRowEntries } from '../../src/core/agent-runtime/architecture-reminders.js';
import { renderNoteHeader } from '../../src/contracts/note.js';
import { probeConsultationGuidanceText } from '../../src/business/workflow/consultation.js';
import { probeScribeReminderText } from '../../src/app/host.js';
import { probeDecisionRowText, probeNotAvailableRowText, probeAnchorText } from '../../src/core/work-graph/views/context-extensions.js';
import { serializeProbe } from '../../src/probe-hook.js';

function run(probe: string, args: unknown[]): unknown {
  switch (probe) {
    case 'brief.render': return renderContinuationBriefZh(args[0] as never, args[1] as never);
    case 'brief.approvedMethods': return approvedMethodLinesZh(args[0] as never);
    case 'brief.blockedCommands': return probeBlockedCommandsLinesZh(args[0] as never, args[1] as number, args[2] as boolean);
    case 'unknownCallReview.render': return renderUnknownCallReviewZh(args[0] as never);
    case 'roleProfile': return platformRoleProfile(args[0] as never);
    case 'decisionResponseInput': return formatDecisionResponseInput(args[0] as never);
    case 'architectureReminderRows': return architectureReminderRowEntries(args[0] as never);
    case 'noteHeader': return renderNoteHeader(args[0] as never);
    case 'consultation.guidance': return probeConsultationGuidanceText(args[0] as string, args[1]);
    case 'scribe.reminder': return probeScribeReminderText(args[0] as number, args[1] as number, args[2] as readonly string[]);
    case 'contextExtensions.decisionRow': return probeDecisionRowText(args[0] as never);
    case 'contextExtensions.notAvailableRow': return probeNotAvailableRowText(args[0] as string);
    case 'contextExtensions.anomalyAnchor': return probeAnchorText(args[0] as never);
    default: throw new Error('unknown probe: ' + probe);
  }
}

describe('S3 edge inputs', () => {
  it('runs every edge case and writes its output', () => {
    const outPath = process.env['S85_EDGE_OUT'];
    const label = process.env['S85_EDGE_LABEL'] ?? 'copy';
    const lines = EDGE_CASES.map(entry => {
      let out: unknown;
      let error: string | null = null;
      try {
        out = run(entry.probe, entry.args);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      return serializeProbe({ label, case: entry.name, probe: entry.probe, error, out });
    });
    if (outPath !== undefined && outPath !== '') writeFileSync(outPath, lines.join('\n') + '\n');
    expect(lines.length).toBe(EDGE_CASES.length);
  });
});
