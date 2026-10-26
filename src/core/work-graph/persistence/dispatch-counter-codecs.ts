/**
 * The dispatch counter's RecordStore codec: one record format and the schemas both backends register. The counter has
 * no event; the send owner writes it inside its own commit.
 */
import { DispatchCounterFormat } from '../../../contracts/dispatch-counter-format.js';
import { createRecordCodec, formatSchemas } from './field-table-codec.js';

export const dispatchCounterCodec = createRecordCodec(DispatchCounterFormat);
export const DISPATCH_COUNTER_SCHEMAS = formatSchemas([dispatchCounterCodec]);
