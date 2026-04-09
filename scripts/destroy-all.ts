#!/usr/bin/env bun
import { loadEnv } from "./lib/env.js";
import { flyCmdAsync } from "./lib/fly.js";

const env = loadEnv() as Record<string, string | undefined>;
const app = env.FLY_APP_NAME?.trim();
const token = env.FLY_API_TOKEN?.trim();
if (!app || !token) {
  console.error("Missing FLY_APP_NAME or FLY_API_TOKEN");
  process.exit(1);
}

const fe = { ...process.env, FLY_API_TOKEN: token, FLY_ACCESS_TOKEN: token };

console.log(`Destroying Fly app ${app} (including Machines; volumes released — data may be purged per Fly policy)…\n`);
const r = await flyCmdAsync(["apps", "destroy", app, "--yes"], fe, { inheritIo: true });
if (!r.ok) {
  console.error(r.stderr || "fly apps destroy failed");
  process.exit(1);
}
console.log("\nDestroyed. Run make setup to create a new app + volume.");
