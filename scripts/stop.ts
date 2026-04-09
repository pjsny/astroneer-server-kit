#!/usr/bin/env bun
import { loadEnv } from "./lib/env.js";
import { flyCmdAsync } from "./lib/fly.js";

function missingKeys(env: Record<string, string | undefined>, keys: string[]): string[] {
  return keys.filter(k => !env[k]?.trim());
}

const env = loadEnv() as Record<string, string | undefined>;
const missing = missingKeys(env, ["FLY_API_TOKEN", "FLY_APP_NAME"]);
if (missing.length) {
  console.error(`Missing in .env: ${missing.join(", ")}`);
  process.exit(1);
}

const app = env.FLY_APP_NAME!.trim();
const fe = {
  ...process.env,
  FLY_API_TOKEN: env.FLY_API_TOKEN!.trim(),
  FLY_ACCESS_TOKEN: env.FLY_API_TOKEN!.trim(),
};

console.log(`Scaling ${app} to 0 machines (saves stay on the Fly volume)…\n`);
const r = await flyCmdAsync(["scale", "count", "0", "--yes", "-a", app], fe, { inheritIo: true });
if (!r.ok) {
  console.error(r.stderr || "fly scale failed");
  process.exit(1);
}
console.log("\nStopped. Run make start to deploy again.");
