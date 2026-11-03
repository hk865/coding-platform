// Slice 8E L1 (spec §2): the semantic layer's read projections. Pure types only:
// this file imports `./note.js` and nothing from `W/`, so the Host routes, E3 and
// the ninth slice can consume it without an upward dependency.
import type {
  LinkEndRequestV1, LinkEvidenceStoredV1, LinkPayloadV1, LinkVerificationV1, NoteAnchorV1, NoteSourceV1,
  SemanticRelationV1,
} from './note.js';

/** Endpoint identity (N1, C13): identity comes from the stored raw request, not from whether resolution succeeded. */
export type SemanticEndV1 = {
  anchor: NoteAnchorV1;                         // the stored anchor (a file anchor carries the L14 symbol locator)
  request: LinkEndRequestV1;                    // the raw request; identity is computed from this
  moduleId: string | null;                      // the module the current directory attributes it to
  unresolved: 'ambiguous' | 'not_owned' | null; // the reason when moduleId is null
  anchorStatus: 'live' | 'retired';             // this anchor slot's own status, from the slot's check
  anchorRetiredReasons: ('module_removed' | 'interface_removed' | 'file_deleted'
    | 'task_ended' | 'stage_not_in_current_plan' | 'symbol_missing')[];
};

/** The link row a semantic read returns. */
export type SemanticLinkV1 = {
  noteId: string; version: number; state: 'accepted' | 'reviewed' | 'pending_review';
  relation: SemanticRelationV1; from: SemanticEndV1; to: SemanticEndV1; via: SemanticEndV1 | null;
  key: Exclude<LinkPayloadV1['key'], undefined>;           // read as null for injects and callback
  evidence: Omit<LinkEvidenceStoredV1, 'fileDigest' | 'digestBasis'>[];
  verification: LinkVerificationV1;             // the read-time result
  currentEligible: boolean;                     // current state, fresh, not conflicting, source available, ends not retired, evidence not broken/unchecked
  topic: string; conclusion: string; source: NoteSourceV1; goalId: string | null; confirmedByUser: boolean;
  freshness: 'fresh' | 'stale' | 'unchecked';
};

/**
 * The read-time link payload (N10): the stored verification only has the two
 * write-time states, while a read may produce any of the four. The stored narrow
 * union is not widened to hold read results.
 */
export type LinkReadPayloadV1 = Omit<LinkPayloadV1, 'verification'> & { verification: LinkVerificationV1 };

export type SemanticScopeV1 = { kind: 'project' } | { kind: 'module'; moduleId: string } | { kind: 'file'; path: string };

/** The paging envelope the links and flows reads share. */
export type SemanticPageV1<T> = { items: T[]; next: string | null; catalogRevision: number | null };
