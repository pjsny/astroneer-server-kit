#!/usr/bin/env bun
import React, { useState, useEffect } from 'react';
import { render, Box, Text, useApp } from 'ink';
import { useFrame } from './ui/useFrame.js';
import { loadEnv } from './lib/env.js';
import { validateToken } from './lib/github.js';
import { makeS3Client } from './lib/s3.js';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import * as tf from './lib/terraform.js';
import { Header } from './ui/Header.js';
import { colors, spinnerFrames } from './ui/theme.js';
import { defaultProvider } from './providers/index.js';
import fs from 'fs';

const provider = defaultProvider;

// ── Types ──────────────────────────────────────────────────────────────────────

type CheckStatus = 'pending' | 'checking' | 'pass' | 'fail' | 'warn';
interface Check { label: string; status: CheckStatus; detail?: string; }

type Phase = 'running' | 'done';

// ── Check row component ────────────────────────────────────────────────────────

const CheckRow: React.FC<{ check: Check }> = ({ check }) => {
  const frame = useFrame(80, check.status === 'checking');

  const icon =
    check.status === 'pass'     ? <Text color={colors.green}>✓</Text> :
    check.status === 'fail'     ? <Text color={colors.red}>✗</Text> :
    check.status === 'warn'     ? <Text color={colors.gold}>!</Text> :
    check.status === 'checking' ? <Text color={colors.purple}>{spinnerFrames[frame % spinnerFrames.length]}</Text> :
                                  <Text color={colors.muted}>○</Text>;

  const labelColor =
    check.status === 'pass'     ? colors.white  :
    check.status === 'fail'     ? colors.red    :
    check.status === 'warn'     ? colors.gold   :
    check.status === 'checking' ? colors.teal   :
                                  colors.muted;

  return (
    <Box gap={2}>
      <Box width={2}>{icon}</Box>
      <Box flexDirection="column">
        <Text color={labelColor}>{check.label}</Text>
        {check.detail && <Text color={colors.muted}>{check.detail}</Text>}
      </Box>
    </Box>
  );
};

// ── Group component ────────────────────────────────────────────────────────────

const GROUP_COLORS: Record<string, string> = {
  'Tools':          colors.teal,
  'Credentials':    colors.purple,
  'Infrastructure': colors.gold,
};

const Group: React.FC<{ title: string; checks: Check[] }> = ({ title, checks }) => (
  <Box flexDirection="column" gap={1} marginBottom={1}>
    <Text color={GROUP_COLORS[title] ?? colors.orange} bold>{title}</Text>
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      {checks.map((c, i) => <CheckRow key={i} check={c} />)}
    </Box>
  </Box>
);

// ── Main app ───────────────────────────────────────────────────────────────────

const Preflight: React.FC = () => {
  const { exit } = useApp();
  const env = loadEnv();

  const [tools,  setTools]  = useState<Check[]>([
    { label: 'terraform', status: 'pending' },
    { label: 'ssh',       status: 'pending' },
  ]);
  const [creds,  setCreds]  = useState<Check[]>([
    { label: 'GitHub token',              status: 'pending' },
    { label: `${provider.name} API token`, status: 'pending' },
  ]);
  const [infra,  setInfra]  = useState<Check[]>([
    { label: 'Terraform state bucket', status: 'pending' },
    { label: 'SSH key',                status: 'pending' },
    { label: 'Saves volume',           status: 'pending' },
    { label: 'Server status',          status: 'pending' },
  ]);
  const [phase,  setPhase]  = useState<Phase>('running');
  const [passed, setPassed] = useState(0);
  const [failed, setFailed] = useState(0);

  const update = <T extends Check>(
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    i: number,
    patch: Partial<T>
  ) => setter(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c) as T[]);

  useEffect(() => {
    (async () => {
      // ── Tools ──────────────────────────────────────────────────────────────
      update(setTools, 0, { status: 'checking' });
      if (tf.isInstalled()) {
        update(setTools, 0, { status: 'pass' });
      } else {
        update(setTools, 0, { status: 'fail', detail: 'brew install terraform' });
      }

      update(setTools, 1, { status: 'checking' });
      const sshOk = Bun.spawnSync(['ssh', '-V']).exitCode === 0;
      update(setTools, 1, { status: sshOk ? 'pass' : 'fail', detail: sshOk ? undefined : 'ssh not found' });

      // ── Credentials ────────────────────────────────────────────────────────
      update(setCreds, 0, { status: 'checking' });
      if (env.GITHUB_TOKEN) {
        const user = await validateToken(env.GITHUB_TOKEN);
        update(setCreds, 0, {
          status: user ? 'pass' : 'fail',
          detail: user ? `logged in as ${user}` : 'token invalid or missing scopes — run: bun run setup',
        });
      } else {
        update(setCreds, 0, { status: 'fail', detail: 'not set — run: bun run setup' });
      }

      // Validate provider-specific API token (first credential)
      update(setCreds, 1, { status: 'checking' });
      const envRecord = env as Record<string, string>;
      const hasProviderCreds = provider.credentials.every(c => envRecord[c.envKey]);
      if (hasProviderCreds) {
        const result = await provider.validateCredentials(envRecord);
        update(setCreds, 1, {
          status: result.ok ? 'pass' : 'fail',
          detail: result.ok ? undefined : `${result.error} — run: bun run setup`,
        });
      } else {
        update(setCreds, 1, { status: 'fail', detail: 'not set — run: bun run setup' });
      }

      // ── Infrastructure ─────────────────────────────────────────────────────
      update(setInfra, 0, { status: 'checking' });
      const s3Key    = envRecord[provider.s3KeyEnvVar];
      const s3Secret = envRecord[provider.s3SecretEnvVar];
      if (s3Key && s3Secret) {
        try {
          const s3 = makeS3Client(s3Key, s3Secret, provider.s3Endpoint);
          await s3.send(new HeadBucketCommand({ Bucket: provider.s3Bucket }));
          update(setInfra, 0, { status: 'pass' });
        } catch {
          update(setInfra, 0, { status: 'fail', detail: 'bucket not found — run: bun run setup' });
        }
      } else {
        update(setInfra, 0, { status: 'fail', detail: 'S3 credentials not set — run: bun run setup' });
      }

      update(setInfra, 1, { status: 'checking' });
      const SSH_KEY = envRecord.SSH_KEY ?? `${process.env.HOME}/.ssh/astro-server`;
      const sshExists = fs.existsSync(SSH_KEY) && fs.existsSync(`${SSH_KEY}.pub`);
      update(setInfra, 1, {
        status: sshExists ? 'pass' : 'fail',
        detail: sshExists ? SSH_KEY : `key not found at ${SSH_KEY} — run: bun run setup`,
      });

      update(setInfra, 2, { status: 'checking' });
      try {
        const volumeOk = await provider.checkVolume(envRecord);
        update(setInfra, 2, {
          status: volumeOk ? 'pass' : 'fail',
          detail: volumeOk ? undefined : 'not found — run: bun run setup',
        });
      } catch {
        update(setInfra, 2, { status: 'fail', detail: 'could not check — run: bun run setup' });
      }

      update(setInfra, 3, { status: 'checking' });
      try {
        const serverRunning = await provider.checkServer(envRecord);
        update(setInfra, 3, {
          status: serverRunning ? 'warn' : 'pass',
          detail: serverRunning ? 'server is currently running' : 'stopped (idle)',
        });
      } catch {
        update(setInfra, 3, { status: 'fail', detail: 'could not check' });
      }

      // ── Tally ──────────────────────────────────────────────────────────────
      const all = [...tools, ...creds, ...infra];
      setPassed(all.filter(c => c.status === 'pass' || c.status === 'warn').length);
      setFailed(all.filter(c => c.status === 'fail').length);
      setPhase('done');
    })();
  }, []);

  useEffect(() => {
    if (phase === 'done') {
      const t = setTimeout(() => exit(), 500);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const allFailed = failed;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Header subtitle="pre-flight systems check" />

      <Group title="Tools"           checks={tools} />
      <Group title="Credentials"     checks={creds} />
      <Group title="Infrastructure"  checks={infra} />

      {phase === 'done' && (
        <Box
          borderStyle="round"
          borderColor={allFailed > 0 ? colors.red : colors.green}
          paddingX={3}
          paddingY={1}
          marginTop={1}
        >
          {allFailed > 0 ? (
            <Box flexDirection="column">
              <Text color={colors.red} bold>
                ✗  {allFailed} check{allFailed > 1 ? 's' : ''} failed
              </Text>
              <Text color={colors.muted}>
                Run <Text color={colors.orange}>bun run setup</Text> to fix.
              </Text>
            </Box>
          ) : (
            <Text color={colors.green} bold>
              ✓  All systems go. Run <Text color={colors.orange}>make start</Text> to launch.
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};

render(<Preflight />);
