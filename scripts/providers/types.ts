// Provider abstraction — cloud target for Astroneer dedicated hosting.

export interface ProviderCredential {
  label:  string;
  envKey: string;
  hint:   string;
  mask:   boolean;
  optional?: boolean;
  selectOptions?: Array<{ value: string; label: string }>;
}

export interface Provider {
  id: string;
  name: string;
  costRunning: string;
  costStopped: string;
  region: string;
  credentials: ProviderCredential[];
  validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }>;
  /** Persistent volume exists for this app */
  checkVolume(env: Record<string, string | undefined>): Promise<boolean>;
  /** At least one machine / deploy exists */
  checkServer(env: Record<string, string | undefined>): Promise<boolean>;

  disabled?: boolean;
  disabledReason?: string;
}
