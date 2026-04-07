#!/usr/bin/env bun
import React, { useState, useEffect } from 'react';
import { render, Box, Text, useApp } from 'ink';
import { useFrame } from './ui/useFrame.js';
import { loadEnv } from './lib/env.js';
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
    { label: `${provider.credentials[0]?.label ?? provider.name} (and related keys)`, status: 'pending' },
  ]);
  const [infra,  setInfra]  = useState<Check[]>([
    { label: 'Terraform state bucket', status: 'pending' },
    { label: 'SSH key',                status: 'pending' },
    { label: 'Saves volume',           status: 'pending' },
    { label: 'Compute instance (Terraform)', status: 'pending' },
  ]);
  const [phase,  setPhase]  = useState<Phase>('running');
  const [passed, setPassed] = useState(0);
  const [failed, setFailed] = useState(0);
  /** When true, `server_ip` exists in Terraform state — compute is already provisioned (`make start` was run). */
  const [computeInState, setComputeInState] = useState(false);

  const update = <T extends Check>(
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    i: number,
    patch: Partial<T>
  ) => setter(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c) as T[]);

  useEffect(() => {
    let cancelled = false;
    /** Run after commit: avoids React 19 "Should not already be working" when sync work + setState overlap Ink + reconciler. */
    const timer = setTimeout(() => {
      void (async () => {
        const tally: CheckStatus[] = [];

        // ── Tools ──────────────────────────────────────────────────────────────
        update(setTools, 0, { status: 'checking' });
        if (tf.isInstalled()) {
          update(setTools, 0, { status: 'pass' });
          tally.push('pass');
        } else {
          update(setTools, 0, { status: 'fail', detail: 'brew install terraform' });
          tally.push('fail');
        }

        update(setTools, 1, { status: 'checking' });
        const sshOk = Bun.spawnSync(['ssh', '-V']).exitCode === 0;
        update(setTools, 1, { status: sshOk ? 'pass' : 'fail', detail: sshOk ? undefined : 'ssh not found' });
        tally.push(sshOk ? 'pass' : 'fail');

        // ── Credentials ────────────────────────────────────────────────────────
        update(setCreds, 0, { status: 'checking' });
        const envRecord = env as Record<string, string>;
        const hasProviderCreds = provider.credentials.every(
          c => c.optional || envRecord[c.envKey],
        );
        if (hasProviderCreds) {
          const result = await provider.validateCredentials(envRecord);
          const st = result.ok ? 'pass' : 'fail';
          update(setCreds, 0, {
            status: st,
            detail: result.ok ? undefined : `${result.error} — run: bun run setup`,
          });
          tally.push(st);
        } else {
          update(setCreds, 0, { status: 'fail', detail: 'not set — run: bun run setup' });
          tally.push('fail');
        }

        // ── Infrastructure ─────────────────────────────────────────────────────
        update(setInfra, 0, { status: 'checking' });
        const s3Key    = envRecord[provider.s3KeyEnvVar];
        const s3Secret = envRecord[provider.s3SecretEnvVar];
        if (s3Key && s3Secret) {
          const s3Endpoint = provider.s3EndpointEnvVar
            ? envRecord[provider.s3EndpointEnvVar]
            : provider.s3Endpoint;
          const s3Bucket =
            (provider.s3BucketEnvVar ? envRecord[provider.s3BucketEnvVar] : undefined) ?? provider.s3Bucket;
          try {
            const s3 = makeS3Client(s3Key, s3Secret, s3Endpoint);
            await s3.send(new HeadBucketCommand({ Bucket: s3Bucket }));
            update(setInfra, 0, { status: 'pass' });
            tally.push('pass');
          } catch {
            update(setInfra, 0, { status: 'fail', detail: 'bucket not found — run: bun run setup' });
            tally.push('fail');
          }
        } else {
          update(setInfra, 0, { status: 'fail', detail: 'S3 credentials not set — run: bun run setup' });
          tally.push('fail');
        }

        update(setInfra, 1, { status: 'checking' });
        const SSH_KEY = envRecord.SSH_KEY ?? `${process.env.HOME}/.ssh/astro-server`;
        const sshExists = fs.existsSync(SSH_KEY) && fs.existsSync(`${SSH_KEY}.pub`);
        update(setInfra, 1, {
          status: sshExists ? 'pass' : 'fail',
          detail: sshExists ? SSH_KEY : `key not found at ${SSH_KEY} — run: bun run setup`,
        });
        tally.push(sshExists ? 'pass' : 'fail');

        update(setInfra, 2, { status: 'checking' });
        try {
          const volumeOk = await provider.checkVolume(envRecord);
          const st = volumeOk ? 'pass' : 'fail';
          update(setInfra, 2, {
            status: st,
            detail: volumeOk ? undefined : 'not found — run: bun run setup',
          });
          tally.push(st);
        } catch {
          update(setInfra, 2, { status: 'fail', detail: 'could not check — run: bun run setup' });
          tally.push('fail');
        }

        update(setInfra, 3, { status: 'checking' });
        let instanceInTfState = false;
        try {
          /** True when Terraform state has a live `server_ip` output (instance resource present). */
          instanceInTfState = await provider.checkServer(envRecord);
          const st = instanceInTfState ? 'warn' : 'pass';
          update(setInfra, 3, {
            status: st,
            detail: instanceInTfState
              ? 'Vultr instance in state — billed for compute until `make stop`'
              : 'no instance in Terraform state (`make start` provisions the VM)',
          });
          tally.push(st);
        } catch {
          update(setInfra, 3, { status: 'fail', detail: 'could not check' });
          tally.push('fail');
        }

        if (cancelled) return;
        setComputeInState(instanceInTfState);
        setPassed(tally.filter(s => s === 'pass' || s === 'warn').length);
        setFailed(tally.filter(s => s === 'fail').length);
        setPhase('done');
      })();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
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
          ) : computeInState ? (
            <Box flexDirection="column">
              <Text color={colors.green} bold>✓  All systems go — compute is provisioned.</Text>
              <Text color={colors.muted}>
                <Text color={colors.orange}>make ip</Text>
                {' / '}
                <Text color={colors.orange}>make ssh</Text>
                {' · '}
                <Text color={colors.orange}>make logs</Text>
                {' · stop VM (keep saves volume) with '}
                <Text color={colors.orange}>make stop</Text>
              </Text>
            </Box>
          ) : (
            <Text color={colors.green} bold>
              ✓  All systems go. Run <Text color={colors.orange}>make start</Text> to launch the VM.
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};

render(<Preflight />);
