# Astroneer Dedicated Server

Up to 8 players (Steam only). Auto-shuts down when idle. World saves survive server destruction.

**Cost:** ~$24/mo while running, ~$1/mo while stopped.

---

## First-time setup

### 1. Get your credentials

| What | Where |
|------|-------|
| DO Personal Access Token | digitalocean.com → API → Tokens → Generate |
| DO Spaces access key + secret | digitalocean.com → API → Spaces Keys → Generate |
| SSH key pair | `ssh-keygen -t ed25519 -f ~/.ssh/astro-server` |

### 2. Set local env vars

```bash
export DO_TOKEN=your_do_token
export DO_SPACES_KEY=your_spaces_key
export DO_SPACES_SECRET=your_spaces_secret
```

Add these to your `~/.zshrc` (or `~/.bashrc`) so they persist.

### 3. Bootstrap (run once)

Creates the Spaces bucket that stores Terraform state.

```bash
cd bootstrap
terraform init
TF_VAR_do_token=$DO_TOKEN terraform apply
```

### 4. Init the main Terraform config

```bash
cd terraform
terraform init \
  -backend-config="access_key=$DO_SPACES_KEY" \
  -backend-config="secret_key=$DO_SPACES_SECRET"
```

### 5. Create the persistent saves volume (run once)

This volume survives server destruction — your world always lives here.

```bash
TF_VAR_do_token=$DO_TOKEN \
TF_VAR_ssh_public_key="$(cat ~/.ssh/astro-server.pub)" \
TF_VAR_repo_url=https://github.com/YOUR_ORG/YOUR_REPO \
terraform apply -target=digitalocean_volume.saves
```

### 6. Add GitHub secrets

Go to your repo → Settings → Secrets and variables → Actions:

| Secret | Value |
|--------|-------|
| `DO_TOKEN` | DO Personal Access Token |
| `DO_SPACES_KEY` | Spaces access key ID |
| `DO_SPACES_SECRET` | Spaces secret key |
| `SSH_PUBLIC_KEY` | `cat ~/.ssh/astro-server.pub` |
| `SSH_PRIVATE_KEY` | `cat ~/.ssh/astro-server` |

That's it. You're ready to play.

---

## Starting the server

**Actions → Start Server → Run workflow**

Takes ~3 minutes to boot. The IP and connect address appear in the workflow summary.

Optional: set session hours before auto-shutdown (default: 6).

## Stopping the server

- **Manual:** Actions → Stop Server → Run workflow
- **Auto:** Shuts down after 60 minutes of no player activity

## Connecting in-game

Astroneer → Multiplayer → Servers → Add Server → enter `IP:8777`

---

## Moving an existing world

Find your save on Windows:
```
C:\Users\YOURNAME\AppData\Local\Astro\Saved\SaveGames\
```

Upload it to the server:
```bash
bash upload-save.sh <server-ip> /path/to/SAVE_1.savegame
```

---

## Server commands (SSH in as root)

```bash
systemctl status astroneer        # check status
systemctl restart astroneer       # restart
journalctl -u astroneer -f        # live logs
bash /opt/astro-setup/update.sh   # update game version
```

Server config lives at `/mnt/saves/AstroServerSettings.ini` and persists across sessions.
