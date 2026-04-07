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

export function repoRoot() {
  return ROOT;
}

const VULTR_S3_ENV_KEYS = [
  "VULTR_S3_BUCKET",
  "VULTR_S3_ACCESS_KEY",
  "VULTR_S3_SECRET_KEY",
  "VULTR_S3_ENDPOINT",
] as const;

/** Clears Vultr Object Storage lines in `.env` (values deleted, keys kept as `KEY=`). Preserves other lines and order. */
export function clearVultrS3EnvPlaceholders(root: string = ROOT): void {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  const next = text.split("\n").map(line => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return line;
    const eq = line.indexOf("=");
    if (eq < 0) return line;
    const key = line.slice(0, eq).trim();
    if (key.startsWith("#")) return line;
    if ((VULTR_S3_ENV_KEYS as readonly string[]).includes(key)) {
      return `${key}=`;
    }
    return line;
  });
  fs.writeFileSync(file, next.join("\n").replace(/\n*$/, "") + "\n");
}
