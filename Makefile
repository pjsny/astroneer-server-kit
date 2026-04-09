# Astroneer Server Kit — Fly.io
-include .env
export

.PHONY: help setup setup-debug preflight start stop destroy-all ssh logs update ip status

help:
	@echo ""
	@echo "  Astroneer Server Kit (Fly.io)"
	@echo "  ──────────────────────────────────"
	@echo "  make setup         First-time setup wizard"
	@echo "  make setup-debug   Same with on-screen error detail"
	@echo "  make preflight     Check flyctl + .env + volume"
	@echo ""
	@echo "  make start         fly deploy (build + run dedicated server)"
	@echo "  make stop          Scale Machines to 0 (volume retained)"
	@echo "  make destroy-all   fly apps destroy (data loss — see Fly docs)"
	@echo "  make status        Brief Fly + connect summary"
	@echo "  make logs          fly logs (follow)"
	@echo "  make ip            List Fly IPv4 for the app"
	@echo "  make ssh           fly ssh console (same as: fly ssh console -a \$$FLY_APP_NAME)"
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
	@bun run scripts/ip.ts

status:
	@bun run scripts/status.tsx

logs:
	@fly logs -a "$(FLY_APP_NAME)"

ssh:
	@fly ssh console -a "$(FLY_APP_NAME)"

update: start
	@echo "(update == redeploy via make start / fly deploy)"
