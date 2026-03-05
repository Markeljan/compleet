import systemPromptPath from "./system-prompt.txt" with { type: "file" };
import type { RuntimeContext } from "./types";

let cachedSystemPrompt: string | null = null;

export async function loadSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt !== null) {
    return cachedSystemPrompt;
  }

  cachedSystemPrompt = (await Bun.file(systemPromptPath).text()).trim();
  return cachedSystemPrompt;
}

export function buildUserPrompt(
  request: string,
  context: RuntimeContext
): string {
  return JSON.stringify(
    {
      task: request,
      context: {
        cwd: context.cwd,
        shell: context.shell,
        platform: context.platform,
        homeDir: context.homeDir,
      },
      instructions: {
        output: "Return only the JSON object described in the system prompt.",
      },
    },
    null,
    2
  );
}
