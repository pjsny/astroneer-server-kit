import type { Provider } from "./types.js";
import { vultr } from "./vultr.js";

export const providers: Provider[] = [vultr];

export const defaultProvider = providers[0] as Provider;

export type { Provider };
