import fs from 'node:fs';
import path from 'node:path';
const evidence='evidence/2026-09-11-source-cleanup/contracts-followup';
const docs='../agent_learn/agent_dev/agent_platform';
for(const name of ['targeted','backend-types-final','ui-types-final','boundaries-final','full-tests','build','ui-artifacts','browser-isolated']){
 if(fs.readFileSync(`${evidence}/${name}.exit`,'utf8').trim()!=='0')throw Error(`Not passed: ${name}`);
}
function write(file,body){const rel=file.startsWith(docs)?`docs/${path.relative(docs,file).replaceAll('\\','/')}`:file,history=`${evidence}/history/${rel}.txt`;
 if(!fs.existsSync(history)){fs.mkdirSync(path.dirname(history),{recursive:true});fs.writeFileSync(history,fs.readFileSync(file),{flag:'wx'});}
 fs.writeFileSync(`${file}.cleanup-tmp`,body,{flag:'wx'});fs.renameSync(`${file}.cleanup-tmp`,file);
}
write('IMPLEMENTATION-HANDOFF.md',`# Agent Platform 当前交接

更新：2026-09-11。产品根 D:/1.project/Software/agent_platform；权威根 D:/1.project/Software/agent_learn/agent_dev/agent_platform。

已实施指定语义编排链的源码、契约与文档整理。续轮将3510行总校验拆成16个直接协议入口，返工协议整理为问题材料、提案、驱动、Control受理四个入口；组合根专用 ReworkIssueReadPort 移回 harness，删除无消费者同义别名。跨模块消费者直接引用对应协议，无汇总 barrel。保留前轮测试材料分离、模块内部依赖归位、返工编译器分责与宿主共享接线。

contracts 当前116个TS文件、85个顶层文件；校验器内部共享声明增加12个语法导出，不能据此声称公共导出全面减少。1572项保留契约声明比对无差异；独立复核170个迁移声明及真实消费者。全仓299文件/1951项、真实浏览器26项通过，类型/边界/完整构建/产物检查通过。Windows依赖解析、测试完成后的外层脚本解析、浏览器默认端口占用及旧产物首检失败均单独保留，未用PASS覆盖。完整验证、文档结果、消费者依据、历史兼容项和起点/交付源码身份见[续轮证据](evidence/2026-09-11-source-cleanup/contracts-followup/verification.md)，前轮记录留在同一有界evidence根。

下一步：VerificationService.openIssues提供验证问题，组合根读取后作为issueMaterials交Dispatch；ExecutionFeedbackCompiler→正式只读Query目前实际调查执行者公开反馈。现有机械返工由ReworkPlanCompiler提案，Dispatch经acceptReworkProposal进入Control的recordPlanChangeProposal/recordUserDecision/applyPlanChange。**工具FAIL进入协调角色语义调查、协调结果形成正式调整提案并受理的连接仍未实现**。service.ts的continueEndedRun连接普通Run终态/启动扫描、重验和必要Reviewer准备，不代表语义改计划完成。

Control唯一正式权威、12 Module和依赖图、旧FAIL/计划/未处置义务、精确材料授权、requiredOutputs声明性语义与Reviewer独立性不变。持久字段和HTTP形状不变；内部源码路径迁移不保证未知外部deep-import。所有有效未完义务继续由[唯一模块状态](../agent_learn/agent_dev/agent_platform/human/module-status.md)维护。两个仓库已有dirty改动保留；未提交推送或重装依赖。前交接原文已保存在续轮history，本次有限清理完成后停止。
`);
const statusPath=`${docs}/human/module-status.md`;
const original=fs.readFileSync(statusPath,'utf8');
const start=original.indexOf('## 本次源码整理'),end=original.indexOf('## 当前语义协作增量',start);
if(start<0||end<0)throw Error('Current status section missing');
const section=`## 本次源码与契约整理

公共 contracts 已分离纯测试材料与宿主默认样例，内部 Verification 构造依赖和 StateLedger 结构校验回到所属 Module；返工编译按输入检查和提案组装分责，两宿主共用 Query 授权后投影接线。续轮进一步将3510行总校验拆为16个协议入口，返工契约收为问题材料、提案、驱动、Control受理四个入口；宿主专用读取器移回 harness，同义无消费者别名删除。当前116个contracts TS文件、85个顶层文件，不以文件或语法导出数量减少作为完成依据。历史施工注释与旧路径已在涉及范围整理，持久字段、HTTP、正式义务及权限规则不变。

本轮全仓行为299文件/1951项、浏览器26项通过；1572个保留契约声明等价，独立复核170个迁移声明。类型、边界、构建、文档、独立复核、环境/验证脚本真实失败和剩余维护债统一见[续轮清理证据](../../../../agent_platform/evidence/2026-09-11-source-cleanup/contracts-followup/verification.md)。起点见该目录baseline.json，交付见final.json；HEAD不代替dirty工作树。前轮记录和两个状态文件原文保存在同一有界evidence根，各次失败未覆盖。

`;
write(statusPath,original.slice(0,start)+section+original.slice(end));
