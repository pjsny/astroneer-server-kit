import path from "path";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");

export interface TerraformEnv {
  /** Path to the provider's terraform directory, relative to repo root */
  tfDir:       string;
  /** All TF_VAR_* variables (provider-specific vars + ssh_public_key + repo_url) */
  tfVars:      Record<string, string>;
  s3AccessKey: string;
  s3SecretKey: string;
  s3Endpoint:  string;
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
  return {
    ...process.env,
    ...varEntries,
    AWS_ACCESS_KEY_ID:     e.s3AccessKey,
    AWS_SECRET_ACCESS_KEY: e.s3SecretKey,
  };
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
    const stderr = await new Response(proc.stderr).text();
    return { ok: false, error: stderr.trim().split("\n").pop() ?? "Unknown error" };
  }
  return { ok: true };
}

export async function init(e: TerraformEnv): Promise<Result> {
  return run(
    [
      "init", "-input=false", "-reconfigure",
      `-backend-config=access_key=${e.s3AccessKey}`,
      `-backend-config=secret_key=${e.s3SecretKey}`,
      `-backend-config=endpoint=${e.s3Endpoint}`,
    ],
    e
  );
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
