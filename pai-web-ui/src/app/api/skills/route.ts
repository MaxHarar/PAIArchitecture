import { NextResponse } from "next/server";
import { getAllSkills, groupSkillsByCategory } from "@/lib/pai/skills";

export async function GET() {
  try {
    const skills = await getAllSkills();
    const grouped = groupSkillsByCategory(skills);

    return NextResponse.json({
      total: skills.length,
      skills,
      grouped,
    });
  } catch (error) {
    console.error("Error fetching skills:", error);
    return NextResponse.json(
      { error: "Failed to fetch skills" },
      { status: 500 }
    );
  }
}
