/**
 * One Plan/Main scene line: the Member scene's queued direct intervention and
 * its record, with the scene's own project, Goal and Session ids. The line waits
 * for your decision (PB-M5), so the line view's 需要你决定 note is a link.
 * Only this line's own reads are answered here; every other run, message or
 * line falls through to the board's scene.
 */
import { createHash } from 'node:crypto';
import { scene as MEMBER } from './Member.scene.mjs';

const OLD_PROJECT = 'ag2b-collab-project';
const OLD_WORKSPACE = 'ag2b-collab-workspace';
const OLD_GOAL = 's7c-goal';
const OLD_SESSION = 'session-ad6323a33c216470e3f25cc5599fc99d0911b5564b6b7914e78268f9f043cad1';

export function sceneLine(ids) {
  const rewrite = (value) => JSON.parse(JSON.stringify(value)
    .replaceAll(OLD_PROJECT, ids.projectId)
    .replaceAll(OLD_WORKSPACE, ids.workspaceId)
    .replaceAll(OLD_GOAL, ids.goalId)
    .replaceAll(OLD_SESSION, ids.sessionId));
  const ask = (route, input) => rewrite(MEMBER.reply(route, {
    ...input,
    key: { projectId: OLD_PROJECT, sessionId: OLD_SESSION },
    workspace: { projectId: OLD_PROJECT, workspaceId: OLD_WORKSPACE },
  }));
  const detail = ask('lines/read', {}).value;
  detail.row.name = { ...detail.row.name, primary: ids.name, tasks: [{ projectId: ids.projectId, goalId: ids.goalId, taskId: 's7c-m1' }] };
  detail.row.status = { ...detail.row.status, own: 'standby', bucket: 'working',
    attention: { code: 'decide', params: {}, refs: [] },
    attentionCounts: { decide: 1, failed: 0, blocked: 0, unknown: 0 } };
  const runIds = new Set(ask('lines/page', { section: 'executions' }).value.items.map((item) => item.runRef?.runId));
  const messageIds = new Set(ask('lines/page', { section: 'messages' }).value.items.map((item) => item.messageRef.messageId));
  /* 问一问 rounds: the page names a consultation `consultation-` + SHA-256 of its message ref's canonical JSON
     (boot.ts), and the refs here are rewritten, so each rewritten id maps back to the Member scene's own. */
  const canonical = (v) => (v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']'
    : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}');
  const consultationOf = (ref) => 'consultation-' + createHash('sha256').update(canonical(ref)).digest('hex');
  const consultations = new Map(MEMBER.reply('lines/page', { section: 'messages' }).value.items
    .map((item) => [consultationOf(rewrite(item.messageRef)), consultationOf(item.messageRef)]));
  const owns = (route, input) => {
    const key = input?.key;
    if (route === 'lines/read' || route === 'lines/page') return key?.sessionId === ids.sessionId;
    if (route === 'executions/read') return runIds.has(input?.runId);
    if (route === 'executions/brief') return runIds.has(input?.runRef?.runId);
    if (route === 'executions/steps') return runIds.has(input?.ref?.runId);
    if (route === 'messages/view') return messageIds.has(input?.messageId);
    if (route === 'messages/body') return messageIds.has(input?.messageRef?.messageId);
    if (route === 'queries/read') return consultations.has(input?.queryJobId);
    if (route === 'queries/answer') return MEMBER.reply(route, input)?.status === 'ready';
    return false;
  };
  return {
    lineRow: detail.row,
    reply(route, input) {
      if (!owns(route, input)) return undefined;
      if (route === 'lines/read') return { status: 'ready', value: detail };
      if (route === 'queries/read') {
        const old = consultations.get(input.queryJobId);
        return JSON.parse(JSON.stringify(rewrite(MEMBER.reply(route, { ...input, queryJobId: old }))).replaceAll(old, input.queryJobId));
      }
      return ask(route, input);
    },
  };
}
