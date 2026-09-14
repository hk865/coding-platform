import fs from 'node:fs';

const sourcePath = 'src/control/control-engine/coordination.ts';
const targetPath = 'src/control/control-engine/coordination/admission-support.ts';
let source = fs.readFileSync(sourcePath, 'utf8');

const slice = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`missing extraction marker: ${start}`);
  return source.slice(from, to);
};

const primary = slice('type WriteRejectionCode =', '// ------------------------------------------------------------------------ //\n// Control 受理面');
const waitValidation = slice('function checkWaitTerm(', '/**\n * 下一页 route intent');
const receiptHelpers = slice('type AdmitRejection =', '\n\nexport type { CoordinationRegistrySnapshot');
const exported = new Set([
  'asRecord', 'requireString', 'requireIsoTimestamp', 'checkCommandShape',
  'checkWorkContextRef', 'checkParticipationRef', 'checkRunRef', 'checkArtifactRef',
  'utf8Bytes', 'checkAgentAttribution', 'checkSchedulerAttribution', 'rejectWrite',
  'mapCommitReceipt', 'checkWaitTerm', 'checkDeliveryRefShape',
  'checkWaitConditionRefShape', 'checkRoutePageProposal', 'admitReject',
  'ensureAdmissionReject', 'mapSettleCommitRejection',
]);
const expose = (text) => text.replace(/^function (\w+)/gm, (whole, name) => exported.has(name) ? `export function ${name}` : whole);

const target = `import type { CommandIdentity } from '../../../contracts/command-event.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import type { LedgerCommitReceipt, VersionedRef } from '../../../contracts/ledger.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { WorkContextRef } from '../../../contracts/context-continuity.js';
import type { ValidationIssue } from '../../../contracts/validation/common.js';
import { validateActor } from '../../../contracts/validation/identity.js';
import type {
  AdmitWaitSuccessorReceipt,
  AgentPrincipalRefV1,
  CommunicationSettleReceipt,
  CommunicationWriteReceipt,
  EnsureWaitAdmissionReceipt,
  WorkParticipationRef,
} from '../../../contracts/coordination.js';

/** Pure command-shape, attribution and receipt mapping for coordination admission. */
${expose(primary)}
function isLedgerCursor(value: unknown): boolean {
  return typeof value === 'string' && /^c\\d{10}$/.test(value);
}

${expose(waitValidation)}
${expose(receiptHelpers)}
`;

source = source.replace(primary, '');
source = source.replace(waitValidation, '');
source = source.replace(receiptHelpers, '');
source = source.replace(/\nfunction isLedgerCursor\(value: unknown\): boolean \{\n  return typeof value === "string" && \/\^c\\d\{10\}\$\/\.test\(value\);\n\}\n/, '\n');
const importAnchor = 'import { readMailboxView } from "./coordination/mailbox-view.js";';
const importedNames = [...exported].sort().join(',\n  ');
source = source.replace(importAnchor, `${importAnchor}\nimport {\n  ${importedNames},\n} from "./coordination/admission-support.js";`);

fs.writeFileSync(targetPath, target);
fs.writeFileSync(sourcePath, source);
console.log(JSON.stringify({ targetPath, exported: [...exported], sourceBytes: source.length, targetBytes: target.length }, null, 2));
