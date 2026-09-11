# RAT-00 / RepoQA Express 固定任务包

本包固定官方 RepoQA 发布数据中的 Express 单仓全部 10 个 needle，保留发布数组顺序；尚未运行模型，不产生 Agent 能力成绩。

`manifest.json` 是公开题号、顺序、版本和摘要清单。`agent-input/source/` 仅包含发布数据使用的 11 个 Express 源文件和 MIT 许可证，`agent-input/prompts/` 包含 10 个独立题面。每次试验只复制对应一个题面和允许源码；不能把本目录、平台根目录或全部题目一并作为 Worker workspace。

## 固定来源

- RepoQA 工具：[evalplus/repoqa](https://github.com/evalplus/repoqa/tree/ae876deb1365dbf5a15b0533723c8ed123eee586)，commit `ae876deb1365dbf5a15b0533723c8ed123eee586`。
- 数据：[2024-06-23 发布](https://github.com/evalplus/repoqa_release/releases/tag/2024-06-23)，发布仓 commit `e3a571033de99d0b9dcaccd25577a75d4b1c70b1`。该 tag 对应资产实际发布于 `2024-10-07T19:18:17Z`；数据版本标签不等同资产发布日期。
- 官方资产只有一个 12,525,636 字节 gzip 文件。本阶段有界下载此必要资产，未 clone 完整仓库。完整数据保留于 `.local/evaluation/rat-00/repoqa/evaluator-only/upstream/`；允许给 Agent 的内容只取 Express 单仓。
- [选仓文件](https://github.com/evalplus/repoqa/blob/ae876deb1365dbf5a15b0533723c8ed123eee586/scripts/cherrypick/lists.json) 和发布数据均指向 Express commit `815f799310a5627c000d4a5156c1c958e4947b4c`、入口 `lib`、分组 `typescript`。全部 11 个源文件已与该 commit 官方原文件逐字节比对一致；实际文件为 JavaScript。
- 官方工具和发布数据 Apache-2.0、Express 源码 MIT，原许可文本已保留。逐文件 URL、字节数与 SHA-256 见 `evidence/rat-00/repoqa/provenance.json`（路径相对平台根）。

## 两种评测分别报告

`agent-input` 题面要求用文件工具定位、返回路径、完整函数及简短证据，因此属于 **RepoQA 派生的工具导航验收**。其源码读取量、路径引用正确率、延迟与函数匹配指标单独记录，不能称为官方长上下文 SNF 成绩。

官方 SNF 用 `search_needle_function.py` 构造依赖顺序代码上下文和位置比率；本包冻结 16,384 上下文 token、1,024 最大生成 token、默认保留注释、阈值 0.8。冻结源码实际使用 `codellama/CodeLlama-7b-Instruct-hf` tokenizer；README 中的 DeepSeekCoder 表述与源码不一致，应按该固定源码执行。tokenizer revision 和资产目前未冻结，官方上下文未生成，SNF 为 `BLOCKED`；函数评分器所需依赖已在专用环境安装并通过 30 项对照。

官方评分代码完整保存在私有上游目录；只允许调用固定版本的 `repoqa.compute_score.needle_evaluator`。该函数先解析输出，再调用官方相似度算法，与同仓 needle 比较最佳候选，按 0.8 判定。`preflight.py` 不重造算法、不使用依赖 stub、不发模型请求；缺依赖时保存 `BLOCKED`，不会把材料结构检查记成评分器通过。

## 私有材料与工作区

以下材料仅在 `.local/evaluation/rat-00/repoqa/evaluator-only/`：单仓官方格式 `express-dataset.json`、含真实函数名/路径/答案的 `needle-manifest.json`、10 题共 30 个预检输入 `official-scorer-controls.json`、完整发布数据、评分器源码。`.local/` 已被平台 Git 忽略；私有根目录权限为 0700。位置分离和文件权限不能替代运行时隔离：启动模型前必须从实际沙箱内证明不能读取 evaluator、平台父目录、其他 trial 和凭证。

每题正对照与重复正对照使用该题官方参考函数；负对照使用下一题的参考函数（最后一题轮回第一题）。这些只是验证固定官方评分器的已知输入，未计为模型作答或成绩。30 个对照已通过固定官方评分器；这不替代官方长上下文构造或实际模型测试。

在平台根运行：

```sh
python3 evaluation/rat-00-v1/repoqa/prepare.py
.local/evaluation/rat-00/repoqa/scorer-env/bin/python evaluation/rat-00-v1/repoqa/preflight.py
python3 evaluation/rat-00-v1/repoqa/materialize-workspace.py --task-id repoqa-express-01 --destination /absolute/new/trial-workspace
```

`prepare.py` 仅使用已冻结的本地官方数据，重跑时不同内容会报错，不能静默改题。`materialize-workspace.py` 要求全新目标目录，并只复制选中题面的 `TASK.md`、11 个源码文件和许可证。该工具不创建沙箱、不启动 Agent。当前全部 10 个样本工作区已分别物化到 `.local/evaluation/rat-00/repoqa/agent-workspaces/`，每个 13 文件；后续每个 trial 应重新从固定模板创建独立目录。

## 当前证据和缺项

- `evidence/rat-00/repoqa/preflight.json`：46 项材料完整性、版本和静态边界检查 PASS；官方评分器 30/30 对照 PASS，零模型调用。
- `evidence/rat-00/repoqa/workspace-preflight.json`：10 个独立工作区创建和输入白名单检查 PASS；实际 OS 沙箱边界尚未测试。
- 初次系统 Python 评分依赖缺失的真实记录保留为 `preflight-before-dependencies.json`。随后在 `.local/evaluation/rat-00/repoqa/scorer-env/` 创建专用 Python 3.12.3 环境，按 `scorer-requirements.lock` 安装 32 个固定版本及 SHA-256 的包；必要包归档总计 50,701,085 字节。未安装 torch、TensorFlow、Flax，未下载模型权重或 tokenizer 资产。下载大小/来源见 `scorer-dependency-plan.json`。
- 评分入口强制 Hugging Face 和 Transformers 离线模式，记录实际 Python 路径、锁文件摘要和依赖版本；直接调用冻结源码 `needle_evaluator`，未修改任何官方算法。
- 专用环境创建命令为 `python3 -m venv --without-pip .local/evaluation/rat-00/repoqa/scorer-env`；使用系统 pip 的 `--python <scorer-env>/bin/python install --require-hashes --no-deps -r <scorer-requirements.lock>` 安装固定包，避开系统环境修改。
- 还需在后续阶段冻结实际 provider/model、共享总预算和 trial 次数并接通真实 Worker。此包只冻结题面、来源和评分协议，不擅自推断模型或付费预算。
