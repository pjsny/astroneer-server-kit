#!/usr/bin/env bun
import { loadEnv } from "./lib/env.js";
import { flyCmdAsync, parseFlyIpListJson } from "./lib/fly.js";

const env = loadEnv() as Record<string, string | undefined>;
const app = env.FLY_APP_NAME?.trim();
const token = env.FLY_API_TOKEN?.trim();
if (!app || !token) {
  console.error("Missing FLY_APP_NAME or FLY_API_TOKEN — run make setup");
  process.exit(1);
}

const fe = { ...process.env, FLY_API_TOKEN: token, FLY_ACCESS_TOKEN: token };
const r = await flyCmdAsync(["ips", "list", "-a", app, "--json"], fe);
if (!r.ok) {
  console.error(r.stderr || "fly ips list failed");
  process.exit(1);
}
const ip = parseFlyIpListJson(r.stdout);
if (ip) console.log(ip);
else console.log(r.stdout.trim());
