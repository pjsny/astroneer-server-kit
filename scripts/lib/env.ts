import path from "path";
import fs from "fs";

const ROOT = path.resolve(import.meta.dir, "../..");
const ENV_FILE = path.join(ROOT, ".env");

/** `.env` key/value pairs (all optional until you run setup). */
export type Env = Partial<Record<string, string>>;

export function loadEnv(): Env {
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

/** Merge into `.env`, preserving unrelated existing keys. */
export function writeEnvMerge(patch: Record<string, string | undefined>): void {
  const cur = loadEnv() as Record<string, string | undefined>;
  const next = { ...cur, ...patch };
  const lines = Object.entries(next)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_FILE, lines.join("\n") + "\n");
}

export function repoRoot() {
  return ROOT;
}

