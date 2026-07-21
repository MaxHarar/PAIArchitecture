/**
 * Vercel Integration
 *
 * Uses Vercel REST API for deployment management.
 *
 * Required env keys in ~/.claude/.env:
 *   VERCEL_TOKEN     — Personal access token (from vercel.com/account/tokens)
 *   VERCEL_TEAM_ID   — (optional) Team ID for team-scoped API calls
 */

import {
  BaseIntegration,
  type IntegrationResult,
  type TestResult,
  requestApproval,
  log,
} from "./base.ts";

interface VercelDeployment {
  uid: string;
  name: string;
  url: string;
  state: string;
  created: number;
  creator: { username: string };
  meta?: Record<string, string>;
  inspectorUrl?: string;
}

export class VercelIntegration extends BaseIntegration {
  readonly name = "vercel";
  readonly requiredEnvKeys = ["VERCEL_TOKEN"];

  private get teamParam(): string {
    const teamId = process.env.VERCEL_TEAM_ID;
    return teamId ? `&teamId=${teamId}` : "";
  }

  // ---------------------------------------------------------------------------
  // Vercel API helpers
  // ---------------------------------------------------------------------------

  private async vercelGet(path: string): Promise<unknown> {
    const separator = path.includes("?") ? "&" : "?";
    const url = `https://api.vercel.com${path}${separator}${this.teamParam.replace("&", "")}`;

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.env("VERCEL_TOKEN")}`,
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Vercel API GET ${path}: ${resp.status} ${text}`);
    }

    return resp.json();
  }

  private async vercelPost(path: string, body?: unknown): Promise<unknown> {
    const separator = path.includes("?") ? "&" : "?";
    const url = `https://api.vercel.com${path}${separator}${this.teamParam.replace("&", "")}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env("VERCEL_TOKEN")}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Vercel API POST ${path}: ${resp.status} ${text}`);
    }

    return resp.json();
  }

  // ---------------------------------------------------------------------------
  // Core interface
  // ---------------------------------------------------------------------------

  async check(): Promise<IntegrationResult> {
    // List recent deployments
    const data = (await this.vercelGet("/v6/deployments?limit=10")) as {
      deployments: VercelDeployment[];
    };

    const deployments = data.deployments.map((d) => ({
      uid: d.uid,
      name: d.name,
      url: d.url,
      state: d.state,
      created: new Date(d.created).toISOString(),
      inspectorUrl: d.inspectorUrl,
    }));

    // Flag any errored deployments
    const errors = deployments.filter((d) =>
      ["ERROR", "CANCELED"].includes(d.state)
    );

    return this.ok({
      totalRecent: deployments.length,
      errorCount: errors.length,
      deployments,
      errors: errors.length > 0 ? errors : undefined,
    });
  }

  async act(action: string, params: Record<string, unknown>): Promise<IntegrationResult> {
    switch (action) {
      case "deploy":
        return this.deploy(params.projectId as string);
      case "rollback":
        return this.rollback(params.deploymentId as string);
      default:
        return this.ok({ error: `Unknown action: ${action}` });
    }
  }

  async test(): Promise<TestResult> {
    const missing = this.checkEnvKeys();

    if (missing.length > 0) {
      return {
        integration: this.name,
        configured: false,
        healthy: false,
        missing,
        message: `Missing env keys: ${missing.join(", ")}`,
      };
    }

    const hasTeam = !!process.env.VERCEL_TEAM_ID;
    return {
      integration: this.name,
      configured: true,
      healthy: true,
      message: `Vercel token present. Team scope: ${hasTeam ? "yes" : "no (personal)"}.`,
    };
  }

  // ---------------------------------------------------------------------------
  // Actions (ASK_FIRST gated)
  // ---------------------------------------------------------------------------

  private async deploy(projectId: string): Promise<IntegrationResult> {
    if (!projectId) throw new Error("deploy requires 'projectId' param");

    // ASK_FIRST: deploying requires human approval
    const approved = await requestApproval(
      this.name,
      "deploy",
      `Trigger deployment for project: ${projectId}`
    );
    if (!approved) {
      return this.ok({ blocked: true, reason: "ASK_FIRST: awaiting approval" });
    }

    // Trigger deployment via creating a new deployment
    // In practice this uses the project's git integration, but we can also
    // trigger via API. Using the deployments endpoint with the project name.
    const result = await this.vercelPost("/v13/deployments", {
      name: projectId,
      target: "production",
    });

    log.info("Vercel deployment triggered", { projectId });
    return this.ok(result);
  }

  private async rollback(deploymentId: string): Promise<IntegrationResult> {
    if (!deploymentId) throw new Error("rollback requires 'deploymentId' param");

    // ASK_FIRST: rollback requires human approval
    const approved = await requestApproval(
      this.name,
      "rollback",
      `Rollback to deployment: ${deploymentId}`
    );
    if (!approved) {
      return this.ok({ blocked: true, reason: "ASK_FIRST: awaiting approval" });
    }

    // Vercel rollback is done by promoting a previous deployment
    // The v6 API uses the "alias" approach or re-deploying from a specific commit
    const result = await this.vercelPost(
      `/v6/deployments/${deploymentId}/rollback`
    );

    log.info("Vercel rollback triggered", { deploymentId });
    return this.ok(result);
  }
}

// ---------------------------------------------------------------------------
// CLI entry point: bun run vercel.ts --test
// ---------------------------------------------------------------------------
if (import.meta.main) {
  const vercel = new VercelIntegration();

  if (process.argv.includes("--test")) {
    vercel.safeTest().then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.healthy ? 0 : 1);
    });
  } else {
    console.log("Usage: bun run vercel.ts --test");
    console.log("  --test  Verify VERCEL_TOKEN exists in ~/.claude/.env");
  }
}
