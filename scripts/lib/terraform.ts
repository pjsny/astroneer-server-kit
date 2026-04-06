import path from "path";

const TF_DIR = path.resolve(import.meta.dir, "../../terraform");

interface TerraformEnv {
  hcloudToken: string;
  sshPublicKey: string;
  repoUrl: string;
  s3AccessKey: string;
  s3SecretKey: string;
}

function tfEnv(e: TerraformEnv) {
  return {
    ...process.env,
    TF_VAR_hcloud_token: e.hcloudToken,
    TF_VAR_ssh_public_key: e.sshPublicKey,
    TF_VAR_repo_url: e.repoUrl,
    AWS_ACCESS_KEY_ID: e.s3AccessKey,
    AWS_SECRET_ACCESS_KEY: e.s3SecretKey,
  };
}

async function run(args: string[], env: NodeJS.ProcessEnv): Promise<boolean> {
  const proc = Bun.spawn(["terraform", ...args], {
    cwd: TF_DIR,
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  return code === 0;
}

export async function init(e: TerraformEnv) {
  return run(
    [
      "init",
      "-input=false",
      "-reconfigure",
      `-backend-config=access_key=${e.s3AccessKey}`,
      `-backend-config=secret_key=${e.s3SecretKey}`,
    ],
    tfEnv(e)
  );
}

export async function applyTarget(e: TerraformEnv, target: string) {
  return run(
    ["apply", "-auto-approve", "-input=false", `-target=${target}`],
    tfEnv(e)
  );
}

export async function output(
  e: TerraformEnv,
  name: string
): Promise<string | null> {
  const proc = Bun.spawn(
    ["terraform", "output", "-raw", name],
    { cwd: TF_DIR, env: tfEnv(e), stdout: "pipe", stderr: "pipe" }
  );
  const code = await proc.exited;
  if (code !== 0) return null;
  return (await new Response(proc.stdout).text()).trim();
}

export async function stateShow(e: TerraformEnv, resource: string) {
  const proc = Bun.spawn(
    ["terraform", "state", "show", resource],
    { cwd: TF_DIR, env: tfEnv(e), stdout: "pipe", stderr: "pipe" }
  );
  const code = await proc.exited;
  return code === 0;
}

export function isInstalled() {
  const proc = Bun.spawnSync(["terraform", "version"]);
  return proc.exitCode === 0;
}
