/**
 * Pending logical requests (idempotency that survives a page reload).
 *
 * The server deduplicates by requestId, so the browser must remember which
 * requestId belongs to which *unfinished* logical operation:
 *   - a retry after an unknown outcome reuses the same id and the same payload
 *     identity, so the server replays instead of creating a second run;
 *   - once a formal receipt arrives (accepted or rejected) the operation is over,
 *     and a later identical submission is a NEW execution with a NEW id.
 *
 * Only a payload *digest* is persisted. Instructions, commands, file references
 * and credentials never enter browser storage.
 */
import type { GoalScope, Scope } from '../api/types';

export const PENDING_KEY_PREFIX = 'agent-platform.workbench.pending.v1';
export type PendingKind = 'goal' | 'real-task' | 'command-check' | 'verification-round' | 'independent-review' | 'fixture-query' | 'semantic-query' | 'history-grant' | 'history-revoke' | 'exploration-plan' | 'exploration-run' | 'exploration-review';
export type PendingRecord = { requestId: string; fingerprint: string; kind: PendingKind; scopeKey: string; createdAt: string };
export type PendingMap = Record<string, Record<string, PendingRecord>>;

export function pendingScopeKey(scope: Scope & { goalId?: string }): string {
  return [scope.projectId, scope.workspaceId, scope.goalId ?? ''].map(encodeURIComponent).join('::');
}

export function readPending(storage: Storage): PendingMap {
  try {
    const raw = storage.getItem(PENDING_KEY_PREFIX);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: PendingMap = {};
    for (const [scopeKey, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const kinds: Record<string, PendingRecord> = {};
      for (const [kind, entry] of Object.entries(value as Record<string, unknown>)) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as Partial<PendingRecord>;
        if (typeof record.requestId !== 'string' || typeof record.fingerprint !== 'string') continue;
        kinds[kind] = { requestId: record.requestId, fingerprint: record.fingerprint, kind: kind as PendingKind, scopeKey, createdAt: typeof record.createdAt === 'string' ? record.createdAt : '' };
      }
      result[scopeKey] = kinds;
    }
    return result;
  } catch { return {}; }
}

/** Deterministic payload identity. Only the digest leaves this function. */
export async function payloadFingerprint(payload: unknown): Promise<string> {
  const text = JSON.stringify(payload);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('当前浏览器不支持请求标识摘要');
  const bytes = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export class PendingStore {
  private map: PendingMap;

  constructor(private readonly storage: Storage | null) {
    this.map = storage ? readPending(storage) : {};
  }

  private persist(): void {
    if (!this.storage) return;
    try { this.storage.setItem(PENDING_KEY_PREFIX, JSON.stringify(this.map)); } catch { /* storage full or unavailable */ }
  }

  peek(scope: GoalScope, kind: PendingKind): PendingRecord | null {
    return this.map[pendingScopeKey(scope)]?.[kind] ?? null;
  }

  list(scope: GoalScope): PendingRecord[] { return Object.values(this.map[pendingScopeKey(scope)] ?? {}); }

  /**
   * Claim the requestId for one logical operation.
   * Same scope + same kind + same payload digest => the SAME pending request.
   * A different payload is blocked until the existing request is resolved.
   * No entry at all means a fresh execution.
   */
  async begin(scope: GoalScope, kind: PendingKind, payload: unknown): Promise<{ requestId: string; replayed: boolean; replaced: string | null }> {
    const scopeKey = pendingScopeKey(scope);
    const fingerprint = await payloadFingerprint(payload);
    const existing = this.map[scopeKey]?.[kind] ?? null;
    if (existing && existing.fingerprint === fingerprint) return { requestId: existing.requestId, replayed: true, replaced: null };
    if (existing) throw new Error('旧请求结果仍未确定（' + existing.requestId + '）。请先查询服务器回执，或恢复原内容重试；旧请求确认后才能提交新内容。');
    const requestId = globalThis.crypto.randomUUID();
    const kinds = { ...(this.map[scopeKey] ?? {}), [kind]: { requestId, fingerprint, kind, scopeKey, createdAt: new Date().toISOString() } };
    this.map = { ...this.map, [scopeKey]: kinds };
    this.persist();
    return { requestId, replayed: false, replaced: null };
  }

  /** The logical operation is over (accepted, rejected or resolved by receipt). */
  settle(scope: GoalScope, kind: PendingKind, requestId: string): boolean {
    const scopeKey = pendingScopeKey(scope);
    const existing = this.map[scopeKey]?.[kind];
    if (!existing || existing.requestId !== requestId) return false;
    const kinds = { ...this.map[scopeKey] };
    delete kinds[kind];
    this.map = { ...this.map, [scopeKey]: kinds };
    this.persist();
    return true;
  }
}
