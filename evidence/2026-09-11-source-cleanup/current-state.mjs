import fs from 'node:fs';import path from 'node:path';
const docs='../agent_learn/agent_dev/agent_platform',evidence='evidence/2026-09-11-source-cleanup';
const statusFile=docs+'/human/module-status.md',handoff='IMPLEMENTATION-HANDOFF.md';
for(const [file,name]of [[statusFile,'docs/human/module-status.md'],[handoff,handoff]]){const dest=evidence+'/history/'+name+'.txt';fs.mkdirSync(path.dirname(dest),{recursive:true});if(!fs.existsSync(dest))fs.copyFileSync(file,dest);}
let s=fs.readFileSync(statusFile,'utf8');const section=s.indexOf('## 当前语义协作增量');if(section<0)throw Error('Missing current status section');
s=`# 当前模块状态

更新：2026-09-11。本页是唯一当前实现状态入口；产品要求见 [PRODUCT](../PRODUCT.md)，模块责任和依赖见 [ARCHITECTURE](../ARCHITECTURE.md)。本次委托为指定语义编排生产链的技术债整理，沿用现有 12 Module，未新增产品能力。

当前事实：已有公开执行反馈驱动只读协调调查、精确授权补料、正式机械返工、当前版本工具重验和必要 Reviewer 准备。协调角色实际消费工具 FAIL 后形成语义计划调整仍未接通；下列全部有效未完义务保留。

## 本次源码整理

公共 contracts 已分离纯测试材料与宿主默认样例，内部 Verification 构造依赖和 StateLedger 结构校验回到所属 Module；返工编译按输入检查和提案组装分责，两宿主共用 Query 授权后投影接线并保留原实例生命周期。整理过时施工注释和旧路径，持久字段、HTTP、正式义务及权限规则不变。

本次全仓行为 299 文件/1951 项、浏览器 26 项均通过；类型、边界、构建、文档、独立复核、真实失败和剩余维护债统一见[清理证据](../../../../agent_platform/evidence/2026-09-11-source-cleanup/verification.md)。起点见[两个 dirty 仓库身份](../../../../agent_platform/evidence/2026-09-11-source-cleanup/baseline.json)，交付见同目录 final.json；HEAD 不代替工作树。原状态正文已在该目录 history/docs/human/module-status.md.txt 保存。

`+s.slice(section);
s=s.replace('已新增公开结构化执行反馈','已有公开结构化执行反馈').replace('Verification新增正式返工后的','Verification已有正式返工后的').replace('最终本轮实测与限制统一记录在','该语义增量实测与限制记录在').replace('本轮语义协作新增验收与限制见','此前语义协作增量验收与限制见').replace('本轮新增功能依据用户新的明确委托实施。','本次源码清理未扩展产品语义，验证以本页顶部清理证据为准。');
fs.writeFileSync(statusFile+'.cleanup-tmp',s,{flag:'wx'});fs.renameSync(statusFile+'.cleanup-tmp',statusFile);
const h=`# Agent Platform 当前交接

更新：2026-09-11。产品根 D:/1.project/Software/agent_platform；权威根 D:/1.project/Software/agent_learn/agent_dev/agent_platform。

本次已实施指定语义编排链的源码与文档整理，未实现新的语义编排能力。公共契约目录从135个TS文件收敛为101个：纯测试材料迁到tests/contract-support，真实宿主默认值留在src/fixtures和src/testing；内部依赖/校验回到Verification与StateLedger，规划工作身份材料并入planning协议。返工编译器分为输入校验/分组与提案组装；两种宿主共用Query授权后投影接线，保留原生命周期。旧施工指令、无消费者stub/barrel及失效路径已处理，原文归档。

全仓299文件/1951项、真实浏览器26项通过；兼容声明体1640项无差异，独立复核26个返工函数体一致。完整命令、类型/边界/构建/文档结果、真实失败、消费者迁移、历史兼容路径及最终源码身份只保存在[本轮证据](evidence/2026-09-11-source-cleanup/verification.md)。当前能力与全部有效未完义务由[模块状态](../agent_learn/agent_dev/agent_platform/human/module-status.md)维护；没有另建长期状态表。

下一项的真实入口：VerificationService.openIssues提供验证问题，组合根先读取后交Dispatch；ExecutionFeedbackCompiler→正式只读Query目前实际消费的是执行者公开反馈；机械返工通过ReworkPlanCompiler→acceptReworkProposal进入Control的recordPlanChangeProposal/recordUserDecision/applyPlanChange。service.ts的continueEndedRun连接普通Run终态及启动扫描、工具重验和必要Reviewer准备。**工具FAIL→协调角色语义调查→正式调整提案的连接仍未实现**，不能因整理后入口更清楚而声称完成。仍需调查刷新/决定回流、必要重审联合链和中途恢复验收。

保留12 Module和依赖图、Control唯一权威、旧FAIL/计划/未处置义务、精确跨工作授权、requiredOutputs声明性语义及Reviewer独立性。所有既有dirty改动保留；未reset/clean/stash、提交推送或重装依赖。旧交接原文在[归档副本](evidence/2026-09-11-source-cleanup/history/IMPLEMENTATION-HANDOFF.md.txt)。本次有限整理到此停止，不自动启动下一工程。
`;
fs.writeFileSync(handoff+'.cleanup-tmp',h,{flag:'wx'});fs.renameSync(handoff+'.cleanup-tmp',handoff);
