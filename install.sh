#!/usr/bin/env bash

set -e

# Configuration
REPO="desduvauchelle/tamias"
INSTALL_DIR="$HOME/.bun/bin"
BINARY_NAME="tamias"

echo "--------------------------------------------------------"
echo "🐿️ Installing Tamias from GitHub Releases"
echo "--------------------------------------------------------"

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

# 2. Fetch latest release info
echo "=> Fetching latest release for ${OS}-${ARCH}..."
LATEST_RELEASE_URL="https://api.github.com/repos/${REPO}/releases/latest"
HTTP_STATUS=$(curl -s -o .tamias_release.json -w "%{http_code}" "$LATEST_RELEASE_URL")

if [ "$HTTP_STATUS" -ne 200 ]; then
    echo "Error: Failed to fetch release information from GitHub (HTTP $HTTP_STATUS)."
    rm -f .tamias_release.json
    exit 1
fi

VERSION=$(grep -o '"tag_name": *"[^"]*"' .tamias_release.json | head -n 1 | cut -d '"' -f 4)
DOWNLOAD_URL=$(grep -o '"browser_download_url": *"[^"]*"' .tamias_release.json | grep "$ASSET_NAME" | head -n 1 | cut -d '"' -f 4)

rm -f .tamias_release.json

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

rm -rf "$TMP_DIR"

echo "--------------------------------------------------------"
echo "✅ Tamias $VERSION installed successfully!"
echo "If $INSTALL_DIR is not in your PATH, you may need to add it."
echo "Run 'tamias' to get started."
echo "--------------------------------------------------------"
