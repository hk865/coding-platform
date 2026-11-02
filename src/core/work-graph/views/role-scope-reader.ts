/**
 * The effective-scope read port (`state/role-scope.ts`), implemented over the project's real open responsible links
 * and Session records.
 *
 * The port answers per project, so a line's Session record is read BY REF (`records.readMany` + `decodeSessionRecord`)
 * rather than through `readSession`: the directory refuses another workspace's Session, and a project's role lines
 * must answer for the project. Every private read has one policy — a failure rejects, `not_ready` passes through, and
 * nothing answers `[]` in place of a failure. A project link stops the read first; otherwise one entry per open goal
 * link plus one per open region link, whose modules come from the one pure `effectiveRegions` table.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ModuleRef, ProjectScope, SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { SessionRecord, SessionWorkLink } from '../../../contracts/core/session.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import { roleLineDutyOf, roleScopeOfTarget, type RoleLineDutyV1 } from '../../../contracts/role-lines.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import {
  S2C_OPEN_LINKS_BY_SESSION_LOOKUP, SESSION_LINKS_BY_PROJECT_TARGET_LOOKUP,
  decodeSessionRecord, decodeSessionWorkLink, plainSessionRefKey, plainSessionRefToAggregate,
} from '../sessions/session-record-codecs.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { readStoredDecoded, type ReadRecordTemplates } from '../communication/decision-source/read-support.js';
import { storeFailureToRejection } from './goal-conflicts.js';
import {
  effectiveRegions, type EffectiveScopeReadPort, type EffectiveScopeV1, type RegionClaimV1,
} from '../state/role-scope.js';

/** `sessions.readSession` is not a dependency: the record is read by ref, because `readSession` refuses another
 *  workspace's Session and this port answers per project. */
export type EffectiveScopeReaderDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;   // the project-wide link stream and the Session records
  architecture: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;   // the one current-catalog read
  duties: SessionDutyReadPort;                                              // the fixed role → duty read
};

const SESSION_READ_TEMPLATES: ReadRecordTemplates = {
  notCanonical: 'the Session ref is not canonicalizable JSON',
  couldNotRead: 'the Session record could not be read',
  doesNotExist: 'the Session does not exist',
  unaccounted: 'the record store neither returned nor reported missing the Session',
  damaged: (label, reason) => `the ${label} record is damaged: ${reason}`,
};

export function createEffectiveScopeReader(deps: EffectiveScopeReaderDependencies): EffectiveScopeReadPort {
  const readSessionByRef = (ref: SessionRef): Promise<ReadResult<SessionRecord>> =>
    readStoredDecoded(deps.records, plainSessionRefToAggregate(ref), SESSION_READ_TEMPLATES,
      decodeSessionRecord, 'Session');

  /** The line's own open responsible links (goal, project and region targets). */
  const linksOf = async (session: SessionRef):
  Promise<{ ok: true; value: SessionWorkLink[] } | { ok: false; rejection: CoreRejection }> => {
    let batch;
    try {
      batch = await lookupAll(deps.records, S2C_OPEN_LINKS_BY_SESSION_LOOKUP,
        [session.projectId, session.sessionId, 'responsible', null]);
    } catch (error) {
      return { ok: false, rejection: storeFailureToRejection(error) };
    }
    const links: SessionWorkLink[] = [];
    for (const record of batch.items) {
      const decoded = decodeSessionWorkLink(record);
      if (decoded.status !== 'decoded') {
        return { ok: false, rejection: rejected('unavailable', `the open responsible link ${record.refKey} is not decodable: ${decoded.reason}`) };
      }
      links.push(decoded.value);
    }
    return { ok: true, value: links };
  };

  /** The project's open responsible module links, each owner's duty resolved once per Session record. */
  const regionClaims = async (ctx: CoreCallContext, projectId: string):
  Promise<{ ok: true; value: RegionClaimV1[] } | { ok: false; rejection: CoreRejection }> => {
    let batch;
    try {
      batch = await lookupAll(deps.records, SESSION_LINKS_BY_PROJECT_TARGET_LOOKUP,
        [projectId, 'module', 'responsible', null]);
    } catch (error) {
      return { ok: false, rejection: storeFailureToRejection(error) };
    }
    const entries: { session: SessionRef; moduleRef: ModuleRef }[] = [];
    for (const record of batch.items) {
      const decoded = decodeSessionWorkLink(record);
      if (decoded.status !== 'decoded') {
        return { ok: false, rejection: rejected('unavailable', `the open responsible region link ${record.refKey} is not decodable: ${decoded.reason}`) };
      }
      const link = decoded.value;
      if (link.ref.target.kind !== 'module') continue;
      entries.push({ session: { projectId: link.ref.projectId, sessionId: link.ref.sessionId },
        moduleRef: link.ref.target.ref });
    }
    const duties = new Map<string, RoleLineDutyV1>();
    for (const entry of entries) {
      const key = plainSessionRefKey(entry.session);
      if (duties.has(key)) continue;
      const owner = await readSessionByRef(entry.session);
      if (owner.status !== 'ready') {
        return { ok: false, rejection: owner.status === 'rejected' ? owner
          : rejected('unavailable', 'the Session record could not be read') };
      }
      let resolved: ReadResult<PlatformDutyV1 | 'unknown'>;
      try {
        resolved = await deps.duties(owner.value.role, ctx);
      } catch {
        return { ok: false, rejection: rejected('unavailable', 'session_duty_unknown') };
      }
      if (resolved.status !== 'ready') {
        return { ok: false, rejection: rejected('unavailable', 'session_duty_unknown') };
      }
      const duty = roleLineDutyOf(resolved.value);
      if (duty === null) return { ok: false, rejection: rejected('unavailable', 'session_duty_unknown') };
      duties.set(key, duty);
    }
    return { ok: true, value: entries.map((entry) => ({
      session: entry.session, duty: duties.get(plainSessionRefKey(entry.session))!,
      moduleRef: entry.moduleRef })) };
  };

  /** The current catalog; `not_found` is a lawful "none adopted", every other read outcome is the read's own. */
  const catalog = async (ctx: CoreCallContext): Promise<ReadResult<AdoptedArchitecture | null>> => {
    try {
      const read = await deps.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
      if (read.status === 'ready') return { status: 'ready', value: read.value.catalog.catalog };
      if (read.status === 'not_found') return { status: 'ready', value: null };
      return read;   // a rejected read keeps its own code (a real `source_stale` included) and `not_ready` passes through
    } catch {
      return rejected('unavailable', 'the catalog cannot be read');
    }
  };

  return {
    async readEffectiveScope(ctx, input): Promise<ReadResult<EffectiveScopeV1[]>> {
      if (input.session.projectId !== ctx.projectId) {
        return rejected('forbidden', 'the Session is outside the call context project');
      }
      const open = await linksOf(input.session);
      if (!open.ok) return open.rejection;
      const targets = open.value.map((link) => roleScopeOfTarget(link.ref.target));
      if (targets.some((scope) => scope?.kind === 'project')) return { status: 'ready', value: [{ kind: 'project' }] };
      const goals: EffectiveScopeV1[] = [];
      for (const scope of targets) {
        if (scope?.kind === 'goal') goals.push({ kind: 'goal', goalRef: scope.goalRef });
      }
      goals.sort((left, right) => {
        const leftGoal = left.kind === 'goal' ? left.goalRef.goalId : '';
        const rightGoal = right.kind === 'goal' ? right.goalRef.goalId : '';
        return leftGoal.localeCompare(rightGoal);
      });
      const regionLinks: { kind: 'region'; moduleRef: ModuleRef }[] = [];
      for (const scope of targets) if (scope?.kind === 'region') regionLinks.push(scope);
      if (regionLinks.length === 0) return { status: 'ready', value: goals };
      const catalogRead = await catalog(ctx);
      if (catalogRead.status !== 'ready') return catalogRead;
      const claims = await regionClaims(ctx, input.session.projectId);
      if (!claims.ok) return claims.rejection;
      const effective = effectiveRegions({ regions: claims.value, catalog: catalogRead.value });
      const regions: EffectiveScopeV1[] = [];
      for (const region of regionLinks) {
        const index = claims.value.findIndex((claim) => claim.session.projectId === input.session.projectId
          && claim.session.sessionId === input.session.sessionId
          && claim.moduleRef.projectId === region.moduleRef.projectId
          && claim.moduleRef.moduleId === region.moduleRef.moduleId);
        if (index < 0) {
          return rejected('unavailable', `the line ${input.session.sessionId} has no open responsible region claim for ${region.moduleRef.moduleId}`);
        }
        regions.push({ kind: 'region', moduleRef: region.moduleRef, modules: effective[index]!.modules });
      }
      regions.sort((left, right) => {
        const leftModule = left.kind === 'region' ? left.moduleRef.moduleId : '';
        const rightModule = right.kind === 'region' ? right.moduleRef.moduleId : '';
        return leftModule.localeCompare(rightModule);
      });
      return { status: 'ready', value: [...goals, ...regions] };
    },

    async effectiveRegionOf(ctx, input: { projectRef: ProjectScope; duty: RoleLineDutyV1; moduleRef: ModuleRef }):
    Promise<ReadResult<ModuleRef[]>> {
      if (input.projectRef.projectId !== ctx.projectId) {
        return rejected('forbidden', 'the region belongs to another project');
      }
      const catalogRead = await catalog(ctx);
      if (catalogRead.status !== 'ready') return catalogRead;
      const claims = await regionClaims(ctx, input.projectRef.projectId);
      if (!claims.ok) return claims.rejection;
      const dutyClaims = claims.value.filter((claim) => claim.duty === input.duty);
      const effective = effectiveRegions({ regions: dutyClaims, catalog: catalogRead.value });
      const index = dutyClaims.findIndex((claim) => claim.moduleRef.projectId === input.moduleRef.projectId
        && claim.moduleRef.moduleId === input.moduleRef.moduleId);
      if (index < 0) return { status: 'not_found' };
      return { status: 'ready', value: effective[index]!.modules };
    },
  };
}
