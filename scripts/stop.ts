#!/usr/bin/env bun
import { loadEnv } from "./lib/env";
import { triggerWorkflow } from "./lib/github";

const env = loadEnv();

if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
  console.error("Not configured. Run: bun run setup");
  process.exit(1);
}

console.log("Stopping server...");
await triggerWorkflow(env.GITHUB_TOKEN, env.GITHUB_REPO, "stop.yml");

console.log("\nShutdown triggered. World saves are safe.");
console.log(`Track progress at: https://github.com/${env.GITHUB_REPO}/actions`);
