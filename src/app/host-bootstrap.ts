import { buildBootstrapCommand, type WorkspaceBootstrapEntry, type WorkspaceBootstrapReceipt, type BootstrapManifestSnapshot } from '../contracts/bootstrap.js';
import type { StateLedger } from '../contracts/ledger.js';
import { canonicalJson } from '../contracts/fingerprint.js';

/** Host mounting metadata is not a bootstrap identity. Historical hosts could
 * hash root/name with the entries; their canonical manifest still records the
 * original project/workspace identities. Recognize that already-created store
 * without rewriting its manifest or weakening the Ledger's empty-store guard. */
export async function ensureHostBootstrap(ledger: StateLedger,
  bootstrap: (command: ReturnType<typeof buildBootstrapCommand>) => Promise<WorkspaceBootstrapReceipt>,
  scopes: readonly WorkspaceBootstrapEntry[]): Promise<void> {
  const entries = scopes.map(({ projectId, workspaceId }) => ({ projectId, workspaceId }));
  const command = buildBootstrapCommand({ schemaVersion: 1, entries }, {
    commandId: 'gui-bootstrap-v1', correlationId: 'gui-bootstrap-v1', submittedAt: '2026-09-07T00:00:00.000Z',
  });
  const receipt = await bootstrap(command);
  if (receipt.status === 'committed') return;
  if (receipt.code === 'not_empty') {
    const first = (await ledger.events({ afterCursor: null, limit: 1 })).events[0]?.event;
    if (first?.eventType === 'ProjectBootstrapped') {
      const sourceDigest = first.payload.sourceDigest;
      const stored = await ledger.load({ aggregateType: 'BootstrapManifest', manifestId: sourceDigest });
      if (stored.status === 'found' && stored.snapshot.ref.aggregateType === 'BootstrapManifest') {
        const manifest = stored.snapshot as BootstrapManifestSnapshot;
        const normalized = manifest.entries.map(({ projectId, workspaceId }) => ({ projectId, workspaceId }));
        const identities = (rows: WorkspaceBootstrapEntry[]) => rows.map(row => canonicalJson(row)).sort();
        if (manifest.schemaVersion === 1 && manifest.bootstrapRevision === 1 && manifest.revision === 1 &&
            manifest.sourceDigest === sourceDigest && manifest.ref.manifestId === sourceDigest &&
            canonicalJson(identities(normalized)) === canonicalJson(identities(entries))) {
          let complete = true;
          for (const entry of entries) {
            const project = await ledger.load({ aggregateType: 'Project', projectId: entry.projectId });
            const workspace = await ledger.load({ aggregateType: 'Workspace', ...entry });
            if (project.status !== 'found' || project.snapshot.ref.aggregateType !== 'Project' || project.snapshot.revision < 1 ||
                workspace.status !== 'found' || workspace.snapshot.ref.aggregateType !== 'Workspace' || workspace.snapshot.revision < 1) complete = false;
          }
          if (complete) return;
        }
      }
    }
  }
  throw Error(JSON.stringify(receipt));
}
