#!/usr/bin/env bun
import { loadEnv } from "./lib/env.js";
import * as tf from "./lib/terraform.js";
import { vultrTerraformEnv } from "./providers/vultr.js";

const env = loadEnv() as Record<string, string | undefined>;
try {
  const tfe = vultrTerraformEnv(env);
  const init = await tf.init(tfe);
  if (!init.ok) {
    console.error(init.error ?? "terraform init failed");
    process.exit(1);
  }
  const ip = await tf.output(tfe, "server_ip");
  console.log(ip ?? "");
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
