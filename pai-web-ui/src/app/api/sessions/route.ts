import { NextResponse } from "next/server";
import { getSessions, getSessionDetails } from "@/lib/pai/sessions";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("id");

  try {
    if (sessionId) {
      const details = await getSessionDetails(sessionId);
      if (!details) {
        return NextResponse.json(
          { error: "Session not found" },
          { status: 404 }
        );
      }
      return NextResponse.json(details);
    }

    const sessions = await getSessions();
    return NextResponse.json({
      total: sessions.length,
      sessions,
    });
  } catch (error) {
    console.error("Error fetching sessions:", error);
    return NextResponse.json(
      { error: "Failed to fetch sessions" },
      { status: 500 }
    );
  }
}
