const fs = require('fs');
const path = require('path');
const base = '/tmp/s85-scratch/S3/base';
const handoff = '/tmp/s85-scratch/S3/handoff/tools-2/tools';
const read = p => fs.readFileSync(path.join(base, p), 'utf8');
const ev = s => Function('"use strict";return (' + s + ');')();
const load = n => JSON.parse(fs.readFileSync(path.join(handoff, n + '.json'), 'utf8'));
let fails = 0;
function eq(label, got, want) {
  if (got !== want) { fails++; console.log('MISMATCH ' + label + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}

const comm = read('src/core/agent-runtime/communication-tools.ts');
const mailboxNames = ev(comm.slice(comm.indexOf('export const SESSION_MAILBOX_TOOL_NAMES = ') + 'export const SESSION_MAILBOX_TOOL_NAMES = '.length, comm.indexOf('] as const;') + 1));
const decisionNames = ev(comm.slice(comm.indexOf('export const USER_DECISION_TOOL_NAMES = ') + 'export const USER_DECISION_TOOL_NAMES = '.length, comm.indexOf('] as const;', comm.indexOf('export const USER_DECISION_TOOL_NAMES = ')) + 1));
if (!comm.includes('`Session mailbox: ${name}`') || !comm.includes('`User decision: ${name}`')) throw new Error('prefix shape');
for (const n of mailboxNames) { const j = load(n); eq(n + '.description', j.description, 'Session mailbox: ' + n); eq(n + '.parameters', JSON.stringify(j.parameters), '{}'); }
for (const n of decisionNames) { const j = load(n); eq(n + '.description', j.description, 'User decision: ' + n); eq(n + '.parameters', JSON.stringify(j.parameters), '{}'); }

const graph = read('src/core/agent-runtime/graph-tools.ts');
const gs = graph.indexOf('const descriptions = {');
const ge = graph.indexOf('} as const;', gs) + 1;
const gd = ev(graph.slice(gs + 'const descriptions = '.length, ge));
for (const n of ['look_graph', 'find_graph']) { const j = load(n); eq(n + '.description', j.description, gd[n]); eq(n + '.parameters', JSON.stringify(j.parameters), '{}'); }

const sd = read('src/core/agent-runtime/session-discovery-tools.ts');
const s0 = sd.indexOf("description: name === 'find_related_sessions'");
const s1 = sd.indexOf(",\n      inputSchema", s0 + 10);
const sdExpr = sd.slice(s0 + 'description: '.length, s1);
const sdEval = Function('name', '"use strict";return (' + sdExpr + ');');
for (const n of ['find_related_sessions', 'read_session_card']) { const j = load(n); eq(n + '.description', j.description, sdEval(n)); eq(n + '.parameters', JSON.stringify(j.parameters), '{}'); }

const uc = read('src/core/agent-runtime/unknown-call-review-tools.ts');
function desc(marker, next) { const i = uc.indexOf(marker); const j = uc.indexOf(next, i); return ev(uc.slice(i + 'description: '.length, j).trim().replace(/,$/, '')); }
function ds(from, to) { const seg = uc.slice(from, to); const re = /\.describe\(('(?:[^'\\]|\\.)*')\)/g; const v = []; let m; while ((m = re.exec(seg))) v.push(ev(m[1])); return v; }
const rd = ds(uc.indexOf('const inputSchema'), uc.indexOf('type RecordUnknownCallReviewArguments'));
const pd = ds(uc.indexOf('const proposalInputSchema'), uc.indexOf('type ProposeSaferMethodArguments'));
const rj = load('record_unknown_call_review');
eq('record.description', rj.description, desc("description: 'Record one review-round conclusion", 'inputSchema,'));
eq('record.params', JSON.stringify(rj.parameters), JSON.stringify({ item: rd[0], verdict: rd[1], evidence: rd[2], crashSuspicion: rd[3] }));
const pj = load('propose_safer_method');
eq('proposal.description', pj.description, desc("description: 'Propose one safer replacement command", 'inputSchema: proposalInputSchema,'));
eq('proposal.params', JSON.stringify(pj.parameters), JSON.stringify({ item: pd[0], command: pd[1], cwd: pd[2], rationale: pd[3] }));

const expected = new Set([...mailboxNames, ...decisionNames, 'look_graph', 'find_graph', 'find_related_sessions', 'read_session_card', 'record_unknown_call_review', 'propose_safer_method']);
const actual = fs.readdirSync(handoff).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
if (actual.length !== expected.size || actual.some(n => !expected.has(n))) { fails++; console.log('SET MISMATCH', actual); }
console.log(fails === 0 ? 'OK: 15 tools, all descriptions and parameters byte-identical to base' : fails + ' mismatches');
process.exit(fails === 0 ? 0 : 1);
