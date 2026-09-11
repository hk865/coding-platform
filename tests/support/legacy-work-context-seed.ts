/**
 * RC-03 测试夹具：**遗留账本**里的工作身份形状。
 *
 * ── 这个文件为什么存在 ────────────────────────────────────────────────────────
 * RC-03 之后，「同一 (项目, 工作区, 目标, 任务) 有两条 WorkContextBinding」不再可能由任何
 * 生产入口产生：Control 守卫拒绝第二条身份，账本的身份槽在事务里挡住并发/跨进程的第二条。
 * 但**旧数据库里已经存在**这种形状（RC-03 之前建立的历史事实），而解析面（唯一权威）与
 * 已完成工作视图都必须继续正确消费它：给出唯一答案、把落选身份作为可读的不可变历史保留、
 * 把归并事实可见地投影出来。这些行为不能用"现在造不出这种输入"来当作不必证明。
 *
 * 因此这里提供**唯一**一条构造遗留账本的测试入口：它把 RC-03 之前那次提交会写下的东西
 * （一条 WorkContextBound 事件 + 一份 WorkContextBinding 快照）直接写进存储，**故意不写
 * identity_claims**——这正是遗留数据库与现在的数据库的差别。
 *
 * ── 这不是旁路，理由写清楚 ────────────────────────────────────────────────────
 *   1. 它只存在于 tests/，不被任何生产代码引用，也不进入任何命令路径；
 *   2. 它不改变唯一性判定的实现：判定仍在 Control 守卫与账本提交语义里，且**因为**有这条
 *      夹具，那些判定才被反过来验证（同一命令走真实入口时会被拒绝，见各用例的断言）；
 *   3. 它构造的是"过去某个版本的守护进程写下的状态"，而不是"绕过现在的守卫写状态"：
 *      写进去的行与旧版适配器写的行逐字段同构，且不留任何新的写入路径。
 */
import { DatabaseSync } from "node:sqlite";
import { InMemoryLedger } from "../../src/data/state-ledger/in-memory-ledger.js";
import { SqliteStateLedger } from "../../src/data/state-ledger/sqlite-ledger.js";
import { buildWorkContextBindLedgerCommit } from "../../src/control/control-engine/records/context.js";
import { canonicalJson } from "../../src/contracts/fingerprint.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";
import type { CommitCursor } from "../../src/contracts/command-event.js";
import type { BindWorkContextCommand } from "../../src/contracts/context-continuity.js";
import type { StateLedger } from "../../src/contracts/ledger.js";

/** InMemoryLedger 的存储形状（只读夹具需要写进去，故显式声明而不是 any）。 */
type InMemoryLedgerInternals = {
  snapshots: Map<string, unknown>;
  eventLog: { cursor: CommitCursor; event: unknown }[];
  cursorSeq: number;
};

/**
 * 把一条 WorkContextBinding 按**遗留账本**的形状写进存储（不写身份槽）。
 * 返回写进去的快照，供用例直接断言"落选身份原样保留"。
 */
export async function seedLegacyWorkContextBinding(
  ledger: StateLedger,
  command: BindWorkContextCommand,
  deps: { eventId: string; occurredAt: string },
): Promise<{ workId: string; cursor: CommitCursor }> {
  const batch = buildWorkContextBindLedgerCommit(command, deps);
  const snapshot = batch.snapshots[0]!;
  const event = batch.events[0]!;

  if (ledger instanceof InMemoryLedger) {
    const internals = ledger as unknown as InMemoryLedgerInternals;
    const seq = internals.cursorSeq + 1;
    internals.cursorSeq = seq;
    const cursor = makeCommitCursor(seq);
    internals.eventLog.push({ cursor, event });
    internals.snapshots.set(canonicalJson(snapshot.ref), snapshot);
    return { workId: snapshot.binding.workId, cursor };
  }

  if (ledger instanceof SqliteStateLedger) {
    // 另开一条连接写"遗留行"：与旧版适配器写下的行完全同构（events + snapshots），
    // 且**不**写 identity_claims —— 遗留数据库里没有这张表的行。
    const db = new DatabaseSync(ledger.dbPath);
    try {
      const inserted = db.prepare("INSERT INTO events (event_json) VALUES (?)").run(JSON.stringify(event));
      db.prepare("INSERT INTO snapshots (ref_key, snapshot_json) VALUES (?, ?)").run(
        canonicalJson(snapshot.ref),
        JSON.stringify(snapshot),
      );
      return { workId: snapshot.binding.workId, cursor: makeCommitCursor(Number(inserted.lastInsertRowid)) };
    } finally {
      db.close();
    }
  }

  throw new Error("seedLegacyWorkContextBinding: 只支持 InMemoryLedger 与 SqliteStateLedger（真实存储）");
}
