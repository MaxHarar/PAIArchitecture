import { NextResponse } from "next/server";

const VOICE_SERVER_URL = "http://localhost:8888";

/**
 * Proxy endpoint for VoiceServer /notify
 * Avoids CORS issues when calling from browser
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const response = await fetch(`${VOICE_SERVER_URL}/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `VoiceServer error: ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    // VoiceServer might not be running - fail gracefully
    console.error("VoiceServer proxy error:", error);

    const message = error instanceof Error ? error.message : "Unknown error";

    // Check if it's a connection error (server not running)
    if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
      return NextResponse.json(
        { error: "VoiceServer not running", silent: true },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: `Failed to reach VoiceServer: ${message}` },
      { status: 500 }
    );
  }
}
