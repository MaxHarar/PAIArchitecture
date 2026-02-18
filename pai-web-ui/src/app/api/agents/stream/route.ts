import { NextRequest } from "next/server";
import { getCurrentSession, watchTranscript } from "@/lib/pai/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection message
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "connected" })}\n\n`)
      );

      // Get current session
      const current = await getCurrentSession();

      if (!current) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "no_session", message: "No active session found" })}\n\n`
          )
        );

        // Keep connection alive, poll for new sessions
        const pollInterval = setInterval(async () => {
          const newSession = await getCurrentSession();
          if (newSession) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "session_started", session: newSession })}\n\n`
              )
            );
          }
        }, 5000);

        // Clean up on close
        request.signal.addEventListener("abort", () => {
          clearInterval(pollInterval);
        });

        return;
      }

      // Send current session info
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "session", session: current })}\n\n`
        )
      );

      // Watch transcript for changes
      try {
        for await (const event of watchTranscript(
          current.transcriptPath,
          request.signal
        )) {
          if (request.signal.aborted) break;

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ eventType: "transcript", data: event })}\n\n`
            )
          );
        }
      } catch (err) {
        if (!request.signal.aborted) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: String(err) })}\n\n`
            )
          );
        }
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
