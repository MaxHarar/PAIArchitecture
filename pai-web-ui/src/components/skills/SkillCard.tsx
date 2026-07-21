"use client";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SkillMetadata } from "@/lib/pai/skills";

const CATEGORY_COLORS: Record<string, string> = {
  Research: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  Development: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Content: "bg-green-500/20 text-green-400 border-green-500/30",
  Communication: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  Security: "bg-red-500/20 text-red-400 border-red-500/30",
  Personal: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  System: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  Data: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  Other: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

const CATEGORY_ICONS: Record<string, string> = {
  Research: "🔍",
  Development: "⚙️",
  Content: "📝",
  Communication: "💬",
  Security: "🔒",
  Personal: "👤",
  System: "🖥️",
  Data: "📊",
  Other: "📦",
};

interface SkillCardProps {
  skill: SkillMetadata;
  onClick?: () => void;
}

export function SkillCard({ skill, onClick }: SkillCardProps) {
  return (
    <Card
      className="cursor-pointer hover:border-pai-500/50 transition-colors"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{CATEGORY_ICONS[skill.category] || "📦"}</span>
            <CardTitle className="text-base">{skill.name}</CardTitle>
          </div>
          {skill.hasTools && (
            <Badge variant="outline" className="text-xs">
              Tools
            </Badge>
          )}
        </div>
        <CardDescription className="line-clamp-2 text-xs">
          {skill.description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1">
          {skill.triggers.slice(0, 3).map((trigger) => (
            <Badge
              key={trigger}
              variant="secondary"
              className="text-xs"
            >
              {trigger}
            </Badge>
          ))}
          {skill.triggers.length > 3 && (
            <Badge variant="secondary" className="text-xs">
              +{skill.triggers.length - 3}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface SkillGridProps {
  skills: SkillMetadata[];
  onSkillClick?: (skill: SkillMetadata) => void;
}

export function SkillGrid({ skills, onSkillClick }: SkillGridProps) {
  // Group by category
  const grouped = skills.reduce((acc, skill) => {
    if (!acc[skill.category]) {
      acc[skill.category] = [];
    }
    acc[skill.category].push(skill);
    return acc;
  }, {} as Record<string, SkillMetadata[]>);

  // Sort categories
  const categoryOrder = [
    "Research",
    "Development",
    "Content",
    "Communication",
    "Security",
    "Personal",
    "System",
    "Data",
    "Other",
  ];

  const sortedCategories = Object.keys(grouped).sort(
    (a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b)
  );

  return (
    <div className="space-y-6">
      {sortedCategories.map((category) => (
        <div key={category}>
          <div className="flex items-center gap-2 mb-3">
            <span>{CATEGORY_ICONS[category] || "📦"}</span>
            <h3 className="font-semibold text-sm">{category}</h3>
            <Badge
              className={`text-xs border ${CATEGORY_COLORS[category] || CATEGORY_COLORS.Other}`}
            >
              {grouped[category].length}
            </Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {grouped[category].map((skill) => (
              <SkillCard
                key={skill.name}
                skill={skill}
                onClick={() => onSkillClick?.(skill)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
