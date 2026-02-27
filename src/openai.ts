import { buildUserPrompt, loadSystemPrompt } from "./prompt";
import { ensureCodexChatGPTAuth } from "./codex-auth";
import type { RiskLevel, RuntimeContext, Suggestion } from "./types";
import { loadUserConfig } from "./user-config";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: { message?: string };
}

interface ResponsesApiResponse {
  output_text?: unknown;
  output?: unknown;
  response?: ResponsesApiResponse;
  error?: { message?: string };
}

interface ResolvedOpenAIConfig {
  authMethod: "openai-api-key";
  apiKey: string;
}

interface ResolvedCodexConfig {
  authMethod: "codex-oauth";
  accessToken: string;
}

type ResolvedRuntimeConfig = ResolvedOpenAIConfig | ResolvedCodexConfig;

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENAI_MODEL = "gpt-4o-mini";
const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const CODEX_MODEL = "gpt-5.3-codex";

const GENERAL_ASSISTANT_SYSTEM_PROMPT =
  "You are a concise, helpful assistant. Answer directly in plain text unless asked for another format.";

export async function resolveRuntimeConfig(): Promise<ResolvedRuntimeConfig> {
  const stored = await loadUserConfig();
  const authMethod = stored.authMethod;

  if (authMethod === "openai-api-key") {
    const apiKey = stored.openaiApiKey?.trim();
    if (!apiKey) {
      throw new Error('OpenAI API key is missing from setup. Run "tcomp setup" to configure it.');
    }

    return {
      authMethod,
      apiKey,
    };
  }

  if (authMethod === "codex-oauth") {
    const auth = await ensureCodexChatGPTAuth(Boolean(process.stdin.isTTY));
    return {
      authMethod,
      accessToken: auth.accessToken,
    };
  }

  throw new Error('Setup is required before using tcomp. Run "tcomp setup".');
}

function normalizeContent(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

function stripCodeFence(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  const withoutStart = trimmed.replace(/^```[a-zA-Z0-9_-]*\s*/, "");
  return withoutStart.replace(/\s*```$/, "").trim();
}

function tryExtractJson(raw: string): unknown {
  const cleaned = stripCodeFence(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through
  }

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = cleaned.slice(first, last + 1);
    try {
      return JSON.parse(slice);
    } catch {
      // fall through
    }
  }

  throw new Error("Model response was not valid JSON");
}

function asRiskLevel(value: unknown): RiskLevel {
  if (value === "medium" || value === "high" || value === "low") {
    return value;
  }
  return "low";
}

function parseSuggestion(raw: string): Suggestion {
  const parsed = tryExtractJson(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Parsed response is not an object");
  }

  const obj = parsed as Record<string, unknown>;
  const command = typeof obj.command === "string" ? obj.command.trim() : "";
  const explanation = typeof obj.explanation === "string" ? obj.explanation.trim() : "";
  const risk = asRiskLevel(obj.risk);
  const needsConfirmation =
    typeof obj.needsConfirmation === "boolean"
      ? obj.needsConfirmation
      : risk !== "low";

  return {
    command,
    explanation,
    risk,
    needsConfirmation,
  };
}

async function requestChatCompletion(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  includeResponseFormat: boolean,
): Promise<string> {
  const payload: Record<string, unknown> = {
    model: OPENAI_MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };

  if (includeResponseFormat) {
    payload.response_format = { type: "json_object" };
  }

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45_000),
  });

  const text = await response.text();
  let json: ChatCompletionResponse | null = null;
  try {
    json = JSON.parse(text) as ChatCompletionResponse;
  } catch {
    // handled below
  }

  if (!response.ok) {
    const errorMessage = json?.error?.message ?? text;
    throw new Error(`OpenAI API error (${response.status}): ${errorMessage}`);
  }

  const content = normalizeContent(json?.choices?.[0]?.message?.content);
  if (!content.trim()) {
    throw new Error("Empty model response");
  }
  return content;
}

async function requestCodexResponses(
  accessToken: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const payload = {
    model: CODEX_MODEL,
    stream: true,
    store: false,
    instructions: systemPrompt,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: userPrompt }],
      },
    ],
  };

  const response = await fetch(`${CODEX_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      Accept: "text/event-stream, application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45_000),
  });

  const text = await response.text();
  let json: ResponsesApiResponse | null = null;
  try {
    json = JSON.parse(text) as ResponsesApiResponse;
  } catch {
    // handled below
  }

  if (!response.ok) {
    const errorMessage = json?.error?.message ?? text;
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Codex auth failed (${response.status}). Run "tcomp setup" and choose "Codex OAuth", then try again.`,
      );
    }
    throw new Error(`Codex API error (${response.status}): ${errorMessage}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const looksLikeSse =
    contentType.includes("text/event-stream") ||
    /(^|\n)\s*event:\s/m.test(text) ||
    /(^|\n)\s*data:\s/m.test(text);
  const content = looksLikeSse
    ? extractTextFromSseStream(text)
    : extractResponsesOutputText(json ?? text);
  if (!content.trim()) {
    throw new Error("Empty Codex response");
  }
  return content;
}

function extractTextFromSseStream(sse: string): string {
  const doneTexts: string[] = [];
  const deltas: string[] = [];
  const fallbackPayloads: unknown[] = [];

  const chunks = sse.split(/\r?\n\r?\n/);
  for (const chunk of chunks) {
    if (!chunk.trim()) {
      continue;
    }

    let eventName = "";
    const dataLines: string[] = [];
    for (const line of chunk.split(/\r?\n/)) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }

    if (dataLines.length === 0) {
      continue;
    }

    const data = dataLines.join("\n");
    if (data === "[DONE]") {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }

    const delta = extractResponsesDeltaText(parsed, eventName);
    if (delta) {
      deltas.push(delta);
    }
    const doneText = extractResponsesDoneText(parsed, eventName);
    if (doneText) {
      doneTexts.push(doneText);
    }
    fallbackPayloads.push(parsed);
  }

  if (doneTexts.length > 0) {
    return doneTexts[doneTexts.length - 1] ?? "";
  }

  if (deltas.length > 0) {
    return deltas.join("");
  }

  for (let i = fallbackPayloads.length - 1; i >= 0; i -= 1) {
    const text = extractResponsesOutputText(fallbackPayloads[i]);
    if (text) {
      return text;
    }
  }

  return "";
}

function extractResponsesDeltaText(input: unknown, eventName: string): string {
  if (!input || typeof input !== "object") {
    return "";
  }

  const obj = input as Record<string, unknown>;
  if (typeof obj.delta === "string") {
    return obj.delta;
  }

  if (typeof obj.text === "string" && eventName.includes("delta")) {
    return obj.text;
  }

  const content = obj.content;
  if (Array.isArray(content)) {
    let combined = "";
    for (const item of content) {
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        if (typeof rec.delta === "string") {
          combined += rec.delta;
        } else if (typeof rec.text === "string" && eventName.includes("delta")) {
          combined += rec.text;
        }
      }
    }
    return combined;
  }

  return "";
}

function extractResponsesDoneText(input: unknown, eventName: string): string {
  if (!input || typeof input !== "object") {
    return "";
  }

  const obj = input as Record<string, unknown>;
  if (eventName === "response.output_text.done" && typeof obj.text === "string") {
    return obj.text;
  }

  if (eventName === "response.content_part.done") {
    const part = obj.part;
    if (part && typeof part === "object") {
      const record = part as Record<string, unknown>;
      if (record.type === "output_text" && typeof record.text === "string") {
        return record.text;
      }
    }
  }

  return "";
}

function extractResponsesOutputText(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (!input || typeof input !== "object") {
    return "";
  }

  const obj = input as ResponsesApiResponse & Record<string, unknown>;

  if (typeof obj.output_text === "string") {
    return obj.output_text;
  }

  if (obj.response && typeof obj.response === "object") {
    const nested = extractResponsesOutputText(obj.response);
    if (nested) {
      return nested;
    }
  }

  if (!Array.isArray(obj.output)) {
    return "";
  }

  const parts: string[] = [];
  for (const item of obj.output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (!Array.isArray(record.content)) {
      continue;
    }
    for (const piece of record.content) {
      if (!piece || typeof piece !== "object") {
        continue;
      }
      const part = piece as Record<string, unknown>;
      if (typeof part.text === "string") {
        parts.push(part.text);
      }
    }
  }
  return parts.join("");
}

function isResponseFormatUnsupported(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const msg = error.message.toLowerCase();
  return msg.includes("response_format") && (msg.includes("unsupported") || msg.includes("unknown"));
}

export async function generateSuggestion(
  request: string,
  context: RuntimeContext,
): Promise<Suggestion> {
  const config = await resolveRuntimeConfig();
  const [systemPrompt, userPrompt] = await Promise.all([
    loadSystemPrompt(),
    Promise.resolve(buildUserPrompt(request, context)),
  ]);

  let raw: string;

  if (config.authMethod === "codex-oauth") {
    raw = await requestCodexResponses(config.accessToken, systemPrompt, userPrompt);
    if (process.env.TCOMP_DEBUG_RAW === "1") {
      console.error("DEBUG raw codex response:");
      console.error(raw);
    }
    return parseSuggestion(raw);
  }

  try {
    raw = await requestChatCompletion(config.apiKey, systemPrompt, userPrompt, true);
  } catch (error) {
    if (!isResponseFormatUnsupported(error)) {
      throw error;
    }
    raw = await requestChatCompletion(config.apiKey, systemPrompt, userPrompt, false);
  }

  return parseSuggestion(raw);
}

export async function generatePromptResponse(
  request: string,
  context: RuntimeContext,
): Promise<string> {
  const config = await resolveRuntimeConfig();
  const userPrompt = `User prompt: ${request}

Runtime context:
- cwd: ${context.cwd}
- shell: ${context.shell}
- platform: ${context.platform}`;

  const raw =
    config.authMethod === "codex-oauth"
      ? await requestCodexResponses(config.accessToken, GENERAL_ASSISTANT_SYSTEM_PROMPT, userPrompt)
      : await requestChatCompletion(config.apiKey, GENERAL_ASSISTANT_SYSTEM_PROMPT, userPrompt, false);

  return raw.trim();
}
