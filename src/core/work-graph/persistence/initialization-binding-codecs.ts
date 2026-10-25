/**
 * The initialization binding's RecordStore codec: one record format, its two candidate lookups and the schemas both
 * backends register. The binding has no event; the confirm owner writes it inside its own commit.
 */
import { InitializationBindingFormat } from '../../../contracts/initialization-binding.js';
import { createRecordCodec, formatSchemas } from './field-table-codec.js';

export const initializationBindingCodec = createRecordCodec(InitializationBindingFormat);
export const INITIALIZATION_BINDING_SCHEMAS = formatSchemas([initializationBindingCodec]);
