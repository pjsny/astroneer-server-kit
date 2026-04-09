import type { Provider } from "./types.js";
import { flyCmdAsync, FLY_CLI_INSTALL_DOCS_URL, flyInstalled } from "../lib/fly.js";
import { DEFAULT_FLY_REGION, FLY_REGION_OPTIONS } from "./fly-regions.js";

function tokenFromEnv(env: Record<string, string | undefined>): string {
  return (env.FLY_API_TOKEN ?? "").trim();
}

function appFromEnv(env: Record<string, string | undefined>): string {
  return (env.FLY_APP_NAME ?? "").trim();
}

function flyEnvWithToken(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const t = tokenFromEnv(env);
  return { ...process.env, FLY_ACCESS_TOKEN: t, FLY_API_TOKEN: t };
}

export const fly: Provider = {
  id:   "fly",
  name: "Fly.io (Wine in Docker)",

  costRunning:
    "Varies by vm size + egress (roughly ~$40–90/mo for 4 shared CPUs / 8 GB — check fly.io/pricing)",
  costStopped:
    "Volumes bill while allocated (~$0.15/GB-mo); destroy app to release volume",
  region: "Set FLY_REGION (default ord) — deploy must match volume region",

  credentials: [
    {
      envKey: "FLY_REGION",
      label:  "Fly region",
      hint:   "Same region for Machines and the astroneer_server_kit_data volume.",
      mask:   false,
      optional: true,
      selectOptions: FLY_REGION_OPTIONS,
    },
  ],

  async validateCredentials(creds) {
    const key = tokenFromEnv(creds);
    if (!key) return { ok: false, error: "Missing Fly API token" };
    if (!flyInstalled()) {
      return {
        ok: false,
        error: `fly CLI not installed — see ${FLY_CLI_INSTALL_DOCS_URL} (e.g. brew install flyctl)`,
      };
    }
    const r = await flyCmdAsync(["apps", "list"], flyEnvWithToken(creds));
    if (!r.ok) return { ok: false, error: r.stderr.trim() || `fly apps list failed (${r.code})` };
    return { ok: true };
  },

  async checkVolume(env) {
    const app = appFromEnv(env);
    if (!app || !tokenFromEnv(env)) return false;
    const r = await flyCmdAsync(["volumes", "list", "-a", app, "-j"], flyEnvWithToken(env));
    if (!r.ok) return false;
    try {
      const rows = JSON.parse(r.stdout) as Array<{ name?: string }>;
      return Array.isArray(rows) && rows.some(v => v.name === "astroneer_server_kit_data");
    } catch {
      return r.stdout.includes("astroneer_server_kit_data");
    }
  },

  async checkServer(env) {
    const app = appFromEnv(env);
    if (!app || !tokenFromEnv(env)) return false;
    const r = await flyCmdAsync(["status", "-a", app], flyEnvWithToken(env));
    return r.ok;
  },
};

export { DEFAULT_FLY_REGION };
