import path from "path";
import { repoRoot } from "./env.js";

const BOOTSTRAP_DIR = path.join(repoRoot(), "terraform/bootstrap");

export interface BootstrapObjectStorageResult {
  accessKey: string;
  secretKey: string;
  endpoint:  string;
  bucket:    string;
}

interface TfOutputEntry {
  value: unknown;
  sensitive?: boolean;
}

/**
 * Creates a Vultr Object Storage subscription (local Terraform state in terraform/bootstrap/)
 * and returns S3 credentials for the main module's remote backend.
 */
export async function provisionObjectStorageForTerraformState(
  vultrApiKey: string,
  region: string,
  tfStateBucket: string,
): Promise<BootstrapObjectStorageResult> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TF_VAR_vultr_api_key:   vultrApiKey,
    TF_VAR_region:          region,
    TF_VAR_tf_state_bucket: tfStateBucket,
  };
  const clusterId = process.env.TF_VAR_object_storage_cluster_id?.trim();
  if (clusterId) env.TF_VAR_object_storage_cluster_id = clusterId;

  const init = Bun.spawnSync(["terraform", "init", "-input=false", "-backend=false"], {
    cwd:    BOOTSTRAP_DIR,
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  if (init.exitCode !== 0) {
    throw new Error(
      `bootstrap terraform init:\n${init.stderr.toString()}\n--- stdout ---\n${init.stdout.toString()}`,
    );
  }

  const apply = Bun.spawnSync(["terraform", "apply", "-auto-approve", "-input=false"], {
    cwd:    BOOTSTRAP_DIR,
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  if (apply.exitCode !== 0) {
    throw new Error(
      `bootstrap terraform apply:\n${apply.stderr.toString()}\n--- stdout ---\n${apply.stdout.toString()}`,
    );
  }

  const out = Bun.spawnSync(["terraform", "output", "-json"], {
    cwd:    BOOTSTRAP_DIR,
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  if (out.exitCode !== 0) {
    throw new Error(
      `bootstrap terraform output:\n${out.stderr.toString()}\n--- stdout ---\n${out.stdout.toString()}`,
    );
  }

  const j = JSON.parse(out.stdout.toString()) as Record<string, TfOutputEntry>;
  const accessKey = j.s3_access_key?.value;
  const secretKey = j.s3_secret_key?.value;
  const endpoint  = j.s3_endpoint?.value;
  const bucket    = j.tf_state_bucket?.value;

  if (typeof accessKey !== "string" || typeof secretKey !== "string" || typeof endpoint !== "string" || typeof bucket !== "string") {
    throw new Error("Unexpected bootstrap terraform output shape");
  }

  return { accessKey, secretKey, endpoint, bucket };
}
