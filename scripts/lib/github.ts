import sodium from "tweetsodium";

const BASE = "https://api.github.com";

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function setSecret(
  token: string,
  repo: string,
  name: string,
  value: string
) {
  // Get repo public key for secret encryption
  const keyRes = await fetch(
    `${BASE}/repos/${repo}/actions/secrets/public-key`,
    { headers: headers(token) }
  );
  if (!keyRes.ok) throw new Error(`Failed to get repo public key: ${keyRes.status}`);
  const { key, key_id } = await keyRes.json() as { key: string; key_id: string };

  // Encrypt with tweetsodium (pure JS crypto_box_seal — works in Bun)
  const keyBytes     = Buffer.from(key, "base64");
  const valueBytes   = Buffer.from(value);
  const encrypted    = sodium.seal(valueBytes, keyBytes);
  const encryptedB64 = Buffer.from(encrypted).toString("base64");

  const res = await fetch(`${BASE}/repos/${repo}/actions/secrets/${name}`, {
    method: "PUT",
    headers: headers(token),
    body: JSON.stringify({ encrypted_value: encryptedB64, key_id }),
  });
  if (!res.ok) throw new Error(`Failed to set secret ${name}: ${res.status}`);
}

export async function triggerWorkflow(
  token: string,
  repo: string,
  workflow: string,
  inputs: Record<string, string> = {}
) {
  const res = await fetch(
    `${BASE}/repos/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ ref: "main", inputs }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to trigger workflow: ${res.status} ${body}`);
  }
}

export async function validateToken(token: string): Promise<string | null> {
  const res = await fetch(`${BASE}/user`, { headers: headers(token) });
  if (!res.ok) return null;
  const data = await res.json() as { login: string };
  return data.login;
}
