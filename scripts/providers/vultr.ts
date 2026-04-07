import fs from "fs";
import type { Provider } from "./types.js";
import * as tf from "../lib/terraform.js";
import type { TerraformEnv } from "../lib/terraform.js";
import { resolveRepoUrl } from "../lib/repo.js";
import { DEFAULT_VULTR_PLAN_SLUG } from "./vultr-plans.js";
import { VULTR_REGION_OPTIONS } from "./vultr-regions.js";

const TF_DIR = "terraform/vultr";
const BOOTSTRAP_TF_DIR = "terraform/bootstrap";

function vultrTfVarsFromEnv(env: Record<string, string | undefined>): Record<string, string> {
  const creds = env as Record<string, string>;
  const sshKeyPath = env.SSH_KEY ?? `${process.env.HOME}/.ssh/astro-server`;
  const sshPublicKey = fs.readFileSync(`${sshKeyPath}.pub`, "utf8").trim();
  return {
    vultr_api_key:   creds.VULTR_API_KEY ?? "",
    region:          creds.VULTR_REGION?.trim() || "ewr",
    plan:            creds.VULTR_PLAN?.trim() || DEFAULT_VULTR_PLAN_SLUG,
    server_name:     creds.ASTRONEER_SERVER_NAME?.trim() || "My Astroneer Server",
    ssh_public_key:  sshPublicKey,
    repo_url:        resolveRepoUrl(env),
  };
}

/** Local-state Terraform env for `terraform/bootstrap` (Object Storage subscription). */
export function vultrBootstrapTerraformEnv(env: Record<string, string | undefined>): TerraformEnv {
  const tfVars: Record<string, string> = {
    vultr_api_key: env.VULTR_API_KEY ?? "",
    region:        env.VULTR_REGION?.trim() || "ewr",
  };
  const clusterId = env.TF_VAR_object_storage_cluster_id?.trim();
  if (clusterId) tfVars.object_storage_cluster_id = clusterId;

  return {
    tfDir:       BOOTSTRAP_TF_DIR,
    tfVars,
    s3AccessKey: "",
    s3SecretKey: "",
    s3Endpoint:  "",
    s3Bucket:    "",
    localState:  true,
  };
}

/** Builds Terraform env from `.env` / process env; used by CLI and provider checks. */
export function vultrTerraformEnv(env: Record<string, string | undefined>): TerraformEnv {
  const s3Endpoint = env.VULTR_S3_ENDPOINT ?? "";
  const s3Bucket = env.VULTR_S3_BUCKET ?? "astroneer-terraform-state";

  return {
    tfDir: TF_DIR,
    tfVars: vultrTfVarsFromEnv(env),
    s3AccessKey: env.VULTR_S3_ACCESS_KEY ?? "",
    s3SecretKey: env.VULTR_S3_SECRET_KEY ?? "",
    s3Endpoint,
    s3Bucket,
    s3StateKey:  "terraform/terraform.tfstate",
  };
}

export const vultr: Provider = {
  id:   "vultr",
  name: "Vultr (Linux + Wine)",

  costRunning:  "~$48/mo while running (4 vCPU / 8 GB — see vultr.com pricing)",
  costStopped:  "~$10–20/mo stopped (block + Object Storage subscription for TF state)",
  region:       "Many (default Terraform: ewr — set VULTR_REGION in .env to change)",

  s3Endpoint:       "",
  s3EndpointEnvVar: "VULTR_S3_ENDPOINT",
  /** Default S3 bucket name created in the provisioned Object Storage subscription */
  s3Bucket:         "astroneer-terraform-state",
  s3BucketEnvVar:   "VULTR_S3_BUCKET",
  s3StateKey:       "terraform/terraform.tfstate",
  s3KeyEnvVar:      "VULTR_S3_ACCESS_KEY",
  s3SecretEnvVar:   "VULTR_S3_SECRET_KEY",

  tfDir: TF_DIR,
  terraformVars(creds) {
    return {
      vultr_api_key: creds.VULTR_API_KEY ?? "",
      region:        creds.VULTR_REGION?.trim() || "ewr",
      plan:          creds.VULTR_PLAN?.trim() || DEFAULT_VULTR_PLAN_SLUG,
      server_name:   creds.ASTRONEER_SERVER_NAME?.trim() || "My Astroneer Server",
    };
  },
  tfSavesResource: "vultr_block_storage.saves",

  credentials: [
    {
      envKey: "VULTR_API_KEY",
      label:  "Vultr API Key",
      hint:
        "my.vultr.com → API → Personal access token (creates Object Storage + servers).\n" +
        "On that same API screen: if IP access control is on, add your current public IP — or enable All IPv4 / All IPv6 — otherwise Terraform returns Unauthorized IP.",
      mask:   true,
    },
    {
      envKey: "VULTR_REGION",
      label:  "Vultr region",
      hint:   "Same region for compute and Object Storage (Terraform state). Pick default or a specific datacenter.",
      mask:   false,
      optional: true,
      selectOptions: VULTR_REGION_OPTIONS,
    },
  ],

  async validateCredentials(creds) {
    const key = creds.VULTR_API_KEY;
    if (!key) return { ok: false, error: "Missing Vultr API key" };
    const res = await fetch("https://api.vultr.com/v2/account", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return { ok: false, error: `Vultr API returned ${res.status}` };
    return { ok: true };
  },

  async checkVolume(env) {
    try {
      return await tf.stateShow(vultrTerraformEnv(env), "vultr_block_storage.saves");
    } catch {
      return false;
    }
  },

  async checkServer(env) {
    try {
      const ip = await tf.output(vultrTerraformEnv(env), "server_ip");
      return Boolean(ip?.length);
    } catch {
      return false;
    }
  },
};
