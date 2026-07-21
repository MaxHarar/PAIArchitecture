import path from "path";
import { SKILLS_DIR, readFile, listDirectories, fileExists } from "./filesystem";

export interface SkillMetadata {
  name: string;
  description: string;
  category: string;
  triggers: string[];
  workflows: string[];
  hasTools: boolean;
  path: string;
  icon: string;
}

// Category mapping based on skill content/purpose
const CATEGORY_MAP: Record<string, string> = {
  // Research
  Research: "Research",
  OSINT: "Research",
  PrivateInvestigator: "Research",
  FirstPrinciples: "Research",
  BeCreative: "Research",
  RedTeam: "Research",
  Council: "Research",

  // Development
  CreateSkill: "Development",
  CreateCLI: "Development",
  Evals: "Development",
  Prompting: "Development",
  Browser: "Development",

  // Content
  Art: "Content",
  Documents: "Content",
  Fabric: "Content",
  Aphorisms: "Content",

  // Communication
  TelegramClean: "Communication",
  DailyBriefing: "Communication",
  VoiceServer: "Communication",
  GmailManager: "Communication",

  // Security
  WebAssessment: "Security",
  Recon: "Security",
  PromptInjection: "Security",
  SECUpdates: "Security",
  AnnualReports: "Security",

  // Personal
  Telos: "Personal",
  FitnessCoach: "Personal",

  // System
  CORE: "System",
  PAIUpgrade: "System",
  Agents: "System",

  // Data
  BrightData: "Data",
  Apify: "Data",
};

function parseSkillDescription(content: string): string {
  // Look for description in frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const descMatch = frontmatterMatch[1].match(/description:\s*(.+)/);
    if (descMatch) return descMatch[1].trim();
  }

  // Fallback: first paragraph after # heading
  const lines = content.split("\n");
  let inContent = false;
  for (const line of lines) {
    if (line.startsWith("# ")) {
      inContent = true;
      continue;
    }
    if (inContent && line.trim() && !line.startsWith("#")) {
      return line.trim().slice(0, 200);
    }
  }

  return "No description available";
}

function parseTriggers(content: string): string[] {
  const triggers: string[] = [];

  // Look for USE WHEN pattern
  const useWhenMatch = content.match(/USE WHEN[:\s]+([^.]+)/i);
  if (useWhenMatch) {
    triggers.push(...useWhenMatch[1].split(",").map((t) => t.trim()));
  }

  // Look for trigger keywords in frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const triggersMatch = frontmatterMatch[1].match(/triggers?:\s*\[?([^\]\n]+)/i);
    if (triggersMatch) {
      triggers.push(...triggersMatch[1].split(",").map((t) => t.trim().replace(/["\[\]]/g, "")));
    }
  }

  return [...new Set(triggers)].slice(0, 5);
}

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    Research: "🔍",
    Development: "⚙️",
    Content: "🎨",
    Communication: "💬",
    Security: "🛡️",
    Personal: "👤",
    System: "🖥️",
    Data: "📊",
    Other: "📦",
  };
  return icons[category] || "📦";
}

function parseWorkflows(content: string): string[] {
  const workflows: string[] = [];

  // Look for workflow files mentioned
  const workflowMatches = content.matchAll(/Workflows?\/([A-Za-z0-9_-]+)\.md/g);
  for (const match of workflowMatches) {
    workflows.push(match[1]);
  }

  // Look for ## Workflow or ### Workflow sections
  const sectionMatches = content.matchAll(/#{2,3}\s+(?:Workflow[s]?:?\s*)?([A-Za-z0-9_\s-]+workflow)/gi);
  for (const match of sectionMatches) {
    workflows.push(match[1].trim());
  }

  return [...new Set(workflows)].slice(0, 5);
}

export async function getSkillMetadata(skillName: string): Promise<SkillMetadata | null> {
  const skillPath = path.join(SKILLS_DIR, skillName);
  const skillFile = path.join(skillPath, "SKILL.md");

  const content = await readFile(skillFile);
  if (!content) return null;

  const hasTools = await fileExists(path.join(skillPath, "Tools"));

  const category = CATEGORY_MAP[skillName] || "Other";

  return {
    name: skillName,
    description: parseSkillDescription(content),
    category,
    triggers: parseTriggers(content),
    workflows: parseWorkflows(content),
    hasTools,
    path: skillPath,
    icon: getCategoryIcon(category),
  };
}

export async function getAllSkills(): Promise<SkillMetadata[]> {
  const skillDirs = await listDirectories(SKILLS_DIR);

  const skills: SkillMetadata[] = [];

  for (const dir of skillDirs) {
    // Skip hidden directories and non-skill directories
    if (dir.startsWith(".") || dir.startsWith("_")) continue;

    const metadata = await getSkillMetadata(dir);
    if (metadata) {
      skills.push(metadata);
    }
  }

  // Sort by category then name
  return skills.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.name.localeCompare(b.name);
  });
}

export function groupSkillsByCategory(skills: SkillMetadata[]): Record<string, SkillMetadata[]> {
  const grouped: Record<string, SkillMetadata[]> = {};

  for (const skill of skills) {
    if (!grouped[skill.category]) {
      grouped[skill.category] = [];
    }
    grouped[skill.category].push(skill);
  }

  return grouped;
}
