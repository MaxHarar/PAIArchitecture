import { query } from "@anthropic-ai/claude-agent-sdk";
import { homedir } from "os";
import { join } from "path";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for complex tasks

// Working directory for Claude
const WORKING_DIR = join(homedir(), ".claude");

// System prompt for Jarvis in the PAI Command Center
const SYSTEM_PROMPT = `You are Jarvis, an AI assistant in the PAI (Personal AI Infrastructure) Command Center.

You are helpful, knowledgeable, and efficient. You assist the user (Max) with:
- Answering questions about the PAI system
- Executing skills and complex tasks
- Research, analysis, and problem-solving
- System monitoring and management

Use markdown formatting when helpful. For complex tasks, explain what you're doing as you work.

Available skills you can use:
- /research - Research and information gathering
- /browser - Web automation and screenshots
- /art - Visual content creation
- /osint - Open source intelligence
- /redteam - Adversarial analysis
- /fitness - Workout planning

You have full access to tools and can perform complex, multi-step tasks.`;

interface Message {
  role: "user" | "assistant";
  content: string;
}

// Session storage (in-memory for simplicity)
let currentSessionId: string | null = null;

// Active abort controller for cancellation
let activeAbortController: AbortController | null = null;

export async function POST(req: Request) {
  try {
    const { messages, newSession, cancel } = (await req.json()) as {
      messages: Message[];
      newSession?: boolean;
      cancel?: boolean;
    };

    // Handle cancel request
    if (cancel && activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
      return new Response(
        JSON.stringify({ cancelled: true }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get the last user message
    const lastUserMessage = messages
      .filter((m: Message) => m.role === "user")
      .pop();

    if (!lastUserMessage) {
      return new Response(
        JSON.stringify({ error: "No user message found" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Reset session if requested
    if (newSession) {
      currentSessionId = null;
    }

    // Build conversation context
    const conversationContext = messages
      .slice(-6) // Last 6 messages for context
      .map(
        (m: Message) =>
          `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
      )
      .join("\n\n");

    const prompt = conversationContext.includes("User:")
      ? `Previous conversation:\n${conversationContext}\n\nRespond to the user's latest message.`
      : lastUserMessage.content;

    // Create abort controller
    activeAbortController = new AbortController();
    const abortController = activeAbortController;

    // Stream the response with detailed events
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (type: string, data: Record<string, unknown>) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`)
          );
        };

        try {
          // Send initial status
          sendEvent("status", { status: "starting", message: "Starting query..." });

          const queryInstance = query({
            prompt,
            options: {
              model: "claude-sonnet-4-5",
              cwd: WORKING_DIR,
              systemPrompt: SYSTEM_PROMPT,
              permissionMode: "bypassPermissions",
              allowDangerouslySkipPermissions: true,
              resume: currentSessionId || undefined,
              abortController,
            },
          });

          let textBuffer = "";
          let lastTextSend = 0;
          const TEXT_THROTTLE_MS = 100; // Throttle text updates

          // Process streaming events
          for await (const event of queryInstance) {
            // Check for abort
            if (abortController.signal.aborted) {
              sendEvent("cancelled", { message: "Request cancelled" });
              break;
            }

            // Capture session ID
            if (!currentSessionId && event.session_id) {
              currentSessionId = event.session_id;
              sendEvent("session", { sessionId: currentSessionId.slice(0, 8) });
            }

            // Handle assistant messages
            if (event.type === "assistant") {
              for (const block of event.message.content) {
                // Thinking blocks
                if (block.type === "thinking") {
                  const thinking = block.thinking;
                  if (thinking) {
                    // Send truncated thinking preview
                    const preview =
                      thinking.length > 200
                        ? thinking.slice(0, 200) + "..."
                        : thinking;
                    sendEvent("thinking", { content: preview });
                  }
                }

                // Tool use blocks
                if (block.type === "tool_use") {
                  const toolName = block.name;
                  const toolInput = block.input as Record<string, unknown>;

                  sendEvent("tool", {
                    name: toolName,
                    input: summarizeToolInput(toolName, toolInput),
                  });
                }

                // Text content
                if (block.type === "text") {
                  textBuffer += block.text;

                  // Throttle text updates
                  const now = Date.now();
                  if (now - lastTextSend > TEXT_THROTTLE_MS) {
                    sendEvent("text", { content: textBuffer });
                    lastTextSend = now;
                  }
                }
              }
            }

            // Result message
            if (event.type === "result") {
              // Send final text if any remaining
              if (textBuffer) {
                sendEvent("text", { content: textBuffer });
              }

              // Send usage info if available
              if ("usage" in event && event.usage) {
                const usage = event.usage as {
                  input_tokens: number;
                  output_tokens: number;
                };
                sendEvent("result", {
                  usage: {
                    input: usage.input_tokens,
                    output: usage.output_tokens,
                  },
                });
              }
            }
          }

          // Send completion
          sendEvent("done", {});
          controller.close();
        } catch (error) {
          console.error("Query error:", error);
          const errorMsg =
            error instanceof Error ? error.message : "Unknown error";

          // Check if it's an abort error
          if (
            errorMsg.includes("abort") ||
            errorMsg.includes("cancel") ||
            abortController.signal.aborted
          ) {
            sendEvent("cancelled", { message: "Request cancelled" });
          } else {
            sendEvent("error", { message: errorMsg });
          }
          controller.close();
        } finally {
          if (activeAbortController === abortController) {
            activeAbortController = null;
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process chat request" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// Summarize tool input for display
function summarizeToolInput(
  toolName: string,
  input: Record<string, unknown>
): string {
  switch (toolName) {
    case "Read":
      return truncate(String(input.file_path || ""), 60);
    case "Write":
    case "Edit":
      return truncate(String(input.file_path || ""), 60);
    case "Bash":
      return truncate(String(input.command || "").replace(/\n/g, " "), 80);
    case "Glob":
      return String(input.pattern || "");
    case "Grep":
      return `"${truncate(String(input.pattern || ""), 40)}"`;
    case "WebSearch":
      return `"${truncate(String(input.query || ""), 50)}"`;
    case "WebFetch":
      return truncate(String(input.url || ""), 60);
    case "Task":
      return truncate(String(input.description || ""), 50);
    case "Skill":
      return String(input.skill || "");
    default:
      return "";
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}
