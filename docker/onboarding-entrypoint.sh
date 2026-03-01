#!/usr/bin/env bash
# ─── Onboarding Test Entrypoint ───────────────────────────────────────────────
# Runs inside the Docker container. Launches the interactive onboarding wizard.
# Every container run starts with a completely fresh ~/.tamias.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

cd /tamias-app

echo ""
echo "  ╔════════════════════════════════════════════════════╗"
echo "  ║  🐿️  Tamias — Onboarding Test Container            ║"
echo "  ║  Fresh ~/.tamias — identical to a brand-new setup  ║"
echo "  ╚════════════════════════════════════════════════════╝"
echo ""

# Run the interactive onboarding — the TTY is inherited from docker run -it
exec bun run src/index.ts onboarding
