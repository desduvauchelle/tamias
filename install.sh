#!/usr/bin/env bash

set -e

echo "Building Tamias standalone executable..."

# Compile the TypeScript file to a single executable named "tamias"
bun build --compile --minify --sourcemap --outfile ./tamias ./src/index.ts

echo "Installing Tamias..."

# Find a suitable global bin directory
INSTALL_DIR="$HOME/.bun/bin"

if [ ! -d "$INSTALL_DIR" ]; then
  INSTALL_DIR="/usr/local/bin"
fi

if [ ! -w "$INSTALL_DIR" ]; then
    echo "Requires sudo to install to $INSTALL_DIR"
    sudo mv ./tamias "$INSTALL_DIR/tamias"
else
    mv ./tamias "$INSTALL_DIR/tamias"
fi

echo "Done! The 'tamias' command is now available."
