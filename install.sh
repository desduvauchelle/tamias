#!/usr/bin/env bash

set -e

# ─── Config ───────────────────────────────────────────────────────────────────
REPO="desduvauchelle/tamias"
INSTALL_DIR="$HOME/.bun/bin"
BINARY_NAME="tamias"

# Pass --yes / -y (or TAMIAS_YES=1) to skip all prompts and use defaults.
# Handy for CI and automated provisioning.
AUTO_YES=0
NO_BROWSER=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y)       AUTO_YES=1    ;;
    --no-browser)   NO_BROWSER=1  ;;
  esac
done
[ "${TAMIAS_YES:-0}" = "1" ] && AUTO_YES=1
[ "${TAMIAS_NO_BROWSER:-0}" = "1" ] && NO_BROWSER=1

# Helper: prompt via /dev/tty so it works even when stdin is a curl pipe.
ask() {
  local prompt="$1" default="$2" reply
  if [ "$AUTO_YES" = "1" ]; then
    echo "$default"
    return
  fi
  printf "%s" "$prompt" > /dev/tty
  read -r reply < /dev/tty
  echo "${reply:-$default}"
}

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

echo ""
echo "  🐿️  Installing Tamias from GitHub Releases"
echo "  ============================================"

# 0. Check for Bun
if ! command -v bun &> /dev/null; then
  echo ""
  echo "=> Bun not found — installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  echo "=> Bun installed."
fi

BUN_BIN=$(command -v bun || echo "$HOME/.bun/bin/bun")

# 1. Determine OS and Architecture
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  darwin) ;;
  linux)  ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64)   ARCH="x64"   ;;
  aarch64|arm64)  ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

ASSET_NAME="tamias-${OS}-${ARCH}"

# ~/.tamias is the canonical home for all Tamias data
mkdir -p "$HOME/.tamias"

# Create ~/Documents/Tamias as a convenience symlink → ~/.tamias
# (bidirectional: editing files in either location touches the same data)
DOCS_LINK="$HOME/Documents/Tamias"
if [ -d "$HOME/Documents" ] && [ ! -e "$DOCS_LINK" ]; then
  ln -s "$HOME/.tamias" "$DOCS_LINK"
  echo "  => ~/.tamias  (also accessible at ~/Documents/Tamias)"
else
  echo "  => ~/.tamias"
fi
echo ""

# 2. Fetch latest release info
echo "=> Fetching latest release for ${OS}-${ARCH}..."
LATEST_RELEASE_URL="https://api.github.com/repos/${REPO}/releases/latest"
HTTP_STATUS=$(curl -s -o "$TMP_DIR/release.json" -w "%{http_code}" "$LATEST_RELEASE_URL")

if [ "$HTTP_STATUS" -ne 200 ]; then
    echo "Error: Failed to fetch release information from GitHub (HTTP $HTTP_STATUS)."
    exit 1
fi

VERSION=$(grep -o '"tag_name": *"[^"]*"' "$TMP_DIR/release.json" | head -n 1 | cut -d '"' -f 4)
DOWNLOAD_URL=$(grep -o '"browser_download_url": *"[^"]*"' "$TMP_DIR/release.json" | grep "$ASSET_NAME" | head -n 1 | cut -d '"' -f 4)

if [ -z "$DOWNLOAD_URL" ]; then
    echo "Error: Could not find asset $ASSET_NAME for release $VERSION."
    echo "It may not be compiled for your architecture yet."
    exit 1
fi

echo "=> Found version $VERSION."

# 3. Setup Install Directory
if [ ! -d "$INSTALL_DIR" ]; then
  # Fallback to local bin if bun isn't used
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
fi

# 4. Download and Install
echo ""
echo "=> Downloading binary..."
curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$TMP_DIR/$BINARY_NAME"
chmod +x "$TMP_DIR/$BINARY_NAME"

echo "=> Installing to $INSTALL_DIR ..."
if [ ! -w "$INSTALL_DIR" ]; then
  echo "   (requires sudo)"
  sudo mv "$TMP_DIR/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
else
  mv "$TMP_DIR/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
fi

# 4.5. Install Playwright (Chromium) for browser tools
if [ "$NO_BROWSER" = "0" ]; then
  echo ""
  echo "=> Installing Playwright (Chromium) for browser tools (~150 MB)..."
  TAMIAS_PKG="$HOME/.tamias/package.json"
  if [ ! -f "$TAMIAS_PKG" ]; then
    echo '{"name":"tamias-data","version":"1.0.0","private":true}' > "$TAMIAS_PKG"
  fi
  if "$BUN_BIN" add playwright --cwd "$HOME/.tamias" --silent 2>/dev/null && \
     "$HOME/.tamias/node_modules/.bin/playwright" install chromium 2>&1 | tail -3; then
    echo "=> Chromium ready."
  else
    echo "WARNING: Playwright install failed — browser tools won\'t work until you run: tamias browser --setup"
  fi
else
  echo "=> Skipping Playwright install (--no-browser). Run 'tamias browser --setup' later to enable browser tools."
fi

# 5. Dashboard setup — use the pre-built standalone tarball from the release,
# fall back to source + bun build if the tarball is not in the release assets.
DASHBOARD_DIR="$HOME/.tamias/src/dashboard"
DASHBOARD_TARBALL_URL=$(grep -o '"browser_download_url": *"[^"]*"' "$TMP_DIR/release.json" | grep "tamias-dashboard.tar.gz" | head -n 1 | cut -d '"' -f 4)

mkdir -p "$HOME/.tamias/src"

if [ -n "$DASHBOARD_TARBALL_URL" ]; then
  echo ""
  echo "=> Downloading pre-built dashboard..."
  curl -fsSL --progress-bar "$DASHBOARD_TARBALL_URL" -o "$TMP_DIR/tamias-dashboard.tar.gz"

  # Ensure target dirs exist, then extract the standalone bundle into place
  mkdir -p "$DASHBOARD_DIR/.next"
  tar -xzf "$TMP_DIR/tamias-dashboard.tar.gz" -C "$DASHBOARD_DIR"
  echo "=> Dashboard ready (no build step required)."
else
  # No prebuilt tarball — fall back to downloading source and building locally
  echo ""
  echo "=> No pre-built dashboard in release — downloading source and building..."
  curl -fsSL "https://github.com/${REPO}/archive/refs/heads/main.zip" -o "$TMP_DIR/src.zip"
  unzip -q "$TMP_DIR/src.zip" -d "$TMP_DIR/extracted"

  DASH_SRC=""
  DASH_SRC=$(find "$TMP_DIR/extracted" -mindepth 2 -maxdepth 6 -type d \
    -path "*/src/dashboard" -print -quit 2>/dev/null || true)
  if [ -z "$DASH_SRC" ]; then
    DASH_SRC=$(find "$TMP_DIR/extracted" -mindepth 2 -maxdepth 6 -type d \
      -name "dashboard" -print -quit 2>/dev/null || true)
  fi

  if [ -n "$DASH_SRC" ] && [ -d "$DASH_SRC" ]; then
    rm -rf "$DASHBOARD_DIR"
    mv "$DASH_SRC" "$DASHBOARD_DIR"
    if [ -f "$DASHBOARD_DIR/package.json" ]; then
      echo "=> Installing dashboard dependencies..."
      "$BUN_BIN" install --cwd "$DASHBOARD_DIR" 2>&1 | tail -3
      echo "=> Building dashboard..."
      if "$BUN_BIN" run --cwd "$DASHBOARD_DIR" build 2>&1 | tail -5; then
        echo "=> Dashboard built and ready."
      else
        echo "WARNING: Dashboard build failed — dev mode will still work."
      fi
    fi
  else
    echo "WARNING: Dashboard source not found — continuing without it."
  fi
fi

# 5b. Start (or restart) the daemon so the new binary takes effect immediately.
# Make the new binary available before we try to run it.
export PATH="$PATH:$INSTALL_DIR"

# Stop any running daemon first (by PID — avoids relying on old binary's commands)
DAEMON_JSON="$HOME/.tamias/daemon.json"
if [ -f "$DAEMON_JSON" ]; then
  DAEMON_PID=$(grep -o '"pid": *[0-9]*' "$DAEMON_JSON" | grep -o '[0-9]*' | head -1)
  if [ -n "$DAEMON_PID" ] && kill -0 "$DAEMON_PID" 2>/dev/null; then
    echo ""
    echo "=> Stopping running daemon (PID $DAEMON_PID) so new binary takes effect..."
    kill "$DAEMON_PID" 2>/dev/null || true
    sleep 1
  fi
fi

# Start the daemon in background with the new binary
echo ""
echo "=> Starting Tamias daemon..."
"$INSTALL_DIR/$BINARY_NAME" start --daemon 2>/dev/null &

# Wait up to 8 seconds for daemon.json to appear with port/token info
DAEMON_STARTED=0
DASHBOARD_PORT=""
DASHBOARD_TOKEN=""
for i in $(seq 1 16); do
  sleep 0.5
  if [ -f "$DAEMON_JSON" ]; then
    _PORT=$(grep -o '"dashboardPort": *[0-9]*' "$DAEMON_JSON" | grep -o '[0-9]*' | head -1)
    _TOKEN=$(grep -o '"token": *"[^"]*"' "$DAEMON_JSON" | head -1 | cut -d'"' -f4)
    if [ -n "$_PORT" ]; then
      DAEMON_STARTED=1
      DASHBOARD_PORT="$_PORT"
      DASHBOARD_TOKEN="$_TOKEN"
      break
    fi
  fi
done

if [ "$DAEMON_STARTED" = "0" ]; then
  echo "WARNING: Daemon took too long to start. Run 'tamias start' manually."
fi

# 6. PATH Setup
SHELL_NAME=$(basename "$SHELL")
PROFILE_FILE=""

case "$SHELL_NAME" in
  zsh)
    PROFILE_FILE="$HOME/.zshrc"
    ;;
  bash)
    if [ -f "$HOME/.bash_profile" ]; then
      PROFILE_FILE="$HOME/.bash_profile"
    else
      PROFILE_FILE="$HOME/.bashrc"
    fi
    ;;
esac

ALREADY_IN_PATH=false
if command -v tamias &> /dev/null; then
  ALREADY_IN_PATH=true
fi

NEEDS_RESTART=false
if [ "$ALREADY_IN_PATH" = "false" ]; then
  if [ -n "$PROFILE_FILE" ] && [ -f "$PROFILE_FILE" ]; then
    if ! grep -q "$INSTALL_DIR" "$PROFILE_FILE"; then
      echo ""                                       >> "$PROFILE_FILE"
      echo "# Tamias"                               >> "$PROFILE_FILE"
      echo "export PATH=\"\$PATH:$INSTALL_DIR\""   >> "$PROFILE_FILE"
      NEEDS_RESTART=true
    fi
  fi
fi

# Verification
if [ ! -f "$INSTALL_DIR/$BINARY_NAME" ]; then
  echo "Error: Binary not found at $INSTALL_DIR/$BINARY_NAME after installation."
  exit 1
fi

DISPLAY_DATA_HOME="${HOME/$HOME/~}/.tamias"

# Build URLs from daemon.json data if the daemon started
if [ "$DAEMON_STARTED" = "1" ] && [ -n "$DASHBOARD_PORT" ]; then
  if [ -n "$DASHBOARD_TOKEN" ]; then
    _DASH_URL="http://localhost:${DASHBOARD_PORT}?token=${DASHBOARD_TOKEN}"
    _ONBOARD_URL="http://localhost:${DASHBOARD_PORT}/onboarding?token=${DASHBOARD_TOKEN}"
  else
    _DASH_URL="http://localhost:${DASHBOARD_PORT}"
    _ONBOARD_URL="http://localhost:${DASHBOARD_PORT}/onboarding"
  fi
fi

echo ""
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║  🐿️  Tamias $VERSION — Ready!                          "
echo "  ╠══════════════════════════════════════════════════════╣"
printf "  ║  Data dir  : %s\n"   "$DISPLAY_DATA_HOME"
printf "  ║  Binary    : %s/%s\n" "$INSTALL_DIR" "$BINARY_NAME"
echo "  ╠══════════════════════════════════════════════════════╣"
if [ "$DAEMON_STARTED" = "1" ] && [ -n "$DASHBOARD_PORT" ]; then
  echo "  ║  Daemon is running!                                   "
  printf "  ║    Dashboard  : %s\n" "$_DASH_URL"
  printf "  ║    Onboarding : %s\n" "$_ONBOARD_URL"
elif [ "$NEEDS_RESTART" = "true" ]; then
  echo "  ║  To finish installation, please:                      "
  echo "  ║    1. CLOSE this terminal                             "
  echo "  ║    2. OPEN a new terminal                             "
  echo "  ║    3. Run: tamias start                               "
else
  echo "  ║  Run 'tamias start' to launch the daemon.             "
fi
echo "  ╚══════════════════════════════════════════════════════╝"
echo ""
