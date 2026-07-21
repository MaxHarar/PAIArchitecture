/**
 * ActivityStateManager - Tracks Jarvis's current activity for dynamic avatar
 *
 * Pattern: Singleton pub/sub (matches VoiceQueue pattern)
 * Purpose: Centralize activity tracking for header avatar and other UI
 */

export type AvatarRole =
  | 'default'
  | 'architect'
  | 'engineer'
  | 'researcher'
  | 'analyst'
  | 'planner'
  | 'fitness'
  | 'artist';

interface ActivityState {
  currentRole: AvatarRole;
  currentTool: string | null;
  thinking: boolean;
  toolInput: string | null;
}

type StateListener = (state: ActivityState) => void;

class ActivityStateManager {
  private state: ActivityState = {
    currentRole: 'default',
    currentTool: null,
    thinking: false,
    toolInput: null,
  };

  private listeners: Set<StateListener> = new Set();

  // Map tool names to avatar roles
  private readonly TOOL_TO_ROLE: Record<string, AvatarRole> = {
    // Engineering tools
    'Bash': 'engineer',
    'Write': 'engineer',
    'Edit': 'engineer',
    'NotebookEdit': 'engineer',

    // Research tools
    'Read': 'researcher',
    'Grep': 'researcher',
    'Glob': 'researcher',
    'WebSearch': 'researcher',
    'WebFetch': 'researcher',

    // Planning tools
    'TodoWrite': 'planner',
    'Task': 'architect', // Task delegation = architectural thinking
    'EnterPlanMode': 'architect',

    // Skills
    'Skill': 'default', // Will be refined based on skill name
  };

  // Map skill names to avatar roles
  private readonly SKILL_TO_ROLE: Record<string, AvatarRole> = {
    'fitness': 'fitness',
    'FitnessCoach': 'fitness',
    'art': 'artist',
    'Art': 'artist',
    'research': 'researcher',
    'osint': 'analyst',
    'redteam': 'analyst',
  };

  /**
   * Update current activity (called from ChatPanel)
   */
  setActivity(tool: string | null, toolInput?: string, thinking?: boolean): void {
    // Determine role based on tool
    let newRole: AvatarRole = 'default';

    if (tool) {
      // Check if it's a Skill tool - parse skill name from input
      if (tool === 'Skill' && toolInput) {
        const skillMatch = Object.keys(this.SKILL_TO_ROLE).find(
          skill => toolInput.toLowerCase().includes(skill.toLowerCase())
        );
        if (skillMatch) {
          newRole = this.SKILL_TO_ROLE[skillMatch];
        }
      } else {
        newRole = this.TOOL_TO_ROLE[tool] || 'default';
      }
    } else if (thinking) {
      // If just thinking with no tool, check thinking content for keywords
      if (toolInput) {
        if (/architect|design|plan|structure/i.test(toolInput)) {
          newRole = 'architect';
        } else if (/analy[sz]e|data|metrics/i.test(toolInput)) {
          newRole = 'analyst';
        }
      }
    }

    // Update state if changed
    const hasChanged =
      this.state.currentRole !== newRole ||
      this.state.currentTool !== tool ||
      this.state.thinking !== !!thinking;

    if (hasChanged) {
      this.state = {
        currentRole: newRole,
        currentTool: tool,
        thinking: !!thinking,
        toolInput: toolInput || null,
      };
      this.notifyListeners();
    }
  }

  /**
   * Clear activity (back to default)
   */
  clearActivity(): void {
    this.setActivity(null);
  }

  /**
   * Get current state
   */
  getState(): ActivityState {
    return { ...this.state };
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    // Immediately notify with current state
    listener(this.getState());

    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach(listener => listener(state));
  }
}

// Singleton instance
export const activityState = new ActivityStateManager();
