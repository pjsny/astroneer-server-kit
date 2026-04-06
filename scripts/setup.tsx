#!/usr/bin/env bun
import React, { useState, useEffect, useRef } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import { useFrame } from './ui/useFrame.js';
import TextInput from 'ink-text-input';
import { execSync } from 'child_process';
import fs from 'fs';
import { loadEnv, writeEnv } from './lib/env.js';
import { ensureBucket } from './lib/s3.js';
import { setSecret } from './lib/github.js';
import * as tf from './lib/terraform.js';
import { Header } from './ui/Header.js';
import { colors, spinnerFrames } from './ui/theme.js';
import { providers } from './providers/index.js';
import type { Provider } from './providers/index.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface FormValues {
  repo: string;
  githubToken: string;
  [providerKey: string]: string;
}

type TaskStatus = 'pending' | 'running' | 'done' | 'error';
interface Task { label: string; status: TaskStatus; error?: string; }

type Phase =
  | { type: 'select' }
  | { type: 'inputs'; step: number; provider: Provider }
  | { type: 'running'; tasks: Task[]; provider: Provider }
  | { type: 'done' }
  | { type: 'error'; message: string };

// ── Field list built dynamically from the selected provider ───────────────────

function buildFields(provider: Provider): Array<{ key: string; label: string; hint: string; mask: boolean }> {
  return [
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
    ...provider.credentials.map(c => ({
      key:   c.envKey,
      label: c.label,
      hint:  c.hint,
      mask:  c.mask,
    })),
  ];
}

const INITIAL_TASKS: Task[] = [
  { label: 'SSH key',                 status: 'pending' },
  { label: 'Terraform state bucket',  status: 'pending' },
  { label: 'Terraform init',          status: 'pending' },
  { label: 'Persistent saves volume', status: 'pending' },
  { label: 'GitHub Actions secrets',  status: 'pending' },
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

const ProviderSelect: React.FC<{ onSelect: (p: Provider) => void }> = ({ onSelect }) => {
  const firstEnabled = providers.findIndex(p => !p.disabled);
  const [cursor, setCursor] = useState(firstEnabled >= 0 ? firstEnabled : 0);

  const moveCursor = (dir: -1 | 1) => {
    setCursor(c => {
      let next = c + dir;
      while (next >= 0 && next < providers.length && providers[next]?.disabled) next += dir;
      if (next < 0 || next >= providers.length) return c;
      return next;
    });
  };

  useInput((_, key) => {
    if (key.upArrow)   moveCursor(-1);
    if (key.downArrow) moveCursor(1);
    if (key.return && !providers[cursor]?.disabled) onSelect(providers[cursor]);
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={colors.teal} bold>Select a cloud provider</Text>
      <Text color={colors.muted}>↑ ↓ to move  ·  enter to confirm</Text>
      <Box flexDirection="column" marginTop={1} gap={1}>
        {providers.map((p, i) => {
          const selected = i === cursor && !p.disabled;
          return (
            <Box key={p.id} gap={2}>
              <Text color={selected ? colors.orange : colors.muted}>
                {selected ? '▶' : ' '}
              </Text>
              <Box flexDirection="column">
                <Box gap={2}>
                  <Text color={p.disabled ? colors.muted : selected ? colors.white : colors.muted} bold={selected}>
                    {i + 1}.  {p.name}
                  </Text>
                  {p.disabled && (
                    <Text color={colors.muted}>— {p.disabledReason}</Text>
                  )}
                </Box>
                <Text color={colors.muted}>
                  {p.region}  ·  {p.costRunning} running  ·  {p.costStopped} stopped
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

// Step number → accent color, so each field feels distinct
const STEP_COLORS = [colors.teal, colors.purple, colors.orange, colors.gold, colors.teal];

const TaskRow: React.FC<{ task: Task }> = ({ task }) => {
  const frame = useFrame(80, task.status === 'running');

  const icon =
    task.status === 'done'    ? <Text color={colors.green}>✓</Text> :
    task.status === 'error'   ? <Text color={colors.red}>✗</Text> :
    task.status === 'running' ? <Text color={colors.teal}>{spinnerFrames[frame % spinnerFrames.length]}</Text> :
                                <Text color={colors.muted}>○</Text>;

  const labelColor =
    task.status === 'done'    ? colors.white :
    task.status === 'running' ? colors.white :
    task.status === 'error'   ? colors.red   :
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
  fields: Array<{ key: string; label: string; hint: string; mask: boolean }>;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
}> = ({ step, fields, value, onChange, onSubmit }) => {
  const field = fields[step];
  const accent = STEP_COLORS[step % STEP_COLORS.length];

  // Step dots: ● ● ○ ○ ○
  const dots = fields.map((_, i) =>
    i < step    ? <Text key={`d${i}`} color={colors.green}>●</Text> :
    i === step  ? <Text key={`d${i}`} color={accent}>●</Text> :
                  <Text key={`d${i}`} color={colors.muted}>○</Text>
  );

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1}>{dots}</Box>
      <Box flexDirection="column">
        <Text color={accent} bold>{field.label}</Text>
        <Text color={colors.muted}>{field.hint}</Text>
      </Box>
      <Box marginTop={1} gap={1}>
        <Text color={accent}>›</Text>
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
    <Text color={colors.gold} bold>✦  Setting up your base camp...</Text>
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
      <Text><Text color={colors.teal}   bold>make start</Text>   <Text color={colors.muted}>spin up the server</Text></Text>
      <Text><Text color={colors.orange} bold>make stop </Text>   <Text color={colors.muted}>shut it down</Text></Text>
      <Text><Text color={colors.purple} bold>make ssh  </Text>   <Text color={colors.muted}>connect to the server</Text></Text>
      <Text><Text color={colors.gold}   bold>make logs </Text>   <Text color={colors.muted}>tail server output</Text></Text>
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

  const [phase, setPhase] = useState<Phase>({ type: 'select' });
  const [fieldValue, setFieldValue] = useState(detectRepo() || saved.GITHUB_REPO || '');
  const [form, setForm] = useState<Partial<FormValues>>({
    repo: detectRepo() || saved.GITHUB_REPO,
  });

  const handleProviderSelect = (p: Provider) => {
    setPhase({ type: 'inputs', step: 0, provider: p });
  };

  // Pre-fill value when moving between steps
  useEffect(() => {
    if (phase.type !== 'inputs') return;
    const fields = buildFields(phase.provider);
    setFieldValue((form[fields[phase.step].key] as string) ?? '');
  }, [phase.type === 'inputs' ? phase.step : -1]);

  // Handle field submission
  const handleSubmit = (value: string) => {
    if (phase.type !== 'inputs' || !value.trim()) return;
    const fields = buildFields(phase.provider);
    const updated = { ...form, [fields[phase.step].key]: value.trim() };
    setForm(updated);
    setFieldValue('');

    const nextStep = phase.step + 1;
    if (nextStep >= fields.length) {
      setPhase({ type: 'running', tasks: INITIAL_TASKS.map(t => ({ ...t })), provider: phase.provider });
    } else {
      setPhase({ type: 'inputs', step: nextStep, provider: phase.provider });
    }
  };

  // Run setup when we enter the running phase
  useEffect(() => {
    if (phase.type !== 'running' || hasRun.current) return;
    hasRun.current = true;

    const values = form as FormValues;
    const provider = phase.provider;
    const SSH_KEY  = `${process.env.HOME}/.ssh/astro-server`;
    const REPO_URL = `https://github.com/${values.repo}`;

    const update = (i: number, status: TaskStatus, error?: string) =>
      setPhase(prev =>
        prev.type === 'running'
          ? { ...prev, tasks: prev.tasks.map((t, idx) => idx === i ? { ...t, status, error } : t) }
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

      const s3Key    = values[provider.s3KeyEnvVar];
      const s3Secret = values[provider.s3SecretEnvVar];
      const tfArgs = {
        tfDir:  provider.tfDir,
        tfVars: {
          ...provider.terraformVars(values),
          ssh_public_key: sshPublicKey,
          repo_url:       REPO_URL,
        },
        s3AccessKey: s3Key,
        s3SecretKey: s3Secret,
        s3Endpoint:  provider.s3Endpoint,
      };

      // 1 — S3 bucket
      update(1, 'running');
      try {
        await ensureBucket(s3Key, s3Secret, provider.s3Endpoint, provider.s3Bucket);
        update(1, 'done');
      } catch (e) { return fail(1, 'Could not create state bucket. Check your S3 credentials.', String(e)); }

      // 2 — Terraform init
      update(2, 'running');
      const initRes = await tf.init(tfArgs);
      if (!initRes.ok) return fail(2, 'Terraform init failed.', initRes.error);
      update(2, 'done');

      // 3 — Saves volume
      update(3, 'running');
      const volumeExists = await tf.stateShow(tfArgs, provider.tfSavesResource);
      if (!volumeExists) {
        const volRes = await tf.applyTarget(tfArgs, provider.tfSavesResource);
        if (!volRes.ok) return fail(3, 'Could not create saves volume.', volRes.error);
      }
      update(3, 'done');

      // 4 — GitHub secrets
      update(4, 'running');
      try {
        const secrets: Record<string, string> = {
          SSH_PUBLIC_KEY:  sshPublicKey,
          SSH_PRIVATE_KEY: sshPrivateKey,
        };
        for (const cred of provider.credentials) {
          secrets[cred.envKey] = values[cred.envKey];
        }
        for (const [name, value] of Object.entries(secrets)) {
          await setSecret(values.githubToken, values.repo, name, value);
        }
        update(4, 'done');
      } catch (e) { return fail(4, 'Could not set GitHub secrets. Check your GitHub token.', String(e)); }

      // Write .env
      const envData: Record<string, string> = {
        GITHUB_TOKEN: values.githubToken,
        GITHUB_REPO:  values.repo,
        SSH_KEY,
      };
      for (const cred of provider.credentials) {
        envData[cred.envKey] = values[cred.envKey];
      }
      writeEnv(envData);

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
      {phase.type === 'select'  && <ProviderSelect onSelect={handleProviderSelect} />}
      {phase.type === 'inputs'  && (
        <InputPhase
          step={phase.step}
          fields={buildFields(phase.provider)}
          value={fieldValue}
          onChange={setFieldValue}
          onSubmit={handleSubmit}
        />
      )}
      {phase.type === 'running' && <RunningPhase tasks={phase.tasks} />}
      {phase.type === 'done'    && <DonePhase />}
      {phase.type === 'error'   && <ErrorPhase message={phase.message} />}
    </Box>
  );
};

render(<Setup />);
