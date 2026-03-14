/**
 * Sentinel Gateway -- Main Entry Point & HTTP/WebSocket Server
 *
 * Security-hardened persistent AI gateway. Binds to 127.0.0.1:18800 ONLY.
 * Uses Bun.serve built-in -- zero external dependencies.
 *
 * Routes:
 *   POST /message       -- Authenticated message ingestion
 *   POST /outbound      -- Proactive message to Telegram (text + optional voice)
 *   POST /schedule      -- Schedule a future outbound message
 *   GET  /schedule      -- List pending scheduled messages
 *   DELETE /schedule    -- Cancel a scheduled message
 *   POST /background    -- Submit a background task
 *   GET  /background    -- List background tasks
 *   DELETE /background  -- Cancel a background task
 *   GET  /health        -- Public health check
 *   GET  /status        -- Authenticated detailed status
 *   WS   /ws            -- Authenticated WebSocket upgrade
 *
 * Usage:
 *   bun run gateway.ts          -- Start the server
 *   bun run gateway.ts --test   -- Verify config and exit
 */

import { homedir } from "os";

// ---------------------------------------------------------------------------
// PATH setup -- LaunchAgents don't inherit full shell PATH
// ---------------------------------------------------------------------------

const HOME = homedir();
const EXTRA_PATHS = [
  `${HOME}/.local/bin`,
  `${HOME}/.bun/bin`,
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
];

const currentPath = process.env.PATH || "";
const pathParts = currentPath.split(":");
for (const extraPath of EXTRA_PATHS) {
  if (!pathParts.includes(extraPath)) {
    pathParts.unshift(extraPath);
  }
}
process.env.PATH = pathParts.join(":");

// Unset CLAUDECODE env var to allow Agent SDK to spawn claude subprocess.
// When running inside a Claude Code session (e.g. during development), this
// variable triggers the anti-nesting guard. The gateway is a standalone service
// that legitimately needs to spawn its own claude sessions.
delete process.env.CLAUDECODE;

import { type ChannelId, type ChannelTrust, type GatewayMessage, CHANNEL_TRUST, DEFAULT_CONFIG } from "./types.ts";
import { authenticateRequest, validateBearer, type AuthResult } from "./auth.ts";
import {
  checkRateLimit,
  checkMessageSize,
  checkConnectionLimit,
  registerConnection,
  unregisterConnection,
  getConnectionCount,
} from "./rate-limiter.ts";
import { getHealthStatus, isHealthy, gatewayState } from "./health.ts";
import { SentinelBrain } from "./brain.ts";
import { interceptToolCall } from "./interceptor.ts";
import { wrapExternalContent } from "./injection.ts";
import { AuditLogger } from "./audit.ts";
import {
  sendOutbound,
  scheduleMessage,
  cancelScheduled,
  listScheduled,
  startScheduler,
  stopScheduler,
} from "./scheduler.ts";
import {
  submitTask,
  getTask,
  listTasks,
  cancelTask,
  getRunningCount,
  destroyAllTasks,
} from "./background-worker.ts";

// ---------------------------------------------------------------------------
// Brain & Audit (initialized on startup, not on import)
// ---------------------------------------------------------------------------

let brain: SentinelBrain | null = null;
let audit: AuditLogger | null = null;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOST = DEFAULT_CONFIG.host; // 127.0.0.1
const PORT = DEFAULT_CONFIG.port; // 18800

/** Allowed Host header values -- rejects DNS rebinding attacks */
const ALLOWED_HOSTS = new Set([
  `localhost:${PORT}`,
  `127.0.0.1:${PORT}`,
  "localhost",
  "127.0.0.1",
]);

// ---------------------------------------------------------------------------
// WebSocket client tracking
// ---------------------------------------------------------------------------

interface WsClient {
  ws: ServerWebSocket<WsData>;
  channel: ChannelId;
  connectedAt: number;
}

interface WsData {
  channel: ChannelId;
  authenticatedAt: number;
}

const wsClients = new Set<WsClient>();

/**
 * Broadcast a message to all connected WebSocket clients.
 */
export function broadcastToClients(message: string): void {
  for (const client of wsClients) {
    try {
      client.ws.send(message);
    } catch {
      // Connection may have died -- will be cleaned up by close handler
    }
  }
}

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------

type ServerWebSocket<T> = {
  send(data: string | BufferSource): void;
  close(code?: number, reason?: string): void;
  data: T;
  readyState: number;
};

/**
 * Handle POST /message -- the primary ingestion endpoint.
 */
async function handleMessage(req: Request, auth: AuthResult): Promise<Response> {
  // Read body and enforce size limit
  const body = await req.text();
  if (!checkMessageSize(Buffer.byteLength(body, "utf-8"))) {
    return jsonResponse({ error: "Payload too large" }, 413);
  }

  // Rate limit
  const rateResult = checkRateLimit(auth.channel);
  if (!rateResult.allowed) {
    return jsonResponse(
      { error: "Rate limited", retryAfterMs: rateResult.retryAfterMs },
      429,
      { "Retry-After": String(Math.ceil((rateResult.retryAfterMs ?? 1000) / 1000)) },
    );
  }

  // Parse the message payload
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  // Update gateway state
  gatewayState.lastMessageAt = new Date().toISOString();
  gatewayState.pendingRequests++;

  try {
    // Build a normalized GatewayMessage
    const messageId = crypto.randomUUID();
    const p = payload as Record<string, unknown>;
    const content = typeof p.content === "string" ? p.content : typeof p.message === "string" ? p.message : JSON.stringify(p);

    // Wrap external channel content in data-only envelope
    const trust = auth.trust;
    const finalContent = trust === "external"
      ? wrapExternalContent(auth.channel, content, p.metadata as Record<string, unknown> | undefined)
      : content;

    const gatewayMsg: GatewayMessage = {
      id: messageId,
      channel: auth.channel,
      trust: CHANNEL_TRUST[auth.channel],
      content: finalContent,
      rawContent: trust === "external" ? content : undefined,
      timestamp: new Date().toISOString(),
      metadata: (p.metadata as Record<string, unknown>) ?? undefined,
      requiresResponse: true,
    };

    // Broadcast to WebSocket clients for real-time monitoring
    broadcastToClients(
      JSON.stringify({
        type: "message_received",
        id: messageId,
        channel: auth.channel,
        trust: auth.trust,
        timestamp: new Date().toISOString(),
      }),
    );

    // Audit: message received
    audit?.log({
      eventType: "message_received",
      channel: auth.channel,
      trust: CHANNEL_TRUST[auth.channel],
      details: `Message from ${auth.channel} (${content.length} chars)`,
      outcome: "success",
    });

    // Route to brain
    if (!brain) {
      return jsonResponse({ error: "Brain not initialized" }, 503);
    }

    const response = await brain.sendMessage(gatewayMsg);

    // Audit: response sent
    audit?.log({
      eventType: "response_sent",
      channel: auth.channel,
      trust: CHANNEL_TRUST[auth.channel],
      details: `Response: ${response.content.length} chars, tools=${response.toolCallsMade}`,
      outcome: "success",
    });

    // Broadcast response to WS clients
    broadcastToClients(
      JSON.stringify({
        type: "response_sent",
        id: messageId,
        channel: auth.channel,
        contentLength: response.content.length,
        toolCallsMade: response.toolCallsMade,
        timestamp: response.timestamp,
      }),
    );

    return jsonResponse({
      messageId: response.messageId,
      content: response.content,
      channel: response.channel,
      toolCallsMade: response.toolCallsMade,
      usage: response.usage,
      timestamp: response.timestamp,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[gateway] Message processing error: ${errMsg}`);

    audit?.log({
      eventType: "message_error",
      channel: auth.channel,
      trust: CHANNEL_TRUST[auth.channel],
      details: `Error: ${errMsg.slice(0, 200)}`,
      outcome: "error",
    });

    return jsonResponse({ error: "Internal processing error", details: errMsg.slice(0, 200) }, 500);
  } finally {
    gatewayState.pendingRequests--;
  }
}

/**
 * Handle GET /health -- public, no auth required.
 */
function handleHealth(): Response {
  const status = getHealthStatus();
  const httpCode = status.status === "healthy" ? 200 : status.status === "degraded" ? 200 : 503;
  return jsonResponse(status, httpCode);
}

/**
 * Handle GET /status -- authenticated, detailed status.
 */
function handleStatus(): Response {
  const health = getHealthStatus();
  return jsonResponse({
    ...health,
    wsClients: getConnectionCount(),
    config: {
      host: HOST,
      port: PORT,
      maxMessageSizeKB: 100,
      globalRateLimitPerMin: 100,
      maxWsConnections: 5,
    },
  });
}

// ---------------------------------------------------------------------------
// Outbound & Scheduling handlers
// ---------------------------------------------------------------------------

/**
 * Handle POST /outbound — send a proactive message to Telegram.
 */
async function handleOutbound(req: Request, auth: AuthResult): Promise<Response> {
  const rateResult = checkRateLimit(auth.channel);
  if (!rateResult.allowed) {
    return jsonResponse({ error: "Rate limited" }, 429);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const text = typeof payload.text === "string" ? payload.text : null;
  if (!text) {
    return jsonResponse({ error: "Missing 'text' field" }, 400);
  }

  const voice = payload.voice === true;
  const voiceText = typeof payload.voiceText === "string" ? payload.voiceText : undefined;

  audit?.log({
    eventType: "outbound_message",
    channel: auth.channel,
    trust: CHANNEL_TRUST[auth.channel],
    details: `Proactive outbound: ${text.length} chars, voice=${voice}`,
    outcome: "success",
  });

  const result = await sendOutbound(text, { voice, voiceText });

  broadcastToClients(JSON.stringify({
    type: "outbound_sent",
    messageId: result.messageId,
    success: result.success,
    timestamp: new Date().toISOString(),
  }));

  return jsonResponse({
    success: result.success,
    messageId: result.messageId,
  });
}

/**
 * Handle POST /schedule — schedule a future message.
 * Handle GET /schedule — list pending scheduled messages.
 * Handle DELETE /schedule — cancel a scheduled message.
 */
async function handleSchedule(req: Request, auth: AuthResult): Promise<Response> {
  const method = req.method;

  if (method === "GET") {
    const pending = listScheduled();
    return jsonResponse({ scheduled: pending, count: pending.length });
  }

  if (method === "DELETE") {
    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    const id = typeof payload.id === "string" ? payload.id : null;
    if (!id) return jsonResponse({ error: "Missing 'id' field" }, 400);

    const cancelled = cancelScheduled(id);
    return jsonResponse({ cancelled, id });
  }

  // POST — schedule a new message
  const rateResult = checkRateLimit(auth.channel);
  if (!rateResult.allowed) {
    return jsonResponse({ error: "Rate limited" }, 429);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const text = typeof payload.text === "string" ? payload.text : null;
  if (!text) return jsonResponse({ error: "Missing 'text' field" }, 400);

  // Accept either ISO timestamp or delay in seconds
  let sendAt: Date;
  if (typeof payload.sendAt === "string") {
    sendAt = new Date(payload.sendAt);
  } else if (typeof payload.delaySeconds === "number") {
    sendAt = new Date(Date.now() + payload.delaySeconds * 1000);
  } else {
    return jsonResponse({ error: "Missing 'sendAt' (ISO timestamp) or 'delaySeconds'" }, 400);
  }

  const voice = payload.voice === true;
  const voiceText = typeof payload.voiceText === "string" ? payload.voiceText : undefined;

  const scheduled = scheduleMessage(text, sendAt, {
    voice,
    voiceText,
    source: auth.channel,
  });

  audit?.log({
    eventType: "message_scheduled",
    channel: auth.channel,
    trust: CHANNEL_TRUST[auth.channel],
    details: `Scheduled for ${scheduled.sendAt}: ${text.length} chars`,
    outcome: "success",
  });

  return jsonResponse({
    scheduled: true,
    id: scheduled.id,
    sendAt: scheduled.sendAt,
  });
}

// ---------------------------------------------------------------------------
// Background task handlers
// ---------------------------------------------------------------------------

/**
 * Handle POST /background -- submit a background task.
 * Handle GET /background -- list all background tasks.
 * Handle DELETE /background -- cancel a background task.
 */
async function handleBackground(req: Request, auth: AuthResult): Promise<Response> {
  const method = req.method;

  // GET -- list all tasks
  if (method === "GET") {
    const all = listTasks();
    return jsonResponse({
      tasks: all,
      running: getRunningCount(),
      total: all.length,
    });
  }

  // DELETE -- cancel a task
  if (method === "DELETE") {
    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    const id = typeof payload.id === "string" ? payload.id : null;
    if (!id) return jsonResponse({ error: "Missing 'id' field" }, 400);

    const cancelled = cancelTask(id);

    audit?.log({
      eventType: "background_task_cancelled",
      channel: auth.channel,
      trust: CHANNEL_TRUST[auth.channel],
      details: `Background task ${id.slice(0, 8)} cancel=${cancelled}`,
      outcome: cancelled ? "success" : "error",
    });

    return jsonResponse({ cancelled, id });
  }

  // POST -- submit a new task
  const rateResult = checkRateLimit(auth.channel);
  if (!rateResult.allowed) {
    return jsonResponse({ error: "Rate limited" }, 429);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const taskDescription = typeof payload.task === "string" ? payload.task : null;
  if (!taskDescription) {
    return jsonResponse({ error: "Missing 'task' field" }, 400);
  }

  const cwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
  const voice = payload.voice === true;

  const task = submitTask(taskDescription, {
    cwd,
    source: auth.channel,
    voice,
  });

  audit?.log({
    eventType: "background_task_submitted",
    channel: auth.channel,
    trust: CHANNEL_TRUST[auth.channel],
    details: `Background task ${task.id.slice(0, 8)}: "${taskDescription.slice(0, 100)}"`,
    outcome: "success",
  });

  broadcastToClients(
    JSON.stringify({
      type: "background_task_submitted",
      taskId: task.id,
      description: taskDescription.slice(0, 100),
      timestamp: new Date().toISOString(),
    }),
  );

  return jsonResponse({
    taskId: task.id,
    status: task.status,
    description: task.description,
  });
}

// ---------------------------------------------------------------------------
// DNS rebinding guard
// ---------------------------------------------------------------------------

function isDnsRebindingSafe(req: Request): boolean {
  const host = req.headers.get("host");
  if (!host) return false;
  return ALLOWED_HOSTS.has(host);
}

// ---------------------------------------------------------------------------
// JSON response helper
// ---------------------------------------------------------------------------

function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Security headers
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
    ...extraHeaders,
  };
  return new Response(JSON.stringify(data), { status, headers });
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

async function handleFetch(req: Request, server: any): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method;
  const path = url.pathname;

  // DNS rebinding guard -- applies to ALL routes including /health
  if (!isDnsRebindingSafe(req)) {
    return jsonResponse({ error: "Forbidden: invalid Host header" }, 403);
  }

  // Public routes (no auth)
  if (path === "/health" && method === "GET") {
    return handleHealth();
  }

  // WebSocket upgrade
  if (path === "/ws" && method === "GET") {
    // Authenticate before upgrade
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const token = authHeader.slice("Bearer ".length);
    const bearerValid = await validateBearer(token);
    if (!bearerValid) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Check connection limit
    if (!checkConnectionLimit()) {
      return jsonResponse({ error: "Too many WebSocket connections" }, 503);
    }

    // Upgrade to WebSocket
    const channelHeader = req.headers.get("x-gateway-channel") as ChannelId | null;
    const channel: ChannelId = channelHeader ?? "terminal";

    const upgraded = server.upgrade(req, {
      data: {
        channel,
        authenticatedAt: Date.now(),
      } satisfies WsData,
    });

    if (!upgraded) {
      return jsonResponse({ error: "WebSocket upgrade failed" }, 500);
    }

    // Bun returns undefined on successful upgrade
    return undefined as any;
  }

  // All remaining routes require authentication
  const auth = await authenticateRequest(req);
  if (!auth.authenticated) {
    return jsonResponse(
      { error: "Unauthorized", reason: auth.reason },
      401,
    );
  }

  // Authenticated routes
  switch (true) {
    case path === "/message" && method === "POST":
      return handleMessage(req, auth);

    case path === "/outbound" && method === "POST":
      return handleOutbound(req, auth);

    case path === "/schedule" && (method === "POST" || method === "GET" || method === "DELETE"):
      return handleSchedule(req, auth);

    case path === "/background" && (method === "POST" || method === "GET" || method === "DELETE"):
      return handleBackground(req, auth);

    case path === "/status" && method === "GET":
      return handleStatus();

    default:
      return jsonResponse({ error: "Not found" }, 404);
  }
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

export function startServer(): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    hostname: HOST,
    port: PORT,
    fetch: handleFetch,

    websocket: {
      open(ws: ServerWebSocket<WsData>) {
        registerConnection();
        const client: WsClient = {
          ws,
          channel: ws.data.channel,
          connectedAt: ws.data.authenticatedAt,
        };
        wsClients.add(client);
        console.log(
          `[gateway] WebSocket connected: channel=${ws.data.channel} total=${getConnectionCount()}`,
        );
      },

      message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
        // Inbound WebSocket messages are treated as terminal channel input.
        // Rate-limit them the same as HTTP requests.
        const rateResult = checkRateLimit(ws.data.channel);
        if (!rateResult.allowed) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: "Rate limited",
              retryAfterMs: rateResult.retryAfterMs,
            }),
          );
          return;
        }

        gatewayState.lastMessageAt = new Date().toISOString();

        // Echo acknowledgment -- brain routing would happen here
        ws.send(
          JSON.stringify({
            type: "ack",
            channel: ws.data.channel,
            timestamp: new Date().toISOString(),
          }),
        );
      },

      close(ws: ServerWebSocket<WsData>) {
        unregisterConnection();
        // Remove from client set
        for (const client of wsClients) {
          if (client.ws === ws) {
            wsClients.delete(client);
            break;
          }
        }
        console.log(
          `[gateway] WebSocket disconnected: channel=${ws.data.channel} total=${getConnectionCount()}`,
        );
      },

      drain(ws: ServerWebSocket<WsData>) {
        // Backpressure relief -- no action needed for our use case
      },
    },
  });

  // Mark Claude session as alive (will be managed by brain module)
  gatewayState.claudeSessionAlive = true;
  gatewayState.startedAt = new Date().toISOString();

  console.log(`[gateway] Sentinel Gateway listening on ${HOST}:${PORT}`);
  console.log(`[gateway] Security: localhost-only, DNS rebinding guard active`);

  return server;
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let server: ReturnType<typeof Bun.serve> | null = null;

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[gateway] Received ${signal} -- shutting down gracefully...`);

  // Close all WebSocket connections
  for (const client of wsClients) {
    try {
      client.ws.close(1001, "Server shutting down");
    } catch {
      // Ignore errors during shutdown
    }
  }
  wsClients.clear();

  // Stop accepting new connections
  if (server) {
    server.stop(true); // true = close existing connections
    console.log("[gateway] Server stopped.");
  }

  // Stop the scheduler
  stopScheduler();

  // Cancel all background tasks
  destroyAllTasks();

  // Persist brain state before exit
  if (brain) {
    await brain.destroy();
    console.log("[gateway] Brain state persisted.");
  }
  console.log("[gateway] Graceful shutdown complete.");
  process.exit(0);
}

// Register signal handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes("--test")) {
  // Config verification mode
  console.log("[gateway] Configuration test:");
  console.log(`  Host:      ${HOST}`);
  console.log(`  Port:      ${PORT}`);
  console.log(`  DNS Guard: ${[...ALLOWED_HOSTS].join(", ")}`);
  console.log(`  Max WS:    5`);
  console.log(`  Max Body:  100KB`);
  console.log(`  Global RL: 100/min`);

  // Verify the binding will not be 0.0.0.0
  if (HOST !== "127.0.0.1") {
    console.error("[gateway] FATAL: Host must be 127.0.0.1");
    process.exit(1);
  }

  console.log("[gateway] Configuration OK.");
  process.exit(0);
} else {
  // Normal startup — initialize brain, audit, then start server
  (async () => {
    // Initialize audit logger
    audit = new AuditLogger(DEFAULT_CONFIG.logDir);
    console.log("[gateway] Audit logger initialized");

    // Initialize brain with persistent Claude session
    brain = new SentinelBrain(DEFAULT_CONFIG);

    // Wire tool call interception
    brain.on("tool_call", (event) => {
      const decision = interceptToolCall(event);
      if (!decision.allowed) {
        audit?.log({
          eventType: "tool_blocked",
          channel: event.sourceChannel,
          trust: event.sourceTrust,
          details: `Tool "${event.tool}" blocked: ${decision.reason}`,
          outcome: "blocked",
        });
      }
    });

    // Resume previous session if available
    await brain.resumeSession();
    console.log("[gateway] Brain initialized");

    // Start the HTTP/WS server
    server = startServer();

    // Start the outbound message scheduler
    startScheduler();

    audit.log({
      eventType: "gateway_started",
      channel: "system",
      trust: "trusted" as ChannelTrust,
      details: `Gateway started on ${HOST}:${PORT}`,
      outcome: "success",
    });
  })();
}
