// NOTE: Hetzner support is in testing and not yet available for selection.
// The implementation is kept here for future enablement.

import type { Provider } from './types.js';

const API = 'https://api.hetzner.cloud/v1';

function headers(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export const hetzner: Provider = {
  id:           'hetzner',
  name:         'Hetzner',
  costRunning:  '~$4/mo',
  costStopped:  '~$0.05/mo',
  region:       'ash (Ashburn, VA)',

  // in testing — not yet selectable in the setup wizard
  disabled:       true,
  disabledReason: 'coming soon',

  tfDir:          'terraform/hetzner',

  s3Endpoint:     'https://fsn1.your-objectstorage.com',
  s3Bucket:       'astro-server-tf-state',
  s3KeyEnvVar:    'HETZNER_S3_ACCESS_KEY',
  s3SecretEnvVar: 'HETZNER_S3_SECRET_KEY',

  tfSavesResource: 'hcloud_volume.saves',

  terraformVars(creds) {
    return { hcloud_token: creds.HCLOUD_TOKEN };
  },

  credentials: [
    {
      label:  'Hetzner Cloud API Token',
      envKey: 'HCLOUD_TOKEN',
      hint:   'console.hetzner.cloud → project → Security → API Tokens → Generate',
      mask:   true,
    },
    {
      label:  'Hetzner Object Storage  ·  Access Key',
      envKey: 'HETZNER_S3_ACCESS_KEY',
      hint:   'console.hetzner.cloud → project → Security → S3 Credentials → Generate',
      mask:   false,
    },
    {
      label:  'Hetzner Object Storage  ·  Secret Key',
      envKey: 'HETZNER_S3_SECRET_KEY',
      hint:   'Same page as above — copy the secret key',
      mask:   true,
    },
  ],

  async validateCredentials(creds) {
    const res = await fetch(`${API}/servers`, { headers: headers(creds.HCLOUD_TOKEN) });
    if (!res.ok) return { ok: false, error: 'API token invalid or missing permissions' };
    return { ok: true };
  },

  async checkVolume(creds) {
    const res = await fetch(`${API}/volumes?name=astro-saves`, { headers: headers(creds.HCLOUD_TOKEN) });
    const data = await res.json() as { volumes: unknown[] };
    return (data.volumes?.length ?? 0) > 0;
  },

  async checkServer(creds) {
    const res = await fetch(`${API}/servers?name=astro-server`, { headers: headers(creds.HCLOUD_TOKEN) });
    const data = await res.json() as { servers: unknown[] };
    return (data.servers?.length ?? 0) > 0;
  },
};
