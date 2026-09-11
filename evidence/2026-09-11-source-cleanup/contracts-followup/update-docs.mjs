import fs from 'node:fs';
import path from 'node:path';
const evidence='evidence/2026-09-11-source-cleanup/contracts-followup';
const docs='../agent_learn/agent_dev/agent_platform';
function edit(file,replacements){const original=fs.readFileSync(file,'utf8');let body=original;
 for(const[from,to]of replacements){if(!body.includes(from))throw Error(`Missing text in ${file}: ${from}`);body=body.replace(from,to);}
 const rel=file.startsWith(docs)?`docs/${path.relative(docs,file).replaceAll('\\','/')}`:file;
 const history=`${evidence}/history/${rel}.txt`;if(!fs.existsSync(history)){fs.mkdirSync(path.dirname(history),{recursive:true});fs.writeFileSync(history,original,{flag:'wx'});}
 fs.writeFileSync(`${file}.cleanup-tmp`,body,{flag:'wx'});fs.renameSync(`${file}.cleanup-tmp`,file);
}
edit('src/contracts/README.md',[
 ['[rework.ts](rework.ts)、[rework-drive.ts](rework-drive.ts)、[rework-acceptance.ts](rework-acceptance.ts)','[问题材料](rework/issues.ts)、[提案](rework/proposal.ts)、[驱动](rework/drive.ts)、[Control受理](rework/acceptance.ts)'],
 ['仅供测试的构造器和替身在', '协议结构校验按入口在 [validation](validation/README.md) 中组织，消费者直接引用对应协议，无总转导出。公共问题结果与通用结构原语在 common.ts；原语只服务字段校验，不取代 Control 的正式准入政策。返工问题来源、当前处置与 ReworkDispositionPort 在同一问题协议；提案继续复用 PlanProposal。只有组合根消费的 ReworkIssueReadPort 位于 [harness/rework-composition.ts](../harness/rework-composition.ts)。\n\n仅供测试的构造器和替身在'],
]);
edit('src/control/plan-compiler/README.md', [['[contracts/rework.ts](../../contracts/rework.ts)','[contracts/rework/proposal.ts](../../contracts/rework/proposal.ts)']]);
edit(`${docs}/dev_docs/interfaces/module-boundaries.md`, [['持久字段、HTTP 路由/响应及正式权限不变。','持久字段、HTTP 路由/响应及正式权限不变。\n\n结构校验按协议位于 `contracts/validation/`，调用方直接引用 plan、dispatch、evidence、context、material-access 等入口；common 只共享校验问题形状与结构原语，不承接 Module 业务规则。返工协议在 `contracts/rework/` 分为 issues（Verification 来源与 Control 处置）、proposal（PlanCompiler 提案）、drive（Dispatch 请求/结果）、acceptance（Control 受理）。原 ReworkDispositionPort 与问题材料共同定义；只有宿主消费的 ReworkIssueReadPort 回到 `harness/rework-composition.ts`。这些子目录不是新增 Module，也不扩大依赖图。']]);
edit(`${docs}/dev_docs/interfaces/runtime-collaboration.md`, [['contracts/rework-disposition.ts、rework-drive.ts、run-output-materials.ts','contracts/rework/issues.ts、rework/drive.ts、run-output-materials.ts']]);
edit(`${docs}/dev_docs/modules/data/artifact-vault.md`, [['src/contracts/material-access.ts 与 src/contracts/validation.ts','src/contracts/material-access.ts 与 src/contracts/validation/material-access.ts']]);
