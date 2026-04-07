# Astroneer Server Kit
# Run 'make help' to see all commands.

-include .env
export

SSH_KEY  ?= $(HOME)/.ssh/astro-server
SSH_USER  = root
TF_DIR    = terraform/vultr

.PHONY: help setup setup-debug preflight start stop destroy-all ssh logs wine-bugpack update ip status

help:
	@echo ""
	@echo "  Astroneer Server Kit"
	@echo "  ──────────────────────────────────"
	@echo "  make setup         First-time setup wizard"
	@echo "  make setup-debug   Same, with on-screen error detail (see ASTRONEER_SETUP_DEBUG)"
	@echo "  make preflight     Check everything is configured"
	@echo ""
	@echo "  make start         Start the server"
	@echo "  make stop          Stop the server (VM only; keeps saves volume)"
	@echo "  make destroy-all   Tear down vultr stack + setup Object Storage (full reset)"
	@echo "  make ip            Show the server's current IP"
	@echo "  make status        In-game address, Terraform summary, optional SSH service check"
	@echo "  make ssh           SSH into the running server"
	@echo "  make logs          Recent journal + tail -F service.log (Wine); Unreal -log under Astro/Saved/Logs/"
	@echo "  make wine-bugpack  SSH: versions + log tails for Wine TLS debugging / WineHQ"
	@echo "  make update        Update the game to the latest version"
	@echo ""

setup:
	@bun run scripts/setup.tsx

setup-debug:
	@ASTRONEER_SETUP_DEBUG=1 bun run scripts/setup.tsx

preflight:
	@bun run scripts/preflight.tsx

start:
	@bun run scripts/start.ts

stop:
	@bun run scripts/stop.ts

destroy-all:
	@bun run scripts/destroy-all.ts

ip:
	@bun run scripts/ip.ts || echo "(no IP — run make start once, or check .env / Terraform state)"

status:
	@bun run scripts/status.tsx

ssh: _require_ip
	@ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no $(SSH_USER)@$$(make -s ip)

logs: _require_ip
	@ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no $(SSH_USER)@$$(make -s ip) \
		"echo '--- last 80 lines: systemd (start/stop) ---'; journalctl -u astroneer -n 80 --no-pager; echo; echo '--- tail -F service.log (Wine stderr/stdout); Unreal: tail -f ~/astro-server/Astro/Saved/Logs/*.log'; tail -n 5 -F /home/astroneer/logs/service.log"

wine-bugpack: _require_ip
	@ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no $(SSH_USER)@$$(make -s ip) \
		"sudo /usr/local/bin/astro-wine-bugpack"

update: _require_ip
	@ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no $(SSH_USER)@$$(make -s ip) \
		"/usr/local/bin/astro-update"

_require_ip:
	@IP=$$(make -s ip); \
	if [ -z "$$IP" ] || [ "$$IP" = "Server is not running." ]; then \
		echo "Server is not running. Run 'make start' first."; \
		exit 1; \
	fi
