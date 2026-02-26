#!/usr/bin/env bash
# ─── Docker Integration Test Launcher ────────────────────────────────────────
#
# Builds the Docker image and runs the full integration test suite.
# Your local ~/.tamias is completely untouched.
#
# Usage:
#   ./test/integration/run.sh            # normal run
#   ./test/integration/run.sh --rebuild  # force rebuild image
#   ./test/integration/run.sh --shell    # drop into container shell for debugging
#
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE_NAME="tamias-integration"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

cd "$PROJECT_ROOT"

# Parse args
REBUILD=false
SHELL_MODE=false
for arg in "$@"; do
  case "$arg" in
    --rebuild) REBUILD=true ;;
    --shell)   SHELL_MODE=true ;;
    *)         echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

# ── Build image ──────────────────────────────────────────────────────────────
if $REBUILD || ! docker image inspect "$IMAGE_NAME" > /dev/null 2>&1; then
  echo -e "${YELLOW}Building Docker image: $IMAGE_NAME${NC}"
  docker build -t "$IMAGE_NAME" -f test/integration/Dockerfile .
  echo -e "${GREEN}Image built successfully${NC}"
else
  echo -e "${GREEN}Using existing Docker image: $IMAGE_NAME${NC}"
  echo "  (use --rebuild to force a fresh build)"
fi

# ── Run ──────────────────────────────────────────────────────────────────────
echo ""

if $SHELL_MODE; then
  echo -e "${YELLOW}Dropping into container shell for debugging...${NC}"
  echo "  Source is mounted at /tamias-src (read-only)"
  echo "  Run: cp -r /tamias-src/. /tamias-build/ && cd /tamias-build && bun install"
  echo ""
  docker run --rm -it \
    -v "$PROJECT_ROOT:/tamias-src:ro" \
    --entrypoint /bin/bash \
    "$IMAGE_NAME"
else
  echo -e "${YELLOW}Running integration tests...${NC}"
  echo ""

  if docker run --rm \
    -v "$PROJECT_ROOT:/tamias-src:ro" \
    "$IMAGE_NAME"; then
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  Integration tests PASSED${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
    exit 0
  else
    EXIT_CODE=$?
    echo ""
    echo -e "${RED}═══════════════════════════════════════════════${NC}"
    echo -e "${RED}  Integration tests FAILED (exit code: $EXIT_CODE)${NC}"
    echo -e "${RED}═══════════════════════════════════════════════${NC}"
    exit 1
  fi
fi
