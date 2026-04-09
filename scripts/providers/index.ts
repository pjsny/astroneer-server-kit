import type { Provider } from "./types.js";
import { fly } from "./fly.js";

export const providers: Provider[] = [fly];

export const defaultProvider = providers[0] as Provider;

export type { Provider };
