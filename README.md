# astroneer-server-kit

> Self-hosted Astroneer dedicated server on Hetzner — one-click start/stop via GitHub Actions, auto-shuts down when idle, world saves always persist.

![Start Server](https://github.com/pjsny/astroneer-server-kit/actions/workflows/start.yml/badge.svg)
![Stop Server](https://github.com/pjsny/astroneer-server-kit/actions/workflows/stop.yml/badge.svg)

**Up to 8 players · Steam only (no Xbox/Game Pass crossplay) · ~$4/mo while running · ~$0.05/mo while stopped**

---

## Quick start

**First time only (~5 min):**

1. **Fork this repo** (top-right on this page) — you need your own copy so GitHub Actions runs against your account
2. Clone your fork and run setup:

```bash
brew install terraform bun
git clone git@github.com:YOUR_USERNAME/astroneer-server-kit.git
cd astroneer-server-kit
bun install
bun run setup
```

The wizard asks for your Hetzner credentials and handles everything else automatically.

**Every session:**

```bash
make start   # spin up the server (~3 min to boot)
# play — server auto-stops after 60 min idle
make stop    # or stop it manually when done
```

**Connect in-game:** Multiplayer → Servers → Add Server → `YOUR_IP:8777`

The IP appears in the [Actions](https://github.com/pjsny/astroneer-server-kit/actions) tab after `make start` finishes.

---

## How it works

- **Start/stop** the server with one click in GitHub Actions (or `make start` / `make stop`)
- Server **auto-shuts down** after 60 minutes of no player activity
- World saves live on a **persistent Hetzner Volume** — never lost when the server is destroyed
- Everything is provisioned with **Terraform** — no manual server setup

---

## What you need

- [Terraform](https://developer.hashicorp.com/terraform/install) — `brew install terraform`
- [Bun](https://bun.sh) — `brew install bun`
- A [Hetzner](https://hetzner.com/cloud) account
- A [GitHub Personal Access Token](https://github.com/settings/tokens) with `repo` and `workflow` scopes

---

## Hetzner credentials

`bin/setup` will prompt you for these:

| Credential | Where to get it |
|------------|-----------------|
| Cloud API token | console.hetzner.cloud → project → Security → API Tokens → Generate |
| Object Storage access key + secret | console.hetzner.cloud → project → Security → S3 Credentials → Generate |

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

**Via GitHub Actions (useful for sharing with friends):**

Actions → Start Server → Run workflow

The workflow summary shows your IP and connect address.

---

## Connecting in-game

Astroneer → Multiplayer → Servers → Add Server

- **IP:** shown in the Start Server workflow summary
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
