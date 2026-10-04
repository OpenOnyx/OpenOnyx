import { useState } from "react";
import { LiveVaultGraph, type DemoGraphData } from "../LiveVaultGraph";

const CLUSTER_COLORS = { attention: 0x6e957e, cognition: 0x738ea8, routines: 0x9a809e };

const CONNECTIONS: DemoGraphData = {
  nodes: [
    { id: "focus", label: "Focus", x: 50, y: 45, current: true },
    { id: "attention", label: "Attention", x: 22, y: 24, color: CLUSTER_COLORS.attention },
    { id: "memory", label: "Working Memory", x: 76, y: 22, color: CLUSTER_COLORS.cognition },
    { id: "context", label: "Context Switching", x: 78, y: 62, color: CLUSTER_COLORS.cognition },
    { id: "flow", label: "Flow", x: 50, y: 80, color: CLUSTER_COLORS.attention },
    { id: "habits", label: "Habits", x: 22, y: 68, color: CLUSTER_COLORS.routines },
    { id: "deep-work", label: "Deep Work", x: 48, y: 18, color: CLUSTER_COLORS.attention },
    { id: "distractions", label: "Distractions", x: 90, y: 42, color: CLUSTER_COLORS.attention },
    { id: "routines", label: "Daily Routines", x: 12, y: 48, color: CLUSTER_COLORS.routines },
    { id: "environment", label: "Workspace Design", x: 14, y: 85, color: CLUSTER_COLORS.routines },
    { id: "rest", label: "Rest", x: 74, y: 88, color: CLUSTER_COLORS.cognition },
    { id: "decisions", label: "Decision Fatigue", x: 88, y: 12, color: CLUSTER_COLORS.cognition },
  ],
  edges: [
    ["focus", "attention"], ["focus", "memory"], ["focus", "flow"],
    ["attention", "context"], ["memory", "context"], ["habits", "flow"],
    ["deep-work", "focus"], ["deep-work", "flow"], ["distractions", "attention"],
    ["distractions", "context"], ["routines", "habits"], ["environment", "routines"],
    ["environment", "distractions"], ["rest", "memory"], ["rest", "focus"],
    ["decisions", "memory"], ["decisions", "routines"],
  ],
};

const EXPLANATIONS: Record<string, string> = {
  Focus: "Focus depends on where attention goes, how much we hold in memory, and whether we can stay in flow.",
  Attention: "Your attention and context-switching notes describe the same cost: interruptions break concentration.",
  "Working Memory": "Switching tasks means rebuilding context in working memory, leaving less capacity for the work itself.",
  "Context Switching": "Each interruption asks you to reload a task. This connects attention with working memory.",
  Flow: "Your flow and habit notes both describe protecting uninterrupted time for demanding work.",
  Habits: "A repeatable routine reduces the effort of starting and creates the conditions for flow.",
  "Deep Work": "Deep work and flow both depend on sustained focus without repeated interruptions.",
  Distractions: "Distractions redirect attention and trigger the context switches described in your other notes.",
  "Daily Routines": "Repeated routines turn useful habits into defaults and reduce everyday decision-making.",
  "Workspace Design": "A quieter workspace supports routines and removes common sources of distraction.",
  Rest: "Rest restores the mental capacity that working memory and sustained focus depend on.",
  "Decision Fatigue": "Repeated decisions consume mental capacity. Routines help reduce that load.",
  "Deep Work ↔ Focus": "Both notes describe protecting concentration long enough to do demanding work.",
  "Deep Work ↔ Flow": "Uninterrupted work makes it easier to become fully absorbed in a task.",
  "Distractions ↔ Attention": "Distractions draw attention away from the task you intended to work on.",
  "Distractions ↔ Context Switching": "An interruption forces a task switch, even when the original task is unfinished.",
  "Daily Routines ↔ Habits": "Routines give individual habits a repeatable place in the day.",
  "Workspace Design ↔ Daily Routines": "A consistent environment makes useful routines easier to repeat.",
  "Workspace Design ↔ Distractions": "Your surroundings can remove interruptions before they compete for attention.",
  "Rest ↔ Working Memory": "Both notes connect recovery with the capacity to hold and use information.",
  "Rest ↔ Focus": "Recovery makes sustained concentration easier to maintain.",
  "Decision Fatigue ↔ Working Memory": "Repeated choices compete for the same limited mental capacity.",
  "Decision Fatigue ↔ Daily Routines": "Routine choices leave more capacity for decisions that need deliberate thought.",
  "Attention ↔ Context Switching": "Different notes. A shared idea: interruptions consume attention.",
  "Working Memory ↔ Context Switching": "Both notes discuss the effort of rebuilding context after a task switch.",
  "Habits ↔ Flow": "Consistent routines help protect the uninterrupted time that flow requires.",
  "Focus ↔ Attention": "Both notes describe deliberately choosing what receives your limited attention.",
  "Focus ↔ Working Memory": "Holding less unrelated context leaves more capacity for concentrated work.",
  "Focus ↔ Flow": "Sustained focus creates the conditions for deep involvement in a task.",
};

export function AIGraphDemo() {
  const [selection, setSelection] = useState<string | null>(null);

  return (
    <div className="studio-connect-row studio-ai-connect-row">
      <div className="studio-ai-connection-copy">
        <p>OpenOnyx finds relationships between ideas, helping you connect notes you never linked.</p>
        <p className="studio-ai-connection-example" aria-live="polite">
          <strong>{selection ?? "Attention ↔ Context Switching"}</strong>
          <span>{EXPLANATIONS[selection ?? "Attention ↔ Context Switching"] ?? "Explore how these ideas relate, even without a written link."}</span>
        </p>
        <ul className="studio-cluster-key" aria-label="Example graph clusters">
          <li><i className="cluster-attention" aria-hidden="true" />Attention</li>
          <li><i className="cluster-cognition" aria-hidden="true" />Cognition</li>
          <li><i className="cluster-routines" aria-hidden="true" />Routines</li>
        </ul>
      </div>
      <LiveVaultGraph data={CONNECTIONS} appearance="paper" semantic showLabels={false} onExplore={setSelection} />
    </div>
  );
}
