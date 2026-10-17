// Slice 4C RW-13 (decision 72 / spec item 13) and slice 8A: this module used to
// own the ONE pure path-ownership decision. It is now a thin re-export of the
// canonical Contracts-layer implementation (`contracts/path-ownership.ts`),
// kept under its existing names so the WorkGraph note readers' import path does
// not change. Directory boundary is `/`; one trailing `/` is stripped from each
// candidate path; the longest matched prefix wins; a tie at the longest length is
// REPORTED with ALL tied candidate values (`tie`) and each caller decides whether
// a tie owns anything. Slice 8A adds the root path `.` (match length 0, lowest
// priority; several `.` candidates tie) and `''` is owned by nobody. No
// backslash handling.
export { pathOwnershipOf, type PathOwnershipV1 } from '../../../contracts/path-ownership.js';
