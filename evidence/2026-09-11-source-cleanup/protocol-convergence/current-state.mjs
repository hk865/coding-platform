import fs from 'node:fs';
import {edit,root} from './edit.mjs';
for(const name of ['backend-types-release','ui-types-release','boundaries-release','targeted-release','full-tests','build','ui-artifacts','browser'])if(fs.readFileSync(`${root}/${name}.exit`,'utf8').trim()!=='0')throw Error(`Not passed: ${name}`);
edit('IMPLEMENTATION-HANDOFF.md',()=>[
'# Agent Platform 当前交接',
'',
'更新：2026-09-11。产品根 D:/1.project/Software/agent_platform；权威根 D:/1.project/Software/agent_learn/agent_dev/agent_platform。',
'',
'原清理委托已继续处理有消费者的重复协议：PlanProposalPort及独立ReworkPlanDraftV1删除；提案结果、规划Context端口/请求/结果收口到contracts/planning.ts，返工与普通变更草稿引用PlanRevisionDraft字段权威，保留必填、省略与null差异。初始协调使用requestInitial，变更提案仍为request；app与测试调用迁移，原amendment-only注入不增加能力要求。',
'',
'两宿主删除九类共18个纯转发：提案请求、规划/Query/同工作/历史工作Context、三步计划受理及amend。调用方直接使用既有模块对象，带授权投影和Verification问题预取的组合仍保留。contracts文件115→115、接口声明92→91、直接命名导出1463→1465；净增来自实现类型归位，不声称导出总数下降。前轮fixture/testing分离、校验协议拆分、返工实现分责和无消费者删减继续有效。',
'',
'五组关键类型双向等价，契约运行时代码不变；独立复核发现的窄注入、assignments显式undefined和初始kind守卫问题均已修复。相关191项、全仓299文件1953项、真实浏览器26项通过；后端/测试及前端类型、12 Module边界、完整构建/HTTP产物通过。文档检查、源码身份、历史保留、失败原始日志及复核详见[本轮证据](evidence/2026-09-11-source-cleanup/protocol-convergence/verification.md)。',
'',
'持久QueryJob/计划/Evidence、HTTP、权限守卫和历史读取不变；源码旧导入、旧初始request调用及已删harness方法需要按本轮映射迁移，不保证未知外部源码调用兼容。旧FAIL、未处置义务、精确跨工作授权、requiredOutputs声明性语义、Reviewer独立性和未知副作用拒绝重跑仍有效。',
'',
'下一步失败材料仍由VerificationService.openIssues经组合根issueMaterials交Dispatch。ExecutionFeedbackCompiler请求只读协调Query，目前实际消费公开执行反馈；ReworkPlanCompiler机械提案经Dispatch提交acceptReworkProposal，Control用recordPlanChangeProposal/recordUserDecision/applyPlanChange受理。**工具FAIL→协调语义调查→正式语义计划调整尚未接通**，未因整理接口而实现。',
'',
'[唯一模块状态](../agent_learn/agent_dev/agent_platform/human/module-status.md)保留全部有效未完义务。两仓原dirty改动与历史证据保留，未提交推送或重装依赖；本轮限定清理结束，不自动开展其他架构工程。',
''
].join('\n'));
edit('../agent_learn/agent_dev/agent_platform/human/module-status.md',s=>{
 const a=s.indexOf('## 本次源码与契约整理'),b=s.indexOf('## 当前语义协作增量',a);
 if(a<0||b<0)throw Error('State section missing');
 const section=[
'## 本次源码与契约整理','',
'前轮的材料/测试分离、校验协议拆分、返工实现分责及无消费者删减保持。本轮进一步收敛有消费者的重复：删除PlanProposalPort与ReworkPlanDraftV1，提案/规划Context协议统一到planning.ts，计划字段由PlanRevisionDraft派生并保留普通变更与返工差异；初始请求迁移至requestInitial。两宿主九类共18个纯转发删除，调用者使用现有模块对象，Control和Context的真实行为保留。contracts文件115→115、接口92→91、直接命名导出1463→1465；命名导出净增源于类型归位，不将其报告成数量下降。','',
'五组类型独立双向等价，相关191项、全仓299文件1953项与26项浏览器通过；类型、边界、构建/HTTP、文档、原始失败与保留核对统一见[本轮协议收敛证据](../../../../agent_platform/evidence/2026-09-11-source-cleanup/protocol-convergence/verification.md)。源码API迁移不保证未知外部旧导入/旧方法兼容；持久数据与HTTP、正式权限/义务和旧FAIL保留。前轮证据全部留存，后续语义FAIL协调能力未实现。','',
 ].join('\n');
 return s.slice(0,a)+section+'\n'+s.slice(b);
});
