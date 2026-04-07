#!/usr/bin/env bun
import React, { useState, useEffect } from "react";
import { render, Box, Text, useApp } from "ink";
import fs from "fs";
import { loadEnv } from "./lib/env.js";
import { resolveRepoUrl } from "./lib/repo.js";
import * as tf from "./lib/terraform.js";
import { vultr, vultrTerraformEnv } from "./providers/vultr.js";
import { Header } from "./ui/Header.js";
import { colors } from "./ui/theme.js";

const GAME_PORT = 8777;

type Phase = "loading" | "ready" | "error";

interface StatusData {
  tfDir:          string;
  hasInstance:    boolean;
  hasVolume:      boolean;
  ip:             string;
  serverName:     string;
  sshKey:         string;
  connect:        string;
  serviceLabel:   string;
  serviceOk:      boolean;
  bootstrapRaw:   string;
}

function missingKeys(env: Record<string, string | undefined>, keys: string[]): string[] {
  return keys.filter(k => !env[k]?.trim());
}

/** `.env` may use `~/…`; Node does not expand that. */
function expandSshKey(path: string): string {
  if (path.startsWith("~/")) return `${process.env.HOME ?? ""}/${path.slice(2)}`;
  return path;
}

/**
 * `systemctl is-active` exits 3 when inactive — chaining `|| echo …` yields "inactive\nunreachable".
 * `show -p ActiveState` exits 0 and prints active | inactive | failed | …
 */
function remoteServiceStatus(ip: string, sshKey: string): { label: string; ok: boolean } {
  const key = expandSshKey(sshKey);
  if (!ip || !fs.existsSync(key)) {
    return { label: "— (no IP or SSH key path)", ok: false };
  }
  const proc = Bun.spawnSync(
    [
      "ssh",
      "-i",
      key,
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "BatchMode=yes",
      `root@${ip}`,
      "systemctl show astroneer.service -p ActiveState --value 2>/dev/null || echo no-unit",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const raw = new TextDecoder().decode(proc.stdout ?? new Uint8Array()).trim();
  const firstLine = raw.split("\n")[0] ?? "";
  if (!firstLine && proc.exitCode !== 0) {
    return { label: "SSH failed (try: make ssh)", ok: false };
  }
  const state = firstLine || "unreachable";
  if (state === "active") return { label: "active (astroneer.service)", ok: true };
  if (state === "inactive") {
    return { label: "inactive — on server: sudo systemctl start astroneer", ok: false };
  }
  if (state === "activating") return { label: "activating", ok: false };
  if (state === "failed") return { label: "failed — make logs", ok: false };
  if (state === "no-unit") return { label: "unit missing (bootstrap incomplete?)", ok: false };
  return { label: state, ok: false };
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Box flexDirection="column" gap={0} marginBottom={1}>
    <Text color={colors.gold} bold>
      {title}
    </Text>
    <Box flexDirection="column" gap={0} paddingLeft={1}>
      {children}
    </Box>
  </Box>
);

const KV: React.FC<{ label: string; value: string; valueColor?: string }> = ({
  label,
  value,
  valueColor = colors.white,
}) => (
  <Box gap={2}>
    <Box width={22} flexShrink={0}>
      <Text color={colors.muted}>{label}</Text>
    </Box>
    <Text color={valueColor}>{value}</Text>
  </Box>
);

const StatusApp: React.FC = () => {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StatusData | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        const env = loadEnv() as Record<string, string | undefined>;
        const required = [
          "VULTR_API_KEY",
          "VULTR_S3_BUCKET",
          "VULTR_S3_ACCESS_KEY",
          "VULTR_S3_SECRET_KEY",
          "VULTR_S3_ENDPOINT",
        ];
        const missing = missingKeys(env, required);
        if (missing.length) {
          setError(`Missing in .env: ${missing.join(", ")}\nRun: make setup`);
          setPhase("error");
          return;
        }

        const tfe = vultrTerraformEnv(env);
        const init = await tf.init(tfe);
        if (!init.ok) {
          setError(init.error ?? "terraform init failed");
          setPhase("error");
          return;
        }

        const hasInstance = await tf.stateShow(tfe, "vultr_instance.astro");
        const hasVolume = await tf.stateShow(tfe, vultr.tfSavesResource);
        const ip = hasInstance ? (await tf.output(tfe, "server_ip"))?.trim() || "" : "";

        let repoUrl = "";
        try {
          repoUrl = resolveRepoUrl(env);
        } catch {
          repoUrl = env.GITHUB_REPO ? `https://github.com/${env.GITHUB_REPO}` : "(set GITHUB_REPO)";
        }
        const bootstrapRaw = `${repoUrl.replace("https://github.com/", "https://raw.githubusercontent.com/")}/main/terraform/vultr/bootstrap.sh`;

        const serverName = env.ASTRONEER_SERVER_NAME?.trim() || "(from bootstrap / saves volume)";
        const sshKey = expandSshKey(
          (env.SSH_KEY?.trim() || `${process.env.HOME}/.ssh/astro-server`) as string,
        );
        const connect = ip ? `${ip}:${GAME_PORT}` : "— (run make start)";
        const { label: serviceLabel, ok: serviceOk } = remoteServiceStatus(ip, sshKey);

        setData({
          tfDir:        tfe.tfDir,
          hasInstance,
          hasVolume,
          ip,
          serverName,
          sshKey,
          connect,
          serviceLabel,
          serviceOk,
          bootstrapRaw,
        });
        setPhase("ready");
      })();
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (phase === "ready" || phase === "error") {
      const delay = phase === "error" ? 4000 : 3000;
      const t = setTimeout(() => exit(), delay);
      return () => clearTimeout(t);
    }
  }, [phase, exit]);

  const yn = (v: boolean) => (v ? { t: "yes", c: colors.green as string } : { t: "no", c: colors.muted as string });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Header subtitle="server status" animated={false} />

      {phase === "loading" && (
        <Text color={colors.teal}>
          Reading Terraform state…
        </Text>
      )}

      {phase === "error" && error && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={colors.red}
          paddingX={2}
          paddingY={1}
          marginTop={1}
        >
          <Text color={colors.red} bold>
            ✗  Status unavailable
          </Text>
          {error.split("\n").map((line, i) => (
            <Text key={i} color={colors.muted}>
              {line || " "}
            </Text>
          ))}
        </Box>
      )}

      {phase === "ready" && data && (
        <Box flexDirection="column" marginTop={0}>
          <Section title="Terraform">
            <KV label="Stack" value={data.tfDir} />
            <KV label="Compute instance" value={yn(data.hasInstance).t} valueColor={yn(data.hasInstance).c} />
            <KV label="Saves volume" value={yn(data.hasVolume).t} valueColor={yn(data.hasVolume).c} />
          </Section>

          <Section title="Connect">
            <KV label="Display name" value={data.serverName} />
            <KV label="Public IP" value={data.ip || "—"} valueColor={data.ip ? colors.white : colors.muted} />
            <Box flexDirection="column" gap={0}>
              <Box gap={2}>
                <Box width={22} flexShrink={0}>
                  <Text color={colors.muted}>In-game address</Text>
                </Box>
                <Text bold color={colors.teal}>
                  {data.connect}
                </Text>
              </Box>
              <Box paddingLeft={24}>
                <Text color={colors.muted}>Multiplayer → Add Server → paste host:port</Text>
              </Box>
            </Box>
            <KV
              label="SSH"
              value={data.ip ? `ssh -i ${data.sshKey} root@${data.ip}` : `ssh -i ${data.sshKey} root@<make ip>`}
              valueColor={colors.purple}
            />
            <KV
              label="Game service"
              value={data.serviceLabel}
              valueColor={data.serviceOk ? colors.green : colors.gold}
            />
          </Section>

          <Section title="Bootstrap (cloud-init)">
            <Text color={colors.muted}>{data.bootstrapRaw}</Text>
          </Section>

          <Box borderStyle="round" borderColor={colors.teal} paddingX={2} paddingY={1} marginTop={1}>
            <Text color={colors.green} bold>
              ✓  make logs
            </Text>
            <Text color={colors.muted}> Tail astroneer.service on the VM</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

render(<StatusApp />);
