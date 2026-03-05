export type RiskLevel = "low" | "medium" | "high";
export type ProviderName = "codex" | "openai";

export interface Suggestion {
  command: string;
  explanation: string;
  needsConfirmation: boolean;
  risk: RiskLevel;
}

export interface RuntimeContext {
  cwd: string;
  homeDir: string;
  platform: NodeJS.Platform;
  shell: string;
}
