#!/usr/bin/env bun
import fs from "fs";
import { loadEnv } from "./lib/env.js";
import * as tf from "./lib/terraform.js";
import { vultrTerraformEnv } from "./providers/vultr.js";

/** Destroy VM + firewall + SSH key; keep block volume. */
const DESTROY_TARGETS = [
  "vultr_instance.astro",
  "vultr_firewall_rule.astro_tcp",
  "vultr_firewall_rule.astro_udp",
  "vultr_firewall_rule.astro_ssh",
  "vultr_firewall_group.astro",
  "vultr_ssh_key.astro",
];

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
if (!exists) {
  console.log("No server in Terraform state (already stopped).");
  process.exit(0);
}

const ip = await tf.output(tfe, "server_ip");
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

console.log("\nterraform destroy (compute only; saves volume kept)…\n");
const destroyed = await tf.destroyTargets(tfe, DESTROY_TARGETS);
if (!destroyed.ok) {
  console.error(destroyed.error ?? "destroy failed");
  process.exit(1);
}

console.log("\nStopped. World data remains on the Vultr block volume.");
