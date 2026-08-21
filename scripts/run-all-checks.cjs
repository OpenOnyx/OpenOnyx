#!/usr/bin/env node

/**
 * OpenOnyx Contributors Unified Integrity & Compatibility Runner
 * 
 * This script runs all checks needed to verify that a contributor's changes
 * do not break compilation, Obsidian API compatibility, third-party plugin integrations,
 * build integrity, or general unit tests.
 * 
 * It automatically downloads and configures missing dependencies (like Pandoc WASM
 * and plugin fixtures) to make execution seamless.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

const rootDir = path.resolve(__dirname, "..");
const installDir = process.env.OPENONYX_PANDOC_DIR
  || path.join(os.homedir(), ".local", "share", "openonyx", "tools", "pandoc");
const pandocPath = path.join(installDir, process.platform === "win32" ? "pandoc.cjs" : "pandoc");
const fixturesDir = path.join(rootDir, "tests", ".openobsidian", "plugins");

console.log(`${colors.bold}${colors.cyan}=====================================================${colors.reset}`);
console.log(`${colors.bold}${colors.cyan}    OpenOnyx Unified Integrity & Compatibility Check  ${colors.reset}`);
console.log(`${colors.bold}${colors.cyan}=====================================================${colors.reset}\n`);

function runCommand(command, args, description) {
  console.log(`${colors.bold}${colors.yellow}▶ Running: ${description}...${colors.reset}`);
  
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: true,
  });

  if (result.status !== 0) {
    console.log(`\n${colors.bold}${colors.red}❌ FAILED: ${description}${colors.reset}\n`);
    return false;
  }

  console.log(`${colors.bold}${colors.green}✓ PASSED: ${description}${colors.reset}\n`);
  return true;
}

async function main() {
  // Prerequisite 1: Pandoc WASM Backend Check
  if (!fs.existsSync(pandocPath)) {
    console.log(`${colors.yellow}⚠️ Pandoc WASM backend was not found at: ${pandocPath}${colors.reset}`);
    const success = runCommand("node", ["scripts/install-pandoc-backend.cjs"], "Downloading & installing Pandoc WASM backend");
    if (!success) {
      console.error(`${colors.bold}${colors.red}Aborting: Could not set up Pandoc backend.${colors.reset}`);
      process.exit(1);
    }
  } else {
    console.log(`${colors.green}✓ Pandoc WASM backend found at: ${pandocPath}${colors.reset}\n`);
  }

  // Prerequisite 2: Plugin Fixtures Check
  const fixturesExist = fs.existsSync(fixturesDir) && fs.readdirSync(fixturesDir).length > 0;
  if (!fixturesExist) {
    console.log(`${colors.yellow}⚠️ Obsidian community plugin fixtures are missing. Fetching now...${colors.reset}`);
    const success = runCommand("node", ["scripts/fetch-plugin-fixtures.cjs"], "Downloading Obsidian plugin fixtures");
    if (!success) {
      console.error(`${colors.bold}${colors.red}Aborting: Could not fetch plugin fixtures.${colors.reset}`);
      process.exit(1);
    }
  } else {
    console.log(`${colors.green}✓ Plugin integration fixtures found.${colors.reset}\n`);
  }

  // Step 1: Type Checking & Linting
  if (!runCommand("npm", ["run", "lint"], "TypeScript compilation and type safety check (tsc --noEmit)")) {
    process.exit(1);
  }

  // Step 2: Obsidian API compatibility verification
  if (!runCommand("node", ["scripts/test-obsidian-api-compat.cjs"], "Obsidian API runtime exports alignment audit")) {
    process.exit(1);
  }

  // Step 3: Document Conversion tests
  if (!runCommand("node", ["scripts/test-pandoc-backend.cjs"], "Pandoc backend wasm rendering tests")) {
    process.exit(1);
  }

  // Step 4: Run all unit, integration, sandbox, and build-integrity tests via Vitest
  if (!runCommand("npx", ["vitest", "run"], "Vitest all-in-one test suite execution")) {
    process.exit(1);
  }

  console.log(`${colors.bold}${colors.cyan}=====================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.green} 🎉 ALL CHECKS PASSED SUCCESSFULLY!                 ${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan} Your changes are clean, safe, and ready to commit!   ${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}=====================================================${colors.reset}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
