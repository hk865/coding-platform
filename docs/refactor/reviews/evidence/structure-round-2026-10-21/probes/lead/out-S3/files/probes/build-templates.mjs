import { writeFileSync } from 'node:fs';
const dir = '/tmp/s85-scratch/S3/handoff/brief-k3/templates/';
const brief = [
  '## 接续说明',
  '{{marker}}{{body}}{{blockedOmission}}{{bodyOmission}}{{anomalies}}{{review}}{{blocked}}',
  '',
  '### 继续之前',
  '- 文件可能已经变化，编辑前先重新读取。',
  '- “结果未知”的工具调用可能已经产生副作用，重做之前先核实当前状态。',
  '- “没有执行”的工具调用没有产生结果，需要时重新发起。',
  '- 本说明只陈述持久记录中的事实；写明“无法确定”的地方不代表没有变化。',
].join('\n');
const review = [
  '## Unknown-call review',
  '这一轮只核对，不做任务，不改工作区；不许重跑下面的命令。',
  '',
  '### 工作区采集',
  '{{workspaceLines}}',
  '',
  '### 已经写过的结论',
  '{{writtenLines}}',
  '',
  '### 要核对的调用',
  '{{items}}',
  '',
  '### 每条要回答两件事',
  '1. 做没做完：已做 / 没做 / 做了一半 / 判断不了，附依据；',
  '2. 会不会就是 Host 崩溃的原因：不太可能 / 可能 / 判断不了，附依据（命令本身、留下的痕迹）。',
].join('\n');
const proposal = [
  '## Unknown-call review',
  '这一轮只核对，不做任务，不改工作区；不许重跑下面的命令。',
  '',
  '### 工作区采集',
  '{{workspaceLines}}',
  '',
  '### 已经写过的结论',
  '{{writtenLines}}',
  '',
  '### 提方案',
  '- 这一轮只给下面的条目提方案：每条调用一次 propose_safer_method，命令要能原样执行；不要跑原命令。{{targets}}{{personNote}}{{annotations}}{{platformTargets}}',
].join('\n');
writeFileSync(dir + 'continuation-brief.txt', brief);
writeFileSync(dir + 'unknown-call-review.txt', review);
writeFileSync(dir + 'unknown-call-proposal.txt', proposal);
for (const name of ['continuation-brief', 'unknown-call-review', 'unknown-call-proposal']) {
  const { readFileSync } = await import('node:fs');
  const b = readFileSync(dir + name + '.txt');
  console.log(name, b.length, 'last', b[b.length - 1], 'endsLF', b[b.length - 1] === 10);
}
