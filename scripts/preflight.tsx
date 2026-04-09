#!/usr/bin/env bun
import React, { useState, useEffect } from 'react';
import { render, Box, Text, useApp } from 'ink';
import { useFrame } from './ui/useFrame.js';
import { loadEnv } from './lib/env.js';
import { flyAuthLoggedIn, flyInstalled, FLY_CLI_INSTALL_DOCS_URL } from './lib/fly.js';
import { Header } from './ui/Header.js';
import { colors, spinnerFrames } from './ui/theme.js';
import { defaultProvider } from './providers/index.js';

const provider = defaultProvider;

type CheckStatus = 'pending' | 'checking' | 'pass' | 'fail' | 'warn';
interface Check { label: string; status: CheckStatus; detail?: string; }

type Phase = 'running' | 'done';

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

const Preflight: React.FC = () => {
  const { exit } = useApp();
  const env = loadEnv();

  const [tools, setTools] = useState<Check[]>([
    { label: 'flyctl (Fly CLI)', status: 'pending' },
    { label: 'fly auth login', status: 'pending' },
    { label: 'bun',             status: 'pending' },
  ]);
  const [creds, setCreds] = useState<Check[]>([
    { label: 'FLY_APP_NAME + FLY_API_TOKEN (.env)', status: 'pending' },
  ]);
  const [infra, setInfra] = useState<Check[]>([
    { label: 'Fly volume astroneer_server_kit_data', status: 'pending' },
    { label: 'Machines running / deploy', status: 'pending' },
  ]);
  const [phase, setPhase] = useState<Phase>('running');
  const [failed, setFailed] = useState(0);
  const [deployed, setDeployed] = useState(false);

  const update = <T extends Check>(
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    i: number,
    patch: Partial<T>,
  ) => setter(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c) as T[]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const tally: CheckStatus[] = [];
        const envRecord = env as Record<string, string>;
        const flyCommitted = Boolean(
          envRecord.FLY_APP_NAME?.trim() || envRecord.FLY_API_TOKEN?.trim(),
        );

        update(setTools, 0, { status: 'checking' });
        if (flyInstalled()) {
          update(setTools, 0, { status: 'pass' });
          tally.push('pass');
        } else if (flyCommitted) {
          update(setTools, 0, {
            status: 'fail',
            detail: `Install flyctl — ${FLY_CLI_INSTALL_DOCS_URL}`,
          });
          tally.push('fail');
        } else {
          update(setTools, 0, {
            status: 'warn',
            detail: `Install flyctl before setup — ${FLY_CLI_INSTALL_DOCS_URL}`,
          });
          tally.push('warn');
        }

        update(setTools, 1, { status: 'checking' });
        if (!flyInstalled()) {
          update(setTools, 1, {
            status: 'warn',
            detail: 'Install flyctl first',
          });
          tally.push('warn');
        } else if (flyAuthLoggedIn()) {
          update(setTools, 1, { status: 'pass', detail: 'fly auth whoami' });
          tally.push('pass');
        } else if (flyCommitted) {
          update(setTools, 1, {
            status: 'fail',
            detail: 'Run: fly auth login',
          });
          tally.push('fail');
        } else {
          update(setTools, 1, {
            status: 'warn',
            detail: 'Run: fly auth login before make setup',
          });
          tally.push('warn');
        }

        update(setTools, 2, { status: 'checking' });
        update(setTools, 2, { status: 'pass', detail: 'you are running this with bun' });
        tally.push('pass');

        update(setCreds, 0, { status: 'checking' });
        const hasTok = Boolean(envRecord.FLY_API_TOKEN?.trim());
        const hasApp = Boolean(envRecord.FLY_APP_NAME?.trim());
        if (hasTok && hasApp) {
          const result = await provider.validateCredentials(envRecord);
          update(setCreds, 0, {
            status: result.ok ? 'pass' : 'fail',
            detail: result.ok ? undefined : `${result.error} — run setup`,
          });
          tally.push(result.ok ? 'pass' : 'fail');
        } else {
          update(setCreds, 0, { status: 'fail', detail: 'run: make setup' });
          tally.push('fail');
        }

        update(setInfra, 0, { status: 'checking' });
        try {
          const volOk = await provider.checkVolume(envRecord);
          update(setInfra, 0, {
            status: volOk ? 'pass' : 'fail',
            detail: volOk ? undefined : 'volume missing — re-run setup or fly volumes create',
          });
          tally.push(volOk ? 'pass' : 'fail');
        } catch {
          update(setInfra, 0, { status: 'fail', detail: 'could not check' });
          tally.push('fail');
        }

        update(setInfra, 1, { status: 'checking' });
        let running = false;
        try {
          running = await provider.checkServer(envRecord);
          const st = running ? 'warn' : 'pass';
          update(setInfra, 1, {
            status: st,
            detail: running
              ? 'App responds to fly status — you are likely billed for Machines'
              : 'No active deploy yet — run make start',
          });
          tally.push(st);
        } catch {
          update(setInfra, 1, { status: 'fail', detail: 'could not check' });
          tally.push('fail');
        }

        if (cancelled) return;
        setDeployed(running);
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

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Header subtitle="pre-flight systems check" />
      <Group title="Tools" checks={tools} />
      <Group title="Credentials" checks={creds} />
      <Group title="Infrastructure" checks={infra} />
      {phase === 'done' && (
        <Box
          borderStyle="round"
          borderColor={failed > 0 ? colors.red : colors.green}
          paddingX={3}
          paddingY={1}
          marginTop={1}
        >
          {failed > 0 ? (
            <Box flexDirection="column">
              <Text color={colors.red} bold>✗  {failed} check{failed > 1 ? 's' : ''} failed</Text>
              <Text color={colors.muted}>Run <Text color={colors.orange}>make setup</Text></Text>
            </Box>
          ) : deployed ? (
            <Text color={colors.green} bold>
              ✓  All good — <Text color={colors.orange}>make ip</Text> / <Text color={colors.orange}>make logs</Text>
              {' · stop with '}<Text color={colors.orange}>make stop</Text>
            </Text>
          ) : (
            <Text color={colors.green} bold>
              ✓  Ready. Run <Text color={colors.orange}>make start</Text> to deploy.
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};

render(<Preflight />);
