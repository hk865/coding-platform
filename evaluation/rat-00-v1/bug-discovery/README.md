# 主动找 Bug 固定正负样本

8 个匿名样本由 4 项内置 canary 的缺陷起点及修复后版本组成，映射和标签只在 evaluator-only 保存。该组用于接通发现/独立复现链，不作为新的陌生项目泛化基准。后续解题 Agent 必须使用全新上下文，只得到所选样本 instruction.md 与 workspace，不能继承 canary 解答、配对样本、评测记录或本目录其他材料。

public/manifest.json 固定样本顺序和逐文件摘要。每次运行只物化一个样本；模型发现必须在 RAT-05 绑定独立复现证据。负样本仅确认目标缺陷已修复，不宣称没有任何其他缺陷。

运行 `python3 evaluator-only/preflight.py` 可独立执行 8 个已有隐藏评分器；这是基线/参考解自检，不是模型发现成绩。
