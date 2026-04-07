import fs from "fs";
import os from "os";
import path from "path";
import { randomBytes } from "node:crypto";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");

export interface TerraformEnv {
  /** Path to the provider's terraform directory, relative to repo root */
  tfDir:       string;
  /** All TF_VAR_* variables (provider-specific vars + ssh_public_key + repo_url) */
  tfVars:      Record<string, string>;
  s3AccessKey: string;
  s3SecretKey: string;
  s3Endpoint:  string;
  /** S3 bucket name for remote state (e.g. Vultr Object Storage bucket) */
  s3Bucket:    string;
  /** Object key for the state file (default in init() if omitted) */
  s3StateKey?: string;
  /** When true, `init()` uses local backend only (e.g. terraform/bootstrap). */
  localState?: boolean;
}

interface Result {
  ok: boolean;
  error?: string;
}

function resolveDir(tfDir: string): string {
  return path.resolve(REPO_ROOT, tfDir);
}

function tfEnv(e: TerraformEnv): NodeJS.ProcessEnv {
  const varEntries: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.tfVars)) {
    varEntries[`TF_VAR_${k}`] = v;
  }
  return { ...process.env, ...varEntries };
}

function hclEscapeDoubleQuoted(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

/** Writes partial S3 backend config (S3-compatible object storage). Deleted after init. */
function writeS3BackendPartialHcl(e: TerraformEnv): string {
  const stateKey = e.s3StateKey ?? "terraform/terraform.tfstate";
  const name = `ask-tf-backend-${process.pid}-${randomBytes(8).toString("hex")}.hcl`;
  const file = path.join(os.tmpdir(), name);
  const content = [
    `bucket                      = "${hclEscapeDoubleQuoted(e.s3Bucket)}"`,
    `key                         = "${hclEscapeDoubleQuoted(stateKey)}"`,
    `region                      = "us-east-1"`,
    `access_key                  = "${hclEscapeDoubleQuoted(e.s3AccessKey)}"`,
    `secret_key                  = "${hclEscapeDoubleQuoted(e.s3SecretKey)}"`,
    `use_path_style              = true`,
    `skip_credentials_validation = true`,
    `skip_metadata_api_check     = true`,
    `skip_region_validation      = true`,
    `skip_requesting_account_id  = true`,
    `skip_s3_checksum            = true`,
    `endpoints = {`,
    `  s3 = "${hclEscapeDoubleQuoted(e.s3Endpoint)}"`,
    `}`,
    "",
  ].join("\n");
  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}

async function run(args: string[], e: TerraformEnv): Promise<Result> {
  const proc = Bun.spawn(["terraform", ...args], {
    cwd:    resolveDir(e.tfDir),
    env:    tfEnv(e),
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = (await new Response(proc.stderr).text()).trim();
    const stdout = (await new Response(proc.stdout).text()).trim();
    // Never use only the last line — Terraform box diagnostics often end with "╵" alone.
    const parts = [stderr, stdout ? `--- stdout ---\n${stdout}` : ""].filter(Boolean);
    return { ok: false, error: parts.join("\n\n") || "Unknown error" };
  }
  return { ok: true };
}

/** Apply full stack; streams Terraform stdout/stderr to the terminal. */
export async function apply(e: TerraformEnv): Promise<Result> {
  const proc = Bun.spawn(["terraform", "apply", "-auto-approve", "-input=false"], {
    cwd:    resolveDir(e.tfDir),
    env:    tfEnv(e),
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  return code === 0 ? { ok: true } : { ok: false, error: "terraform apply failed" };
}

/** Destroy only the listed resource targets (typical tear-down while keeping volumes). */
export async function destroyTargets(e: TerraformEnv, targets: string[]): Promise<Result> {
  const args = ["terraform", "destroy", "-auto-approve", "-input=false", ...targets.map(t => `-target=${t}`)];
  const proc = Bun.spawn(args, {
    cwd:    resolveDir(e.tfDir),
    env:    tfEnv(e),
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  return code === 0 ? { ok: true } : { ok: false, error: "terraform destroy failed" };
}

/** Destroy every resource in the stack (e.g. VM, firewall, SSH key object, block volume). */
export async function destroyAll(e: TerraformEnv): Promise<Result> {
  const proc = Bun.spawn(["terraform", "destroy", "-auto-approve", "-input=false"], {
    cwd:    resolveDir(e.tfDir),
    env:    tfEnv(e),
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  return code === 0 ? { ok: true } : { ok: false, error: "terraform destroy failed" };
}

export async function init(e: TerraformEnv): Promise<Result> {
  if (e.localState) {
    return run(["init", "-input=false"], e);
  }
  const backendFile = writeS3BackendPartialHcl(e);
  try {
    return await run(
      ["init", "-input=false", "-reconfigure", `-backend-config=${backendFile}`],
      e,
    );
  } finally {
    try {
      fs.unlinkSync(backendFile);
    } catch {
      /* ignore */
    }
  }
}

export async function applyTarget(e: TerraformEnv, target: string): Promise<Result> {
  return run(["apply", "-auto-approve", "-input=false", `-target=${target}`], e);
}

export async function output(e: TerraformEnv, name: string): Promise<string | null> {
  const proc = Bun.spawn(["terraform", "output", "-raw", name], {
    cwd:    resolveDir(e.tfDir),
    env:    tfEnv(e),
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) return null;
  return (await new Response(proc.stdout).text()).trim();
}

export async function stateShow(e: TerraformEnv, resource: string): Promise<boolean> {
  const proc = Bun.spawn(["terraform", "state", "show", resource], {
    cwd:    resolveDir(e.tfDir),
    env:    tfEnv(e),
    stdout: "pipe",
    stderr: "pipe",
  });
  return (await proc.exited) === 0;
}

export function isInstalled(): boolean {
  return Bun.spawnSync(["terraform", "version"]).exitCode === 0;
}
