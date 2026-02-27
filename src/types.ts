export type RiskLevel = "low" | "medium" | "high";
export type ProviderName = "openai" | "codex";

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

export interface ProviderConfig {
  provider: ProviderName;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}
