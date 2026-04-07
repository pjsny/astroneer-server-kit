#!/usr/bin/env bun
import React, { useState, useEffect, useRef, startTransition } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import fs from 'fs';
import { loadEnv, writeEnv } from './lib/env.js';
import { ensureBucket } from './lib/s3.js';
import { detectGitHubRepoSlug } from './lib/repo.js';
import { provisionObjectStorageForTerraformState } from './lib/vultr-bootstrap.js';
import * as tf from './lib/terraform.js';
import type { TerraformEnv } from './lib/terraform.js';
import { Header } from './ui/Header.js';
import { colors } from './ui/theme.js';
import { providers } from './providers/index.js';
import type { Provider } from './providers/index.js';
import { terraformStateBucketFromServerName } from './lib/s3-bucket-name.js';
import {
  DEFAULT_VULTR_PLAN_SLUG,
  SETUP_LEGAL_BLURB,
  VULTR_COMPUTE_PLANS,
} from './providers/vultr-plans.js';

/** Extra error output in the UI + longer exit delay. Also accepts `--debug`. */
const SETUP_DEBUG =
  process.env.ASTRONEER_SETUP_DEBUG === '1' ||
  process.env.SETUP_DEBUG === '1' ||
  process.argv.includes('--debug');

function formatErrorDetail(e: unknown): string {
  if (e instanceof Error && e.stack) return `${e.message}\n${e.stack}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Short user-facing line when we recognize the failure mode (full detail still in Debug / stderr). */
function objectStorageProvisionSummary(detail: string): string {
  const base =
    'Could not provision Object Storage or create the state bucket. Check API key and region (object storage must exist in that region).';
  if (/unauthorized ip/i.test(detail)) {
    return (
      `${base} ` +
      "Vultr blocked this machine's public IP: your API token is likely restricted by an IP allowlist. " +
      'In my.vultr.com → API, add your current IP, enable All IPv4 / All IPv6, or use an allowed network / VPN.'
    );
  }
  if (/invalid tier/i.test(detail)) {
    return (
      `${base} ` +
      'Object Storage tiers depend on the cluster/region. Re-run setup (bootstrap now resolves tier from the Vultr API), or set TF_VAR_object_storage_tier_id to an id from GET .../object-storage/clusters/{cluster}/tiers.'
    );
  }
  if (/invalidlocationconstraint|location constraint is not valid/i.test(detail)) {
    return (
      `${base} ` +
      'S3 CreateBucket was sent a bad LocationConstraint for this object-storage host. Ensure you are on the latest kit (Vultr uses endpoint-only placement; the client must use region us-east-1 for signing).'
    );
  }
  return base;
}

// ── Types ──────────────────────────────────────────────────────────────────────

type FormValues = Record<string, string>;

type TaskStatus = 'pending' | 'running' | 'done' | 'error';
interface Task { label: string; status: TaskStatus; error?: string; }

type Phase =
  | { type: 'select' }
  | { type: 'serverName'; provider: Provider }
  | { type: 'planSelect'; provider: Provider; serverName: string }
  | { type: 'inputs'; step: number; provider: Provider }
  | { type: 'running'; tasks: Task[]; provider: Provider }
  | { type: 'done' }
  | { type: 'error'; message: string; detail?: string };

// ── Field list built dynamically from the selected provider ───────────────────

type CredentialStepField = {
  key: string;
  label: string;
  hint: string;
  mask: boolean;
  optional: boolean;
  selectOptions?: Array<{ value: string; label: string }>;
};

function buildFields(provider: Provider): CredentialStepField[] {
  return provider.credentials.map(c => ({
    key:   c.envKey,
    label: c.label,
    hint:  c.hint,
    mask:  c.mask,
    optional: c.optional ?? false,
    selectOptions: c.selectOptions,
  }));
}

const INITIAL_TASKS: Task[] = [
  { label: 'SSH key',                                  status: 'pending' },
  { label: 'Vultr Object Storage (Terraform bootstrap)', status: 'pending' },
  { label: 'Terraform init (main)',                    status: 'pending' },
  { label: 'Persistent saves volume',                  status: 'pending' },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

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
  // Static running glyph — animated useFrame() tick races React 19 + Ink ("Cannot update TaskRow while rendering Setup").
  const icon =
    task.status === 'done'    ? <Text color={colors.green}>✓</Text> :
    task.status === 'error'   ? <Text color={colors.red}>✗</Text> :
    task.status === 'running' ? <Text color={colors.teal}>›</Text> :
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

const ServerNamePhase: React.FC<{
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
}> = ({ value, onChange, onSubmit }) => (
  <Box flexDirection="column" gap={1}>
    <Text color={colors.teal} bold>Server display name</Text>
    <Text color={colors.muted}>
      Shown in the in-game server browser (<Text color={colors.white}>ServerName</Text> in AstroServerSettings.ini).
      Your Terraform remote state bucket name is derived from this label.
    </Text>
    <Text color={colors.muted}>
      Stop the dedicated server before editing <Text color={colors.white}>Engine.ini</Text> or{' '}
      <Text color={colors.white}>AstroServerSettings.ini</Text> — changes made while it is running may not stick.
    </Text>
    <Box marginTop={1} gap={1}>
      <Text color={colors.teal}>›</Text>
      <TextInput value={value} onChange={onChange} onSubmit={onSubmit} placeholder="e.g. Trailblazers Co-op" />
    </Box>
  </Box>
);

const PlanSelectPhase: React.FC<{
  serverName: string;
  initialSlug: string;
  onConfirm: (slug: string) => void;
}> = ({ serverName, initialSlug, onConfirm }) => {
  const i0 = VULTR_COMPUTE_PLANS.findIndex(p => p.slug === initialSlug);
  const [cursor, setCursor] = useState(i0 >= 0 ? i0 : 1);

  const move = (d: -1 | 1) =>
    setCursor(c => {
      const n = c + d;
      return n >= 0 && n < VULTR_COMPUTE_PLANS.length ? n : c;
    });

  useInput((_, key) => {
    if (key.upArrow)   move(-1);
    if (key.downArrow) move(1);
    if (key.return)    onConfirm(VULTR_COMPUTE_PLANS[cursor].slug);
  });

  const plan = VULTR_COMPUTE_PLANS[cursor];
  if (!plan) return null;

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={colors.teal} bold>Instance size (Vultr)</Text>
      <Text color={colors.muted}>
        Server <Text color={colors.white}>{serverName}</Text>
        {' — '}
        <Text color={colors.muted}>↑ ↓  ·  enter to confirm</Text>
      </Text>
      <Text color={colors.muted}>Prices are rough US$/month guides; confirm at vultr.com.</Text>
      <Box flexDirection="column" marginTop={1} gap={1}>
        {VULTR_COMPUTE_PLANS.map((p, i) => {
          const sel = i === cursor;
          return (
            <Box key={p.slug} gap={2}>
              <Text color={sel ? colors.orange : colors.muted}>{sel ? '▶' : ' '}</Text>
              <Box flexDirection="column">
                <Text color={sel ? colors.white : colors.muted} bold={sel}>
                  {p.label}  <Text color={colors.gold}>{p.priceHint}</Text>
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={colors.muted} paddingX={1} paddingY={0} gap={0}>
        <Text color={colors.purple} bold>Spec note</Text>
        <Text color={colors.muted}>{plan.guidance}</Text>
        <Box marginTop={1}>
          <Text color={colors.muted} dimColor>
            Astroneer dedicated: Steam, up to 8 players; client uses TCP/UDP 8777 (port in Engine.ini). Hosting your own server means firewall and security are on you.
          </Text>
        </Box>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={colors.red} bold>Important</Text>
        <Text color={colors.muted}>{SETUP_LEGAL_BLURB}</Text>
      </Box>
    </Box>
  );
};

const InputPhase: React.FC<{
  step: number;
  fields: CredentialStepField[];
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
}> = ({ step, fields, value, onChange, onSubmit }) => {
  const field = fields[step];
  const accent = STEP_COLORS[step % STEP_COLORS.length];
  const opts = field.selectOptions;

  const [selectCursor, setSelectCursor] = useState(0);

  useEffect(() => {
    if (!opts) return;
    const i = opts.findIndex(o => o.value === value);
    setSelectCursor(i >= 0 ? i : 0);
  }, [step, opts, value]);

  useInput(
    (_, key) => {
      if (!opts) return;
      if (key.upArrow)   setSelectCursor(c => Math.max(0, c - 1));
      if (key.downArrow) setSelectCursor(c => Math.min(opts.length - 1, c + 1));
      if (key.return) {
        setSelectCursor(c => {
          onSubmit(opts[c].value);
          return c;
        });
      }
    },
    { isActive: Boolean(opts) },
  );

  // Step dots: ● ● ○ ○ ○
  const dots = fields.map((_, i) =>
    i < step    ? <Text key={`d${i}`} color={colors.green}>●</Text> :
    i === step  ? <Text key={`d${i}`} color={accent}>●</Text> :
                  <Text key={`d${i}`} color={colors.muted}>○</Text>
  );

  const selectedOpt = opts?.[selectCursor];

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1}>{dots}</Box>
      <Box flexDirection="column">
        <Text color={accent} bold>{field.label}</Text>
        <Text color={colors.muted}>{field.hint}</Text>
        {field.optional && !opts && (
          <Text color={colors.muted}>Optional — leave blank for default ({'ewr'})</Text>
        )}
        {opts && (
          <Text color={colors.muted}>↑ ↓ to move  ·  enter to confirm</Text>
        )}
      </Box>
      {opts && selectedOpt ? (
        <Box flexDirection="column" marginTop={1} gap={0}>
          {opts.map((opt, i) => {
            const sel = i === selectCursor;
            return (
              <Box key={opt.value || '__default'} gap={2}>
                <Text color={sel ? colors.orange : colors.muted}>{sel ? '▶' : ' '}</Text>
                <Text color={sel ? colors.white : colors.muted} bold={sel}>{opt.label}</Text>
              </Box>
            );
          })}
        </Box>
      ) : (
        <Box marginTop={1} gap={1}>
          <Text color={accent}>›</Text>
          <TextInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            mask={field.mask ? '*' : undefined}
            placeholder={field.optional ? "(default)" : "..."}
          />
        </Box>
      )}
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
      <Text><Text color={colors.teal}   bold>make ip   </Text>   <Text color={colors.muted}>show current server IP</Text></Text>
    </Box>
    <Text color={colors.muted}>See you out there, Explorer. ✦</Text>
  </Box>
);

const ErrorPhase: React.FC<{ message: string; detail?: string }> = ({ message, detail }) => (
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
    {SETUP_DEBUG && detail && (
      <Box flexDirection="column" marginTop={1} gap={0}>
        <Text color={colors.orange} bold>Debug (full trace)</Text>
        {detail.split('\n').map((line, i) => (
          <Text key={i} color={colors.muted}>{line || ' '}</Text>
        ))}
      </Box>
    )}
    <Text color={colors.muted}>
      Run <Text color={colors.orange}>make preflight</Text> to check your configuration.
      {!SETUP_DEBUG && detail ? (
        <>
          {' '}Terraform stderr (if any) was also printed <Text color={colors.white} bold>above</Text> this box. For on-screen detail:{' '}
          <Text color={colors.orange}>ASTRONEER_SETUP_DEBUG=1 make setup</Text> or{' '}
          <Text color={colors.orange}>bun scripts/setup.tsx --debug</Text>.
        </>
      ) : null}
    </Text>
  </Box>
);

// ── Main app ───────────────────────────────────────────────────────────────────

const Setup: React.FC = () => {
  const { exit } = useApp();
  const saved = loadEnv();
  const hasRun = useRef(false);

  const [phase, setPhase] = useState<Phase>({ type: 'select' });
  const [fieldValue, setFieldValue] = useState('');
  const [form, setForm] = useState<Partial<FormValues>>({});

  const handleProviderSelect = (p: Provider) => {
    const fromSaved = (saved as Record<string, string | undefined>).ASTRONEER_SERVER_NAME;
    const initial =
      (form.ASTRONEER_SERVER_NAME || (typeof fromSaved === 'string' ? fromSaved : '')) ?? '';
    setFieldValue(initial);
    setPhase({ type: 'serverName', provider: p });
  };

  const handleServerNameSubmit = (value: string) => {
    if (phase.type !== 'serverName') return;
    const v = value.trim();
    if (!v) return;
    setForm(f => ({ ...f, ASTRONEER_SERVER_NAME: v }));
    setFieldValue('');
    setPhase({ type: 'planSelect', provider: phase.provider, serverName: v });
  };

  const handlePlanConfirm = (slug: string) => {
    if (phase.type !== 'planSelect') return;
    const p = phase.provider;
    const updatedForm: Partial<FormValues> = { ...form, VULTR_PLAN: slug };
    setForm(updatedForm);

    const fields = buildFields(p);
    const key0 = fields[0].key;
    const fromSaved0 = (saved as Record<string, string | undefined>)[key0];
    const initial0 =
      (updatedForm[key0] || (typeof fromSaved0 === 'string' ? fromSaved0 : '')) ?? '';
    setFieldValue(initial0);
    setPhase({ type: 'inputs', step: 0, provider: p });
  };

  // Handle field submission
  const handleSubmit = (value: string) => {
    if (phase.type !== 'inputs') return;
    const fields = buildFields(phase.provider);
    const field = fields[phase.step];
    if (!value.trim() && !field.optional) return;
    const updated = { ...form, [field.key]: value.trim() };

    const nextStep = phase.step + 1;
    if (nextStep >= fields.length) {
      setForm(updated);
      setFieldValue('');
      setPhase({ type: 'running', tasks: INITIAL_TASKS.map(t => ({ ...t })), provider: phase.provider });
      return;
    }

    const nextKey = fields[nextStep].key;
    const fromSavedNext = (saved as Record<string, string | undefined>)[nextKey];
    const nextInitial =
      (updated[nextKey] || (typeof fromSavedNext === 'string' ? fromSavedNext : '')) ?? '';
    setForm(updated);
    setFieldValue(nextInitial);
    setPhase({ type: 'inputs', step: nextStep, provider: phase.provider });
  };

  // Run setup when we enter the running phase (defer + startTransition; TaskRow avoids useFrame ticks).
  useEffect(() => {
    if (phase.type !== 'running' || hasRun.current) return;
    hasRun.current = true;

    const values = form as FormValues;
    const provider = phase.provider;

    const timer = setTimeout(() => {
      const SSH_KEY = `${process.env.HOME}/.ssh/astro-server`;
      const repoSlug = detectGitHubRepoSlug();
      if (!repoSlug) {
        startTransition(() =>
          setPhase({
            type: 'error',
            message:
              'Could not detect a GitHub repo (git remote origin should be github.com/user/repo). Clone your fork first, or set GITHUB_REPO in .env before re-running setup.',
          }),
        );
        return;
      }
      const REPO_URL = `https://github.com/${repoSlug}`;

      const update = (i: number, status: TaskStatus, error?: string) =>
        startTransition(() =>
          setPhase(prev =>
            prev.type === 'running'
              ? { ...prev, tasks: prev.tasks.map((t, idx) => idx === i ? { ...t, status, error } : t) }
              : prev,
          ),
        );

      const fail = (_i: number, message: string, detail?: string) => {
        if (detail) console.error('\n[setup] — ' + message + ' —\n' + detail + '\n');
        startTransition(() => setPhase({ type: 'error', message, detail }));
      };

      void (async () => {
        // 0 — SSH key
        update(0, 'running');
        try {
          await ensureSshKey(SSH_KEY);
          update(0, 'done');
        } catch (e) {
          return fail(0, 'Could not create SSH key.', String(e));
        }

        const sshPublicKey = fs.readFileSync(`${SSH_KEY}.pub`, 'utf8').trim();

        const region = provider.terraformVars(values).region ?? 'ewr';
        const displayName = values.ASTRONEER_SERVER_NAME?.trim();
        if (!displayName) {
          startTransition(() =>
            setPhase({ type: 'error', message: 'Server display name is missing. Re-run setup from the beginning.' }),
          );
          return;
        }
        const tfStateBucket = terraformStateBucketFromServerName(displayName);

        // 1 — Vultr Object Storage subscription (Terraform) + empty state bucket
        update(1, 'running');
        let s3Key: string;
        let s3Secret: string;
        let s3Endpoint: string;
        let s3Bucket: string;
        try {
          const os = await provisionObjectStorageForTerraformState(
            values.VULTR_API_KEY,
            region,
            tfStateBucket,
          );
          s3Key = os.accessKey;
          s3Secret = os.secretKey;
          s3Endpoint = os.endpoint;
          s3Bucket = os.bucket;
          await ensureBucket(s3Key, s3Secret, s3Endpoint, s3Bucket);
          update(1, 'done');
        } catch (e) {
          const d = String(e);
          return fail(1, objectStorageProvisionSummary(d), d);
        }

        const tfArgs: TerraformEnv = {
          tfDir:  provider.tfDir,
          tfVars: {
            ...provider.terraformVars(values),
            ssh_public_key: sshPublicKey,
            repo_url:       REPO_URL,
          },
          s3AccessKey: s3Key,
          s3SecretKey: s3Secret,
          s3Endpoint,
          s3Bucket,
          s3StateKey: provider.s3StateKey,
        };

        // 2 — Main Terraform init
        update(2, 'running');
        const initRes = await tf.init(tfArgs);
        if (!initRes.ok) return fail(2, 'Terraform init failed.', initRes.error);
        update(2, 'done');

        // 3 — Saves volume
        update(3, 'running');
        const volumeExists = await tf.stateShow(tfArgs, provider.tfSavesResource);
        if (!volumeExists) {
          const volRes = await tf.applyTarget(
            {
              ...tfArgs,
              tfVars: { ...tfArgs.tfVars, attach_saves_volume: 'false' },
            },
            provider.tfSavesResource,
          );
          if (!volRes.ok) return fail(3, 'Could not create saves volume.', volRes.error);
        }
        update(3, 'done');

        const envData: Record<string, string> = {
          GITHUB_REPO:             repoSlug,
          SSH_KEY,
          ASTRONEER_SERVER_NAME:   displayName,
          VULTR_PLAN:              values.VULTR_PLAN || DEFAULT_VULTR_PLAN_SLUG,
          VULTR_API_KEY:           values.VULTR_API_KEY,
          VULTR_S3_ACCESS_KEY:     s3Key,
          VULTR_S3_SECRET_KEY:     s3Secret,
          VULTR_S3_ENDPOINT:       s3Endpoint,
          VULTR_S3_BUCKET:         s3Bucket,
        };
        if (values.VULTR_REGION?.trim()) envData.VULTR_REGION = values.VULTR_REGION.trim();
        writeEnv(envData);

        startTransition(() => setPhase({ type: 'done' }));
      })().catch(e => {
        const d = formatErrorDetail(e);
        console.error('\n[setup] — unhandled —\n' + d + '\n');
        startTransition(() => setPhase({ type: 'error', message: String(e), detail: d }));
      });
    }, 0);

    return () => clearTimeout(timer);
  }, [phase.type]);

  // Exit after completion (longer on error so you can read output / scrollback)
  useEffect(() => {
    if (phase.type === 'done' || phase.type === 'error') {
      const errDelay = SETUP_DEBUG ? 120_000 : 12_000;
      const t = setTimeout(() => exit(), phase.type === 'done' ? 300 : errDelay);
      return () => clearTimeout(t);
    }
  }, [phase.type]);

  if (!tf.isInstalled()) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Header subtitle="pre-flight systems check" animated={false} />
        <Text color={colors.red}>✗  Terraform is not installed.</Text>
        <Text color={colors.muted}>Install it with: <Text color={colors.orange}>brew install terraform</Text></Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Header animated={false} />
      {phase.type === 'select'     && <ProviderSelect onSelect={handleProviderSelect} />}
      {phase.type === 'serverName' && (
        <ServerNamePhase value={fieldValue} onChange={setFieldValue} onSubmit={handleServerNameSubmit} />
      )}
      {phase.type === 'planSelect' && (
        <PlanSelectPhase
          serverName={phase.serverName}
          initialSlug={
            form.VULTR_PLAN
            ?? (saved as Record<string, string | undefined>).VULTR_PLAN
            ?? DEFAULT_VULTR_PLAN_SLUG
          }
          onConfirm={handlePlanConfirm}
        />
      )}
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
      {phase.type === 'error'   && <ErrorPhase message={phase.message} detail={phase.detail} />}
    </Box>
  );
};

render(<Setup />);
