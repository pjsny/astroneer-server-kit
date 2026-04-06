#!/usr/bin/env bun
import {
  intro,
  outro,
  text,
  password,
  spinner,
  note,
  confirm,
  isCancel,
  cancel,
} from "@clack/prompts";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { loadEnv, writeEnv, repoRoot } from "./lib/env";
import { ensureBucket } from "./lib/s3";
import { setSecret, validateToken } from "./lib/github";
import * as tf from "./lib/terraform";

function bail(msg: string): never {
  cancel(msg);
  process.exit(1);
}

function check<T>(val: T | symbol): T {
  if (isCancel(val)) bail("Setup cancelled.");
  return val as T;
}

async function detectRepo(): Promise<string | null> {
  try {
    const remote = execSync("git remote get-url origin", { encoding: "utf8" }).trim();
    const match =
      remote.match(/github\.com[:/](.+?\/.+?)(?:\.git)?$/) ||
      remote.match(/github\.com\/(.+?\/.+?)(?:\.git)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function generateSshKey(keyPath: string) {
  if (fs.existsSync(keyPath)) return false;
  const proc = Bun.spawnSync([
    "ssh-keygen", "-t", "ed25519", "-f", keyPath, "-N", "", "-C", "astroneer-server",
  ]);
  if (proc.exitCode !== 0) throw new Error("ssh-keygen failed");
  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────

intro("Astroneer Server Kit — Setup");

const saved = loadEnv();

// Check terraform
if (!tf.isInstalled()) {
  bail("Terraform is not installed. Install it with: brew install terraform");
}

// Detect repo
const detectedRepo = await detectRepo();
const repoInput = check(
  await text({
    message: "GitHub repo (owner/name)",
    placeholder: "yourname/astroneer-server-kit",
    initialValue: detectedRepo ?? saved.GITHUB_REPO ?? "",
    validate: (v) => (v.includes("/") ? undefined : "Must be in owner/repo format"),
  })
);
const GITHUB_REPO = repoInput.trim();
const REPO_URL = `https://github.com/${GITHUB_REPO}`;

// GitHub token
note(
  "Create a token at: github.com/settings/tokens\nScopes needed: repo, workflow",
  "GitHub Personal Access Token"
);
const githubTokenInput = check(
  await password({
    message: "GitHub token",
    validate: (v) => (v.length > 0 ? undefined : "Required"),
  })
);
const GITHUB_TOKEN = githubTokenInput.trim();

const s1 = spinner();
s1.start("Validating GitHub token");
const ghUser = await validateToken(GITHUB_TOKEN);
if (!ghUser) bail("GitHub token is invalid or missing repo/workflow scopes.");
s1.stop(`GitHub token valid (${ghUser})`);

// Hetzner Cloud token
note(
  "console.hetzner.cloud → your project → Security → API Tokens → Generate",
  "Hetzner Cloud API Token"
);
const hcloudTokenInput = check(
  await password({
    message: "Hetzner Cloud API token",
    validate: (v) => (v.length > 0 ? undefined : "Required"),
  })
);
const HCLOUD_TOKEN = hcloudTokenInput.trim();

// Hetzner S3 credentials
note(
  "console.hetzner.cloud → your project → Security → S3 Credentials → Generate",
  "Hetzner Object Storage"
);
const s3KeyInput = check(
  await text({
    message: "Object Storage Access Key",
    validate: (v) => (v.length > 0 ? undefined : "Required"),
  })
);
const HETZNER_S3_ACCESS_KEY = s3KeyInput.trim();

const s3SecretInput = check(
  await password({
    message: "Object Storage Secret Key",
    validate: (v) => (v.length > 0 ? undefined : "Required"),
  })
);
const HETZNER_S3_SECRET_KEY = s3SecretInput.trim();

// SSH key
const SSH_KEY = path.join(process.env.HOME!, ".ssh/astro-server");
const s2 = spinner();
s2.start("Setting up SSH key");
const created = await generateSshKey(SSH_KEY);
s2.stop(created ? `SSH key created at ${SSH_KEY}` : `SSH key already exists at ${SSH_KEY}`);

const sshPublicKey = fs.readFileSync(`${SSH_KEY}.pub`, "utf8").trim();

// Terraform env
const tfEnvArgs = {
  hcloudToken: HCLOUD_TOKEN,
  sshPublicKey,
  repoUrl: REPO_URL,
  s3AccessKey: HETZNER_S3_ACCESS_KEY,
  s3SecretKey: HETZNER_S3_SECRET_KEY,
};

// Create state bucket
const s3 = spinner();
s3.start("Creating Terraform state bucket");
const bucketCreated = await ensureBucket(HETZNER_S3_ACCESS_KEY, HETZNER_S3_SECRET_KEY);
s3.stop(bucketCreated ? "State bucket created" : "State bucket already exists");

// Terraform init
const s4 = spinner();
s4.start("Initializing Terraform");
const initOk = await tf.init(tfEnvArgs);
if (!initOk) bail("Terraform init failed. Check your credentials.");
s4.stop("Terraform initialized");

// Create saves volume
const s5 = spinner();
s5.start("Creating persistent saves volume");
const volumeExists = await tf.stateShow(tfEnvArgs, "hcloud_volume.saves");
if (!volumeExists) {
  const ok = await tf.applyTarget(tfEnvArgs, "hcloud_volume.saves");
  if (!ok) bail("Failed to create saves volume.");
}
s5.stop(volumeExists ? "Saves volume already exists" : "Saves volume created");

// Set GitHub secrets
const s6 = spinner();
s6.start("Setting GitHub Actions secrets");
const secrets: Record<string, string> = {
  HCLOUD_TOKEN,
  HETZNER_S3_ACCESS_KEY,
  HETZNER_S3_SECRET_KEY,
  SSH_PUBLIC_KEY: sshPublicKey,
  SSH_PRIVATE_KEY: fs.readFileSync(SSH_KEY, "utf8"),
};
for (const [name, value] of Object.entries(secrets)) {
  await setSecret(GITHUB_TOKEN, GITHUB_REPO, name, value);
}
s6.stop("All GitHub secrets set");

// Write .env
writeEnv({
  HCLOUD_TOKEN,
  HETZNER_S3_ACCESS_KEY,
  HETZNER_S3_SECRET_KEY,
  GITHUB_TOKEN,
  GITHUB_REPO,
  SSH_KEY,
});

outro(
  `All done!\n\n  bun start   spin up the server\n  bun stop    shut it down\n  make ssh    SSH into the running server\n  make logs   tail the server logs`
);
