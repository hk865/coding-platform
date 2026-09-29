import { retry } from './retry.mjs';
export const callClient = (operation, options) => retry(operation, options);
