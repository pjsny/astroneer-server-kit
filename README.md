# astroneer-server-kit

> Self-hosted Astroneer dedicated server on **Vultr** (Ubuntu + **Wine** + Windows Steam depot 728470) — **`make start` / `make stop`** run Terraform locally (no GitHub PAT).

**Up to 8 players · Steam only (no Xbox/Game Pass crossplay) · ~$4/mo while running · ~$0.05/mo while stopped**

---

## Quick start

**First time only (~5 min):**

1. **Fork & clone** this repo (needed so cloud-init can pull `bootstrap.sh` from **your** `main` branch on GitHub).
2. From the clone, run setup:

```bash
brew install terraform bun
git clone git@github.com:YOUR_USERNAME/astroneer-server-kit.git
cd astroneer-server-kit
bun install
bun run setup
```

The wizard asks for your **Vultr API key** (and optional region). It runs `terraform/bootstrap/` to **create an Object Storage subscription**, writes S3 credentials into `.env`, and creates the remote-state bucket — no manual S3 keys in the panel.

**Every session:**

```bash
make start   # terraform apply (VM + first-boot bootstrap; allow 15–25+ min before joining)
make stop    # terraform destroy (VM only; saves stay on the block volume)
```

**Connect in-game:** Multiplayer → Servers → Add Server → `YOUR_IP:8777`

Run `make ip` (or `cd terraform/vultr && terraform output -raw server_ip`) after `make start` completes.

---

## How it works

- **`make start` / `make stop`** call Terraform on your machine using credentials in `.env` (no GitHub token required)
- World saves live on a **persistent Vultr block volume** — data survives when the VM is destroyed (`make stop`)
- Everything is provisioned with **Terraform**

---

## What you need

- [Terraform](https://developer.hashicorp.com/terraform/install) — `brew install terraform`
- [Bun](https://bun.sh) — `brew install bun`
- A [Vultr](https://www.vultr.com/) account, **Object Storage** bucket + S3 keys, and patience (Wine + SteamCMD on first boot is slow and **best-effort** — UE under Wine can break on updates)
- **No** GitHub personal access token for the default path

---

## Vultr credentials

Run `make setup`:

| Input | Notes |
|--------|--------|
| API key | my.vultr.com → **API** → Personal access token |
| Region (optional) | Slug such as `ewr` — must support **Object Storage** in that region; blank = `ewr` |

Setup stores **`terraform/bootstrap/terraform.tfstate` locally** (gitignored) — that stack owns the Object Storage subscription. **Back it up** if you rely on it; losing only that file while keeping `.env` is recoverable only if you still have the subscription in the Vultr panel.

**Fork default branch:** cloud-init downloads `bootstrap.sh` from `raw.githubusercontent.com/…/main/…`. Use **`main`** as the default branch on your fork (or edit `cloud-init.yaml.tftpl` / `main.tf` locals).

---

## Starting and stopping

**Via terminal:**
```bash
make start   # spin up the server
make stop    # shut it down
make ip      # show current IP
make ssh     # SSH into the running server
make logs    # tail the server logs
make update  # update game to latest version
```

---

## Connecting in-game

Astroneer → Multiplayer → Servers → Add Server

- **IP:** `make ip` (after `make start` completes)
- **Port:** `8777`

---

## Moving an existing world

Find your save on Windows:
```
C:\Users\YOURNAME\AppData\Local\Astro\Saved\SaveGames\
```

Upload it:
```bash
bash upload-save.sh <server-ip> /path/to/SAVE_1.savegame
```

---

## Setting server name and owner

After your first boot:
```bash
make ssh
nano /mnt/saves/AstroServerSettings.ini
```

Set `OwnerName=` to your Steam display name. This file persists across all future sessions.

---

## Troubleshooting

Run `make preflight` to check your configuration.

Open an [issue](https://github.com/pjsny/astroneer-server-kit/issues) if you're stuck — use the issue templates for the fastest response.
