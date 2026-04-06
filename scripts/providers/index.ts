import type { Provider } from './types.js';
import { digitalocean } from './digitalocean.js';
import { hetzner } from './hetzner.js';

// Registry of all supported providers.
// Disabled providers are shown in the UI but cannot be selected.
export const providers: Provider[] = [digitalocean, hetzner];

export const defaultProvider = digitalocean;

export type { Provider };
