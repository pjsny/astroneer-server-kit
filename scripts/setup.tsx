#!/usr/bin/env bun
import React, { useState, useEffect, useRef, useCallback, startTransition } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { loadEnv, writeEnvMerge } from './lib/env.js';
import { detectGitHubRepoSlug } from './lib/repo.js';
import {
  createFlyOrgDeployTokenAsync,
  flyAuthLoggedIn,
  flyAuthLoginInteractiveAsync,
  flyCmdAsync,
  FLY_CLI_INSTALL_DOCS_URL,
  flyInstalled,
  slugifyAppName,
  writeFlyToml,
} from './lib/fly.js';
import { Header } from './ui/Header.js';
import { colors } from './ui/theme.js';
import { providers } from './providers/index.js';
import type { Provider } from './providers/index.js';
import {
  DEFAULT_FLY_REGION,
  DEFAULT_FLY_VM_MEMORY,
  FLY_MEMORY_OPTIONS,
} from './providers/fly-regions.js';
import { randomBytes } from 'node:crypto';

const SETUP_DEBUG =
  process.env.ASTRONEER_SETUP_DEBUG === '1' ||
  process.env.SETUP_DEBUG === '1' ||
  process.argv.includes('--debug');

function formatErrorDetail(e: unknown): string {
  if (e instanceof Error && e.stack) return `${e.message}\n${e.stack}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

type FormValues = Record<string, string>;
type TaskStatus = 'pending' | 'running' | 'done' | 'error';
interface Task { label: string; status: TaskStatus; error?: string; }

type Phase =
  | { type: 'select' }
  | { type: 'flyPreflight'; provider: Provider }
  | { type: 'serverName'; provider: Provider }
  | { type: 'memorySelect'; provider: Provider; serverName: string }
  | { type: 'tokenSource'; provider: Provider }
  | { type: 'inputs'; step: number; provider: Provider; flyTokenMode?: 'generate' | 'manual' }
  | { type: 'running'; tasks: Task[]; provider: Provider; values: FormValues; flyTokenMode?: 'generate' | 'manual' }
  | { type: 'done' }
  | { type: 'error'; message: string; detail?: string };

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

const FLY_MANUAL_TOKEN_FIELD: CredentialStepField = {
  key:    'FLY_API_TOKEN',
  label:  'Fly API token',
  hint:
    'fly.io dashboard → Access Tokens, or paste a token you created with fly tokens create',
  mask:     true,
  optional: false,
};

const TOKEN_SOURCE_OPTIONS: Array<{ value: 'generate' | 'manual'; label: string }> = [
  { value: 'generate', label: 'Generate API token with fly CLI (default org — recommended)' },
  { value: 'manual', label: 'Enter API token manually' },
];

function getFlyInputFields(mode: 'generate' | 'manual'): CredentialStepField[] {
  const flyP = providers.find(p => p.id === 'fly');
  if (!flyP) return [];
  const regionOnly = buildFields(flyP);
  if (mode === 'generate') return regionOnly;
  return [FLY_MANUAL_TOKEN_FIELD, ...regionOnly];
}

function fieldsForInputsPhase(phase: Extract<Phase, { type: 'inputs' }>): CredentialStepField[] {
  if (phase.provider.id === 'fly' && phase.flyTokenMode) return getFlyInputFields(phase.flyTokenMode);
  return buildFields(phase.provider);
}

const INITIAL_TASKS: Task[] = [
  { label: 'Fly API token (org-scoped; fly tokens create org)', status: 'pending' },
  { label: 'Persistent volume (astroneer_server_kit_data)', status: 'pending' },
  { label: 'fly.toml + .env', status: 'pending' },
];

const STEP_COLORS = [colors.teal, colors.purple, colors.orange, colors.gold, colors.teal];

const TaskRow: React.FC<{ task: Task }> = ({ task }) => {
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

type FlyGateStatus = 'checking' | 'pass' | 'no-cli' | 'no-auth';

const FlyPreflightPhase: React.FC<{
  onPass: () => void;
  onBack: () => void;
}> = ({ onPass, onBack }) => {
  const [status, setStatus] = useState<FlyGateStatus>('checking');
  const [loginRunning, setLoginRunning] = useState(false);

  const runCheck = () => {
    setStatus('checking');
    queueMicrotask(() => {
      if (!flyInstalled()) {
        setStatus('no-cli');
        return;
      }
      if (!flyAuthLoggedIn()) {
        setStatus('no-auth');
        return;
      }
      setStatus('pass');
    });
  };

  useEffect(() => {
    runCheck();
  }, []);

  const runFlyAuthLogin = async () => {
    if (!flyInstalled()) return;
    setLoginRunning(true);
    try {
      process.stdout.write('\n');
      await flyAuthLoginInteractiveAsync();
    } catch (e) {
      console.error(e);
    } finally {
      setLoginRunning(false);
      runCheck();
    }
  };

  useInput(
    (input, key) => {
      if (key.escape) onBack();
      if (status === 'pass' && key.return) {
        onPass();
        return;
      }
      if (status === 'no-auth' && input === 'l') {
        void runFlyAuthLogin();
        return;
      }
      if ((status === 'no-cli' || status === 'no-auth') && (input === 'r' || key.return)) runCheck();
    },
    { isActive: !loginRunning },
  );

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={colors.teal} bold>Fly CLI (preflight)</Text>
      {loginRunning && (
        <Box
          borderStyle="round"
          borderColor={colors.purple}
          paddingX={2}
          paddingY={1}
          flexDirection="column"
          gap={0}
        >
          <Text color={colors.purple} bold>Running fly auth login…</Text>
          <Text color={colors.muted}>
            Use the browser or prompts below. When it finishes, we will re-check login.
          </Text>
        </Box>
      )}
      {!loginRunning && status === 'checking' && (
        <Text color={colors.muted}>Checking flyctl and fly auth…</Text>
      )}
      {!loginRunning && status === 'pass' && (
        <Box flexDirection="column" gap={1}>
          <Text color={colors.green}>✓  flyctl is available</Text>
          <Text color={colors.green}>✓  logged in (fly auth whoami)</Text>
          <Box marginTop={1}>
            <Text color={colors.muted}>
              <Text color={colors.teal} bold>enter</Text> to continue  ·  <Text color={colors.teal}>esc</Text> back
            </Text>
          </Box>
        </Box>
      )}
      {!loginRunning && status === 'no-cli' && (
        <Box flexDirection="column" gap={1}>
          <Text color={colors.red}>✗  flyctl not found</Text>
          <Text color={colors.muted}>
            Install: <Text color={colors.orange}>brew install flyctl</Text> (macOS) — see docs for Linux/Windows
          </Text>
          <Text color={colors.muted}>{FLY_CLI_INSTALL_DOCS_URL}</Text>
          <Text color={colors.muted}>
            <Text color={colors.teal}>r</Text> or <Text color={colors.teal}>enter</Text> retry  ·  <Text color={colors.teal}>esc</Text> back
          </Text>
        </Box>
      )}
      {!loginRunning && status === 'no-auth' && (
        <Box
          borderStyle="round"
          borderColor={colors.gold}
          paddingX={2}
          paddingY={1}
          flexDirection="column"
          gap={1}
        >
          <Text color={colors.red}>✗  not logged in to Fly</Text>
          <Text color={colors.muted}>
            We can run <Text color={colors.orange}>fly auth login</Text> for you in this terminal (browser / prompts).
          </Text>
          <Text color={colors.white}>
            Press <Text color={colors.teal} bold>l</Text> to run it here
          </Text>
          <Text color={colors.muted}>
            Or run it yourself elsewhere, then <Text color={colors.teal}>r</Text> / <Text color={colors.teal}>enter</Text> to retry
            {' · '}
            <Text color={colors.teal}>esc</Text> back
          </Text>
        </Box>
      )}
    </Box>
  );
};

const ProviderSelect: React.FC<{ onSelect: (p: Provider) => void; onExit: () => void }> = ({
  onSelect,
  onExit,
}) => {
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
    if (key.escape) onExit();
  });
  return (
    <Box flexDirection="column" gap={1}>
      <Text color={colors.teal} bold>Select hosting</Text>
      <Text color={colors.muted}>↑ ↓  ·  enter  ·  esc exit</Text>
      <Box flexDirection="column" marginTop={1} gap={1}>
        {providers.map((p, i) => {
          const selected = i === cursor && !p.disabled;
          return (
            <Box key={p.id} gap={2}>
              <Text color={selected ? colors.orange : colors.muted}>{selected ? '▶' : ' '}</Text>
              <Box flexDirection="column">
                <Box gap={2}>
                  <Text color={p.disabled ? colors.muted : selected ? colors.white : colors.muted} bold={selected}>
                    {i + 1}.  {p.name}
                  </Text>
                  {p.disabled && <Text color={colors.muted}>— {p.disabledReason}</Text>}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
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
      Shown in-game (<Text color={colors.white}>ServerName</Text>). Also seeds the Fly app name slug.
    </Text>
    <Box marginTop={1} gap={1}>
      <Text color={colors.teal}>›</Text>
      <TextInput value={value} onChange={onChange} onSubmit={onSubmit} placeholder="e.g. Trailblazers Co-op" />
    </Box>
  </Box>
);

const MemorySelectPhase: React.FC<{
  serverName: string;
  initial: string;
  onConfirm: (slug: string) => void;
}> = ({ serverName, initial, onConfirm }) => {
  const i0 = FLY_MEMORY_OPTIONS.findIndex(p => p.value === initial);
  const [cursor, setCursor] = useState(i0 >= 0 ? i0 : 1);
  const move = (d: -1 | 1) =>
    setCursor(c => {
      const n = c + d;
      return n >= 0 && n < FLY_MEMORY_OPTIONS.length ? n : c;
    });
  useInput((_, key) => {
    if (key.upArrow)   move(-1);
    if (key.downArrow) move(1);
    if (key.return)    onConfirm(FLY_MEMORY_OPTIONS[cursor].value);
  });
  const plan = FLY_MEMORY_OPTIONS[cursor];
  if (!plan) return null;
  return (
    <Box flexDirection="column" gap={1}>
      <Text color={colors.teal} bold>Machine memory (Fly VM)</Text>
      <Text color={colors.muted}>
        Server <Text color={colors.white}>{serverName}</Text> — ↑ ↓  ·  enter
      </Text>
      <Box flexDirection="column" marginTop={1} gap={1}>
        {FLY_MEMORY_OPTIONS.map((p, i) => {
          const sel = i === cursor;
          return (
            <Box key={p.value} gap={2}>
              <Text color={sel ? colors.orange : colors.muted}>{sel ? '▶' : ' '}</Text>
              <Text color={sel ? colors.white : colors.muted} bold={sel}>{p.label}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

const TokenSourcePhase: React.FC<{
  onConfirm: (mode: 'generate' | 'manual') => void;
  onBack: () => void;
}> = ({ onConfirm, onBack }) => {
  const [cursor, setCursor] = useState(0);
  const move = (d: -1 | 1) =>
    setCursor(c => {
      const n = c + d;
      return n >= 0 && n < TOKEN_SOURCE_OPTIONS.length ? n : c;
    });
  useInput((_, key) => {
    if (key.upArrow)   move(-1);
    if (key.downArrow) move(1);
    if (key.return) {
      const opt = TOKEN_SOURCE_OPTIONS[cursor];
      if (opt) onConfirm(opt.value);
    }
    if (key.escape) onBack();
  });
  return (
    <Box flexDirection="column" gap={1}>
      <Text color={colors.teal} bold>Fly API token</Text>
      <Text color={colors.muted}>↑ ↓  ·  enter  ·  esc back</Text>
      <Box flexDirection="column" marginTop={1} gap={1}>
        {TOKEN_SOURCE_OPTIONS.map((opt, i) => {
          const sel = i === cursor;
          return (
            <Box key={opt.value} gap={2}>
              <Text color={sel ? colors.orange : colors.muted}>{sel ? '▶' : ' '}</Text>
              <Text color={sel ? colors.white : colors.muted} bold={sel}>{opt.label}</Text>
            </Box>
          );
        })}
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
        const opt = opts[selectCursor];
        if (opt) onSubmit(opt.value);
      }
    },
    { isActive: Boolean(opts) },
  );

  const dots = fields.map((_, i) =>
    i < step    ? <Text key={`d${i}`} color={colors.green}>●</Text> :
    i === step  ? <Text key={`d${i}`} color={accent}>●</Text> :
                  <Text key={`d${i}`} color={colors.muted}>○</Text>,
  );

  const selectedOpt = opts?.[selectCursor];

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1}>{dots}</Box>
      <Box flexDirection="column">
        <Text color={accent} bold>{field.label}</Text>
        <Text color={colors.muted}>{field.hint}</Text>
        {field.optional && !opts && (
          <Text color={colors.muted}>Optional — blank defaults to {DEFAULT_FLY_REGION}</Text>
        )}
        {opts && <Text color={colors.muted}>↑ ↓  ·  enter</Text>}
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
    <Text color={colors.gold} bold>✦  Wiring Fly.io…</Text>
    <Box flexDirection="column" gap={1} marginTop={1}>
      {tasks.map((task, i) => <TaskRow key={i} task={task} />)}
    </Box>
  </Box>
);

const DonePhase: React.FC = () => (
  <Box flexDirection="column" borderStyle="round" borderColor={colors.green} paddingX={3} paddingY={1} gap={1}>
    <Text color={colors.green} bold>✓  Ready to deploy</Text>
    <Box flexDirection="column" marginTop={1} gap={0}>
      <Text><Text color={colors.teal} bold>make start</Text>   <Text color={colors.muted}>fly deploy (build is slow the first time)</Text></Text>
      <Text><Text color={colors.orange} bold>make stop</Text>   <Text color={colors.muted}>scale machines to 0</Text></Text>
      <Text><Text color={colors.gold} bold>make logs</Text>   <Text color={colors.muted}>fly logs</Text></Text>
      <Text><Text color={colors.teal} bold>make ip</Text>     <Text color={colors.muted}>allocated IPs</Text></Text>
    </Box>
    <Text color={colors.muted}>
      <Text color={colors.teal} bold>make start</Text> allocates a dedicated IPv4 (if needed) and sets{' '}
      <Text color={colors.white}>ASTRONEER_PUBLIC_IP</Text>. If joins still fail,{' '}
      <Text color={colors.orange}>fly secrets set ASTRONEER_PUBLIC_IP=… -a YOUR_APP</Text>
    </Text>
  </Box>
);

const ErrorPhase: React.FC<{ message: string; detail?: string }> = ({ message, detail }) => (
  <Box flexDirection="column" borderStyle="round" borderColor={colors.red} paddingX={3} paddingY={1} gap={1}>
    <Text color={colors.red} bold>✗  Something went wrong</Text>
    <Text color={colors.white}>{message}</Text>
    {SETUP_DEBUG && detail && (
      <Box flexDirection="column" marginTop={1} gap={0}>
        <Text color={colors.orange} bold>Debug</Text>
        {detail.split('\n').map((line, i) => (
          <Text key={i} color={colors.muted}>{line || ' '}</Text>
        ))}
      </Box>
    )}
    <Text color={colors.muted}><Text color={colors.orange}>make preflight</Text></Text>
  </Box>
);

const Setup: React.FC = () => {
  const { exit } = useApp();
  const saved = loadEnv();
  const hasRun = useRef(false);
  const [phase, setPhase] = useState<Phase>({ type: 'select' });
  const [fieldValue, setFieldValue] = useState('');
  const [form, setForm] = useState<Partial<FormValues>>({});

  const handleProviderSelect = (p: Provider) => {
    if (p.id === 'fly') {
      setPhase({ type: 'flyPreflight', provider: p });
      return;
    }
    const fromSaved = (saved as Record<string, string | undefined>).ASTRONEER_SERVER_NAME;
    const initial = (form.ASTRONEER_SERVER_NAME || (typeof fromSaved === 'string' ? fromSaved : '')) ?? '';
    setFieldValue(initial);
    setPhase({ type: 'serverName', provider: p });
  };

  const flyPreflightPass = useCallback(() => {
    setPhase(prev => {
      if (prev.type !== 'flyPreflight') return prev;
      const p = prev.provider;
      const fromSaved = (saved as Record<string, string | undefined>).ASTRONEER_SERVER_NAME;
      const initial = (form.ASTRONEER_SERVER_NAME || (typeof fromSaved === 'string' ? fromSaved : '')) ?? '';
      startTransition(() => setFieldValue(initial));
      return { type: 'serverName', provider: p };
    });
  }, [saved, form.ASTRONEER_SERVER_NAME]);

  const handleServerNameSubmit = (value: string) => {
    if (phase.type !== 'serverName') return;
    const v = value.trim();
    if (!v) return;
    setForm(f => ({ ...f, ASTRONEER_SERVER_NAME: v }));
    setFieldValue('');
    setPhase({ type: 'memorySelect', provider: phase.provider, serverName: v });
  };

  const handleMemoryConfirm = (mem: string) => {
    if (phase.type !== 'memorySelect') return;
    setForm(f => ({ ...f, FLY_VM_MEMORY: mem }));
    const p = phase.provider;
    if (p.id === 'fly') {
      setPhase({ type: 'tokenSource', provider: p });
      return;
    }
    const fields = buildFields(p);
    const key0 = fields[0].key;
    const fromSaved0 = (saved as Record<string, string | undefined>)[key0];
    const initial0 = (form[key0] || (typeof fromSaved0 === 'string' ? fromSaved0 : '')) ?? '';
    setFieldValue(initial0);
    setPhase({ type: 'inputs', step: 0, provider: p });
  };

  const handleTokenSourceConfirm = (mode: 'generate' | 'manual') => {
    if (phase.type !== 'tokenSource') return;
    const p = phase.provider;
    const fields = getFlyInputFields(mode);
    const key0 = fields[0]?.key;
    if (!key0) return;
    const fromSaved0 = (saved as Record<string, string | undefined>)[key0];
    const initial0 = (form[key0] || (typeof fromSaved0 === 'string' ? fromSaved0 : '')) ?? '';
    setFieldValue(initial0);
    setPhase({ type: 'inputs', step: 0, provider: p, flyTokenMode: mode });
  };

  const handleSubmit = (value: string) => {
    if (phase.type !== 'inputs') return;
    const fields = fieldsForInputsPhase(phase);
    const field = fields[phase.step];
    if (!value.trim() && !field.optional) return;
    const updated = { ...form, [field.key]: value.trim() };

    const nextStep = phase.step + 1;
    if (nextStep >= fields.length) {
      setForm(updated);
      setFieldValue('');
      setPhase({
        type:   'running',
        tasks:  INITIAL_TASKS.map(t => ({ ...t })),
        provider: phase.provider,
        values: updated as FormValues,
        flyTokenMode: phase.provider.id === 'fly' ? phase.flyTokenMode : undefined,
      });
      return;
    }
    const nextKey = fields[nextStep].key;
    const fromSavedNext = (saved as Record<string, string | undefined>)[nextKey];
    const nextInitial = (updated[nextKey] || (typeof fromSavedNext === 'string' ? fromSavedNext : '')) ?? '';
    setForm(updated);
    setFieldValue(nextInitial);
    setPhase({ type: 'inputs', step: nextStep, provider: phase.provider });
  };

  useEffect(() => {
    if (phase.type !== 'running' || hasRun.current) return;
    hasRun.current = true;
    const values = phase.values;
    const provider = phase.provider;

    const timer = setTimeout(() => {
      const update = (i: number, status: TaskStatus, error?: string) =>
        startTransition(() =>
          setPhase(prev =>
            prev.type === 'running'
              ? { ...prev, tasks: prev.tasks.map((t, idx) => idx === i ? { ...t, status, error } : t) }
              : prev,
          ),
        );

      const fail = (i: number, message: string, detail?: string) => {
        if (detail) console.error('\n[setup]\n' + detail + '\n');
        startTransition(() => setPhase({ type: 'error', message, detail }));
      };

      void (async () => {
        if (phase.type !== 'running') return;

        const displayName = values.ASTRONEER_SERVER_NAME?.trim();
        if (!displayName) {
          startTransition(() =>
            setPhase({ type: 'error', message: 'Server display name missing.' }),
          );
          return;
        }

        const tokenMode = phase.flyTokenMode ?? 'generate';
        const existingTok = (saved as Record<string, string | undefined>).FLY_API_TOKEN?.trim();

        update(0, 'running');
        if (!flyInstalled()) {
          return fail(
            0,
            'Fly CLI not found.',
            `Install flyctl — ${FLY_CLI_INSTALL_DOCS_URL}\n(e.g. brew install flyctl on macOS)`,
          );
        }

        let token: string | undefined;

        if (tokenMode === 'manual') {
          token = values.FLY_API_TOKEN?.trim() || existingTok;
          if (!token) {
            return fail(
              0,
              'Fly API token missing.',
              'Paste your token, or go back and choose Generate API token with fly CLI.',
            );
          }
        } else {
          token = existingTok;
          if (!token) {
            if (!flyAuthLoggedIn()) {
              return fail(
                0,
                'Not logged in to Fly.',
                'Run: fly auth login — or choose Enter API token manually.',
              );
            }
            const created = await createFlyOrgDeployTokenAsync();
            if (!created.ok || !created.token) {
              return fail(
                0,
                'Could not create Fly API token (fly tokens create org).',
                created.stderr ?? 'fly tokens create org failed',
              );
            }
            token = created.token;
          }
        }

        const fe = { FLY_API_TOKEN: token, FLY_ACCESS_TOKEN: token };

        update(0, 'done');

        const region = (values.FLY_REGION?.trim() || DEFAULT_FLY_REGION);
        const baseSlug = slugifyAppName(displayName);
        const suffix = randomBytes(3).toString('hex');
        const app = `${baseSlug}-${suffix}`.slice(0, 50);

        update(1, 'running');
        const createApp = await flyCmdAsync(["apps", "create", app], fe);
        if (!createApp.ok && !/already been taken|already exists|duplicate/i.test(createApp.stderr)) {
          return fail(1, 'Could not create Fly app.', createApp.stderr);
        }
        const vol = await flyCmdAsync(
          [
            "volumes",
            "create",
            "astroneer_server_kit_data",
            "--region",
            region,
            "--size",
            "20",
            "-y",
            "-a",
            app,
          ],
          fe,
        );
        if (!vol.ok && !/already exists|already been attached|duplicate|name is already used/i.test(vol.stderr + vol.stdout)) {
          return fail(1, 'Could not create volume astroneer_server_kit_data.', vol.stderr || vol.stdout);
        }
        update(1, 'done');

        update(2, 'running');
        const repoSlug = detectGitHubRepoSlug() ?? '';
        const vmMem = values.FLY_VM_MEMORY?.trim() || DEFAULT_FLY_VM_MEMORY;
        writeFlyToml({
          app,
          region,
          serverName: displayName,
          vmMemory:   vmMem,
        });
        writeEnvMerge({
          GITHUB_REPO:           repoSlug || undefined,
          ASTRONEER_SERVER_NAME: displayName,
          FLY_API_TOKEN:         token,
          FLY_APP_NAME:          app,
          FLY_REGION:            region,
          FLY_VM_MEMORY:         vmMem,
        });
        update(2, 'done');

        startTransition(() => setPhase({ type: 'done' }));
      })().catch(e => {
        const d = formatErrorDetail(e);
        console.error(d);
        startTransition(() => setPhase({ type: 'error', message: String(e), detail: d }));
      });
    }, 0);

    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase.type === 'done' || phase.type === 'error') {
      const errDelay = SETUP_DEBUG ? 120_000 : 12_000;
      const t = setTimeout(() => exit(), phase.type === 'done' ? 400 : errDelay);
      return () => clearTimeout(t);
    }
  }, [phase.type]);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Header animated={false} />
      {phase.type === 'select' && <ProviderSelect onSelect={handleProviderSelect} onExit={exit} />}
      {phase.type === 'flyPreflight' && (
        <FlyPreflightPhase onPass={flyPreflightPass} onBack={() => setPhase({ type: 'select' })} />
      )}
      {phase.type === 'serverName' && (
        <ServerNamePhase value={fieldValue} onChange={setFieldValue} onSubmit={handleServerNameSubmit} />
      )}
      {phase.type === 'memorySelect' && (
        <MemorySelectPhase
          serverName={phase.serverName}
          initial={
            form.FLY_VM_MEMORY
            ?? (saved as Record<string, string | undefined>).FLY_VM_MEMORY
            ?? DEFAULT_FLY_VM_MEMORY
          }
          onConfirm={handleMemoryConfirm}
        />
      )}
      {phase.type === 'tokenSource' && (
        <TokenSourcePhase
          onConfirm={handleTokenSourceConfirm}
          onBack={() => {
            const name = form.ASTRONEER_SERVER_NAME?.trim() ?? '';
            setPhase({
              type:       'memorySelect',
              provider: phase.provider,
              serverName: name || '—',
            });
          }}
        />
      )}
      {phase.type === 'inputs' && (
        <InputPhase
          step={phase.step}
          fields={fieldsForInputsPhase(phase)}
          value={fieldValue}
          onChange={setFieldValue}
          onSubmit={handleSubmit}
        />
      )}
      {phase.type === 'running' && <RunningPhase tasks={phase.tasks} />}
      {phase.type === 'done' && <DonePhase />}
      {phase.type === 'error' && <ErrorPhase message={phase.message} detail={phase.detail} />}
    </Box>
  );
};

render(<Setup />);
