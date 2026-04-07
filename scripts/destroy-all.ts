#!/usr/bin/env bun
import fs from "fs";
import path from "path";
import { clearVultrS3EnvPlaceholders, loadEnv } from "./lib/env.js";
import * as tf from "./lib/terraform.js";
import { vultrBootstrapTerraformEnv, vultrTerraformEnv } from "./providers/vultr.js";

const REPO_ROOT = path.resolve(import.meta.dir, "..");

/** Full teardown: terraform/vultr (VM, volume, …) then terraform/bootstrap (Object Storage / state bucket). */

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

const exists = await tf.stateShow(tfe, "vultr_instance.astro");
const ip = exists ? await tf.output(tfe, "server_ip") : null;
const keyPath = env.SSH_KEY ?? `${process.env.HOME}/.ssh/astro-server`;

if (ip?.length && fs.existsSync(keyPath)) {
  console.log(`Stopping astroneer service on ${ip}…`);
  Bun.spawnSync([
    "ssh",
    "-i",
    keyPath,
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "ConnectTimeout=15",
    `root@${ip}`,
    "systemctl stop astroneer || true",
  ]);
}

console.log("\nterraform destroy (full stack — including saves volume)…\n");
const destroyed = await tf.destroyAll(tfe);
if (!destroyed.ok) {
  console.error(destroyed.error ?? "destroy failed");
  process.exit(1);
}

console.log("\nAll resources in terraform/vultr are destroyed.");

const bootstrapState = path.join(REPO_ROOT, "terraform/bootstrap/terraform.tfstate");
if (!fs.existsSync(bootstrapState)) {
  console.log(
    "\nNo terraform/bootstrap/terraform.tfstate — skipped Object Storage teardown. If a subscription still exists, remove it in the Vultr dashboard.",
  );
  process.exit(0);
}

const bootstrapEnv = vultrBootstrapTerraformEnv(env);
console.log("\nterraform/bootstrap: destroying Object Storage subscription (Terraform remote state bucket)…\n");
const bootInit = await tf.init(bootstrapEnv);
if (!bootInit.ok) {
  console.error(bootInit.error ?? "bootstrap init failed");
  process.exit(1);
}
const bootDestroy = await tf.destroyAll(bootstrapEnv);
if (!bootDestroy.ok) {
  console.error(bootDestroy.error ?? "bootstrap destroy failed");
  process.exit(1);
}

clearVultrS3EnvPlaceholders(REPO_ROOT);
console.log("Cleared VULTR_S3_* entries in .env (stale keys removed).");

console.log("\nObject Storage subscription from setup is destroyed. Run `make setup` before `make start` again.");
