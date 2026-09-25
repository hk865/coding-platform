export class SerialToolBatchPolicy {
    plan(calls) {
        return calls.map((call) => ({ mode: "serial", callIds: [call.callId] }));
    }
}
//# sourceMappingURL=tool-batch-policy-port.js.map