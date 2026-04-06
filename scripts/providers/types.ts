// Provider abstraction — defines what every cloud provider must implement.
// Add a new file in this directory and register it in index.ts to add a provider.

export interface ProviderCredential {
  label:  string;
  envKey: string;
  hint:   string;
  mask:   boolean;
}

export interface Provider {
  /** Internal ID — must match the terraform directory's provider block */
  id: string;
  /** Display name shown in the setup wizard */
  name: string;
  /** Approximate monthly cost while the server is running */
  costRunning: string;
  /** Approximate monthly cost while stopped (persistent volume only) */
  costStopped: string;
  /** Region label shown in the selector */
  region: string;

  // ── Object storage (used for Terraform remote state) ──────────────────────
  s3Endpoint:    string;
  s3Bucket:      string;
  /** envKey of the credential that holds the S3 access key */
  s3KeyEnvVar:   string;
  /** envKey of the credential that holds the S3 secret key */
  s3SecretEnvVar: string;

  // ── Terraform ─────────────────────────────────────────────────────────────
  /** Path to this provider's terraform directory, relative to repo root */
  tfDir: string;
  /**
   * Map provider credentials to Terraform variable names.
   * ssh_public_key and repo_url are injected by the setup wizard automatically.
   */
  terraformVars(creds: Record<string, string>): Record<string, string>;
  /** Terraform state address of the persistent saves volume, e.g. "digitalocean_volume.saves" */
  tfSavesResource: string;

  // ── Credentials collected by the setup wizard ─────────────────────────────
  credentials: ProviderCredential[];

  // ── Runtime checks ────────────────────────────────────────────────────────
  validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }>;
  checkVolume(creds: Record<string, string>): Promise<boolean>;
  checkServer(creds: Record<string, string>): Promise<boolean>;

  // ── Availability ──────────────────────────────────────────────────────────
  /** When true the provider appears in the list but cannot be selected. */
  disabled?: boolean;
  disabledReason?: string;
}
