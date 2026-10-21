const fs = require('fs');
const base = '/tmp/s85-scratch/S3/base';
const read = p => fs.readFileSync(base + '/' + p, 'utf8');
const outDir = '/tmp/s85-scratch/S3/handoff/rest';
const strings = {};
const manifest = { strings: {}, templates: {}, tools: {}, notes: [] };
function lit(src, re, name) {
  const m = src.match(re);
  if (!m) throw new Error('no match ' + name);
  return eval(m[1]);
}
function put(key, value, loc) { strings[key] = value; manifest.strings[key] = loc; }

// role profiles
const roleSrc = read('src/core/agent-runtime/role-profiles.ts');
for (const duty of ['executor','secretary','adviser','scribe','reviewer']) {
  const re = new RegExp("duty: '" + duty + "',\\n    label: ('(?:[^'\\\\]|\\\\.)*'),\\n    purpose: (\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')");
  const m = roleSrc.match(re);
  if (!m) throw new Error('role ' + duty);
  put('role.'+duty+'.label', eval(m[1]), 'src/core/agent-runtime/role-profiles.ts:' + (roleSrc.slice(0,m.index).split('\n').length+1));
  put('role.'+duty+'.purpose', eval(m[2]), 'src/core/agent-runtime/role-profiles.ts:' + (roleSrc.slice(0,m.index).split('\n').length+2));
}

// architecture
const archSrc = read('src/core/agent-runtime/architecture-reminders.ts');
const lines = archSrc.split('\n');
const lineOf = (needle, start=0) => { const i = lines.findIndex((l,idx)=>idx>=start && l.includes(needle)); if(i<0) throw new Error('line '+needle); return i+1; };
const kindBlock = archSrc.match(/const KIND_LABELS = \[([\s\S]*?)\] as const;/)[1];
const kindLits = [...kindBlock.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m=>eval("'"+m[1]+"'"));
put('architecture.kind.dependencyMissing', kindLits[0], 'src/core/agent-runtime/architecture-reminders.ts:'+lineOf("'声明的依赖没有 import'"));
put('architecture.kind.importUndeclared', kindLits[1], 'src/core/agent-runtime/architecture-reminders.ts:'+lineOf("'import 没有声明的依赖'"));
put('architecture.kind.ungrouped', kindLits[2], 'src/core/agent-runtime/architecture-reminders.ts:'+lineOf("'新文件没归组'"));
put('architecture.kind.move', kindLits[3], 'src/core/agent-runtime/architecture-reminders.ts:'+lineOf("'可能移动'"));
put('architecture.time.justNow', lit(archSrc, /if \(elapsed < minute\) return ('(?:[^'\\]|\\.)*');/, 'justNow'), 'src/core/agent-runtime/architecture-reminders.ts:'+lineOf("return '刚才'"));
put('architecture.time.minutesAgo', ' ' + archSrc.match(/return `\$\{String\(Math\.floor\(elapsed \/ minute\)\)\} ([^`]*)`;/)[1], 'src/core/agent-runtime/architecture-reminders.ts:'+lineOf(' 分钟前'));
put('architecture.time.hoursAgo', ' ' + archSrc.match(/return `\$\{String\(Math\.floor\(elapsed \/ hour\)\)\} ([^`]*)`;/)[1], 'src/core/agent-runtime/architecture-reminders.ts:'+lineOf(' 小时前'));
put('architecture.time.daysAgo', ' ' + archSrc.match(/return `\$\{String\(Math\.floor\(elapsed \/ day\)\)\} ([^`]*)`;/)[1], 'src/core/agent-runtime/architecture-reminders.ts:'+lineOf(' 天前'));
put('architecture.certaintyUnknown', lit(archSrc, /finding\.certainty === 'unknown' \? ('(?:[^'\\]|\\.)*') : ''/, 'uncertain'), 'src/core/agent-runtime/architecture-reminders.ts:'+lineOf("'，不确定'"));
put('architecture.observationSuffix', '的观测）', 'src/core/agent-runtime/architecture-reminders.ts:'+lineOf('的观测）'));
put('architecture.noObservation', lit(archSrc, /text: ('(?:[^'\\]|\\.)*') \}\]/, 'noObs'), 'src/core/agent-runtime/architecture-reminders.ts:'+lineOf("text: '还没有观测'"));
const omission = archSrc.match(/const text = `另有 \$\{String\(omitted\)\} ([^`]*)`;/);
if (!omission) throw new Error('omission');
put('architecture.omissionPrefix', '另有 ', 'src/core/agent-runtime/architecture-reminders.ts:'+lineOf('另有 '));
put('architecture.omissionSuffix', ' ' + omission[1], 'src/core/agent-runtime/architecture-reminders.ts:'+lineOf('条架构提醒没列出'));

// note
const noteSrc = read('src/contracts/note.ts');
const noteLines = noteSrc.split('\n');
const noteLine = needle => { const i = noteLines.findIndex(l=>l.includes(needle)); if(i<0) throw new Error('note '+needle); return i+1; };
for (const kind of ['convention','pitfall','tradeoff','open_question','preference','decision','understanding','repair']) {
  const re = new RegExp(kind + ": ('(?:[^'\\\\]|\\\\.)*')");
  const m = noteSrc.match(re); if(!m) throw new Error('note kind '+kind);
  put('note.kind.'+kind, eval(m[1]), 'src/contracts/note.ts:'+noteLine(kind+': '));
}
const noteAnchors = [
  ['note.anchor.modulePrefix', /case 'module': display = `([^`$]*)\$\{anchor\.moduleId\}`/, '模块 '],
  ['note.anchor.interfacePrefix', /case 'interface': display = `([^`$]*)\$\{anchor\.moduleId\}/, '接口 '],
  ['note.anchor.symbolPrefix', /anchor\.symbol === undefined \? '' : `([^`$]*)\$\{anchor\.symbol\.qualifiedName\}`/, '#'],
  ['note.anchor.deletedSuffix', /anchor\.deleted === true \? ('(?:[^'\\]|\\.)*') : ''/, '（已删）'],
  ['note.anchor.goalPrefix', /case 'goal': display = `([^`$]*)\$\{anchor\.goalId\}`/, '目标 '],
  ['note.anchor.stagePrefix', /case 'stage': display = `([^`$]*)\$\{anchor\.stageId\}`/, '阶段 '],
  ['note.anchor.taskPrefix', /case 'task': display = `([^`$]*)\$\{anchor\.taskId\}`/, '任务 '],
];
for (const [key, re, needle] of noteAnchors) {
  const m = noteSrc.match(re); if(!m) throw new Error(key);
  const v = m[1].startsWith("'") ? eval(m[1]) : m[1];
  put(key, v, 'src/contracts/note.ts:'+noteLine(needle));
}
put('note.anchor.project', '项目', 'src/contracts/note.ts:'+noteLine("case 'project'"));

// context extensions
const ctxSrc = read('src/core/work-graph/views/context-extensions.ts');
const ctxLines = ctxSrc.split('\n');
const ctxLine = needle => { const i = ctxLines.findIndex(l=>l.includes(needle)); if(i<0) throw new Error('ctx '+needle); return i+1; };
put('contextExtension.decisionPrefix', '待决定：', 'src/core/work-graph/views/context-extensions.ts:'+ctxLine('待决定：'));
put('contextExtension.unavailablePrefix', '待决来源尚未接入：', 'src/core/work-graph/views/context-extensions.ts:'+ctxLine('待决来源尚未接入：'));
put('contextExtension.interruption.retiredArchive', '因线退役被归档中断', 'src/core/work-graph/views/context-extensions.ts:'+ctxLine('因线退役被归档中断'));
put('contextExtension.interruption.archive', '被归档中断', 'src/core/work-graph/views/context-extensions.ts:'+ctxLine(": '被归档中断'"));
put('contextExtension.anchorPrefix', '中断，待核对：任务 ', 'src/core/work-graph/views/context-extensions.ts:'+ctxLine('中断，待核对'));
put('contextExtension.anchorRunSeparator', ' 的执行 ', 'src/core/work-graph/views/context-extensions.ts:'+ctxLine(' 的执行 '));
put('contextExtension.anchorSuffix', '，改动没撤销也没核对', 'src/core/work-graph/views/context-extensions.ts:'+ctxLine('，改动没撤销也没核对'));

// scribe marker
const hostSrc = read('src/app/host.ts');
put('scribe.marker', lit(hostSrc, /const SCRIBE_REMINDER_MARKER = ('(?:[^'\\]|\\.)*');/, 'marker'), 'src/app/host.ts:190');

// templates
const querySrc = read('src/core/agent-runtime/query-preparation.ts');
const guideRaw = querySrc.match(/export const INITIAL_COORDINATION_RESPONSE_GUIDE = (`[\s\S]*?`);\n/)[1];
const guide = eval(guideRaw);
fs.writeFileSync(outDir + '/templates/initial-planning-answer.txt', Buffer.from(guide, 'utf8'));
manifest.templates['initial-planning-answer'] = 'src/core/agent-runtime/query-preparation.ts:50';

const consultationSrc = read('src/business/workflow/consultation.ts');
const consRaw = consultationSrc.split('\n')[446].match(/: `([\s\S]*)`,?$/)[1];
let cons = consRaw.replace('${message.ref.messageId}', '{{messageId}}').replace('${JSON.stringify(message.sourceRef)}', '{{sourceJson}}');
cons = eval('`' + cons + '`');
fs.writeFileSync(outDir + '/templates/consultation-received-input.txt', Buffer.from(cons, 'utf8'));
manifest.templates['consultation-received-input'] = 'src/business/workflow/consultation.ts:447';

fs.writeFileSync(outDir + '/templates/user-decision-response.txt', Buffer.from('用户答复\n{{bodyJson}}', 'utf8'));
manifest.templates['user-decision-response'] = 'src/core/agent-runtime/execution-inputs.ts:59';

const hostLines = hostSrc.split('\n');
const scribeLine1 = hostLines[1433]; const scribeLine2 = hostLines[1434];
let scribe = scribeLine1.match(/const text = `([\s\S]*)`/)[1] + scribeLine2.match(/\+ `([\s\S]*)`;/)[1];
scribe = scribe.replace('${SCRIBE_REMINDER_MARKER}', '{{marker}}').replace('${String(pendingCount)}', '{{pendingCount}}').replace('${String(updateDueCount)}', '{{updateDueCount}}').replace('${[...anchorNames].slice(0, 20).join(\'、\')}', '{{anchors}}');
scribe = eval('`' + scribe + '`');
fs.writeFileSync(outDir + '/templates/scribe-reminder.txt', Buffer.from(scribe, 'utf8'));
manifest.templates['scribe-reminder'] = 'src/app/host.ts:1434';

fs.writeFileSync(outDir + '/strings.json', JSON.stringify(strings, null, 2) + '\n');
fs.writeFileSync(outDir + '/MANIFEST.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('strings', Object.keys(strings).length);
for (const t of Object.keys(manifest.templates)) console.log(t, JSON.stringify(fs.readFileSync(outDir+'/templates/'+t+'.txt','utf8')));
