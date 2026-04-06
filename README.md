# astroneer-server-kit

> Self-hosted Astroneer dedicated server on DigitalOcean — one-click start/stop via GitHub Actions, auto-shuts down when idle, world saves always persist.

![Start Server](https://github.com/pjsny/astroneer-server-kit/actions/workflows/start.yml/badge.svg)
![Stop Server](https://github.com/pjsny/astroneer-server-kit/actions/workflows/stop.yml/badge.svg)

**Up to 8 players · Steam only (no Xbox/Game Pass crossplay) · ~$24/mo while running · ~$1/mo while stopped**

---

## Quick start

**First time only (~5 min):**

```bash
brew install terraform gh   # install required tools
bash bin/setup              # interactive wizard — handles everything
```

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
- World saves live on a **persistent DigitalOcean Volume** — never lost when the server is destroyed
- Everything is provisioned with **Terraform** — no manual droplet setup

---

## Requirements

- [Terraform](https://developer.hashicorp.com/terraform/install) — `brew install terraform`
- [GitHub CLI](https://cli.github.com) — `brew install gh`
- A [DigitalOcean](https://digitalocean.com) account

---

## Setup (one time, ~5 minutes)

```bash
bash bin/setup
```

That's it. The wizard will:
1. Check your tools are installed
2. Ask for your DigitalOcean credentials
3. Generate an SSH key
4. Create the Terraform state bucket
5. Create the persistent saves volume
6. Set all GitHub Actions secrets automatically

Not sure if everything is configured? Run `make preflight` at any time.

---

## Starting and stopping

**Via GitHub Actions (anyone can do this):**

Actions → Start Server → Run workflow

The workflow summary shows your server IP and connect address. Takes ~3 minutes to boot.

**Via terminal:**

```bash
make start    # spin up the server
make stop     # shut it down
make ip       # show current IP
make ssh      # SSH into the running server
make logs     # tail the server logs
make update   # update game to latest version
```

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

The script uploads the file, sets permissions, and activates it — no manual config needed.

---

## Setting server name and owner

After your first boot, edit on the server:
```bash
make ssh
nano /mnt/saves/AstroServerSettings.ini
```

Set `OwnerName=` to your Steam display name. This file persists across all future sessions.

---

## Troubleshooting

Run `make preflight` to check your configuration.

Check the [Issues](https://github.com/pjsny/astroneer-server-kit/issues) tab — use the issue templates to report bugs or get help with connection problems.
