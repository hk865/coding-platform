/** Durable identity for an operation spanning Store and Kernel effects. */
export type OperationRef = { aggregateType: 'CoreOperation'; projectId: string; operationId: string };
