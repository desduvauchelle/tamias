#!/usr/bin/env bash
# ─── Tamias Onboarding Test — Docker Launcher ────────────────────────────────
#
# Builds the Docker image and runs the interactive onboarding wizard in a
# completely isolated container. Your local ~/.tamias is never touched.
#
# Each run gives you a brand-new first-time experience. Run as many times as
# you like — state never leaks between runs.
#
# Usage:
#   ./docker/test-onboarding.sh            # run onboarding (build if needed)
#   ./docker/test-onboarding.sh --rebuild  # force a fresh image build first
#   ./docker/test-onboarding.sh --shell    # drop into bash for debugging
#
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="tamias-onboarding-test"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

cd "$PROJECT_ROOT"

# ── Parse args ────────────────────────────────────────────────────────────────
REBUILD=false
SHELL_MODE=false
for arg in "$@"; do
  case "$arg" in
    --rebuild) REBUILD=true ;;
    --shell)   SHELL_MODE=true ;;
    *) echo "Unknown argument: $arg"; echo "Usage: $0 [--rebuild] [--shell]"; exit 1 ;;
  esac
done

# ── Build image ───────────────────────────────────────────────────────────────
if $REBUILD || ! docker image inspect "$IMAGE_NAME" > /dev/null 2>&1; then
  echo -e "${YELLOW}Building Docker image: $IMAGE_NAME${NC}"
  echo "  (this takes ~1-2 min on first run; subsequent builds are cached)"
  echo ""
  docker build -t "$IMAGE_NAME" -f docker/Dockerfile.onboarding .
  echo ""
  echo -e "${GREEN}Image built successfully.${NC}"
else
  echo -e "${GREEN}Using existing image: $IMAGE_NAME${NC}"
  echo "  (run with --rebuild to pick up source code changes)"
fi

echo ""

# ── Run ───────────────────────────────────────────────────────────────────────
if $SHELL_MODE; then
  echo -e "${YELLOW}Dropping into container shell for debugging...${NC}"
  echo "  Source is at /tamias-app"
  echo "  Run: bun run src/index.ts onboarding"
  echo ""
  docker run --rm -it \
    --entrypoint /bin/bash \
    "$IMAGE_NAME"
else
  echo -e "${YELLOW}Starting fresh onboarding session...${NC}"
  echo "  Your local ~/.tamias is NOT affected."
  echo ""

  # --rm     → container deleted after exit (fresh state next run)
  # -it      → allocate TTY + keep stdin open (required for @clack/prompts)
  docker run --rm -it "$IMAGE_NAME"

  echo ""
  echo -e "${GREEN}Session ended. Run again for another fresh onboarding.${NC}"
fi
