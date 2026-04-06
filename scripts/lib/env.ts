import path from "path";
import fs from "fs";

const ROOT = path.resolve(import.meta.dir, "../..");
const ENV_FILE = path.join(ROOT, ".env");

export interface Env {
  HCLOUD_TOKEN: string;
  HETZNER_S3_ACCESS_KEY: string;
  HETZNER_S3_SECRET_KEY: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  SSH_KEY: string;
}

export function loadEnv(): Partial<Env> {
  if (!fs.existsSync(ENV_FILE)) return {};
  const lines = fs.readFileSync(ENV_FILE, "utf8").split("\n");
  const env: Record<string, string> = {};
  for (const line of lines) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length) env[key.trim()] = rest.join("=").trim();
  }
  return env as Partial<Env>;
}

export function writeEnv(env: Partial<Env>) {
  const lines = Object.entries(env)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_FILE, lines.join("\n") + "\n");
}

export function repoRoot() {
  return ROOT;
}
