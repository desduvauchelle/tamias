#!/usr/bin/env bash
# ─── Integration Test Entrypoint ─────────────────────────────────────────────
# Runs inside the Docker container. Copies source, installs deps, runs tests.
# Exit code 0 = all tests passed, 1 = failures.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

echo ""
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║  🐿️  Tamias Integration Tests — Docker               ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo ""

# Colour helpers
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No colour

phase() { echo -e "\n${YELLOW}▸ $1${NC}"; }
pass()  { echo -e "  ${GREEN}✓${NC} $1"; }
fail()  { echo -e "  ${RED}✗${NC} $1"; FAILURES=$((FAILURES + 1)); }

FAILURES=0
TOTAL=0

assert_eq() {
  TOTAL=$((TOTAL + 1))
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    pass "$label"
  else
    fail "$label (expected '$expected', got '$actual')"
  fi
}

assert_contains() {
  TOTAL=$((TOTAL + 1))
  local label="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    pass "$label"
  else
    fail "$label (expected to contain '$needle')"
  fi
}

assert_file_exists() {
  TOTAL=$((TOTAL + 1))
  local label="$1" path="$2"
  if [ -f "$path" ]; then
    pass "$label"
  else
    fail "$label (file not found: $path)"
  fi
}

assert_dir_exists() {
  TOTAL=$((TOTAL + 1))
  local label="$1" path="$2"
  if [ -d "$path" ]; then
    pass "$label"
  else
    fail "$label (directory not found: $path)"
  fi
}

assert_file_not_exists() {
  TOTAL=$((TOTAL + 1))
  local label="$1" path="$2"
  if [ ! -f "$path" ]; then
    pass "$label"
  else
    fail "$label (file should not exist: $path)"
  fi
}

assert_exit_zero() {
  TOTAL=$((TOTAL + 1))
  local label="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    pass "$label"
  else
    fail "$label (command failed: $*)"
  fi
}

assert_exit_nonzero() {
  TOTAL=$((TOTAL + 1))
  local label="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    fail "$label (command should have failed: $*)"
  else
    pass "$label"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 0: Environment verification
# ═══════════════════════════════════════════════════════════════════════════════
phase "Phase 0: Environment"

assert_exit_zero "Bun is installed" bun --version
BUN_VER=$(bun --version)
pass "Bun version: $BUN_VER"

assert_dir_exists "Source mount exists" /tamias-src

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 1: Fresh install from source
# ═══════════════════════════════════════════════════════════════════════════════
phase "Phase 1: Install from source"

# Copy source into the build directory (not a symlink — simulates a real install)
cp -r /tamias-src/. /tamias-build/
cd /tamias-build

# Remove node_modules if any leaked in from mount (simulates clean install)
rm -rf node_modules bun.lockb

assert_file_exists "package.json exists" /tamias-build/package.json
assert_file_exists "src/index.ts exists" /tamias-build/src/index.ts
assert_dir_exists  "src/templates/ exists" /tamias-build/src/templates
assert_dir_exists  "src/utils/ exists" /tamias-build/src/utils

# Install dependencies
phase "Phase 1b: bun install"
BUN_INSTALL_OUTPUT=$(bun install 2>&1) || {
  fail "bun install failed"
  echo "$BUN_INSTALL_OUTPUT"
  exit 1
}
pass "bun install succeeded"

assert_dir_exists "node_modules created" /tamias-build/node_modules

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 2: CLI smoke tests (no daemon, no API keys)
# ═══════════════════════════════════════════════════════════════════════════════
phase "Phase 2: CLI smoke tests"

# Use isolated config dir
export TAMIAS_CONFIG_PATH="/tmp/tamias-integ-test/config.json"
mkdir -p /tmp/tamias-integ-test

# --help should work
HELP_OUTPUT=$(bun run src/index.ts --help 2>&1 || true)
assert_contains "CLI --help shows 'start'" "$HELP_OUTPUT" "start"
assert_contains "CLI --help shows 'chat'"  "$HELP_OUTPUT" "chat"
assert_contains "CLI --help shows 'setup'" "$HELP_OUTPUT" "setup"

# --version should work
VERSION_OUTPUT=$(bun run src/index.ts --version 2>&1 || true)
TOTAL=$((TOTAL + 1))
if echo "$VERSION_OUTPUT" | grep -qE '[0-9]+\.[0-9]+'; then
  pass "CLI --version returns version number"
else
  fail "CLI --version did not return version (got: $VERSION_OUTPUT)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 3: Config & scaffolding (first-run simulation)
# ═══════════════════════════════════════════════════════════════════════════════
phase "Phase 3: Config & scaffolding"

# Run the scaffolding via a Bun script (simulates loadConfig + scaffoldFromTemplates)
bun -e '
import { loadConfig } from "./src/utils/config.ts"
import { scaffoldFromTemplates, MEMORY_DIR } from "./src/utils/memory.ts"
import { existsSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const TAMIAS_DIR = join(homedir(), ".tamias")
if (!existsSync(TAMIAS_DIR)) mkdirSync(TAMIAS_DIR, { recursive: true })

const config = loadConfig()
console.log("CONFIG_VERSION=" + config.version)

scaffoldFromTemplates()
console.log("SCAFFOLD_DONE=true")
' 2>&1 | tee /tmp/scaffold_output.txt

SCAFFOLD_OUT=$(cat /tmp/scaffold_output.txt)
assert_contains "Config loads with version 1.0" "$SCAFFOLD_OUT" "CONFIG_VERSION=1.0"
assert_contains "Scaffolding completed" "$SCAFFOLD_OUT" "SCAFFOLD_DONE=true"

# Verify scaffolded files
TAMIAS_HOME="$HOME/.tamias"
assert_dir_exists  "~/.tamias/ created" "$TAMIAS_HOME"
assert_dir_exists  "~/.tamias/memory/ created" "$TAMIAS_HOME/memory"
assert_dir_exists  "~/.tamias/memory/daily/ created" "$TAMIAS_HOME/memory/daily"
assert_file_exists "SYSTEM.md scaffolded" "$TAMIAS_HOME/memory/SYSTEM.md"
assert_file_exists "SOUL.md scaffolded" "$TAMIAS_HOME/memory/SOUL.md"
assert_file_exists "AGENTS.md scaffolded" "$TAMIAS_HOME/memory/AGENTS.md"
assert_file_exists "TOOLS.md scaffolded" "$TAMIAS_HOME/memory/TOOLS.md"
assert_file_exists "HEARTBEAT.md scaffolded" "$TAMIAS_HOME/memory/HEARTBEAT.md"
assert_file_exists "MEMORY.md scaffolded" "$TAMIAS_HOME/memory/MEMORY.md"
assert_file_exists "SKILL-GUIDE.md scaffolded" "$TAMIAS_HOME/memory/SKILL-GUIDE.md"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 4: Dynamic prompting variables
# ═══════════════════════════════════════════════════════════════════════════════
phase "Phase 4: Dynamic prompting"

DYNAMIC_OUTPUT=$(bun -e '
import { getContextVariables, injectDynamicVariables } from "./src/utils/memory.ts"

const vars = getContextVariables("discord")
console.log("DATE=" + vars.date)
console.log("TIME=" + vars.time)
console.log("CHANNEL=" + vars.active_channel)
console.log("PLATFORM=" + vars.platform)
console.log("VERSION=" + vars.tamias_version)

const result = injectDynamicVariables("Today is {{date}}, channel={{active_channel}}", vars)
console.log("INJECTED=" + result)
' 2>&1)

assert_contains "Date variable resolved" "$DYNAMIC_OUTPUT" "DATE=20"
assert_contains "Channel is discord" "$DYNAMIC_OUTPUT" "CHANNEL=discord"
assert_contains "Platform resolved" "$DYNAMIC_OUTPUT" "PLATFORM="
assert_contains "Version resolved" "$DYNAMIC_OUTPUT" "VERSION="
assert_contains "Injection works" "$DYNAMIC_OUTPUT" "INJECTED=Today is 20"

# Check SYSTEM.md has dynamic variables that will get replaced
SYSTEM_CONTENT=$(cat "$TAMIAS_HOME/memory/SYSTEM.md")
assert_contains "SYSTEM.md has Current Context section" "$SYSTEM_CONTENT" "Current Context"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 5: Sandbox config
# ═══════════════════════════════════════════════════════════════════════════════
phase "Phase 5: Sandbox configuration"

SANDBOX_OUTPUT=$(bun -e '
import { getSandboxConfig } from "./src/utils/config.ts"
const cfg = getSandboxConfig()
console.log("ENGINE=" + cfg.engine)
console.log("IMAGE=" + cfg.image)
console.log("MEMORY=" + cfg.memoryLimit)
console.log("CPU=" + cfg.cpuLimit)
console.log("NETWORK=" + cfg.networkEnabled)
console.log("TIMEOUT=" + cfg.timeout)
' 2>&1)

assert_contains "Sandbox engine defaults to none" "$SANDBOX_OUTPUT" "ENGINE=none"
assert_contains "Sandbox image defaults to ubuntu" "$SANDBOX_OUTPUT" "IMAGE=ubuntu:22.04"
assert_contains "Sandbox memory limit" "$SANDBOX_OUTPUT" "MEMORY=512m"
assert_contains "Sandbox network disabled" "$SANDBOX_OUTPUT" "NETWORK=false"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 6: Vector store initialization
# ═══════════════════════════════════════════════════════════════════════════════
phase "Phase 6: Vector store"

VECTOR_OUTPUT=$(bun -e '
import { VectorStore } from "./src/utils/vectors.ts"
import { join } from "path"
import { tmpdir } from "os"
import { existsSync } from "fs"

const testDir = join(tmpdir(), "tamias-vector-integ-" + Date.now())
const store = new VectorStore(testDir)
await store.init()

const stats = store.getStats()
console.log("COUNT=" + stats.count)
console.log("DIR_EXISTS=" + existsSync(join(testDir, "vectors")))

store.destroy()
console.log("DESTROYED=true")
' 2>&1)

assert_contains "Vector store starts empty" "$VECTOR_OUTPUT" "COUNT=0"
assert_contains "Vector dir created" "$VECTOR_OUTPUT" "DIR_EXISTS=true"
assert_contains "Vector store destroyed" "$VECTOR_OUTPUT" "DESTROYED=true"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 7: Tool registry loads without errors
# ═══════════════════════════════════════════════════════════════════════════════
phase "Phase 7: Tool registry"

TOOL_OUTPUT=$(bun -e '
// Verify all tool modules can be imported without errors
import { terminalTools, TERMINAL_TOOL_NAME } from "./src/tools/terminal.ts"
import { memoryTools, MEMORY_TOOL_NAME } from "./src/tools/memory.ts"
import { SWARM_TOOL_NAME, createSwarmTools } from "./src/tools/swarm.ts"
import { cronTools, CRON_TOOL_NAME } from "./src/tools/cron.ts"

console.log("TERMINAL=" + TERMINAL_TOOL_NAME)
console.log("MEMORY=" + MEMORY_TOOL_NAME)
console.log("SWARM=" + SWARM_TOOL_NAME)
console.log("CRON=" + CRON_TOOL_NAME)

// Check terminal tools have run_command
console.log("HAS_RUN_CMD=" + (typeof terminalTools.run_command !== "undefined"))

// Check memory tools have all functions
console.log("HAS_SAVE=" + (typeof memoryTools.save !== "undefined"))
console.log("HAS_SEARCH=" + (typeof memoryTools.search !== "undefined"))
console.log("HAS_FORGET=" + (typeof memoryTools.forget !== "undefined"))
console.log("HAS_STATS=" + (typeof memoryTools.stats !== "undefined"))

// Check swarm tools factory is a function
console.log("HAS_SWARM_FACTORY=" + (typeof createSwarmTools === "function"))
' 2>&1)

assert_contains "Terminal tool loads" "$TOOL_OUTPUT" "TERMINAL=terminal"
assert_contains "Memory tool loads" "$TOOL_OUTPUT" "MEMORY=memory"
assert_contains "Swarm tool loads" "$TOOL_OUTPUT" "SWARM=swarm"
assert_contains "run_command exists" "$TOOL_OUTPUT" "HAS_RUN_CMD=true"
assert_contains "memory.save exists" "$TOOL_OUTPUT" "HAS_SAVE=true"
assert_contains "memory.search exists" "$TOOL_OUTPUT" "HAS_SEARCH=true"
assert_contains "memory.forget exists" "$TOOL_OUTPUT" "HAS_FORGET=true"
assert_contains "memory.stats exists" "$TOOL_OUTPUT" "HAS_STATS=true"
assert_contains "Swarm factory exists" "$TOOL_OUTPUT" "HAS_SWARM_FACTORY=true"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 8: Migrations
# ═══════════════════════════════════════════════════════════════════════════════
phase "Phase 8: Migrations"

MIGRATION_OUTPUT=$(bun -e '
import { runMigrations } from "./src/utils/migrations/index.ts"
import { homedir } from "os"
import { join } from "path"

const tamiasDirPath = join(homedir(), ".tamias")
const report = await runMigrations(tamiasDirPath)
const all = [...report.applied, ...report.skipped, ...report.deferred]
for (const r of all) {
  console.log("MIGRATION=" + r.domain + ":" + r.version + ":" + (r.reason || "applied"))
}
if (all.length === 0 && report.failed.length === 0) console.log("NO_MIGRATIONS_NEEDED=true")
if (report.failed.length > 0) {
  for (const f of report.failed) console.log("FAILED=" + f.domain + ":" + f.version + ":" + f.error)
}
' 2>&1)

# Migrations should either run or report no-op
TOTAL=$((TOTAL + 1))
if echo "$MIGRATION_OUTPUT" | grep -qE 'MIGRATION=|NO_MIGRATIONS_NEEDED'; then
  pass "Migrations executed without errors"
else
  fail "Migrations output unexpected: $MIGRATION_OUTPUT"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 9: Health checks on fresh install
# ═══════════════════════════════════════════════════════════════════════════════
phase "Phase 9: Health checks"

HEALTH_OUTPUT=$(bun -e '
import { runHealthChecks } from "./src/utils/health/index.ts"

const report = await runHealthChecks({ autoFix: true })
console.log("ERRORS=" + report.hasErrors)
console.log("WARNINGS=" + report.hasWarnings)
console.log("FIXED=" + report.fixedCount)
console.log("TOTAL_CHECKS=" + report.results.length)
for (const r of report.results) {
  console.log("  " + r.status + " " + r.id + ": " + r.message)
}
' 2>&1)

assert_contains "Health check ran" "$HEALTH_OUTPUT" "TOTAL_CHECKS="
# On a fresh install without API keys, warnings are expected (no provider configured)
# but filesystem should be ok/fixed
TOTAL=$((TOTAL + 1))
if echo "$HEALTH_OUTPUT" | grep -qE 'TOTAL_CHECKS=[0-9]'; then
  pass "Health check returned results"
else
  fail "Health check did not return results"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 10: Agent store
# ═══════════════════════════════════════════════════════════════════════════════
phase "Phase 10: Agent store"

AGENT_OUTPUT=$(bun -e '
import { loadAgents, addAgent, findAgent, removeAgent, slugify } from "./src/utils/agentsStore.ts"

// Should start empty
const initial = loadAgents()
console.log("INITIAL_COUNT=" + initial.length)

// Slugify works
console.log("SLUG=" + slugify("My Great Agent"))

// Add an agent
const agent = addAgent({ name: "Test Agent", slug: "test-agent", instructions: "Test instructions" })
console.log("ADDED_ID=" + agent.id)
console.log("ADDED_SLUG=" + agent.slug)

// Find it
const found = findAgent("test-agent")
console.log("FOUND=" + (found ? found.slug : "NOT_FOUND"))

// Remove it
removeAgent(agent.id)
const afterRemove = loadAgents()
console.log("AFTER_REMOVE=" + afterRemove.length)
' 2>&1)

assert_contains "Agent store starts empty" "$AGENT_OUTPUT" "INITIAL_COUNT=0"
assert_contains "Slugify works" "$AGENT_OUTPUT" "SLUG=my-great-agent"
assert_contains "Agent added" "$AGENT_OUTPUT" "ADDED_SLUG=test-agent"
assert_contains "Agent found" "$AGENT_OUTPUT" "FOUND=test-agent"
assert_contains "Agent removed" "$AGENT_OUTPUT" "AFTER_REMOVE=0"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 11: Tenant creation
# ═══════════════════════════════════════════════════════════════════════════════
phase "Phase 11: Tenant management"

TENANT_OUTPUT=$(bun -e '
import { createTenant, listTenants, deleteTenant, getTenantDir } from "./src/utils/tenants.ts"
import { existsSync } from "fs"

// Create a tenant
const tenant = createTenant("Integration Test", "A test tenant")
console.log("TENANT_ID=" + tenant.id)

// Verify dir structure
const dir = getTenantDir(tenant.id)
console.log("HAS_MEMORY=" + existsSync(dir + "/memory"))
console.log("HAS_WORKSPACE=" + existsSync(dir + "/workspace"))
console.log("HAS_PROJECTS=" + existsSync(dir + "/projects"))
console.log("HAS_CONFIG=" + existsSync(dir + "/config.json"))

// List
const list = listTenants()
console.log("TENANT_COUNT=" + list.length)

// Cleanup
deleteTenant(tenant.id)
const afterDelete = listTenants()
console.log("AFTER_DELETE=" + afterDelete.length)
' 2>&1)

assert_contains "Tenant created" "$TENANT_OUTPUT" "TENANT_ID="
assert_contains "Tenant has memory dir" "$TENANT_OUTPUT" "HAS_MEMORY=true"
assert_contains "Tenant has workspace dir" "$TENANT_OUTPUT" "HAS_WORKSPACE=true"
assert_contains "Tenant has projects dir" "$TENANT_OUTPUT" "HAS_PROJECTS=true"
assert_contains "Tenant has config.json" "$TENANT_OUTPUT" "HAS_CONFIG=true"
assert_contains "Tenant listed" "$TENANT_OUTPUT" "TENANT_COUNT=1"
assert_contains "Tenant deleted" "$TENANT_OUTPUT" "AFTER_DELETE=0"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 12: Unit tests
# ═══════════════════════════════════════════════════════════════════════════════
phase "Phase 12: Full unit test suite"

TEST_OUTPUT=$(bun test --preload ./src/tests/setup.ts src/tests/*.test.ts src/utils/*.test.ts 2>&1) || true
TOTAL=$((TOTAL + 1))

if echo "$TEST_OUTPUT" | grep -q "0 fail"; then
  PASS_COUNT=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+ pass' | head -1)
  pass "All unit tests passed ($PASS_COUNT)"
else
  FAIL_LINE=$(echo "$TEST_OUTPUT" | grep -E 'fail' | tail -1)
  fail "Unit tests had failures: $FAIL_LINE"
  echo ""
  echo "$TEST_OUTPUT" | grep -E '(fail|error)' | head -20
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "  ════════════════════════════════════════════════════════"
if [ "$FAILURES" -eq 0 ]; then
  echo -e "  ${GREEN}All $TOTAL integration tests passed!${NC} 🐿️"
else
  echo -e "  ${RED}$FAILURES out of $TOTAL integration tests FAILED${NC}"
fi
echo "  ════════════════════════════════════════════════════════"
echo ""

exit "$FAILURES"
