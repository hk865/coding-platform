import fs from 'node:fs';
import path from 'node:path';
const root='evidence/2026-09-11-source-cleanup/export-pruning',docs='../agent_learn/agent_dev/agent_platform';
for(const name of ['backend-types','ui-types','boundaries','targeted','full-tests','build','ui-artifacts','browser'])if(fs.readFileSync(`${root}/${name}.exit`,'utf8').trim()!=='0')throw Error(`Check not passed: ${name}`);
function write(file,body){const rel=file.startsWith(docs)?`docs/${path.relative(docs,file).replaceAll('\\','/')}`:file,archive=`${root}/history/${rel}.txt`;if(!fs.existsSync(archive)){fs.mkdirSync(path.dirname(archive),{recursive:true});fs.writeFileSync(archive,fs.readFileSync(file),{flag:'wx'});}fs.writeFileSync(`${file}.cleanup-tmp`,body,{flag:'wx'});fs.renameSync(`${file}.cleanup-tmp`,file);}
write('IMPLEMENTATION-HANDOFF.md',`# Agent Platform 当前交接

更新：2026-09-11。产品根 D:/1.project/Software/agent_platform；权威根 D:/1.project/Software/agent_learn/agent_dev/agent_platform。

指定语义编排链的本轮清理已实际收窄公共命名导出：删除9个无消费者声明（含GoalChangePort/PublicSnapshotPort两旧接口、两个旧类型别名、三个Reviewer clone包装及两个序列化包装），54个仅文件内部消费的声明取消export，5个Module内部类型移回实现，去掉3个无用转导出。contracts直接命名导出1531→1463，TS文件116→115；真实模块端口和外层结果字段保留。之前的16个协议校验入口、四个返工入口、测试材料分离和组合根整理继续有效。

1562个保留契约声明正文等价；独立复核另检查真实消费与类型归属。相关154项、全仓1951项和真实浏览器26项通过，后端/测试与前端类型、12 Module边界、完整构建和产物一致性通过；文档检查、原始日志、旧产物首检、源码身份与保留核对详见[本轮证据](evidence/2026-09-11-source-cleanup/export-pruning/verification.md)。前轮所有记录仍在同一有界evidence根，不覆盖历史失败。

持久字段、HTTP、拒绝码/消息、Control权威、旧FAIL/计划/未处置义务、精确材料授权、requiredOutputs声明性语义与Reviewer独立性不变。保留legacyFingerprintMatches、revisionAssignments与有真实消费者的恢复路径。源码named export收窄不保证未知外部deep-import兼容；仓内和已知邻仓消费者已核对。

下一步入口仍是VerificationService.openIssues→组合根issueMaterials→Dispatch；协调角色目前由ExecutionFeedbackCompiler提交正式只读Query，实际消费执行反馈。机械返工经ReworkPlanCompiler→acceptReworkProposal→Control的recordPlanChangeProposal/recordUserDecision/applyPlanChange。**工具FAIL→协调角色语义调查→正式语义调整提案仍未接通**，不能因有接口或机械返工测试通过而声称完成。全部有效未完义务继续由[唯一模块状态](../agent_learn/agent_dev/agent_platform/human/module-status.md)维护。

两个dirty工作树及既有改动保留；未reset/clean/stash、提交推送或重装依赖。原交接和改动前源码均保存在本轮history。本轮限定删减到此停止，不自动继续全仓架构工程；剩余导出不能仅因本轮未删就视为全部必要。
`);
const file=`${docs}/human/module-status.md`,body=fs.readFileSync(file,'utf8'),start=body.indexOf('## 本次源码与契约整理'),end=body.indexOf('## 当前语义协作增量',start);
if(start<0||end<0)throw Error('Status section missing');
const section=`## 本次源码与契约整理

前轮已完成测试材料分离、模块内部依赖归位、返工编译分责、Query组合接线以及16个协议校验入口/四个返工协议入口。本轮进一步删除9个无消费者声明，54个仅文件内使用的声明取消export，5个Module内部类型移回实现，删除3个无用转导出。contracts直接命名导出1531→1463、TS文件116→115。真实HumanCollaboration、SnapshotPort和所有公开结果字段保留，持久数据、HTTP、正式权限/义务与历史兼容不变。

相关154项、全仓299文件/1951项、真实浏览器26项通过；1562个保留契约声明等价，独立复核真实消费者和归属。类型、边界、构建、文档、旧产物检查、原文保留、起点/交付源码身份与剩余债统一见[本轮导出删减证据](../../../../agent_platform/evidence/2026-09-11-source-cleanup/export-pruning/verification.md)。同目录baseline.json/final.json记录dirty工作树，HEAD不代替源码；前轮证据及所有历史失败保留。本轮未实现新语义编排能力，也未断言剩余导出全部必要。

`;
write(file,body.slice(0,start)+section+body.slice(end));
