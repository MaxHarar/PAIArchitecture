/**
 * Integration Registry
 *
 * Central registry for all Heartbeat integrations.
 * Each integration is isolated — if one fails, others continue.
 *
 * Usage:
 *   import { getAllIntegrations, testAll, checkAll } from "./integrations/index.ts";
 *
 *   const results = await checkAll();    // heartbeat tick
 *   const status  = await testAll();     // startup health check
 */

import { type BaseIntegration, type IntegrationResult, type TestResult, log } from "./base.ts";
import { GmailIntegration } from "./gmail.ts";
import { XTwitterIntegration } from "./x-twitter.ts";
import { VercelIntegration } from "./vercel.ts";

// ---------------------------------------------------------------------------
// Singleton instances
// ---------------------------------------------------------------------------

const integrations: BaseIntegration[] = [
  new GmailIntegration(),
  new XTwitterIntegration(),
  new VercelIntegration(),
];

// ---------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------

/**
 * Get all registered integration instances.
 */
export function getAllIntegrations(): BaseIntegration[] {
  return integrations;
}

/**
 * Get a specific integration by name.
 */
export function getIntegration(name: string): BaseIntegration | undefined {
  return integrations.find((i) => i.name === name);
}

/**
 * Run test() on every integration. Returns a status report.
 * Used at startup to verify which integrations are configured.
 */
export async function testAll(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const integration of integrations) {
    const result = await integration.safeTest();
    results.push(result);
  }

  return results;
}

/**
 * Run check() on every enabled integration. Returns results.
 * Called on each heartbeat tick to gather data from all services.
 * Isolated: one failure doesn't block others.
 */
export async function checkAll(): Promise<IntegrationResult[]> {
  const results = await Promise.allSettled(
    integrations.map((i) => i.safeCheck())
  );

  return results.map((r, idx) => {
    if (r.status === "fulfilled") {
      return r.value;
    }
    // This should never happen (safeCheck catches), but just in case
    log.error(`Integration ${integrations[idx].name} check failed catastrophically`, {
      error: r.reason,
    });
    return {
      success: false,
      integration: integrations[idx].name,
      timestamp: new Date().toISOString(),
      error: String(r.reason),
    };
  });
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export { GmailIntegration } from "./gmail.ts";
export { XTwitterIntegration } from "./x-twitter.ts";
export { VercelIntegration } from "./vercel.ts";
export { BaseIntegration, type IntegrationResult, type TestResult } from "./base.ts";

// ---------------------------------------------------------------------------
// CLI entry point: bun run index.ts --test-all
// ---------------------------------------------------------------------------
if (import.meta.main) {
  if (process.argv.includes("--test-all")) {
    testAll().then((results) => {
      console.log("\n=== Integration Health Report ===\n");
      for (const r of results) {
        const icon = r.healthy ? "[OK]" : "[!!]";
        console.log(`${icon} ${r.integration}: ${r.message}`);
        if (r.missing && r.missing.length > 0) {
          console.log(`     Missing: ${r.missing.join(", ")}`);
        }
      }

      const healthy = results.filter((r) => r.healthy).length;
      console.log(`\n${healthy}/${results.length} integrations healthy.\n`);
      process.exit(healthy === results.length ? 0 : 1);
    });
  } else if (process.argv.includes("--check-all")) {
    checkAll().then((results) => {
      console.log(JSON.stringify(results, null, 2));
    });
  } else {
    console.log("Usage: bun run index.ts [--test-all | --check-all]");
    console.log("  --test-all   Verify all integration configs");
    console.log("  --check-all  Run check() on all enabled integrations");
  }
}
