/**
 * The owner single-record read's one copy lives in `persistence/owner-record-read.ts`, where `sessions` may import
 * it too; this old path stays as a re-export so the existing importers keep their import.
 */
export { readOwnerRecord, type OwnerRecordRead } from '../persistence/owner-record-read.js';
