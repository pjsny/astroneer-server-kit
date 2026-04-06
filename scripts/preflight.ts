#!/usr/bin/env bun
import { loadEnv } from "./lib/env";
import { validateToken } from "./lib/github";
import { makeS3Client, } from "./lib/s3";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import * as tf from "./lib/terraform";
import fs from "fs";

const G = "\x1b[32m✓\x1b[0m";
const R = "\x1b[31m✗\x1b[0m";
const Y = "\x1b[33m!\x1b[0m";
const B = "\x1b[1m";
const X = "\x1b[0m";

let passed = 0;
let failed = 0;

function ok(msg: string)   { console.log(`  ${G}  ${msg}`); passed++; }
function fail(msg: string) { console.log(`  ${R}  ${msg}`); failed++; }
function warn(msg: string) { console.log(`  ${Y}  ${msg}`); }

console.log(`\n${B}  Astroneer Server Kit — Preflight${X}`);
console.log("  ─────────────────────────────────\n");

const env = loadEnv();

// ── Tools ──────────────────────────────────────────────────────────────────────

console.log(`${B}  Tools${X}`);
tf.isInstalled() ? ok("terraform") : fail("terraform not installed  →  brew install terraform");
Bun.spawnSync(["ssh", "-V"]).exitCode === 0 ? ok("ssh") : fail("ssh not found");
console.log();

// ── Credentials ────────────────────────────────────────────────────────────────

console.log(`${B}  Credentials${X}`);

if (env.GITHUB_TOKEN) {
  const user = await validateToken(env.GITHUB_TOKEN);
  user ? ok(`GitHub token valid (${user})`) : fail("GitHub token invalid or expired  →  run: bun setup");
} else {
  fail("GITHUB_TOKEN not set  →  run: bun setup");
}

if (env.HCLOUD_TOKEN) {
  const res = await fetch("https://api.hetzner.cloud/v1/servers", {
    headers: { Authorization: `Bearer ${env.HCLOUD_TOKEN}` },
  });
  res.ok ? ok("Hetzner API token valid") : fail("Hetzner token invalid or expired  →  run: bun setup");
} else {
  fail("HCLOUD_TOKEN not set  →  run: bun setup");
}
console.log();

// ── SSH Key ────────────────────────────────────────────────────────────────────

console.log(`${B}  SSH Key${X}`);
const sshKey = env.SSH_KEY ?? `${process.env.HOME}/.ssh/astro-server`;
fs.existsSync(sshKey) && fs.existsSync(`${sshKey}.pub`)
  ? ok(`SSH key at ${sshKey}`)
  : fail(`SSH key not found  →  run: bun setup`);
console.log();

// ── Infrastructure ─────────────────────────────────────────────────────────────

console.log(`${B}  Infrastructure${X}`);

if (env.HETZNER_S3_ACCESS_KEY && env.HETZNER_S3_SECRET_KEY) {
  try {
    const s3 = makeS3Client(env.HETZNER_S3_ACCESS_KEY, env.HETZNER_S3_SECRET_KEY);
    await s3.send(new HeadBucketCommand({ Bucket: "astro-server-tf-state" }));
    ok("Terraform state bucket exists");
  } catch {
    fail("State bucket missing  →  run: bun setup");
  }
} else {
  fail("S3 credentials not set  →  run: bun setup");
}

if (env.HCLOUD_TOKEN) {
  const res = await fetch("https://api.hetzner.cloud/v1/volumes?name=astro-saves", {
    headers: { Authorization: `Bearer ${env.HCLOUD_TOKEN}` },
  });
  const data = await res.json() as { volumes: unknown[] };
  data.volumes?.length > 0
    ? ok("Saves volume exists")
    : fail("Saves volume not found  →  run: bun setup");

  const serverRes = await fetch("https://api.hetzner.cloud/v1/servers?name=astro-server", {
    headers: { Authorization: `Bearer ${env.HCLOUD_TOKEN}` },
  });
  const serverData = await serverRes.json() as { servers: unknown[] };
  serverData.servers?.length > 0
    ? warn("Server is currently running")
    : ok("Server is stopped (expected when idle)");
}
console.log();

// ── Summary ────────────────────────────────────────────────────────────────────

if (failed === 0) {
  console.log(`  \x1b[32m\x1b[1mAll checks passed! Run 'bun start' to spin up the server.\x1b[0m\n`);
} else {
  console.log(`  \x1b[31m\x1b[1m${failed} check(s) failed. Run 'bun run setup' to fix.\x1b[0m\n`);
  process.exit(1);
}
