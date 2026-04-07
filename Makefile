# Astroneer Server Kit
# Run 'make help' to see all commands.

-include .env
export

SSH_KEY  ?= $(HOME)/.ssh/astro-server
SSH_USER  = Administrator
TF_DIR    = terraform/scaleway

.PHONY: help setup preflight start stop ssh logs update ip

help:
	@echo ""
	@echo "  Astroneer Server Kit"
	@echo "  ──────────────────────────────────"
	@echo "  make setup      First-time setup wizard"
	@echo "  make preflight  Check everything is configured"
	@echo ""
	@echo "  make start      Start the server"
	@echo "  make stop       Stop the server"
	@echo "  make ip         Show the server's current IP"
	@echo "  make ssh        SSH into the running server"
	@echo "  make logs       Tail the Astroneer server logs"
	@echo "  make update     Update the game to the latest version"
	@echo ""

setup:
	@bun run scripts/setup.tsx

preflight:
	@bun run scripts/preflight.tsx

start:
	@bun run scripts/start.ts

stop:
	@bun run scripts/stop.ts

ip:
	@cd $(TF_DIR) && terraform output -raw server_ip 2>/dev/null || echo "Server is not running."

ssh: _require_ip
	@ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no $(SSH_USER)@$$(make -s ip)

logs: _require_ip
	@ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no $(SSH_USER)@$$(make -s ip) \
		"powershell -Command \"Get-Content -Path 'C:\\astro-server\\Astro\\Saved\\Logs\\AstroServer.log' -Wait -Tail 50\""

update: _require_ip
	@ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no $(SSH_USER)@$$(make -s ip) \
		"powershell -ExecutionPolicy Bypass -File 'C:\\astro-setup\\update.ps1'"

_require_ip:
	@IP=$$(make -s ip); \
	if [ -z "$$IP" ] || [ "$$IP" = "Server is not running." ]; then \
		echo "Server is not running. Run 'make start' first."; \
		exit 1; \
	fi
