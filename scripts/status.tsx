#!/usr/bin/env bun
import React, { useState, useEffect } from "react";
import { render, Box, Text, useApp } from "ink";
import { loadEnv } from "./lib/env.js";
import { resolveRepoUrl } from "./lib/repo.js";
import { flyCmdAsync, parseFlyIpListJson } from "./lib/fly.js";
import { defaultProvider } from "./providers/index.js";
import { Header } from "./ui/Header.js";
import { colors } from "./ui/theme.js";

const GAME_PORT = 8777;
type Phase = "loading" | "ready" | "error";

interface StatusData {
  app:          string;
  hasVolume:    boolean;
  running:    boolean;
  ipv4:         string;
  serverName:   string;
  connect:      string;
}

function missingKeys(env: Record<string, string | undefined>, keys: string[]): string[] {
  return keys.filter(k => !env[k]?.trim());
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Box flexDirection="column" gap={0} marginBottom={1}>
    <Text color={colors.gold} bold>{title}</Text>
    <Box flexDirection="column" gap={0} paddingLeft={1}>{children}</Box>
  </Box>
);

const KV: React.FC<{ label: string; value: string; valueColor?: string }> = ({
  label,
  value,
  valueColor = colors.white,
}) => (
  <Box gap={2}>
    <Box width={22} flexShrink={0}><Text color={colors.muted}>{label}</Text></Box>
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
        const required = ["FLY_API_TOKEN", "FLY_APP_NAME"];
        const missing = missingKeys(env, required);
        if (missing.length) {
          setError(`Missing in .env: ${missing.join(", ")}\nRun: make setup`);
          setPhase("error");
          return;
        }
        const app = env.FLY_APP_NAME!.trim();
        const fe = {
          ...process.env,
          FLY_API_TOKEN:    env.FLY_API_TOKEN!.trim(),
          FLY_ACCESS_TOKEN: env.FLY_API_TOKEN!.trim(),
        };

        const volOk = await defaultProvider.checkVolume(env);
        const st = await flyCmdAsync(["status", "-a", app], fe);
        const ips = await flyCmdAsync(["ips", "list", "-a", app, "--json"], fe);
        let ipv4 = "";
        if (ips.ok) ipv4 = parseFlyIpListJson(ips.stdout) ?? "";
        const serverName = env.ASTRONEER_SERVER_NAME?.trim() || "(see fly.toml [env])";
        const connect = ipv4 ? `${ipv4}:${GAME_PORT}` : `run make start (allocates IPv4 + secret) — then make ip`;
        setData({
          app,
          hasVolume: volOk,
          running:   st.ok,
          ipv4,
          serverName,
          connect,
        });
        setPhase("ready");
      })();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (phase === "ready" || phase === "error") {
      const t = setTimeout(() => exit(), phase === "error" ? 5000 : 3500);
      return () => clearTimeout(t);
    }
  }, [phase, exit]);

  const yn = (v: boolean) => (v ? { t: "yes", c: colors.green as string } : { t: "no", c: colors.muted as string });

  let repoUrl = "";
  try {
    repoUrl = resolveRepoUrl(loadEnv());
  } catch {
    repoUrl = "";
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Header subtitle="server status" animated={false} />
      {phase === "loading" && <Text color={colors.teal}>Reading Fly.io…</Text>}
      {phase === "error" && error && (
        <Box flexDirection="column" borderStyle="round" borderColor={colors.red} paddingX={2} paddingY={1} marginTop={1}>
          <Text color={colors.red} bold>✗  Status unavailable</Text>
          {error.split("\n").map((line, i) => (<Text key={i} color={colors.muted}>{line || " "}</Text>))}
        </Box>
      )}
      {phase === "ready" && data && (
        <Box flexDirection="column" marginTop={0}>
          <Section title="Fly.io">
            <KV label="App" value={data.app} />
            <KV label="Volume" value={yn(data.hasVolume).t} valueColor={yn(data.hasVolume).c} />
            <KV label="fly status OK" value={yn(data.running).t} valueColor={yn(data.running).c} />
          </Section>
          <Section title="Connect">
            <KV label="Display name" value={data.serverName} />
            <KV label="Public IPv4" value={data.ipv4 || "—"} />
            <KV label="In-game" value={data.connect} valueColor={colors.teal} />
          </Section>
          {repoUrl ? (
            <Section title="Repo">
              <Text color={colors.muted}>{repoUrl}</Text>
            </Section>
          ) : null}
          <Box borderStyle="round" borderColor={colors.teal} paddingX={2} paddingY={1} marginTop={1}>
            <Text color={colors.green} bold>✓  make logs</Text>
            <Text color={colors.muted}> Fly Machine logs</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

render(<StatusApp />);
