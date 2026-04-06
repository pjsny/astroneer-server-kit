import type { Provider } from './types.js';
import { hetzner } from './hetzner.js';

// Registry of all available providers.
// Add new providers here as more are supported.
export const providers: Provider[] = [hetzner];

// The default provider used for new setups.
export const defaultProvider = hetzner;

export type { Provider };
