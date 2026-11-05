/**
 * `role-lines/read` and the stored-name batch read (L44, book :1324).
 *
 * The port's ONE implementer and decode point: the same key and codec the
 * allocation reader uses (`role-line-allocation-reader.ts:251–:274`), no second
 * fact table. One row per line stands on the 2C line row; the added fields are
 * additive and `standby` stays the row's own reason.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { CreatorContactV1, SessionRoleFactsV1 } from '../../../contracts/role-lines.js';
import type { LineRowV1, RoleFactsReadPort, RoleLineSeatV1 } from '../../../contracts/work-line.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RoleLineAllocationReadPort } from '../model/session-contracts.js';
import type { WorkLineReadPort } from '../model/work-line-contracts.js';
import { sessionRoleFactsCodec } from '../sessions/role-line-record-codecs.js';
import { plainSessionRefKey } from '../sessions/session-record-codecs.js';
import type { RoleLinePositionV1 } from '../state/role-line-position.js';   // O2's one value, unchanged
import type { EffectiveScopeReadPort, EffectiveScopeV1 } from '../state/role-scope.js';

/** One row per line: the 2C row is the row; the fields are additive, `standby` stays the row's own reason. */
export type RoleLineReadV1 = {
  row: LineRowV1;                                  // name/status/chain/controls: the one assembly
  scope: EffectiveScopeV1[];                       // the same array O4b's pick reads; still 7D1's scope type
  creator: CreatorContactV1;                       // 7D1 creatorOf over the real contact
  seat: RoleLineSeatV1;
  /** O2's values, consumed unchanged, one per effective scope in `scope` order; a region's `unknown` burden is a
   *  position, never an omitted entry. Empty only where the row has no O2 arm (a project-only line). */
  position: readonly RoleLinePositionV1[];
};
export type RoleLineReadResultV1 = { rows: readonly RoleLineReadV1[] };

export interface RoleLineReadPort {
  readRoleLines(ctx: CoreCallContext, input: { workspace: WorkspaceScope }):
    Promise<ReadResult<RoleLineReadResultV1>>;
}

export function createRoleFactsRead(deps: {
  records: Pick<GoalRecordTransactionPort, 'readMany'>;
}): RoleFactsReadPort {
  return {
    async readRoleFacts(ctx, input) {
      const keys = [...new Set(input.sessions.map((ref) => canonicalJson({
        aggregateType: 'SessionRoleFacts', projectId: ref.projectId, sessionId: ref.sessionId,
      } as unknown as JsonValue)))];
      if (keys.length === 0) return { status: 'ready', value: new Map() };
      const read = await deps.records.readMany(keys);
      if (read.status !== 'ready') {
        return rejected('unavailable', `the stored role facts read failed: ${read.reason}`);
      }
      const storedByKey = new Map(read.value.records.map((record) => [record.refKey, record]));
      const facts = new Map<string, SessionRoleFactsV1>();
      for (const key of keys) {
        const stored = storedByKey.get(key);
        if (stored === undefined) continue;                 // absence is no stored name, not a failed page
        const decoded = sessionRoleFactsCodec.decode(stored);
        if (decoded.status !== 'decoded') {
          return rejected('unavailable', 'the stored role facts are damaged');
        }
        facts.set(plainSessionRefKey(decoded.value.sessionRef), decoded.value);
      }
      return { status: 'ready', value: facts };
    },
  };
}

export function createRoleLineRead(deps: {
  lines: WorkLineReadPort;
  scopes: EffectiveScopeReadPort;
  allocation: Pick<RoleLineAllocationReadPort, 'readRoleLineAllocation'>;
  /** O2's position values, one per effective scope in order (region `unknown` included); empty where no arm fits. */
  positionOf: (ctx: CoreCallContext, input: { row: LineRowV1; scope: EffectiveScopeV1[] })
    => Promise<ReadResult<readonly RoleLinePositionV1[]>>;
}): RoleLineReadPort {
  return {
    async readRoleLines(ctx, input) {
      const listed = await deps.lines.listWorkLines(ctx, { workspace: input.workspace });
      if (listed.status !== 'ready') return listed;
      // One allocation read, flattened per duty into (session -> creator, seat); never a second creator walk.
      const allocation = await deps.allocation.readRoleLineAllocation(ctx, {});
      if (allocation.status !== 'ready') return allocation;
      const holders = new Map<string, { creator: CreatorContactV1; since: CommitCursor }>();
      for (const duty of Object.values(allocation.value.duties)) {
        for (const holder of duty.holders) holders.set(plainSessionRefKey(holder.session), { creator: holder.creator, since: holder.since });
      }
      const rows: RoleLineReadV1[] = [];
      for (const row of listed.value.rows) {
        // A failed scope or position read fails the read; it is never `[]` (v4 :5924).
        const scope = await deps.scopes.readEffectiveScope(ctx, { session: row.key });
        if (scope.status !== 'ready') return scope;
        const position = await deps.positionOf(ctx, { row, scope: scope.value });
        if (position.status !== 'ready') return position;
        const holder = holders.get(plainSessionRefKey(row.key));
        rows.push({ row, scope: scope.value, creator: holder?.creator ?? { kind: 'unknown' },
          seat: holder === undefined ? { status: 'none' } : { status: 'held', since: holder.since },
          position: position.value });
      }
      return { status: 'ready', value: { rows } };
    },
  };
}
