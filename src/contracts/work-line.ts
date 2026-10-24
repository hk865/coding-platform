/**
 * Slice 2C work-line read DTOs (spec §2).
 *
 * Pure data shared by the WorkGraph read model, the Host routes and the UI.
 * `src/core/work-graph/state/line-status.ts` reads these shapes (plus its own
 * pure input types); no persistence schema lives here.
 */
import type { CommitCursor } from './command-event.js';
import type { ControlIntentRef } from './control-intent.js';
import type { ModuleRef, SessionRef, VersionPin, WorkLinkRelation, WorkLinkTarget } from './core/identity.js';
import type { CoreError } from './core/results.js';
import type { SessionMessageRef } from './core/session-message.js';
import type { SessionHealthConclusion, SessionProvenanceV1 } from './core/session.js';
import type { RunOutcome, RunRef, TaskTriple } from './dispatch.js';
import type { DecisionSourceV1 } from './goal-decisions.js';
import type { GraphNodeRefV1 } from './graph-context.js';
import type { GoalRef } from './ledger.js';
import type { NoteAnchorV1, NoteKind, NoteSectionsV1, NoteSourceV1, NoteState } from './note.js';
import type { Disposition, Phase, PlanRevisionRef } from './plan.js';
import type { PlatformDutyV1 } from './platform-duty.js';
import type { QueryExecutionStateV1, QueryRunRef, QueryRunV1 } from './query-job.js';
import type { SessionAnomalyViewV1 } from './session-anomaly.js';
import type { TaskPhaseCauseV1 } from './task-failure.js';
import type { VerificationRoundRef } from './verification.js';

export type LineOwnStateV1 =
  | 'working' | 'checking' | 'starting' | 'waiting_reply' | 'paused'
  | 'unknown' | 'done' | 'retired' | 'standby';
export type LineAttentionCodeV1 = 'decide' | 'failed' | 'blocked' | 'unknown';
export type LineBucketV1 = 'working' | 'standby' | 'archived';
export type LineArchivedTagV1 = 'done' | 'retired' | 'plain';

export type LineCountV1 =
  | { status: 'exact'; value: number }
  | { status: 'partial'; atLeast: number; atMost?: number; reason: string }   // 局部数，不当总数
  | { status: 'unavailable'; reason: string };                                 // 读不到，不是 0

export type LineSourceRefV1 =
  | { kind: 'record'; pin: VersionPin }                                   // Session、Run、QueryRun、Task、Goal、锚点、消息、控制意图、检查轮次
  | { kind: 'card'; source: DecisionSourceV1; cardKey: string };
export type LineReasonV1 = { code: LineReasonCodeV1; params: Record<string, string | number>; refs: LineSourceRefV1[] };
export type LineReasonCodeV1 =                                            // 中文用词见 §3.9
  | 'running_task' | 'query_turn' | 'starting' | 'checking' | 'waiting_reply'
  | 'paused_by_you' | 'paused_by_goal' | 'paused_interrupted' | 'paused_yielded'
  | 'unknown_run' | 'unknown_query' | 'health_recoverable' | 'occupancy_unexplained'
  | 'done_tasks' | 'done_unproven' | 'retired_turn_open' | 'retired_missing' | 'retired_damaged' | 'retired_unrecorded'
  | 'goal_cancelled' | 'awaiting_check' | 'task_deferred' | 'waiting_dispatch' | 'idle'
  | 'card' | 'run_failed' | 'check_failed' | 'continuation_cancelled'
  | 'round_inconclusive' | 'check_interrupted' | 'round_ambiguous' | 'origin_unresolvable'
  | 'run_outcome_unknown' | 'anomaly_pending' | 'copy_unknown' | 'unknown_call_review'
  | 'archived' | 'handed_to' | 'reactivate_refused_retired';

export type LineMarkerV1 =
  | { kind: 'stop_pending'; intentRef: ControlIntentRef }
  | { kind: 'archiving'; archiveRequestId: string; waitingForStop: boolean }
  | { kind: 'undelivered'; count: LineCountV1 }
  | { kind: 'handoff_from'; from: SessionRef; fromLine: SessionRef | null }
  | { kind: 'omitted'; count: LineCountV1 }                               // 前任超过 32 个（链超过 33 个 Session）：partial atLeast 1
  | { kind: 'copy_answering'; copies: SessionRef[] };

export type LineAttentionV1 = { code: LineAttentionCodeV1; reason: LineReasonV1 };
export type LineHistoryPartV1 = 'written_anchors' | 'undelivered' | 'done_evidence';
export type LineStatusV1 = {                                                // 列表、悬停、详情共用的一份（决定 49 · 02）
  own: LineOwnStateV1; ownReason: LineReasonV1;
  attention: LineAttentionV1 | null;                                       // 最急的一项
  attentionCounts: Record<LineAttentionCodeV1, number>;                    // attentionComplete 为 false 时是“至少”
  attentionComplete: boolean;                                              // 决定队列、卡的原因码、锚点读不全，或写下的锚点超读预算时为 false
  doneEvidence: 'complete' | 'incomplete' | 'not_applicable';              // L1a：incomplete → 做过的任务读不全，不给已做完
  partialParts: { part: LineHistoryPartV1; reason: string }[];             // L1b：哪几部分没读全（读预算、读口上限）
  markers: LineMarkerV1[];
  bucket: LineBucketV1 | null;                                             // 这一行带问题（读不全）时为 null，先于别的档（B4）
  archivedTag: LineArchivedTagV1 | null;                                   // 没归档时为 null
  readOnly: boolean;
};

export type LineNameV1 = {
  source: 'running_task' | 'open_tasks' | 'recent_task' | 'secretary_ordinal' | 'duty_only';
  primary: string; extraCount: number;                                     // “首项等 n 项”；秘书是“秘书 N”
  ordinal: number | null;                                                  // secretary_ordinal 的 N：本工作区秘书 Session 按创建顺序（createdAt，同刻按 Session 键）
                                                                           // 从 1 数，归档的也算，只读副本不算；别的来源和读不到序号时为 null
  tasks: TaskTriple[]; goalRef: GoalRef | null;                            // 秘书线的 goalRef 是它最近一次 Query 的目标
  complete: boolean;                                                       // false：秘书的序号读不到，名字只给“秘书”，这一行同时带问题
};
export type LineTaskBriefV1 = {
  task: TaskTriple; title: string; phase: Phase; disposition: Disposition;
  phaseCause: TaskPhaseCauseV1 | null;                                     // 例如 paused_interrupted
  attention: LineAttentionCodeV1 | null;
};
export type LineControlKindV1 =
  | 'pause' | 'resume' | 'cancel' | 'continue' | 'attest_unknown'
  | 'ask' | 'intervene' | 'archive' | 'reactivate';
export type LineControlV1 = {
  kind: LineControlKindV1;
  availability: 'available' | 'unavailable' | 'not_yet';                  // not_yet = 还没接上，写明哪一片
  reason: string | null;                                                   // 不可用或 not_yet 时必填
  reasonCode: string | null;                                               // 不可用时是守卫的拒绝码（如 busy、invalid），提交时被拒的码与它相同；
                                                                           // not_yet 时是 'not_yet'；可用时为 null
  route: string;                                                           // 提交走哪个已有路由
  target: { runRef?: RunRef; queryRunRef?: QueryRunRef; task?: TaskTriple; sessionRef?: SessionRef };
  pins: VersionPin[];                                                      // 提交时要带的版本
};
export type LineRowV1 = {
  key: SessionRef;                                                         // 线头；本次读的键
  duty: PlatformDutyV1 | 'unknown';                                        // unknown 也包括读角色配置失败（L7）
  name: LineNameV1;
  status: LineStatusV1;
  responsibleNow: LineTaskBriefV1[];                                       // 链上全部开着的负责关系，去重（悬停“列全”）
  doneTasks: { tasks: LineTaskBriefV1[]; omitted: LineCountV1 } | null;    // 已做完的悬停卡：最新 21 条里 terminal 的前 20 项（L1a、T8 补充）
  retired: { conclusion: SessionHealthConclusion | null; history: 'readable' | 'not_readable';
    since: CommitCursor | null } | null;                                   // since = Session 的 unavailableSince（提交位置，不是时刻）；旧记录没有时为 null
  groups: { duty: PlatformDutyV1 | 'unknown'; module: ModuleRef | null; task: TaskTriple | null };
  sessionCount: LineCountV1;                                               // 前任超过 32 个时 partial（atLeast 34）
  chainSessions: SessionRef[];                                             // 线头在前，至多 33 个（L2）；给 2B 的 sessionRefs 用
  pinned: boolean; pinnedBy: SessionRef[];
  lastActivityAt: string; sortKey: string;
  controls: LineControlV1[];
  problem: { code: CoreError | 'source_moving'; reason: string } | null;
};
export type WorkLineListV1 = {
  rows: LineRowV1[];                                                       // 全部活跃线，已排序
  counts: { working: LineCountV1; standby: LineCountV1; archived: LineCountV1 & { asOf: CommitCursor | null } };
  legacyUnchecked: LineCountV1;
  attentionComplete: boolean; attentionProblem: string | null;
  readWindow: { from: CommitCursor; to: CommitCursor };
};
export type ArchivedLinePageV1 = {
  rows: LineRowV1[]; nextCursor: string | null; sourceCursor: CommitCursor;
  withoutArchivedAt: LineCountV1;                                          // 没有归档时间、不在这个列表里的已归档 Session（L5）
};

export type LineChainEntryV1 = {
  session: SessionRef; provenance: SessionProvenanceV1 | null;
  lifecycle: 'active' | 'archived'; health: 'available' | 'recoverable' | 'unavailable';
  healthConclusion: SessionHealthConclusion | null;
  createdAt: string; archivedAt: string | null;
  responsibleOpen: TaskTriple[];                                           // E1：两个 Session 同时“负责中”时各自列出
};
export type WorkLineDetailV1 = {
  kind: 'line';
  row: LineRowV1;
  chain: LineChainEntryV1[]; omitted: LineCountV1;                         // 线头在前
  attentionAll: (LineAttentionV1 & { source: LineSourceRefV1 })[];         // 全部关注，不只最急的
  responsibility: 'has_responsibility' | 'none';                           // none → 界面写“尚无负责关系”
  gateChecks: LineGateCheckV1[];                                           // 这条线现在负责的门任务的检查轮次（L23）
  sourceCursor: CommitCursor;
};
export type LineGateCheckV1 = {
  gateTask: TaskTriple;
  roundRef: VerificationRoundRef; revision: number;
  sinceAt: string | null;                                                  // eventAt(since) 的时刻；没有 since 的旧轮次为 null
  status: string; chainIndex: number;
  producerRunRef: RunRef;                                                  // 轮次的主体执行（产出执行），常在别的线上，另记
};
export type LineSegmentV1 = {
  session: SessionRef; kernel: { adapterId: string; kernelSessionId: string };
  from: string; to: string | null; history: 'readable' | 'not_readable'; reason: LineReasonV1 | null;
};
export type LineExecutionItemV1 =                                          // executions 分节的一项（L12），按 generation 排
  | { kind: 'execution'; session: SessionRef; generation: number;         // claim.generation
      runRef: RunRef; revision: number; task: TaskTriple;
      startedAt: string | null;                                            // 显示的时间；没进入过的为 null
      status: 'starting' | 'running' | 'ended'; outcome: RunOutcome | null;
      checks: { roundRef: VerificationRoundRef; revision: number; at: string | null; status: string }[] }  // 普通检查，at = eventAt(since)
  | { kind: 'query'; session: SessionRef; generation: number;             // executionState.sessionGeneration
      queryRunRef: QueryRunRef; revision: number;
      startedAt: string | null;                                            // 显示的时间；记录上有就给，不据此说“进入过”
      phase: QueryExecutionStateV1['phase']; outcome: QueryRunV1['outcome'] };
export type LineConversationSourceV1 = {                                    // WorkGraph 给 Host 的（L12）：只有段
  segments: LineSegmentV1[];                                                // 链上每个 Session 一段，最早的在前
  sourceCursor: CommitCursor;
};
export type LineParticipationV1 = {
  target: WorkLinkTarget; relation: WorkLinkRelation | 'claimed';           // claimed = 只领取过它的执行
  session: SessionRef; since: string | null; until: string | null;
};
export type LineMessageStateV1 = {
  messageRef: SessionMessageRef; revision: number; createdAt: string;
  delivery: 'queued' | 'delivered';
  deliveredTo: { executionRef: RunRef | QueryRunRef; acceptedAt: string } | null;
  read: boolean; responded: boolean;
  replyHandler: SessionRef | null;
  waitDisposition: 'cancel' | 'transfer' | null;
  undelivered: boolean;
  disposition: NotYetV1;                     // 已生效、被拒绝、已到期、已转交、已撤回、待放行、不发（第 7 片）
};
export type WorkLineSectionPageV1 =
  | { section: 'participation'; items: LineParticipationV1[]; nextCursor: string | null; sourceCursor: CommitCursor }
  | { section: 'messages'; items: LineMessageStateV1[]; nextCursor: string | null; sourceCursor: CommitCursor }
  | { section: 'copies'; items: { copy: SessionRef; messageRef: SessionMessageRef; lifecycle: 'active' | 'archived';
        phase: QueryExecutionStateV1['phase'] | null }[]; nextCursor: string | null; sourceCursor: CommitCursor }
  | { section: 'executions'; segments: LineSegmentV1[];                    // L12
      scope: 'indexed';                                                     // 只列有索引的执行：有派工记录的 Work、有 executionState 的 Query
      items: LineExecutionItemV1[]; nextCursor: string | null;
      sourceCursor: CommitCursor };

// 悬停数据和节点详情
export type LineBriefV1 = {                                                 // 带全份状态，悬停、详情和列表逐字段相同
  key: SessionRef; duty: PlatformDutyV1 | 'unknown'; name: LineNameV1;
  status: LineStatusV1;                                                     // 和 LineRowV1.status 同一个类型、同一个函数算出
};
export type NotYetV1 = { availability: 'not_available'; reason: string };    // 还没接上，写明哪一片（注记一栏等）
export type FromExecutedFilesV1<T> =                                        // 要用“执行改过的文件”的字段（L15）
  | { availability: 'available'; value: T; possiblyIncomplete: boolean; sourceCursor: CommitCursor | null }
  | { availability: 'unavailable'; cause: 'not_recorded' | 'read_failed'; reason: string };
export type ExecutedFileV1 = { runRef: RunRef; path: string; certainty: 'definite' | 'possible' };
export type ExecutedFilesViewV1 = FromExecutedFilesV1<ExecutedFileV1[]>;
export type TaskDisplayFactsV1 = {
  neverRanTerminal: 'cancelled' | 'superseded' | null;
  anomaly: { label: '中断，待核对'; next: LineReasonV1; pending: LineCountV1 } | null;
  attention: LineAttentionV1 | null;
};
export type TaskHoverV1 = {
  task: TaskTriple; planRef: PlanRevisionRef; title: string;
  phase: Phase; phaseCause: TaskPhaseCauseV1 | null; disposition: Disposition;
  display: TaskDisplayFactsV1; module: ModuleRef | null;
  owners: LineBriefV1[];                                                   // 现在负责的线
  participatedLines: LineCountV1;
};
export type GroupHoverV1 = {                                               // 目标、阶段（UI-WORKBENCH §0：分组还显示计数）
  node: { kind: 'goal'; ref: GoalRef } | { kind: 'stage'; planRef: PlanRevisionRef; stageId: string };
  tasks: LineCountV1;                                                       // 组里的任务（从没运行过的取消、替代不算，另计）
  neverRanTerminal: LineCountV1;
  participatedLines: LineCountV1;                                           // 做过这里的任务的线
  workingLines: LineCountV1; pausedLines: LineCountV1;
  owners: LineBriefV1[];                                                    // 目标：秘书线（L20 的口径）；阶段：空（原型：阶段没有单一的线）
};
export type ModuleHoverV1 = {                                              // 每个架构目录里的模块，含子模块
  module: ModuleRef; parent: ModuleRef | null; name: string; paths: string[]; responsibility: string;
  maintainer: { status: 'none' };                                           // 第 8 片之前都是 none
  unfinishedTasks: LineCountV1; workingLines: LineCountV1; lines: LineCountV1;   // 按计划：本模块和它声明的子模块
  changedByLines: FromExecutedFilesV1<LineCountV1>;                         // “n 条工作线改过这里的文件”（L15）
  files: FromExecutedFilesV1<ModuleFileV1[]>;                               // 按路径去重，按路径的 UTF-8 字节序（L15）
};
export type ModuleFileV1 = {
  path: string;
  certainty: 'definite' | 'possible';                                       // 改过它的 Run 里有一个 definite 就是 definite
  runs: RunRef[];                                                           // 改过它的那几次 Run
};
export type GraphHoverReadV1 = {
  goalRef: GoalRef; groups: GroupHoverV1[]; tasks: TaskHoverV1[]; modules: ModuleHoverV1[];
  files: FromExecutedFilesV1<{ path: string; tasks: TaskTriple[] }[]>;    // 文件“涉及它的任务”（L15）
  // Slice 4C L21/决定 35 · Q23: the hover card only shows a note COUNT per
  // hovered node (goal, stage, task, module), never full note rows.
  noteCounts: { node: GraphNodeRefV1; count: LineCountV1 }[];
  problems: { node: GraphNodeRefV1; code: CoreError; reason: string }[];
  sourceCursor: CommitCursor;
};
export type NodeDetailRequestV1 = {
  goalRef: GoalRef; node: GraphNodeRefV1;
  section: 'summary' | 'participants' | 'risks' | 'anomalies' | 'executions';
  page: { afterCursor: string | null; limit: number };                     // limit 1..100
};
export type NodeRiskV1 = {
  task: TaskTriple; title: string; phase: Phase;
  shared: { kind: 'module'; module: ModuleRef } | { kind: 'file'; path: string; certainty: 'definite' | 'possible' };
};

/**
 * Slice 4C L21/C1.5: the node-detail notes column. Goal, stage, task and module
 * nodes map to the note anchors of the same kind and carry that node's current
 * understanding (goal/stage only) plus the first `lookup` page, each row
 * labelled with `renderNoteHeader`. Session, Run and round nodes have no note
 * anchor. The understanding shape is inlined because `model/note-contracts.ts`
 * is not importable from `contracts`. When the notes column itself cannot be
 * read the member is `unavailable` with the reason.
 */
export type NodeNoteUnderstandingV1 = { anchorKey: string;
  pointer: { noteId: string | null; revision: number | null };
  updateDue: boolean | null; latestTriggerCursor: string | null };
/** The L9 fields the notes column shows, plus `label` from `renderNoteHeader`. */
export type NodeNoteRowV1 = {
  noteId: string; version: number; storedState: NoteState; kind: NoteKind; label: string;
  topic: string; topicKey: string; conclusion: string; anchor: NoteAnchorV1; extraAnchors: NoteAnchorV1[];
  source: NoteSourceV1; goalId: string | null; confirmedByUser: boolean;
  freshness: 'fresh' | 'stale' | 'unchecked'; changedFiles: { path: string; deleted: boolean }[];
  staleReasons: string[]; sourceUnavailable: boolean; invalid: boolean; conflicting: boolean;
  overQuota: boolean; currentEligible: boolean; crossGoal: boolean;
  anchorStatus: 'live' | 'retired';
  anchorRetiredReasons: ('module_removed' | 'interface_removed' | 'file_deleted' | 'task_ended'
    | 'stage_not_in_current_plan' | 'symbol_missing')[];
  retiredExtraAnchors: string[];
  sections?: NoteSectionsV1;
};
export type NodeNotesV1 =
  | { status: 'not_available'; reason: 'no_note_anchor' }
  | { status: 'unavailable'; reason: string }
  | { status: 'available'; understanding: NodeNoteUnderstandingV1 | null;
      items: NodeNoteRowV1[]; next: string | null; complete: boolean };

export type NodeDetailV1 =
  | { section: 'summary'; node: GraphNodeRefV1; pin: VersionPin;
      task: (TaskHoverV1 & { plannedModules: ModuleRef[]; actualFiles: ExecutedFilesViewV1;
        responsibleNow: LineBriefV1[]; responsibility: 'has_responsibility' | 'none' }) | null;
      group: GroupHoverV1 | null;                                           // 目标、阶段节点
      goal: { anomalyCount: LineCountV1; workingLines: LineCountV1 } | null;
      module: ModuleHoverV1 | null;
      line: LineBriefV1 | null;                                              // Session 节点 → 它所在的线
      notes: NodeNotesV1;                                                     // 注记一栏（第 4 片；4C 接上）
      fileRisks: FromExecutedFilesV1<{ riskCount: LineCountV1 }>;         // 按共用文件算的风险；来源可能不全时 partial（L15、§3.12）
      sourceCursor: CommitCursor }
  | { section: 'participants'; items: (LineBriefV1 & { via: LineParticipationV1['relation'] })[];
      nextCursor: string | null; sourceCursor: CommitCursor }
  | { section: 'risks'; items: NodeRiskV1[]; nextCursor: string | null; sourceCursor: CommitCursor }
  | { section: 'anomalies'; items: (SessionAnomalyViewV1 & { line: LineBriefV1 | null; problem: string | null })[];
      nextCursor: string | null; sourceCursor: CommitCursor }
  | { section: 'executions'; items: { runRef: RunRef; revision: number | null; problem: string | null }[];
      nextCursor: string | null; sourceCursor: CommitCursor };
