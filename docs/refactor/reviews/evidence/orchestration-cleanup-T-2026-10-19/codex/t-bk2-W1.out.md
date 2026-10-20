改完再施工

| 位置 | 问题 | 唯一改法 |
|---|---|---|
| .lead-ref/books-v2/t-items-TP.md:1007；.lead-ref/books/t-items-T2.md:448；.lead-ref/books-v2/t-run-TP.md:9 | TP-137 要删除 PASS-with-gaps 的投影分支，但对应旧断言仍交给第二波 T2-064 删除。分支在 src/core/work-graph/state/verification-machine.ts:729，旧断言在 tests/state/task-machine.test.ts:304、tests/state/task-machine.test.ts:322，不能分波落地。 | 将 T2-064 整项并入第一波 TP-137 的依赖组合，第二波标为已吸收；同步更新运行书和依赖表。 |
| .lead-ref/books-v2/t-book.md:46；.lead-ref/books-v2/t-items-TP.md:1153 | 总则要求保留部分的断言和期望原样不动，只明确允许两项下标调整；TP-156 却明确要求保留场景并调整计数，包括 steps 12→5、runsCounted 3→2。两处指令没有明确优先级。 | 总则补明：条目及书面核对改正已明确列出的精确断言调整可以执行，其余保留断言不得改；下标调整仍仅限 TP-063、TP-166。 |

```json
[
  {
    "where": ".lead-ref/books-v2/t-items-TP.md:1007；.lead-ref/books/t-items-T2.md:448；.lead-ref/books-v2/t-run-TP.md:9",
    "problem": "TP-137 要删除 PASS-with-gaps 的投影分支，但对应旧断言仍交给第二波 T2-064 删除。分支在 src/core/work-graph/state/verification-machine.ts:729，旧断言在 tests/state/task-machine.test.ts:304、tests/state/task-machine.test.ts:322，不能分波落地。",
    "fix": "将 T2-064 整项并入第一波 TP-137 的依赖组合，第二波标为已吸收；同步更新运行书和依赖表。"
  },
  {
    "where": ".lead-ref/books-v2/t-book.md:46；.lead-ref/books-v2/t-items-TP.md:1153",
    "problem": "总则要求保留部分的断言和期望原样不动，只明确允许两项下标调整；TP-156 却明确要求保留场景并调整计数，包括 steps 12→5、runsCounted 3→2。两处指令没有明确优先级。",
    "fix": "总则补明：条目及书面核对改正已明确列出的精确断言调整可以执行，其余保留断言不得改；下标调整仍仅限 TP-063、TP-166。"
  }
]
```