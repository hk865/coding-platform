import fs from 'node:fs';import path from 'node:path';
const root=path.resolve('../agent_learn/agent_dev/agent_platform');
function edit(rel,a,b){const p=path.join(root,rel),s=fs.readFileSync(p,'utf8'),h=path.join(root,'dev_docs/verification/2026-09-11-architecture-convergence/history',rel+'.txt');fs.mkdirSync(path.dirname(h),{recursive:true});if(!fs.existsSync(h))fs.writeFileSync(h,s);fs.writeFileSync(p,s.replaceAll(a,b));}
edit('ARCHITECTURE.md','12 模块状态与带标记 DAG','12 Module 当前状态');
edit('dev_docs/decisions/0003-rework-role-spec-architecture-reconciliation.md','本次只记录决定，架构审查与实现仍保持用户要求的暂停；完整 Module/Interface 同步、行为修复与验收尚未恢复。本确认不表示已通过实现验收，也不授权启动下一阶段功能。','记录上述确认时曾按用户要求暂停。随后用户明确「继续执行架构修复」并确认其他执行者已暂停写入，本次审查、修复与验收据此恢复；结果以本次偏差摘要及实际证据为准。本决定不授权下一阶段功能。');
edit('dev_docs/modules/execution/worker-runtime.md','`runtime/coding-agent-runtime.ts`','`src/execution/worker-runtime/coding-agent-runtime.ts`');
edit('dev_docs/modules/data/workspace-reader.md','`data/source-workspace-reader.ts`','`src/data/workspace-reader/source-workspace-reader.ts`');
edit('dev_docs/modules/control/architecture-reconciler.md','下方2026-09-09','上方2026-09-09');
