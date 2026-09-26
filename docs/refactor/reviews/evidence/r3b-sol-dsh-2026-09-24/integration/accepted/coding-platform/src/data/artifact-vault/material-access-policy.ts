/**
 * Compatibility re-export only.
 *
 * The material grant / exact-basis / provenance rules moved to WorkGraph
 * (`core/work-graph/materials/applicability.ts`). This module keeps the old
 * import path used by the existing Host, harness and vault consumers so the
 * migration leaves exactly one implementation of the rules.
 */
export { createMaterialAccessResolver } from '../../core/work-graph/materials/applicability.js';
