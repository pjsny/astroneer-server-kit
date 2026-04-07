#!/usr/bin/env bun
import { loadEnv } from "./lib/env.js";
import * as tf from "./lib/terraform.js";
import { vultrTerraformEnv } from "./providers/vultr.js";

function missingKeys(env: Record<string, string | undefined>, keys: string[]): string[] {
  return keys.filter(k => !env[k]?.trim());
}

const env = loadEnv() as Record<string, string | undefined>;
const required = [
  "VULTR_API_KEY",
  "VULTR_S3_BUCKET",
  "VULTR_S3_ACCESS_KEY",
  "VULTR_S3_SECRET_KEY",
  "VULTR_S3_ENDPOINT",
];
const missing = missingKeys(env, required);
if (missing.length) {
  console.error(`Missing in .env: ${missing.join(", ")}`);
  console.error("Run: make setup");
  process.exit(1);
}

const tfe = vultrTerraformEnv(env);

console.log("terraform init…");
const init = await tf.init(tfe);
if (!init.ok) {
  console.error(init.error ?? "init failed");
  process.exit(1);
}

console.log("\nterraform apply (provisions / updates the Vultr instance — several minutes)…\n");
const applied = await tf.apply(tfe);
if (!applied.ok) {
  console.error(applied.error ?? "apply failed");
  process.exit(1);
}

const ip = await tf.output(tfe, "server_ip");
console.log(`\nReady. Connect in-game to: ${ip ?? "(no IP)"}:8777`);
console.log("First boot installs Wine + Steam — wait 15–25+ minutes before expecting players.");
