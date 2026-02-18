"use client";

import { useEffect, useState, useCallback } from "react";
import { Header } from "@/components/layout/Header";
import { SplitPanel } from "@/components/layout/SplitPanel";
import { SkillGrid } from "@/components/skills/SkillCard";
import { SkillDetail } from "@/components/skills/SkillDetail";
import { HealthPanel } from "@/components/system/HealthPanel";
import { MemoryBrowser } from "@/components/memory/MemoryBrowser";
import { SessionsList } from "@/components/sessions/SessionsList";
import { AgentTraces } from "@/components/agents/AgentTraces";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { CommandPalette } from "@/components/command/CommandPalette";
import { ErrorBoundary } from "@/components/error/ErrorBoundary";
import { FitnessPanel } from "@/components/fitness/FitnessPanel";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { SkillMetadata } from "@/lib/pai/skills";

interface ActivityPanelProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  skills: SkillMetadata[];
  loading: boolean;
  selectedSkill: SkillMetadata | null;
  setSelectedSkill: (skill: SkillMetadata | null) => void;
  executionResult: string | null;
  setExecutionResult: (result: string | null) => void;
}

function ActivityPanel({
  activeTab,
  onTabChange,
  skills,
  loading,
  selectedSkill,
  setSelectedSkill,
  executionResult,
  setExecutionResult,
}: ActivityPanelProps) {
  // Handle skill execution
  const handleExecuteSkill = async (
    skill: SkillMetadata,
    workflow?: string,
    args?: string
  ) => {
    try {
      const res = await fetch("/api/skills/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillName: skill.name,
          workflow,
          args,
        }),
      });
      const data = await res.json();
      setExecutionResult(data.result || data.message);
      // Close modal after short delay to show result
      setTimeout(() => {
        setSelectedSkill(null);
        setExecutionResult(null);
      }, 2000);
    } catch (err) {
      console.error("Skill execution failed:", err);
      setExecutionResult("Execution failed");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="p-4 border-b border-border">
        <Tabs value={activeTab} onValueChange={onTabChange}>
          <TabsList>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
            <TabsTrigger value="memory">Memory</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="fitness">Fitness</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        <Tabs value={activeTab} onValueChange={onTabChange}>
          <TabsContent value="agents" className="m-0">
            <AgentTraces />
          </TabsContent>

          <TabsContent value="skills" className="m-0 p-4">
            {loading ? (
              <div className="animate-pulse space-y-4">
                <div className="h-8 bg-muted rounded w-1/4"></div>
                <div className="grid grid-cols-3 gap-3">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="h-32 bg-muted rounded"></div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold">
                    Skill Catalog ({skills.length} skills)
                  </h2>
                </div>
                <SkillGrid
                  skills={skills}
                  onSkillClick={(skill) => setSelectedSkill(skill)}
                />
              </>
            )}
          </TabsContent>

          <TabsContent value="memory" className="m-0">
            <MemoryBrowser />
          </TabsContent>

          <TabsContent value="documents" className="m-0">
            <DocumentsPanel />
          </TabsContent>

          <TabsContent value="sessions" className="m-0">
            <SessionsList />
          </TabsContent>

          <TabsContent value="fitness" className="m-0">
            <FitnessPanel />
          </TabsContent>

          <TabsContent value="system" className="m-0">
            <HealthPanel />
          </TabsContent>
        </Tabs>
      </div>

      {/* Skill Detail Modal */}
      {selectedSkill && (
        <SkillDetail
          skill={selectedSkill}
          onClose={() => {
            setSelectedSkill(null);
            setExecutionResult(null);
          }}
          onExecute={handleExecuteSkill}
        />
      )}

      {/* Execution Result Toast */}
      {executionResult && (
        <div className="fixed bottom-4 right-4 bg-pai-500 text-white px-4 py-2 rounded-lg shadow-lg z-50">
          {executionResult}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState("skills");
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSkill, setSelectedSkill] = useState<SkillMetadata | null>(null);
  const [executionResult, setExecutionResult] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Fetch skills
  useEffect(() => {
    async function fetchSkills() {
      try {
        const res = await fetch("/api/skills");
        const data = await res.json();
        setSkills(data.skills || []);
      } catch (err) {
        console.error("Failed to fetch skills:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchSkills();
  }, []);

  // Global keyboard shortcut for command palette
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Handle skill selection from command palette
  const handleSkillSelect = useCallback(
    (skillName: string) => {
      const skill = skills.find((s) => s.name === skillName);
      if (skill) {
        setSelectedSkill(skill);
        setActiveTab("skills");
      }
    },
    [skills]
  );

  // Handle navigation from command palette
  const handleNavigate = useCallback((tab: string) => {
    setActiveTab(tab);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <ErrorBoundary>
        <SplitPanel
          left={
            <ErrorBoundary>
              <ChatPanel />
            </ErrorBoundary>
          }
          right={
            <ErrorBoundary>
              <ActivityPanel
                activeTab={activeTab}
                onTabChange={setActiveTab}
                skills={skills}
                loading={loading}
                selectedSkill={selectedSkill}
                setSelectedSkill={setSelectedSkill}
                executionResult={executionResult}
                setExecutionResult={setExecutionResult}
              />
            </ErrorBoundary>
          }
        />
      </ErrorBoundary>

      {/* Command Palette */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        skills={skills.map((s) => ({ name: s.name, icon: s.icon, description: s.description }))}
        onSkillSelect={handleSkillSelect}
        onNavigate={handleNavigate}
      />
    </div>
  );
}
