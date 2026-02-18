import { NextResponse } from "next/server";
import { getAllSkills } from "@/lib/pai/skills";
import { getWorkEntries, getLearningEntries } from "@/lib/pai/memory";
import { getSessions } from "@/lib/pai/sessions";

interface SearchResult {
  type: "skill" | "work" | "learning" | "session";
  id: string;
  title: string;
  description?: string;
  path?: string;
  relevance: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  const limit = parseInt(searchParams.get("limit") || "20", 10);

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const lowerQuery = query.toLowerCase();
  const results: SearchResult[] = [];

  try {
    // Search skills
    const skills = await getAllSkills();
    for (const skill of skills) {
      const nameMatch = skill.name.toLowerCase().includes(lowerQuery);
      const descMatch = skill.description.toLowerCase().includes(lowerQuery);
      const triggerMatch = skill.triggers.some((t) =>
        t.toLowerCase().includes(lowerQuery)
      );

      if (nameMatch || descMatch || triggerMatch) {
        results.push({
          type: "skill",
          id: skill.name,
          title: skill.name,
          description: skill.description,
          path: skill.path,
          relevance: nameMatch ? 3 : triggerMatch ? 2 : 1,
        });
      }
    }

    // Search work entries
    const workEntries = await getWorkEntries();
    for (const entry of workEntries) {
      const titleMatch = entry.title.toLowerCase().includes(lowerQuery);
      const descMatch = entry.description?.toLowerCase().includes(lowerQuery);
      const tagMatch = entry.tags?.some((t) =>
        t.toLowerCase().includes(lowerQuery)
      );

      if (titleMatch || descMatch || tagMatch) {
        results.push({
          type: "work",
          id: entry.id,
          title: entry.title,
          description: entry.description,
          path: entry.path,
          relevance: titleMatch ? 3 : tagMatch ? 2 : 1,
        });
      }
    }

    // Search learning entries
    const learningEntries = await getLearningEntries();
    for (const entry of learningEntries) {
      const nameMatch = entry.filename.toLowerCase().includes(lowerQuery);
      const contentMatch = entry.content.toLowerCase().includes(lowerQuery);
      const categoryMatch = entry.category.toLowerCase().includes(lowerQuery);

      if (nameMatch || contentMatch || categoryMatch) {
        results.push({
          type: "learning",
          id: entry.id,
          title: entry.filename.replace(".md", ""),
          description: `${entry.category} - ${entry.content.slice(0, 100)}...`,
          path: entry.path,
          relevance: nameMatch ? 3 : categoryMatch ? 2 : 1,
        });
      }
    }

    // Search sessions
    const sessions = await getSessions();
    for (const session of sessions) {
      const idMatch = session.id.toLowerCase().includes(lowerQuery);
      const summaryMatch = session.summary?.toLowerCase().includes(lowerQuery);

      if (idMatch || summaryMatch) {
        results.push({
          type: "session",
          id: session.id,
          title: session.summary || `Session ${session.id.slice(0, 8)}`,
          description: `${session.messageCount} messages, ${session.toolCalls} tool calls`,
          relevance: summaryMatch ? 2 : 1,
        });
      }
    }

    // Sort by relevance and limit
    results.sort((a, b) => b.relevance - a.relevance);

    return NextResponse.json({
      query,
      total: results.length,
      results: results.slice(0, limit),
    });
  } catch (error) {
    console.error("Error searching:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
