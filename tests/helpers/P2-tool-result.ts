/** The tool result the model received for `callId`: the Kernel envelope on error, else the JSON body. */
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';

export function toolResultOf(requests: readonly ModelRequest[], callId: string): unknown {
  for (const request of requests) {
    for (const message of request.messages) {
      if (message.role !== 'tool' || message.callId !== callId) continue;
      if (message.result.status === 'error') return message.result;
      const json = message.result.output.find(part => part.kind === 'json');
      return json === undefined ? undefined : json.value;
    }
  }
  return undefined;
}
