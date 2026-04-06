#!/usr/bin/env bun
import React, { useState, useEffect, useRef } from 'react';
import { render, Box, Text, useApp, useAnimation } from 'ink';
import TextInput from 'ink-text-input';
import { execSync } from 'child_process';
import fs from 'fs';
import { loadEnv, writeEnv } from './lib/env.js';
import { ensureBucket } from './lib/s3.js';
import { setSecret } from './lib/github.js';
import * as tf from './lib/terraform.js';
import { Header } from './ui/Header.js';
import { colors, spinnerFrames } from './ui/theme.js';
import { defaultProvider } from './providers/index.js';

// ── Types ──────────────────────────────────────────────────────────────────────

// GitHub fields always come first, then provider-specific credentials follow.
// When multiple providers are supported, the wizard will ask which to use first.
interface FormValues {
  repo: string;
  githubToken: string;
  [providerKey: string]: string;
}

type TaskStatus = 'pending' | 'running' | 'done' | 'error';
interface Task { label: string; status: TaskStatus; error?: string; }

type Phase =
  | { type: 'inputs'; step: number }
  | { type: 'running'; tasks: Task[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

// ── Field definitions (built from provider) ────────────────────────────────────

const provider = defaultProvider;

const FIELDS: Array<{ key: string; label: string; hint: string; mask: boolean }> = [
  {
    key:   'repo',
    label: 'GitHub Repository',
    hint:  'Fork this repo first → github.com/pjsny/astroneer-server-kit',
    mask:  false,
  },
  {
    key:   'githubToken',
    label: 'GitHub Personal Access Token',
    hint:  'github.com/settings/tokens  ·  scopes: repo + workflow',
    mask:  true,
  },
  // Provider-specific credentials come after the GitHub fields.
  // Swap defaultProvider in providers/index.ts to support a different cloud.
  ...provider.credentials.map(c => ({
    key:   c.envKey,
    label: c.label,
    hint:  c.hint,
    mask:  c.mask,
  })),
];

const INITIAL_TASKS: Task[] = [
  { label: 'SSH key',                        status: 'pending' },
  { label: 'Terraform state bucket',         status: 'pending' },
  { label: 'Terraform init',                 status: 'pending' },
  { label: 'Persistent saves volume',        status: 'pending' },
  { label: 'GitHub Actions secrets',         status: 'pending' },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function detectRepo(): string {
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
    const m = remote.match(/github\.com[:/](.+?\/.+?)(?:\.git)?$/);
    return m?.[1] ?? '';
  } catch { return ''; }
}

async function ensureSshKey(keyPath: string): Promise<void> {
  if (fs.existsSync(keyPath)) return;
  const r = Bun.spawnSync(['ssh-keygen', '-t', 'ed25519', '-f', keyPath, '-N', '', '-C', 'astroneer-server']);
  if (r.exitCode !== 0) throw new Error('ssh-keygen failed');
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const TaskRow: React.FC<{ task: Task }> = ({ task }) => {
  const { frame } = useAnimation({ interval: 80, isActive: task.status === 'running' });

  const icon =
    task.status === 'done'    ? <Text color={colors.green}>✓</Text> :
    task.status === 'error'   ? <Text color={colors.red}>✗</Text> :
    task.status === 'running' ? <Text color={colors.orange}>{spinnerFrames[frame % spinnerFrames.length]}</Text> :
                                <Text color={colors.muted}>○</Text>;

  const labelColor =
    task.status === 'done'    ? colors.white  :
    task.status === 'running' ? colors.orange :
    task.status === 'error'   ? colors.red    :
                                colors.muted;

  return (
    <Box gap={2}>
      <Box width={2}>{icon}</Box>
      <Text color={labelColor}>{task.label}</Text>
      {task.error && <Text color={colors.red}> — {task.error}</Text>}
    </Box>
  );
};

const InputPhase: React.FC<{
  step: number;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
}> = ({ step, value, onChange, onSubmit }) => {
  const field = FIELDS[step];
  return (
    <Box flexDirection="column" gap={1}>
      <Text color={colors.muted}>
        Step {step + 1} of {FIELDS.length}
      </Text>
      <Box flexDirection="column">
        <Text color={colors.orange} bold>{field.label}</Text>
        <Text color={colors.muted}>{field.hint}</Text>
      </Box>
      <Box marginTop={1} gap={1}>
        <Text color={colors.teal}>›</Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          mask={field.mask ? '*' : undefined}
          placeholder="..."
        />
      </Box>
    </Box>
  );
};

const RunningPhase: React.FC<{ tasks: Task[] }> = ({ tasks }) => (
  <Box flexDirection="column" gap={1}>
    <Text color={colors.orange} bold>Setting up your base camp...</Text>
    <Box flexDirection="column" gap={1} marginTop={1}>
      {tasks.map((task, i) => <TaskRow key={i} task={task} />)}
    </Box>
  </Box>
);

const DonePhase: React.FC = () => (
  <Box
    flexDirection="column"
    borderStyle="round"
    borderColor={colors.green}
    paddingX={3}
    paddingY={1}
    gap={1}
  >
    <Text color={colors.green} bold>✓  Base camp ready. Mission begins.</Text>
    <Box flexDirection="column" marginTop={1} gap={0}>
      <Text><Text color={colors.orange} bold>make start</Text>   <Text color={colors.muted}>spin up the server</Text></Text>
      <Text><Text color={colors.orange} bold>make stop </Text>   <Text color={colors.muted}>shut it down</Text></Text>
      <Text><Text color={colors.orange} bold>make ssh  </Text>   <Text color={colors.muted}>connect to the server</Text></Text>
      <Text><Text color={colors.orange} bold>make logs </Text>   <Text color={colors.muted}>tail server output</Text></Text>
    </Box>
    <Text color={colors.muted}>See you out there, Explorer. ✦</Text>
  </Box>
);

const ErrorPhase: React.FC<{ message: string }> = ({ message }) => (
  <Box
    flexDirection="column"
    borderStyle="round"
    borderColor={colors.red}
    paddingX={3}
    paddingY={1}
    gap={1}
  >
    <Text color={colors.red} bold>✗  Something went wrong</Text>
    <Text color={colors.white}>{message}</Text>
    <Text color={colors.muted}>
      Run <Text color={colors.orange}>make preflight</Text> to check your configuration.
    </Text>
  </Box>
);

// ── Main app ───────────────────────────────────────────────────────────────────

const Setup: React.FC = () => {
  const { exit } = useApp();
  const saved = loadEnv();
  const hasRun = useRef(false);

  const [phase, setPhase] = useState<Phase>({ type: 'inputs', step: 0 });
  const [fieldValue, setFieldValue] = useState(detectRepo() || saved.GITHUB_REPO || '');
  const [form, setForm] = useState<Partial<FormValues>>({
    repo: detectRepo() || saved.GITHUB_REPO,
  });

  // Pre-fill value when moving between steps
  useEffect(() => {
    if (phase.type !== 'inputs') return;
    setFieldValue((form[FIELDS[phase.step].key] as string) ?? '');
  }, [phase.type === 'inputs' ? phase.step : -1]);

  // Handle field submission
  const handleSubmit = (value: string) => {
    if (phase.type !== 'inputs' || !value.trim()) return;
    const updated = { ...form, [FIELDS[phase.step].key]: value.trim() };
    setForm(updated);
    setFieldValue('');

    const nextStep = phase.step + 1;
    if (nextStep >= FIELDS.length) {
      setPhase({ type: 'running', tasks: INITIAL_TASKS.map(t => ({ ...t })) });
    } else {
      setPhase({ type: 'inputs', step: nextStep });
    }
  };

  // Run setup when we enter the running phase
  useEffect(() => {
    if (phase.type !== 'running' || hasRun.current) return;
    hasRun.current = true;

    const values = form as FormValues;
    const SSH_KEY  = `${process.env.HOME}/.ssh/astro-server`;
    const REPO_URL = `https://github.com/${values.repo}`;

    const update = (i: number, status: TaskStatus, error?: string) =>
      setPhase(prev =>
        prev.type === 'running'
          ? { type: 'running', tasks: prev.tasks.map((t, idx) => idx === i ? { ...t, status, error } : t) }
          : prev
      );

    const fail = (i: number, message: string, detail?: string) => {
      update(i, 'error', detail);
      setPhase({ type: 'error', message });
    };

    (async () => {
      // 0 — SSH key
      update(0, 'running');
      try {
        await ensureSshKey(SSH_KEY);
        update(0, 'done');
      } catch (e) { return fail(0, 'Could not create SSH key.', String(e)); }

      const sshPublicKey  = fs.readFileSync(`${SSH_KEY}.pub`, 'utf8').trim();
      const sshPrivateKey = fs.readFileSync(SSH_KEY, 'utf8');
      const tfArgs = { hcloudToken: values.hcloudToken, sshPublicKey, repoUrl: REPO_URL, s3AccessKey: values.s3AccessKey, s3SecretKey: values.s3SecretKey };

      // 1 — S3 bucket
      update(1, 'running');
      try {
        await ensureBucket(values.s3AccessKey, values.s3SecretKey);
        update(1, 'done');
      } catch (e) { return fail(1, 'Could not create state bucket. Check your S3 credentials.', String(e)); }

      // 2 — Terraform init
      update(2, 'running');
      const initRes = await tf.init(tfArgs);
      if (!initRes.ok) return fail(2, 'Terraform init failed.', initRes.error);
      update(2, 'done');

      // 3 — Saves volume
      update(3, 'running');
      const volumeExists = await tf.stateShow(tfArgs, 'hcloud_volume.saves');
      if (!volumeExists) {
        const volRes = await tf.applyTarget(tfArgs, 'hcloud_volume.saves');
        if (!volRes.ok) return fail(3, 'Could not create saves volume.', volRes.error);
      }
      update(3, 'done');

      // 4 — GitHub secrets
      update(4, 'running');
      try {
        const secrets = {
          HCLOUD_TOKEN:           values.hcloudToken,
          HETZNER_S3_ACCESS_KEY:  values.s3AccessKey,
          HETZNER_S3_SECRET_KEY:  values.s3SecretKey,
          SSH_PUBLIC_KEY:         sshPublicKey,
          SSH_PRIVATE_KEY:        sshPrivateKey,
        };
        for (const [name, value] of Object.entries(secrets)) {
          await setSecret(values.githubToken, values.repo, name, value);
        }
        update(4, 'done');
      } catch (e) { return fail(4, 'Could not set GitHub secrets. Check your GitHub token.', String(e)); }

      // Write .env
      writeEnv({ HCLOUD_TOKEN: values.hcloudToken, HETZNER_S3_ACCESS_KEY: values.s3AccessKey, HETZNER_S3_SECRET_KEY: values.s3SecretKey, GITHUB_TOKEN: values.githubToken, GITHUB_REPO: values.repo, SSH_KEY });

      setPhase({ type: 'done' });
    })().catch(e => setPhase({ type: 'error', message: String(e) }));
  }, [phase.type]);

  // Exit after completion
  useEffect(() => {
    if (phase.type === 'done' || phase.type === 'error') {
      const t = setTimeout(() => exit(), phase.type === 'done' ? 300 : 5000);
      return () => clearTimeout(t);
    }
  }, [phase.type]);

  if (!tf.isInstalled()) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Header subtitle="pre-flight systems check" />
        <Text color={colors.red}>✗  Terraform is not installed.</Text>
        <Text color={colors.muted}>Install it with: <Text color={colors.orange}>brew install terraform</Text></Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Header />
      {phase.type === 'inputs'  && <InputPhase step={phase.step} value={fieldValue} onChange={setFieldValue} onSubmit={handleSubmit} />}
      {phase.type === 'running' && <RunningPhase tasks={phase.tasks} />}
      {phase.type === 'done'    && <DonePhase />}
      {phase.type === 'error'   && <ErrorPhase message={phase.message} />}
    </Box>
  );
};

render(<Setup />);
