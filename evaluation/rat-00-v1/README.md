# RAT-00 固定测试准备包 v1

本目录是评测操作者的材料库，不是解题 Agent 的工作区。先查看 `benchmark-task-manifest.json`，再选择单题物化器；后续 Worker 仅接收该次生成的源码目录与题面。隐藏评分器、oracle、标签、其他试验和完整数据均留在操作边界外。所有解题 Worker 使用全新上下文，不能继承准备者读过的隐藏答案。

## 版本与资源

- 干净内核快照及当前平台源码摘要：`../../evidence/rat-00/source-baseline.json`。快照保留源码及其独立 Git 提交，依赖按锁文件离线安装并重新构建；原工作区保留。
- 预算：`budget-policy.json`。本次小型协作场景与未来大型模块角色的预算分档保存；累计输入输出与模型单次上下文/输出容量分开。当前模型及费用上限未绑定，不能发起真实 trial。
- 逐文件冻结索引：`asset-index.json`。材料发生变化时校验拒绝；需要变更则登记新版本并保留旧试验。
- 环境：`../../evidence/rat-00/evaluation-environment-report.json`。从平台根目录在当前 shell 执行 `source .local/toolchains/activate.sh`；默认生产 sandbox 的 Node 环境仍需接线，不能把宿主可用当作沙箱可用。

## 物化单个任务

```sh
python3 evaluation/rat-00-v1/scripts/materialize-local-task.py canary ts-nullish-timeout /tmp/rat00-one-canary
python3 evaluation/rat-00-v1/scripts/materialize-local-task.py bug-discovery BD-01 /tmp/rat00-one-bug
python3 evaluation/rat-00-v1/repoqa/materialize-workspace.py --task-id repoqa-express-01 --destination /tmp/rat00-one-repoqa
node evaluation/rat-00-v1/multi-agent/materialize.mjs MA-01 /tmp/rat00-one-ma
```

这些命令从平台根目录执行，目标目录必须不存在。物化仅建立输入白名单；OS 隔离、只读/写权限、环境层保护以及 API 凭证不得透传给工具进程等仍由正式运行接线保证。

## 不调用模型的复核

```sh
python3 evaluation/rat-00-v1/scripts/verify-preparation.py
node evaluation/rat-00-v1/scripts/canary-preflight.mjs /tmp/rat00-canary-preflight-new
python3 evaluation/rat-00-v1/bug-discovery/evaluator-only/preflight.py /tmp/rat00-bug-preflight-new
.local/evaluation/rat-00/repoqa/scorer-env/bin/python evaluation/rat-00-v1/repoqa/preflight.py
```

MA 的功能、控制断言、注入选择器及材料烟测入口见其 README。全部原始结果见 `../../evidence/rat-00/` 与 `.local/evaluation/rat-00/`；已知失败对照通过是评分器能识别错误，不是产品能力通过。

## 当前边界

这批材料覆盖 4 个 canary、8 个缺陷正负样本、10 个 Express 定位题和8个MA场景。42次MA真实试验已登记且全部 NOT_RUN；公开容器诊断仍需 Docker/镜像，官方16k SNF上下文仍需单独固定 tokenizer。生产事件导出/鉴别与23处故障的产品适配要在对应后续票实现，当前只准备了规格和确定性选择器。

GUI/API 接线、累计预算计量和安全停止均未在本阶段实现。按照用户逐阶段要求，先汇报 RAT-00 准备结果及阻塞，再等待确认进入 RAT-01。
