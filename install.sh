#!/usr/bin/env bash

set -e

# Configuration
REPO="desduvauchelle/tamias"
INSTALL_DIR="$HOME/.bun/bin"
BINARY_NAME="tamias"

# Setup temporary directory immediately
TMP_DIR=$(mktemp -d /tmp/tamias-install.XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT

echo "--------------------------------------------------------"
echo "🐿️ Installing Tamias from GitHub Releases"
echo "--------------------------------------------------------"

# 0. Check for Bun
if ! command -v bun &> /dev/null; then
    echo "=> Bun not found. Installing Bun..."
    # Run the bun installer, which is generally robust
    curl -fsSL https://bun.sh/install | bash
    # Source bun for the current session if possible
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

# 1. Determine OS and Architecture
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  darwin)
    OS="darwin"
    ;;
  linux)
    OS="linux"
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64 | amd64)
    ARCH="x64"
    ;;
  aarch64 | arm64)
    ARCH="arm64"
    ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

ASSET_NAME="tamias-${OS}-${ARCH}"

# 1.5 Choose storage location
echo ""
echo "  Where should Tamias store your data?"
echo ""
echo "  1) ~/.tamias              (default, hidden config folder)"
echo "  2) ~/Documents/Tamias    (easy to find in Finder/Explorer)"
echo "  3) Other                 (you choose the path)"
echo ""
printf "  Enter choice [1]: "
read -r STORAGE_CHOICE
STORAGE_CHOICE="${STORAGE_CHOICE:-1}"

TAMIAS_DATA_HOME="$HOME/.tamias"

case "$STORAGE_CHOICE" in
  2)
    TAMIAS_DATA_HOME="$HOME/Documents/Tamias"
    ;;
  3)
    printf "  Enter full path: "
    read -r CUSTOM_PATH
    # Expand ~ manually
    CUSTOM_PATH="${CUSTOM_PATH/#\~/$HOME}"
    if [ -z "$CUSTOM_PATH" ]; then
      echo "  => No path given, defaulting to ~/.tamias"
    elif [ ! -d "$CUSTOM_PATH" ]; then
      printf "  Path does not exist. Create it? [Y/n]: "
      read -r CREATE_CONFIRM
      if [[ "$CREATE_CONFIRM" =~ ^[Nn] ]]; then
        echo "  => Using ~/.tamias instead."
      else
        mkdir -p "$CUSTOM_PATH" || { echo "Error: Could not create $CUSTOM_PATH"; exit 1; }
        TAMIAS_DATA_HOME="$CUSTOM_PATH"
        echo "  => Created $CUSTOM_PATH"
      fi
    else
      TAMIAS_DATA_HOME="$CUSTOM_PATH"
    fi
    ;;
esac

# Ensure the chosen dir exists
mkdir -p "$TAMIAS_DATA_HOME"

# If a non-default path was chosen, symlink ~/.tamias → chosen dir
if [ "$TAMIAS_DATA_HOME" != "$HOME/.tamias" ]; then
  if [ -d "$HOME/.tamias" ] && [ ! -L "$HOME/.tamias" ]; then
    # Real directory already exists — move contents over
    cp -rn "$HOME/.tamias/." "$TAMIAS_DATA_HOME/" 2>/dev/null || true
    rm -rf "$HOME/.tamias"
  fi
  ln -sfn "$TAMIAS_DATA_HOME" "$HOME/.tamias"
  echo "  => Data dir: $TAMIAS_DATA_HOME (symlinked as ~/.tamias)"
else
  echo "  => Data dir: $HOME/.tamias"
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
echo "=> Downloading $DOWNLOAD_URL ..."
TMP_DIR=$(mktemp -d)
TMP_BIN="$TMP_DIR/$BINARY_NAME"

curl -sL --fail --progress-bar "$DOWNLOAD_URL" -o "$TMP_BIN"
chmod +x "$TMP_BIN"

echo "=> Installing to $INSTALL_DIR ..."
if [ ! -w "$INSTALL_DIR" ]; then
    echo "=> Requires sudo to copy to $INSTALL_DIR"
    sudo mv "$TMP_BIN" "$INSTALL_DIR/$BINARY_NAME"
else
    mv "$TMP_BIN" "$INSTALL_DIR/$BINARY_NAME"
fi

# 5. Setup Dashboard (Next.js source is needed for tamias start)
echo "=> Setting up Dashboard..."
DASHBOARD_PARENT="$HOME/.tamias"
mkdir -p "$DASHBOARD_PARENT/src"

if [ ! -d "$DASHBOARD_PARENT/src/dashboard" ]; then
    echo "=> Downloading dashboard source..."
    # Download source to get dashboard
    curl -sL "https://github.com/${REPO}/archive/refs/heads/main.zip" -o "$TMP_DIR/src.zip"
    unzip -q "$TMP_DIR/src.zip" -d "$TMP_DIR"

    # The zip contains a folder like tamias-main or tamias-master
    ZIP_FOLDER=$(find "$TMP_DIR" -maxdepth 1 -type d -name "tamias-*" | head -n 1)

    if [ -d "$ZIP_FOLDER/src/dashboard" ]; then
        mv "$ZIP_FOLDER/src/dashboard" "$DASHBOARD_PARENT/src/dashboard"
        echo "=> Dashboard source installed to $DASHBOARD_PARENT/src/dashboard"
    else
        echo "⚠️ Could not find dashboard source in extract. ZIP_FOLDER=$ZIP_FOLDER"
    fi

    rm -rf "$ZIP_FOLDER" "$DASHBOARD_PARENT/src.zip"
fi

# Install dashboard dependencies if bun is available
if command -v bun &> /dev/null && [ -d "$DASHBOARD_PARENT/src/dashboard" ]; then
    echo "=> Installing dashboard dependencies (this may take a minute)..."
    cd "$DASHBOARD_PARENT/src/dashboard" && bun install &> /dev/null
fi

rm -rf "$TMP_DIR"

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

NEEDS_RESTART=false

if [ -n "$PROFILE_FILE" ] && [ -f "$PROFILE_FILE" ]; then
  if ! grep -q "$INSTALL_DIR" "$PROFILE_FILE"; then
    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
      echo "=> Adding $INSTALL_DIR to PATH in $PROFILE_FILE"
      echo "" >> "$PROFILE_FILE"
      echo "# Tamias PATH" >> "$PROFILE_FILE"
      echo "export PATH=\"\$PATH:$INSTALL_DIR\"" >> "$PROFILE_FILE"
      NEEDS_RESTART=true
    fi
  elif [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    NEEDS_RESTART=true
  fi
fi

DISPLAY_DATA_HOME="$TAMIAS_DATA_HOME"
[ "$TAMIAS_DATA_HOME" = "$HOME/.tamias" ] && DISPLAY_DATA_HOME="~/.tamias" || true

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   🐿️  Tamias $VERSION — Installed!                     "
echo "╠══════════════════════════════════════════════════════╣"
echo "║   Data stored in: $DISPLAY_DATA_HOME"
echo "╠══════════════════════════════════════════════════════╣"
echo "║   To get started:                                    "
echo "║                                                      "
if [ "$NEEDS_RESTART" = true ]; then
echo "║   1. Reload your shell:                              "
echo "║      source $PROFILE_FILE"
echo "║                                                      "
echo "║   2. Then run:                                       "
else
echo "║   Run:                                               "
fi
echo "║      tamias                                          "
echo "║                                                      "
echo "║   This starts the setup wizard. After setup:         "
echo "║      tamias start   — start the background daemon    "
echo "║      tamias chat    — open the chat interface        "
echo "║      tamias stop    — stop the daemon                "
echo "╚══════════════════════════════════════════════════════╝"
echo ""
