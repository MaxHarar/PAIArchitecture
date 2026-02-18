import { NextResponse } from "next/server";
import {
  getActiveSessions,
  getCurrentSession,
  getSessionTrace,
} from "@/lib/pai/agents";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session");

  try {
    // If specific session requested, return its trace
    if (sessionId) {
      const trace = await getSessionTrace(sessionId);
      if (!trace) {
        return NextResponse.json(
          { error: "Session not found" },
          { status: 404 }
        );
      }
      return NextResponse.json(trace);
    }

    // Otherwise return list of active sessions and current session
    const [sessions, current] = await Promise.all([
      getActiveSessions(),
      getCurrentSession(),
    ]);

    return NextResponse.json({
      current,
      sessions,
      total: sessions.length,
    });
  } catch (error) {
    console.error("Error fetching agent data:", error);
    return NextResponse.json(
      { error: "Failed to fetch agent data" },
      { status: 500 }
    );
  }
}
