#!/usr/bin/env bun
import { loadEnv } from "./lib/env.js";
import { ensureFlyDedicatedIPv4, flyCmdAsync } from "./lib/fly.js";

function missingKeys(env: Record<string, string | undefined>, keys: string[]): string[] {
  return keys.filter(k => !env[k]?.trim());
}

const env = loadEnv() as Record<string, string | undefined>;
const required = ["FLY_API_TOKEN", "FLY_APP_NAME"];
const missing = missingKeys(env, required);
if (missing.length) {
  console.error(`Missing in .env: ${missing.join(", ")}`);
  console.error("Run: make setup");
  process.exit(1);
}

const app = env.FLY_APP_NAME!.trim();
const fe = {
  ...process.env,
  FLY_API_TOKEN: env.FLY_API_TOKEN!.trim(),
  FLY_ACCESS_TOKEN: env.FLY_API_TOKEN!.trim(),
};

console.log(`fly deploy (app ${app}) — first image build + game download inside the Machine can take 20–40+ minutes.\n`);

const ip = await ensureFlyDedicatedIPv4(app, fe);
if (!ip.ok) {
  console.error("Could not ensure a dedicated IPv4 for this app.");
  console.error(ip.stderr ?? "unknown error");
  console.error("Try: fly ips allocate-v4 -a " + app + " -y");
  process.exit(1);
}
console.log(`Dedicated IPv4: ${ip.ipv4} (staging as ASTRONEER_PUBLIC_IP secret)`);
const sec = await flyCmdAsync(
  ["secrets", "set", `ASTRONEER_PUBLIC_IP=${ip.ipv4}`, "-a", app, "--stage"],
  fe,
  { inheritIo: true },
);
if (!sec.ok) {
  console.error(sec.stderr || "fly secrets set failed");
  process.exit(1);
}

const r = await flyCmdAsync(["deploy", "--remote-only", "-a", app], fe, { inheritIo: true });
if (!r.ok) {
  console.error(r.stderr || "fly deploy failed");
  process.exit(1);
}
console.log(`\nDeployed. Address: run make ip  ·  logs: make logs`);
