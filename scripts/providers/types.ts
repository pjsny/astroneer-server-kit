// Provider abstraction — defines what every cloud provider must implement.
// Add a new file in this directory to support a new provider.

export interface ProviderCredentials {
  /** Human-readable name shown in the setup wizard */
  label: string;
  /** Key in the .env file and GitHub secrets */
  envKey: string;
  hint: string;
  mask: boolean;
}

export interface Provider {
  /** Internal ID — must match the terraform directory's provider block */
  id: string;
  /** Display name shown to users */
  name: string;
  /** Approximate monthly cost while running */
  costRunning: string;
  /** Approximate monthly cost while stopped (volume only) */
  costStopped: string;
  /** Region where the server will be deployed */
  region: string;
  /** Credentials the setup wizard needs to collect */
  credentials: ProviderCredentials[];
  /** Validate that the collected credentials are working */
  validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }>;
  /** Confirm the saves volume exists via the provider API */
  checkVolume(creds: Record<string, string>): Promise<boolean>;
  /** Confirm a server is currently running via the provider API */
  checkServer(creds: Record<string, string>): Promise<boolean>;
}
