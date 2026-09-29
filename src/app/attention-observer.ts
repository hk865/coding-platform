/**
 * Mechanical attention observer for the common orchestration mechanism.
 *
 * It implements ONLY the mechanical trigger from
 * `docs/refactor/ORCHESTRATION-STATE-MACHINES.md` §0.5. It never interprets
 * "importance", never pre-filters by semantics and never calls a model.
 *
 * File attention is computed from REAL TEXT, not from a snapshot counter: the
 * Host supplies the current content per watched path (read through the original
 * WorkspaceToolsPort), the observer keeps the last delivered AND the last
 * processed content per path, and derives added/deleted LINES by an actual line
 * diff between those baselines. A same-size replacement, a rollback and a
 * tombstone are therefore all real changes; a repeated identical scan is not.
 *
 * Delivery and processing stay separate: `delivered` suppresses repeats, while
 * `processed` moves only through `markProcessed` after a real handler consumed
 * the signal. Each source keeps its own baseline and buffer, so one source's
 * notification never clears another, and a buffered source never blocks the
 * heartbeat.
 */
import type { JsonValue } from '../contracts/fingerprint.js';

/** Explicit Host configuration; no default value is invented here. */
export type AttentionConfigV1 = {
  schemaVersion: 1;
  heartbeatMs: number;
  maxCoalesceMs: number;
  files: {
    minChangedLines: number;
    minRatio: number;
    /** Watched workspace-relative prefixes; `'.'` means the whole workspace. */
    scopePrefixes: readonly string[];
  };
  graph: {
    minChangedElements: number;
    minRatio: number;
  };
};

/** One watched path at its CURRENT version and real text. `null` = removed. */
export type FileAttentionStamp = {
  path: string;
  version: string | null;
  content: string | null;
};

export type GraphAttentionStamp = {
  nodes: readonly string[];
  edges: readonly string[];
  statuses: Readonly<Record<string, string>>;
  /** Formal source revision (Plan revision / Architecture catalog digest). */
  revision?: string;
};

export type AttentionMemberFeedback = { id: string; source: string };

export type AttentionSnapshot = {
  messageCursor: string | null;
  pendingInputs: number;
  files: readonly FileAttentionStamp[];
  /** Paths whose read FAILED (not removed); their old baseline must be kept. */
  unreadablePaths?: readonly string[];
  graph: GraphAttentionStamp | null;
  /** True when the graph read failed; it is unknown, never an empty graph. */
  graphUnreadable?: boolean;
  memberFeedback?: readonly AttentionMemberFeedback[];
};

export type AttentionSignal =
  | { kind: 'file_delta'; added: number; deleted: number; changedFiles: readonly string[] }
  | { kind: 'graph_delta'; changedElements: number; nodes: number; edges: number; statuses: number }
  | { kind: 'heartbeat'; pendingInputs: number; messageCursor: string | null }
  | { kind: 'member_feedback'; items: readonly string[] };

export type AttentionDelivery = {
  signals: readonly AttentionSignal[];
  atMs: number;
  coalesced: boolean;
};

export type AttentionAntiRepeat = {
  versions: ReadonlyMap<string, string | null>;
  graph: GraphAttentionStamp | null;
  feedbackIds: readonly string[];
  messageCursor: string | null;
  pendingInputs: number | null;
};

export type AttentionObserver = {
  observe(snapshot: AttentionSnapshot, atMs: number): AttentionDelivery | null;
  /** Establish the delivered anti-repeat baseline on Host startup WITHOUT
   * notifying already-existing state. It is not the handling watermark. */
  prime(snapshot: AttentionSnapshot): void;
  /**
   * Advance ONLY the anti-repeat baseline after a real delivery. It never moves
   * the processed watermark: delivered is not processed.
   */
  markDelivered(snapshot: AttentionSnapshot, signals?: readonly AttentionSignal[]): void;
  /** The real handling watermark; only this call moves it. */
  markProcessed(snapshot: AttentionSnapshot, signals?: readonly AttentionSignal[]): void;
  readonly processed: AttentionSnapshot | null;
  readonly delivered: AttentionAntiRepeat;
};

const WHOLE_WORKSPACE = '.';
const MAX_LCS_CELLS = 250_000;

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function ratio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
function contentLines(content: string | null): string[] {
  if (content === null || content === '') return [];
  return content.split('\n');
}

/** A real line diff between two texts; no counter arithmetic. */
export function lineDelta(
  previous: string | null,
  current: string | null,
): { added: number; deleted: number; totalLines: number } {
  const before = contentLines(previous);
  const after = contentLines(current);
  if (before.length === 0) return { added: after.length, deleted: 0, totalLines: after.length };
  if (after.length === 0) return { added: 0, deleted: before.length, totalLines: 0 };
  if (before.length * after.length <= MAX_LCS_CELLS) {
    // Longest common subsequence length, one row at a time.
    let previousRow = new Int32Array(after.length + 1);
    let currentRow = new Int32Array(after.length + 1);
    for (let i = 1; i <= before.length; i += 1) {
      for (let j = 1; j <= after.length; j += 1) {
        currentRow[j] = before[i - 1] === after[j - 1]
          ? previousRow[j - 1]! + 1
          : Math.max(previousRow[j]!, currentRow[j - 1]!);
      }
      const swap = previousRow;
      previousRow = currentRow;
      currentRow = swap;
      currentRow.fill(0);
    }
    const common = previousRow[after.length]!;
    return { added: after.length - common, deleted: before.length - common, totalLines: after.length };
  }
  // Myers edit distance preserves line order without allocating the N×M table.
  // A rearrangement is a real delete/insert sequence, never a made-up counter.
  const frontier = new Map<number, number>([[1, 0]]);
  for (let distance = 0; distance <= before.length + after.length; distance += 1) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const left = frontier.get(diagonal - 1) ?? -1;
      const right = frontier.get(diagonal + 1) ?? -1;
      let x = diagonal === -distance || (diagonal !== distance && left < right) ? right : left + 1;
      let y = x - diagonal;
      while (x < before.length && y < after.length && before[x] === after[y]) { x += 1; y += 1; }
      frontier.set(diagonal, x);
      if (x >= before.length && y >= after.length) {
        const added = (distance + after.length - before.length) / 2;
        return { added, deleted: distance - added, totalLines: after.length };
      }
    }
  }
  throw new Error('line diff did not reach the content boundary');
}

export function validateAttentionConfig(config: AttentionConfigV1): AttentionConfigV1 {
  if (config.schemaVersion !== 1) throw new Error('attention config requires schemaVersion 1');
  if (!Number.isSafeInteger(config.heartbeatMs) || config.heartbeatMs <= 0) throw new Error('attention heartbeatMs must be a positive integer');
  if (!Number.isSafeInteger(config.maxCoalesceMs) || config.maxCoalesceMs < config.heartbeatMs) {
    throw new Error('attention maxCoalesceMs must be an integer >= heartbeatMs');
  }
  if (!isNonNegativeInteger(config.files.minChangedLines) || !ratio(config.files.minRatio)) {
    throw new Error('attention file thresholds are invalid');
  }
  if (!Array.isArray(config.files.scopePrefixes) || config.files.scopePrefixes.some(prefix => typeof prefix !== 'string' || prefix.length === 0)) {
    throw new Error('attention scopePrefixes must be non-empty strings');
  }
  if (!isNonNegativeInteger(config.graph.minChangedElements) || !ratio(config.graph.minRatio)) {
    throw new Error('attention graph thresholds are invalid');
  }
  return {
    schemaVersion: 1,
    heartbeatMs: config.heartbeatMs,
    maxCoalesceMs: config.maxCoalesceMs,
    files: { minChangedLines: config.files.minChangedLines, minRatio: config.files.minRatio, scopePrefixes: [...config.files.scopePrefixes] },
    graph: { minChangedElements: config.graph.minChangedElements, minRatio: config.graph.minRatio },
  };
}

export function withinAttentionScope(prefixes: readonly string[], path: string): boolean {
  return prefixes.some(prefix => {
    if (prefix === WHOLE_WORKSPACE) return true;
    const normalized = prefix.replace(/^\.\//, '').replace(/\/+$/, '');
    if (normalized.length === 0) return false;
    return path === normalized || path.startsWith(`${normalized}/`);
  });
}

function indexFiles(stamps: readonly FileAttentionStamp[], prefixes: readonly string[]): Map<string, FileAttentionStamp> {
  const map = new Map<string, FileAttentionStamp>();
  for (const stamp of stamps) {
    if (!withinAttentionScope(prefixes, stamp.path)) continue;
    map.set(stamp.path, { ...stamp });
  }
  return map;
}

function symmetricDifference(left: readonly string[], right: readonly string[]): string[] {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const result: string[] = [];
  for (const value of leftSet) if (!rightSet.has(value)) result.push(value);
  for (const value of rightSet) if (!leftSet.has(value)) result.push(value);
  return result;
}
function statusDifference(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): number {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  let changed = 0;
  for (const key of keys) if (left[key] !== right[key]) changed += 1;
  return changed;
}

export function graphChangedElements(
  previous: GraphAttentionStamp | null,
  current: GraphAttentionStamp | null,
): { changedElements: number; nodes: number; edges: number; statuses: number } {
  if (previous === null && current === null) return { changedElements: 0, nodes: 0, edges: 0, statuses: 0 };
  const nodes = symmetricDifference(previous?.nodes ?? [], current?.nodes ?? []);
  const edges = symmetricDifference(previous?.edges ?? [], current?.edges ?? []);
  const statuses = statusDifference(previous?.statuses ?? {}, current?.statuses ?? {});
  const revision = (previous?.revision ?? '') === (current?.revision ?? '') ? 0 : 1;
  return { changedElements: nodes.length + edges.length + statuses + revision, nodes: nodes.length, edges: edges.length, statuses };
}

type FileBaseline = { version: string | null; content: string | null };
type FileDelta = { added: number; deleted: number; changedFiles: string[] };

/**
 * Real change since the LAST PROCESSED baseline, skipping paths whose exact
 * version was already notified. Undelivered edits are therefore never lost: a
 * delivered-but-unprocessed V1 followed by V2 reports the full processed→V2
 * change, and only a real markProcessed moves the baseline.
 */
function fileDelta(
  current: ReadonlyMap<string, FileAttentionStamp>,
  processed: ReadonlyMap<string, FileBaseline>,
  deliveredVersions: ReadonlyMap<string, string | null>,
  unreadable: ReadonlySet<string>,
): FileDelta {
  const delta: FileDelta = { added: 0, deleted: 0, changedFiles: [] };
  for (const [path, stamp] of current) {
    if (unreadable.has(path)) continue;
    if (deliveredVersions.get(path) === stamp.version) continue;
    const prior = processed.get(path);
    const diff = lineDelta(prior?.content ?? null, stamp.content);
    if (diff.added === 0 && diff.deleted === 0) continue;
    delta.added += diff.added;
    delta.deleted += diff.deleted;
    delta.changedFiles.push(path);
  }
  for (const [path, prior] of processed) {
    if (current.has(path) || unreadable.has(path)) continue;
    if (deliveredVersions.get(path) === null) continue;
    const diff = lineDelta(prior.content, null);
    if (diff.deleted === 0) continue;
    delta.deleted += diff.deleted;
    delta.changedFiles.push(path);
  }
  delta.changedFiles.sort();
  return delta;
}

function sameGraph(left: GraphAttentionStamp | null, right: GraphAttentionStamp | null): boolean {
  if (left === null || right === null) return left === right;
  return left.nodes.length === right.nodes.length && left.edges.length === right.edges.length
    && left.nodes.every((node, index) => node === right.nodes[index])
    && left.edges.every((edge, index) => edge === right.edges[index])
    && Object.keys(left.statuses).length === Object.keys(right.statuses).length
    && Object.keys(left.statuses).every(key => left.statuses[key] === right.statuses[key])
    && (left.revision ?? '') === (right.revision ?? '');
}

function cloneGraph(graph: GraphAttentionStamp): GraphAttentionStamp {
  return { nodes: [...graph.nodes], edges: [...graph.edges], statuses: { ...graph.statuses },
    ...(graph.revision === undefined ? {} : { revision: graph.revision }) };
}

export function createAttentionObserver(configInput: AttentionConfigV1): AttentionObserver {
  const config = validateAttentionConfig(configInput);
  let processed: AttentionSnapshot | null = null;
  let primed = false;
  // processedFiles/processedGraph are the LAST ACTUALLY PROCESSED baselines;
  // deliveredVersions/deliveredGraph only suppress repeated notifications.
  let processedFiles = new Map<string, FileBaseline>();
  let processedGraph: GraphAttentionStamp | null = null;
  let deliveredVersions = new Map<string, string | null>();
  let deliveredGraph: GraphAttentionStamp | null = null;
  const deliveredFeedback = new Set<string>();
  let deliveredCursor: string | null | undefined;
  let deliveredPending: number | null = null;
  let lastHeartbeatMs: number | null = null;
  let bufferedFilesAtMs: number | null = null;
  let bufferedGraphAtMs: number | null = null;

  function fileOverThreshold(delta: FileDelta, total: number): boolean {
    const changed = delta.added + delta.deleted;
    return changed >= config.files.minChangedLines || changed / Math.max(1, total) >= config.files.minRatio;
  }
  function graphOverThreshold(changedElements: number, total: number): boolean {
    return changedElements >= config.graph.minChangedElements || changedElements / Math.max(1, total) >= config.graph.minRatio;
  }

  return {
    observe(snapshot, atMs) {
      if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return null;
      const currentFiles = indexFiles(snapshot.files, config.files.scopePrefixes);
      const signals: AttentionSignal[] = [];
      let coalesced = false;

      const newFeedback = (snapshot.memberFeedback ?? []).map(item => item.id).filter(id => !deliveredFeedback.has(id));
      if (newFeedback.length > 0) {
        signals.push({ kind: 'member_feedback', items: newFeedback });
      }

      const unreadable = new Set<string>(snapshot.unreadablePaths ?? []);
      const delta = fileDelta(currentFiles, processedFiles, deliveredVersions, unreadable);
      const fileChanged = delta.added + delta.deleted > 0;
      let fileReady = false;
      if (!fileChanged) {
        bufferedFilesAtMs = null;
      } else {
        bufferedFilesAtMs ??= atMs;
        let total = 0;
        for (const stamp of currentFiles.values()) total += contentLines(stamp.content).length;
        if (fileOverThreshold(delta, total)) fileReady = true;
        else if (atMs - bufferedFilesAtMs >= config.maxCoalesceMs) { fileReady = true; coalesced = true; }
      }
      if (fileReady) {
        signals.push({ kind: 'file_delta', ...delta });
        bufferedFilesAtMs = null;
      }

      let graphChanged = 0;
      if (snapshot.graphUnreadable !== true && !sameGraph(deliveredGraph, snapshot.graph)) {
        graphChanged = graphChangedElements(processedGraph, snapshot.graph).changedElements;
      }
      let graphReady = false;
      if (graphChanged === 0) {
        bufferedGraphAtMs = null;
      } else {
        bufferedGraphAtMs ??= atMs;
        const current = snapshot.graph ?? { nodes: [], edges: [], statuses: {} };
        const total = current.nodes.length + current.edges.length + Object.keys(current.statuses).length;
        if (graphOverThreshold(graphChanged, total)) graphReady = true;
        else if (atMs - bufferedGraphAtMs >= config.maxCoalesceMs) { graphReady = true; coalesced = true; }
      }
      if (graphReady) {
        signals.push({ kind: 'graph_delta', ...graphChangedElements(processedGraph, snapshot.graph) });
        bufferedGraphAtMs = null;
      }

      const heartbeatDue = lastHeartbeatMs === null || atMs - lastHeartbeatMs >= config.heartbeatMs;
      if (heartbeatDue) {
        const moved = deliveredCursor !== undefined && deliveredCursor !== snapshot.messageCursor;
        const pendingChanged = deliveredPending !== null && deliveredPending !== snapshot.pendingInputs;
        const firstPending = deliveredCursor === undefined && snapshot.pendingInputs > 0;
        if (snapshot.pendingInputs > 0 && (moved || pendingChanged || firstPending)) {
          signals.push({ kind: 'heartbeat', pendingInputs: snapshot.pendingInputs, messageCursor: snapshot.messageCursor });
        }
        lastHeartbeatMs = atMs;
      }

      return signals.length === 0 ? null : { signals, atMs, coalesced };
    },
    markDelivered(snapshot, signals) {
      const kinds = new Set(signals?.map(item => item.kind) ?? ['file_delta', 'graph_delta', 'member_feedback', 'heartbeat']);
      if (kinds.has('file_delta')) for (const [path, stamp] of indexFiles(snapshot.files, config.files.scopePrefixes)) deliveredVersions.set(path, stamp.version);
      if (kinds.has('graph_delta') && !snapshot.graphUnreadable) deliveredGraph = snapshot.graph === null ? null : cloneGraph(snapshot.graph);
      if (kinds.has('member_feedback')) for (const item of snapshot.memberFeedback ?? []) deliveredFeedback.add(item.id);
      if (kinds.has('heartbeat')) { deliveredCursor = snapshot.messageCursor; deliveredPending = snapshot.pendingInputs; }
    },
    prime(snapshot) {
      if (primed) return;
      primed = true;
      processedFiles = new Map([...indexFiles(snapshot.files, config.files.scopePrefixes)]
        .map(([path, stamp]) => [path, { version: stamp.version, content: stamp.content }]));
      processedGraph = snapshot.graph === null ? null : cloneGraph(snapshot.graph);
      deliveredVersions = new Map([...processedFiles].map(([path, baseline]) => [path, baseline.version]));
      deliveredGraph = snapshot.graph === null ? null : cloneGraph(snapshot.graph);
      for (const item of snapshot.memberFeedback ?? []) deliveredFeedback.add(item.id);
      deliveredCursor = snapshot.messageCursor;
      deliveredPending = snapshot.pendingInputs;
    },
    markProcessed(snapshot, signals) {
      const kinds = new Set(signals?.map(item => item.kind) ?? ['file_delta', 'graph_delta', 'member_feedback', 'heartbeat']);
      if (kinds.has('file_delta')) for (const [path, stamp] of indexFiles(snapshot.files, config.files.scopePrefixes)) {
        if (!snapshot.unreadablePaths?.includes(path)) processedFiles.set(path, { version: stamp.version, content: stamp.content });
      }
      if (kinds.has('graph_delta') && !snapshot.graphUnreadable) processedGraph = snapshot.graph === null ? null : cloneGraph(snapshot.graph);
      if (kinds.has('member_feedback')) for (const item of snapshot.memberFeedback ?? []) deliveredFeedback.add(item.id);
      processed = {
        messageCursor: kinds.has('heartbeat') ? snapshot.messageCursor : processed?.messageCursor ?? null,
        pendingInputs: kinds.has('heartbeat') ? snapshot.pendingInputs : processed?.pendingInputs ?? 0,
        files: [...processedFiles].map(([path, stamp]) => ({ path, ...stamp })),
        graph: processedGraph === null ? null : cloneGraph(processedGraph),
        ...(snapshot.memberFeedback === undefined ? {} : { memberFeedback: snapshot.memberFeedback.map(item => ({ ...item })) }),
      };
    },
    get processed() { return processed; },
    get delivered(): AttentionAntiRepeat {
      return {
        versions: new Map(deliveredVersions),
        graph: deliveredGraph === null ? null : cloneGraph(deliveredGraph),
        feedbackIds: [...deliveredFeedback],
        messageCursor: deliveredCursor ?? null,
        pendingInputs: deliveredPending,
      };
    },
  };
}

/** A JSON-safe mechanical description of one attention signal for a UI/record. */
export function attentionSignalToJson(signal: AttentionSignal): JsonValue {
  switch (signal.kind) {
    case 'file_delta': return { kind: signal.kind, added: signal.added, deleted: signal.deleted, changedFiles: [...signal.changedFiles] };
    case 'graph_delta': return { kind: signal.kind, changedElements: signal.changedElements, nodes: signal.nodes, edges: signal.edges, statuses: signal.statuses };
    case 'heartbeat': return { kind: signal.kind, pendingInputs: signal.pendingInputs, messageCursor: signal.messageCursor };
    case 'member_feedback': return { kind: signal.kind, items: [...signal.items] };
  }
}

// --------------------------------------------------------------------------
// Real Host sources: build a mechanical snapshot from the ORIGINAL owners.
// --------------------------------------------------------------------------

export type AttentionScannerDependencies = {
  workspace: Pick<import('../core/workspace/ports.js').WorkspaceToolsPort, 'readWorkspace'>;
  plans: Pick<import('../core/work-graph/tasks/plan-contracts.js').PlanTaskPort, 'queryTaskGraph'>;
  architecture: Pick<import('../core/work-graph/architecture/catalog-contracts.js').ArchitectureCatalogPort, 'readArchitectureRevision'>;
  messages: Pick<import('../core/work-graph/communication/contracts.js').SessionMailboxPort, 'readInbox'>;
};

/** Explicit Host-configured attention scope; nothing is hard-coded globally. */
export type AttentionScopeV1 = {
  scope: { projectId: string; workspaceId: string };
  /**
   * Trusted workspace-relative FIXED FILE paths to watch. This release does not
   * claim directory scopes: a directory path is rejected, never read as a file
   * and then reported as deleted.
   */
  paths: readonly string[];
  /** Explicit scope kind; only fixed files are supported, so it defaults to files. */
  pathsKind?: 'files';
  maxBytes: number;
  /** Optional Goal whose formal task graph contributes the dual-graph facts. */
  goalRef: import('../contracts/ledger.js').GoalRef | null;
  /** Optional member Session whose inbox contributes the message position. */
  targetSession: import('../contracts/core/identity.js').SessionRef | null;
  config: AttentionConfigV1;
};

export type AttentionScanner = {
  scan(ctx: import('../contracts/core/call-context.js').CoreCallContext, scope: AttentionScopeV1): Promise<AttentionSnapshot>;
};

export function createAttentionScanner(deps: AttentionScannerDependencies): AttentionScanner {
  return {
    async scan(ctx, scope) {
      const workspace = { aggregateType: 'Workspace' as const, projectId: scope.scope.projectId, workspaceId: scope.scope.workspaceId };
      const files: FileAttentionStamp[] = [];
      const unreadablePaths: string[] = [];
      for (const path of scope.paths) {
        if (!withinAttentionScope(scope.config.files.scopePrefixes, path)) continue;
        let read;
        try {
          read = await deps.workspace.readWorkspace(ctx, {
            workspace, path, maxBytes: scope.maxBytes, version: { kind: 'working_tree' },
          });
        } catch { unreadablePaths.push(path); continue; }
        if (read.status === 'ready') {
          files.push({ path, version: read.value.digest, content: read.value.content });
        } else if (read.code === 'not_found') {
          // ONLY an explicit not_found is a removal tombstone.
          files.push({ path, version: null, content: null });
        } else {
          // forbidden/unavailable/capacity/not_ready: unknown, keep the baseline.
          unreadablePaths.push(path);
        }
      }
      let graph: GraphAttentionStamp | null = null;
      let graphUnreadable = false;
      const nodes: string[] = [];
      const edges: string[] = [];
      const statuses: Record<string, string> = {};
      let revision: string | null = null;
      if (scope.goalRef !== null) {
        const read = await deps.plans.queryTaskGraph(ctx, { goalRef: scope.goalRef });
        if (read.status === 'ready') {
          const plan = read.value.plan;
          for (const row of read.value.tasks) {
            nodes.push('task:' + row.ref.taskId);
            statuses['task:' + row.ref.taskId] = row.effectivePhase;
          }
          for (const edge of plan.executionDag.dependsOn) edges.push('depends:' + edge.dependsOnId + '->' + edge.taskId + ':' + edge.requires);
          for (const edge of plan.taskHierarchy.parentOf) edges.push('parent:' + edge.parentTaskId + '->' + edge.childTaskId);
          for (const row of read.value.tasks) {
            for (const relation of row.relations) edges.push('relation:' + relation.fromTaskId + '->' + relation.toTaskId + ':' + relation.kind);
          }
          revision = 'plan:' + plan.ref.planId;
        } else if (read.status !== 'not_found') {
          graphUnreadable = true;
        }
      }
      // The FORMAL Architecture Catalog is a second real graph owner; a read
      // failure is unknown, never an empty graph.
      try {
        const arch = await deps.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
        if (arch.status === 'ready') {
          const catalog = arch.value.catalog === null ? null : arch.value.catalog.catalog;
          if (catalog !== null) {
            for (const module of catalog.modules) {
              nodes.push('module:' + module.ref.moduleId);
              statuses['module:' + module.ref.moduleId] = module.name;
            }
            for (const dep of catalog.dependencies) edges.push('arch-depends:' + dep.from.moduleId + '->' + dep.to.moduleId);
            for (const pair of catalog.containment?.parentOf ?? []) edges.push('arch-parent:' + pair.parent.moduleId + '->' + pair.child.moduleId);
          }
          // The baseline content digest is the formal architecture VERSION, so a
          // re-adoption with identical names still registers as a change.
          revision = (revision === null ? '' : revision + '|') + 'arch:' + arch.value.baseline.contentDigest;
        } else if (arch.status !== 'not_found') {
          graphUnreadable = true;
        }
      } catch { graphUnreadable = true; }
      if (nodes.length > 0 || edges.length > 0 || revision !== null) {
        graph = { nodes: nodes.sort(), edges: edges.sort(), statuses, ...(revision === null ? {} : { revision }) };
      }
      // The target inbox is deliberately NOT a source here: the Host also delivers
      // its own mechanical notifications into it, which would self-oscillate.
      return { messageCursor: null, pendingInputs: 0, files, unreadablePaths, graph, graphUnreadable };
    },
  };
}
