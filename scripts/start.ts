#!/usr/bin/env bun
import { loadEnv } from "./lib/env";
import { triggerWorkflow } from "./lib/github";

const env = loadEnv();

if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
  console.error("Not configured. Run: bun run setup");
  process.exit(1);
}

const hours = process.argv[2] ?? "6";

console.log("Starting server...");
await triggerWorkflow(env.GITHUB_TOKEN, env.GITHUB_REPO, "start.yml", {
  session_hours: hours,
});

console.log(`\nKicked off! The server will be ready in ~3 minutes.`);
console.log(`Check for your IP at: https://github.com/${env.GITHUB_REPO}/actions`);
