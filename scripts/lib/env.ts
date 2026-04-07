import path from "path";
import fs from "fs";

const ROOT = path.resolve(import.meta.dir, "../..");
const ENV_FILE = path.join(ROOT, ".env");

// Common keys present regardless of provider.
// Provider-specific credential keys (e.g. SCW_ACCESS_KEY) are added dynamically
// by the setup wizard from the selected provider's credentials list.
export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPO:  string;
  SSH_KEY:      string;
  [key: string]: string;
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

export function writeEnv(env: Record<string, string | undefined>) {
  const lines = Object.entries(env)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_FILE, lines.join("\n") + "\n");
}

export function repoRoot() {
  return ROOT;
}
