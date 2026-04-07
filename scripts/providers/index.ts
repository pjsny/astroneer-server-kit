import type { Provider } from './types.js';

// No providers registered yet.
// Once you've chosen a cloud provider, create a file in this directory
// implementing the Provider interface from types.ts and register it here.
export const providers: Provider[] = [];

export const defaultProvider = providers[0] as Provider | undefined;

export type { Provider };
