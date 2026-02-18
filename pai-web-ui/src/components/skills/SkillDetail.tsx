"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SkillMetadata } from "@/lib/pai/skills";

interface SkillDetailProps {
  skill: SkillMetadata;
  onClose: () => void;
  onExecute: (skill: SkillMetadata, workflow?: string, args?: string) => void;
}

export function SkillDetail({ skill, onClose, onExecute }: SkillDetailProps) {
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>("");
  const [args, setArgs] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);

  const handleExecute = async () => {
    setIsExecuting(true);
    try {
      await onExecute(skill, selectedWorkflow, args);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <CardHeader className="border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{skill.icon}</span>
              <div>
                <CardTitle className="text-xl">{skill.name}</CardTitle>
                <p className="text-sm text-muted-foreground">{skill.category}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground text-xl"
            >
              ×
            </button>
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Description */}
          <div>
            <h3 className="font-semibold mb-2">Description</h3>
            <p className="text-sm text-muted-foreground">{skill.description}</p>
          </div>

          {/* Triggers */}
          <div>
            <h3 className="font-semibold mb-2">Triggers</h3>
            <div className="flex flex-wrap gap-2">
              {skill.triggers.map((trigger, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {trigger}
                </Badge>
              ))}
            </div>
          </div>

          {/* Workflows */}
          {skill.workflows && skill.workflows.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">Workflows</h3>
              <div className="flex flex-wrap gap-2">
                {skill.workflows.map((workflow, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedWorkflow(workflow)}
                    className={`px-3 py-2 rounded-lg border transition-colors text-sm ${
                      selectedWorkflow === workflow
                        ? "border-pai-500 bg-pai-500/10 text-pai-400"
                        : "border-border hover:border-pai-500/50"
                    }`}
                  >
                    {workflow}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Arguments Input */}
          <div>
            <h3 className="font-semibold mb-2">Arguments (optional)</h3>
            <input
              type="text"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="Enter arguments for the skill..."
              className="w-full bg-muted rounded-md px-3 py-2 text-sm placeholder:text-muted-foreground"
            />
          </div>

          {/* Command Preview */}
          <div>
            <h3 className="font-semibold mb-2">Command Preview</h3>
            <div className="bg-muted rounded-md p-3 font-mono text-sm">
              <span className="text-pai-400">/{skill.name.toLowerCase()}</span>
              {selectedWorkflow && (
                <span className="text-green-400"> {selectedWorkflow}</span>
              )}
              {args && <span className="text-yellow-400"> {args}</span>}
            </div>
          </div>
        </CardContent>

        {/* Footer */}
        <div className="border-t border-border p-4 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleExecute}
            disabled={isExecuting}
            className="px-4 py-2 bg-pai-500 hover:bg-pai-600 text-white rounded-md text-sm disabled:opacity-50 transition-colors"
          >
            {isExecuting ? "Executing..." : "Execute Skill"}
          </button>
        </div>
      </Card>
    </div>
  );
}
