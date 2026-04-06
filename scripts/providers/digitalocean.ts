import type { Provider } from './types.js';

const API = 'https://api.digitalocean.com/v2';

function headers(token: string) {
  return {
    Authorization:  `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export const digitalocean: Provider = {
  id:           'digitalocean',
  name:         'DigitalOcean',
  costRunning:  '~$24/mo',
  costStopped:  '~$1/mo',
  region:       'nyc3 (New York)',

  tfDir:          'terraform/digitalocean',

  s3Endpoint:     'https://nyc3.digitaloceanspaces.com',
  s3Bucket:       'astro-server-tf-state',
  s3KeyEnvVar:    'DO_SPACES_KEY',
  s3SecretEnvVar: 'DO_SPACES_SECRET',

  tfSavesResource: 'digitalocean_volume.saves',

  terraformVars(creds) {
    return { do_token: creds.DO_TOKEN };
  },

  credentials: [
    {
      label:  'DigitalOcean API Token',
      envKey: 'DO_TOKEN',
      hint:   'cloud.digitalocean.com → API → Generate New Token  (read + write)',
      mask:   true,
    },
    {
      label:  'Spaces Access Key',
      envKey: 'DO_SPACES_KEY',
      hint:   'cloud.digitalocean.com → API → Spaces Keys → Generate',
      mask:   false,
    },
    {
      label:  'Spaces Secret Key',
      envKey: 'DO_SPACES_SECRET',
      hint:   'Same page as above — copy the secret key',
      mask:   true,
    },
  ],

  async validateCredentials(creds) {
    const res = await fetch(`${API}/account`, { headers: headers(creds.DO_TOKEN) });
    if (!res.ok) return { ok: false, error: 'API token invalid or missing permissions' };
    return { ok: true };
  },

  async checkVolume(creds) {
    const res = await fetch(`${API}/volumes?name=astro-saves`, { headers: headers(creds.DO_TOKEN) });
    const data = await res.json() as { volumes: unknown[] };
    return (data.volumes?.length ?? 0) > 0;
  },

  async checkServer(creds) {
    const res = await fetch(`${API}/droplets?name=astro-server`, { headers: headers(creds.DO_TOKEN) });
    const data = await res.json() as { droplets: unknown[] };
    return (data.droplets?.length ?? 0) > 0;
  },
};
