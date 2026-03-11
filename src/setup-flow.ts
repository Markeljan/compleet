import type { SelectOption } from "./interactive";
import type { ProviderName } from "./types";

export type ProviderSelection = ProviderName | "skip";

export function buildProviderSelectionOptions(
  current: ProviderName,
  configuredProvider: ProviderName | null
): {
  defaultIndex: number;
  options: SelectOption<ProviderSelection>[];
} {
  const options: SelectOption<ProviderSelection>[] = [];

  if (configuredProvider) {
    options.push({
      label: `Skip provider setup and keep ${configuredProvider} (Recommended)`,
      value: "skip",
    });
  }

  options.push(
    { label: "OpenAI OAuth (via Codex CLI)", value: "codex" },
    { label: "OpenAI API key", value: "openai" }
  );

  let defaultIndex = 0;
  if (!configuredProvider && current === "openai") {
    defaultIndex = 1;
  }

  return {
    defaultIndex,
    options,
  };
}
