const fs = require('fs');
const path = require('path');
const repo = '/home/han001/dsh-work/slices/s9s85-S3';
const out = '/tmp/s85-scratch/S3/handoff/tools-2/tools';
const read = p => fs.readFileSync(path.join(repo, p), 'utf8');
const ev = s => Function('"use strict";return (' + s + ');')();

// graph-tools descriptions
const graph = read('src/core/agent-runtime/graph-tools.ts');
const start = graph.indexOf('const descriptions = {');
const end = graph.indexOf('} as const;', start) + '}'.length;
const graphDescs = ev(graph.slice(start + 'const descriptions = '.length, end));

// session discovery descriptions
const sd = read('src/core/agent-runtime/session-discovery-tools.ts');
const sdStart = sd.indexOf("description: name === 'find_related_sessions'");
const sdEnd = sd.indexOf(",\n      inputSchema", sdStart + 10);
const sdExpr = sd.slice(sdStart + 'description: '.length, sdEnd);
const sdEval = Function('name', '"use strict";return (' + sdExpr + ');');
const sdDescs = {
  find_related_sessions: sdEval('find_related_sessions'),
  read_session_card: sdEval('read_session_card'),
};

// unknown-call-review descriptions + describes
const uc = read('src/core/agent-runtime/unknown-call-review-tools.ts');
function extractDesc(marker, nextMarker) {
  const i = uc.indexOf(marker);
  const j = uc.indexOf(nextMarker, i);
  const expr = uc.slice(i + 'description: '.length, j).trim().replace(/,$/, '');
  return ev(expr);
}
const recordDesc = extractDesc("description: 'Record one review-round conclusion", 'inputSchema,');
const proposalDesc = extractDesc("description: 'Propose one safer replacement command", 'inputSchema: proposalInputSchema,');
function describesIn(from, to) {
  const seg = uc.slice(from, to);
  const re = /\.describe\(('(?:[^'\\]|\\.)*')\)/g;
  const vals = []; let m;
  while ((m = re.exec(seg)) !== null) vals.push(ev(m[1]));
  return vals;
}
const recordFrom = uc.indexOf('const inputSchema');
const recordTo = uc.indexOf('type RecordUnknownCallReviewArguments');
const proposalFrom = uc.indexOf('const proposalInputSchema');
const proposalTo = uc.indexOf('type ProposeSaferMethodArguments');
const recordDescribes = describesIn(recordFrom, recordTo);
const proposalDescribes = describesIn(proposalFrom, proposalTo);
if (recordDescribes.length !== 4 || proposalDescribes.length !== 4) throw new Error('describe count');

const comm = read('src/core/agent-runtime/communication-tools.ts');
const mailboxNames = ['send_session_message','read_session_inbox','read_session_message','read_session_message_body','ack_session_message','respond_session_message'];
const decisionNames = ['send_user_message','read_user_decision','record_decision_application'];
if (!comm.includes('`Session mailbox: ${name}`') || !comm.includes('`User decision: ${name}`')) throw new Error('prefix shape');

const tools = {};
for (const n of mailboxNames) tools[n] = { description: `Session mailbox: ${n}`, parameters: {} };
for (const n of decisionNames) tools[n] = { description: `User decision: ${n}`, parameters: {} };
tools.look_graph = { description: graphDescs.look_graph, parameters: {} };
tools.find_graph = { description: graphDescs.find_graph, parameters: {} };
tools.find_related_sessions = { description: sdDescs.find_related_sessions, parameters: {} };
tools.read_session_card = { description: sdDescs.read_session_card, parameters: {} };
tools.record_unknown_call_review = {
  description: recordDesc,
  parameters: {
    item: recordDescribes[0], verdict: recordDescribes[1], evidence: recordDescribes[2], crashSuspicion: recordDescribes[3],
  },
};
tools.propose_safer_method = {
  description: proposalDesc,
  parameters: {
    item: proposalDescribes[0], command: proposalDescribes[1], cwd: proposalDescribes[2], rationale: proposalDescribes[3],
  },
};
fs.mkdirSync(out, { recursive: true });
for (const [name, value] of Object.entries(tools)) {
  fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(value, null, 2) + '\n', 'utf8');
}
fs.writeFileSync('/tmp/s85-scratch/S3/handoff/tools-2/strings.json', '{}\n', 'utf8');
console.log(Object.keys(tools).length + ' tool files');
