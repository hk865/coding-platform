import type { VerificationRuntimeFacts, ReadonlyReportMaterialResult, ReadonlySourceRead } from '../../contracts/verification-context.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';

const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
/** Decode public observations without inferring report quality or completion. */
export function readonlyReportObservation(record: ReturnType<VerificationRuntimeFacts['all']>[number], sourceDigest: string): ReadonlyReportMaterialResult {
  if (!Array.isArray(record.trace) || !Array.isArray(record.events)) return { status: 'incomplete', missing: ['Public trace and terminal events are unavailable'] };
  if (record.trace.length > 20000) return { status: 'incomplete', missing: ['Public trace exceeds bounded observation capacity'] };
  let report: string | null = null, lastSequence = -1;
  let workspaceEffects: 'none' | 'changed' | 'unknown' = 'none';
  const calls = new Map<string, string>(), completed = new Set<string>(), observedTools = new Set<string>(), sourceReads: ReadonlySourceRead[] = [];
  const unknown = () => { if (workspaceEffects !== 'changed') workspaceEffects = 'unknown'; };
  for (const raw of record.trace) {
    const event = object(raw);
    if (!event || typeof event['type'] !== 'string' || typeof event['sequence'] !== 'number' || !Number.isSafeInteger(event['sequence']) || event['sequence'] <= lastSequence) return { status: 'rejected', issues: ['Public trace sequence is incomplete or ambiguous'] };
    lastSequence = event['sequence'];
    const data = object(event['data']);
    if (event['type'] === 'assistant.message_completed') {
      const message = object(data?.['message']);
      report = Array.isArray(data?.['toolCalls']) && data['toolCalls'].length === 0 && typeof message?.['content'] === 'string' ? message['content'] : null;
    }
    if (event['type'] === 'tool.started') {
      const call = object(data?.['call']);
      if (typeof call?.['callId'] !== 'string' || typeof call['name'] !== 'string' || calls.has(call['callId'])) { unknown(); continue; }
      calls.set(call['callId'], call['name']); observedTools.add(call['name']);
      if (['edit', 'write', 'shell', 'exec'].includes(call['name'])) unknown();
    }
    if (event['type'] !== 'tool.completed') continue;
    const id = data?.['callId'], result = object(data?.['result']), effects = object(result?.['effects']);
    if (typeof id !== 'string' || !calls.has(id) || completed.has(id)) { unknown(); continue; }
    completed.add(id);
    if (!Array.isArray(effects?.['changedPaths'])) unknown();
    else if (effects['changedPaths'].length > 0) workspaceEffects = 'changed';
    if (calls.get(id) !== 'read' || result?.['status'] !== 'success' || !Array.isArray(result['output'])) continue;
    for (const entry of result['output']) {
      const output = object(entry), value = output?.['kind'] === 'json' ? object(output['value']) : null;
      if (!value) continue;
      if (typeof value['path'] !== 'string' || typeof value['revision'] !== 'string' || typeof value['startLine'] !== 'number' || typeof value['endLine'] !== 'number') return { status: 'rejected', issues: ['Successful read lacks exact source provenance'] };
      sourceReads.push({ path: value['path'], revision: value['revision'], startLine: value['startLine'], endLine: value['endLine'], callId: id });
    }
  }
  if (calls.size !== completed.size) unknown();
  if (sourceReads.length > 1000 || (report !== null && Buffer.byteLength(report, 'utf8') > 256 * 1024)) return { status: 'incomplete', missing: ['Readonly report or source witnesses exceed capacity'] };
  return { status: 'ready', report, sourceReads, completeReadPaths: [], observedTools: [...observedTools].sort(), workspaceEffects, sourceDigest,
    observationDigest: sha256Hex(canonicalJson({ spec: record.spec, status: record.status, events: record.events, trace: record.trace } as import('../../contracts/fingerprint.js').JsonValue)) };
}
