export type RiskLevel = "low" | "medium" | "high";
export type AuthMethod = "codex-oauth" | "openai-api-key";

export interface Suggestion {
  command: string;
  explanation: string;
  risk: RiskLevel;
  needsConfirmation: boolean;
}

export interface RuntimeContext {
  cwd: string;
  shell: string;
  platform: NodeJS.Platform;
  homeDir: string;
}
