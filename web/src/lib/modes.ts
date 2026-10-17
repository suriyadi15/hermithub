import { Bot, Radio, Sparkles, SquareTerminal, type LucideIcon } from "lucide-react";
import type { Agent, SessionMode } from "./api";
import { useAgents } from "./queries";

export interface ModeInfo {
  mode: SessionMode;
  label: string;
  short: string;
  icon: LucideIcon;
  className: string;
  hint: string;
  /** The agent this mode runs; null for bash. */
  agent: Agent | null;
}

const AGENT_STYLE: Record<string, { icon: LucideIcon; className: string }> = {
  claude: { icon: Bot, className: "text-primary border-primary/40 bg-primary/10" },
  codex: { icon: Sparkles, className: "text-success border-success/40 bg-success/10" },
  gemini: { icon: Sparkles, className: "text-warning border-warning/40 bg-warning/10" },
};

const BASH: Omit<ModeInfo, "agent"> = {
  mode: "bash",
  label: "Terminal",
  short: "bash",
  icon: SquareTerminal,
  className: "text-muted-foreground border-border bg-muted/40",
  hint: "Plain shell in the project folder",
};

function agentMode(a: Agent): ModeInfo {
  const style = AGENT_STYLE[a.id] ?? AGENT_STYLE.claude!;
  return { mode: a.id, label: a.name, short: a.id, ...style, hint: `${a.vendor} · interactive in the web terminal`, agent: a };
}

function remoteMode(claude: Agent): ModeInfo {
  return {
    mode: "rc",
    label: "Claude Remote Control",
    short: "remote",
    icon: Radio,
    className: "text-info border-info/40 bg-info/10",
    hint: "Drive it from claude.ai/code or the Claude mobile app",
    agent: claude,
  };
}

/** Session types the user can start (installed agents + bash), and display info for any mode. */
export function useModes() {
  const agents = useAgents();
  const list = agents.data ?? [];
  const installed = list.filter((a) => a.installed);
  const claude = installed.find((a) => a.id === "claude");
  const modes: ModeInfo[] = [
    ...installed.map(agentMode),
    ...(claude?.remoteControl ? [remoteMode(claude)] : []),
    { ...BASH, agent: null },
  ];
  const info = (mode: SessionMode): ModeInfo => {
    const known = modes.find((m) => m.mode === mode);
    if (known) return known;
    if (mode === "bash") return { ...BASH, agent: null };
    const agent = list.find((a) => a.id === (mode === "rc" ? "claude" : mode));
    if (agent) return mode === "rc" ? remoteMode(agent) : agentMode(agent);
    return { ...BASH, mode, label: mode, short: mode, icon: Bot, hint: "", agent: null };
  };
  return { modes, info, loading: agents.isLoading, hasAgents: installed.length > 0 };
}
