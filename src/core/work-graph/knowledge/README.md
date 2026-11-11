# src/core/work-graph/knowledge：代码知识文件的唯一写入顺序

## 负责什么，不负责什么
- 代码知识落在每个工作区根的 `.workbench/` 里（`architecture.json`、`modules/<fileId>.json`、`notes/<workspaceId>/<noteId>.md`）；文件是知识，提交的事件是写入记录。这里只有一件事：架构和注记的每个写点按同一个顺序写——取项目全部线，服务在 `prepare` 里读当前知识、规划、校验、算出文件改动，提交记录，提交成了才逐个落盘。
- 回放的回执（`replayed`）不碰文件；记录提交了而文件没写成，照实回“记录已提交、知识文件没写成”，不当成功。
- 不读写磁盘：读写文件的是组合根（`src/composition/line-knowledge.ts`）实现的 `LineKnowledge`，端口在 `model/line-knowledge.ts`；文件格式在 `architecture/architecture-file.ts` 和 `notes/note-file.ts`。
- 依赖只有 `model`（`docs/refactor/module-target.json`）；`architecture`、`notes` 依赖本层。放进这里的文件不得 import `architecture/`、`notes/`，否则成环。

## 文件
- `knowledge-write.ts` — 一次知识写的顺序 `writeKnowledge`、写点交回的提交 `knowledgeCommit`、文件没写成时的原因 `knowledgeFilesNotWritten`，以及 `KnowledgePrepared`/`KnowledgeWriteOutcome`/`KnowledgeWritePlan` 等形状。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `writeKnowledge` | `src/core/work-graph/knowledge/knowledge-write.ts:72` | 取项目全部线 → `prepare`（返回 `exit` 就原样交回，什么都没提交）→ 提交 → 不是 `committed` 回 `rejected` → `replayed` 不碰文件 → 逐条线、逐个改动 `applyChange`，第一处失败就停 | 新的架构或注记写点；不要自己先提交再写文件，也不要在别处另写这个顺序 |
| `knowledgeCommit` | `src/core/work-graph/knowledge/knowledge-write.ts:55` | 写点的 `ready.commit`：把最终顺序的事件交给 `extrasOf`、并进同一次提交；提交抛错记进 `thrown`，回 `unavailable` | 每个写点组好 `PreparedCommit` 后交回它；服务按 `thrown` 走自己原来的“按身份重查” |
| `knowledgeFilesNotWritten` | `src/core/work-graph/knowledge/knowledge-write.ts:68` | 记录已提交、文件没写成时给人的原因（带路径） | `files` 回 `rejected` 时；不要另写这句 |

## 内部用
`KnowledgeWritePlan`、`KnowledgeCommitExtras`、`KnowledgeExtrasOf`、`KnowledgePrepared`、`KnowledgeWriteOutcome`、`KnowledgeCommitThrow` 是本层的形状。

## 不要做
- 不要在 `prepare` 外读规划要用的当前知识，也不要在提交前写文件。
- 不要把文件写失败吞掉或当成功；不要重试。
