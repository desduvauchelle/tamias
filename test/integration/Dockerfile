# ─── Tamias Integration Test Docker Image ───────────────────────────────────
#
# Simulates a fresh machine to test the complete install + setup flow.
# Mounts the LOCAL source code so we test the current branch, not a release.
#
# Usage:
#   docker build -t tamias-integration -f test/integration/Dockerfile .
#   docker run --rm -v "$(pwd):/tamias-src:ro" tamias-integration
#
# The container:
#   1. Installs Bun
#   2. Copies /tamias-src into a working directory
#   3. Runs `bun install`
#   4. Runs the integration test suite (test/integration/entrypoint.sh)
#   5. Reports pass/fail with exit code 0 or 1
#
# This does NOT affect your local ~/.tamias at all.
# ─────────────────────────────────────────────────────────────────────────────

FROM ubuntu:22.04

# Avoid interactive prompts during package install
ENV DEBIAN_FRONTEND=noninteractive
ENV HOME=/root

# Install essential packages
RUN apt-get update && apt-get install -y \
	curl \
	unzip \
	git \
	ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL="/root/.bun"
ENV PATH="$BUN_INSTALL/bin:$PATH"

# Verify Bun works
RUN bun --version

# Create a working directory (NOT /root/.tamias — that's the data dir)
WORKDIR /tamias-build

# The entry point script copies source from the mount and runs tests
COPY test/integration/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
