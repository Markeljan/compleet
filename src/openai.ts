import { ensureCodexChatGPTAuth } from "./codex-auth";
import { buildUserPrompt, loadSystemPrompt } from "./prompt";
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
  error?: { message?: string };
  output?: unknown;
  output_text?: unknown;
  response?: ResponsesApiResponse;
}

interface ResolvedOpenAIConfig {
  apiKey: string;
  provider: "openai";
}

interface ResolvedCodexConfig {
  accessToken: string;
  provider: "codex";
}

type ResolvedRuntimeConfig = ResolvedOpenAIConfig | ResolvedCodexConfig;

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENAI_MODEL = "gpt-4o-mini";
const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const CODEX_MODEL = "gpt-5.3-codex";

const GENERAL_ASSISTANT_SYSTEM_PROMPT =
  "You are a concise, helpful assistant. Answer directly in plain text unless asked for another format.";
const CODE_FENCE_START_REGEX = /^```[a-zA-Z0-9_-]*\s*/;
const CODE_FENCE_END_REGEX = /\s*```$/;
const SSE_EVENT_LINE_REGEX = /(^|\n)\s*event:\s/m;
const SSE_DATA_LINE_REGEX = /(^|\n)\s*data:\s/m;
const SSE_CHUNK_SPLIT_REGEX = /\r?\n\r?\n/;
const SSE_LINE_SPLIT_REGEX = /\r?\n/;

export async function resolveRuntimeConfig(): Promise<ResolvedRuntimeConfig> {
  const stored = await loadUserConfig();
  const provider = stored.activeProvider;

  if (provider === "openai") {
    const apiKey = stored.openaiApiKey?.trim();
    if (!apiKey) {
      throw new Error(
        'OpenAI API key is missing. Run "tc config openai" or "tc setup".'
      );
    }

    return {
      provider,
      apiKey,
    };
  }

  if (provider === "codex") {
    const auth = await ensureCodexChatGPTAuth(Boolean(process.stdin.isTTY));
    return {
      provider,
      accessToken: auth.accessToken,
    };
  }

  throw new Error('Setup is required before using tc. Run "tc setup".');
}

function normalizeContent(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string {
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

  const withoutStart = trimmed.replace(CODE_FENCE_START_REGEX, "");
  return withoutStart.replace(CODE_FENCE_END_REGEX, "").trim();
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
  const explanation =
    typeof obj.explanation === "string" ? obj.explanation.trim() : "";
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
  includeResponseFormat: boolean
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
  userPrompt: string
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
        `Codex auth failed (${response.status}). Run "tc config codex" or "tc setup", then try again.`
      );
    }
    throw new Error(`Codex API error (${response.status}): ${errorMessage}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const looksLikeSse =
    contentType.includes("text/event-stream") ||
    SSE_EVENT_LINE_REGEX.test(text) ||
    SSE_DATA_LINE_REGEX.test(text);
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

  for (const chunk of sse.split(SSE_CHUNK_SPLIT_REGEX)) {
    const parsedChunk = parseSseChunk(chunk);
    if (!parsedChunk) {
      continue;
    }

    const { eventName, parsed } = parsedChunk;
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
    return doneTexts.at(-1) ?? "";
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

function parseSseChunk(
  chunk: string
): { eventName: string; parsed: unknown } | null {
  if (!chunk.trim()) {
    return null;
  }

  let eventName = "";
  const dataLines: string[] = [];
  for (const line of chunk.split(SSE_LINE_SPLIT_REGEX)) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  const data = dataLines.join("\n");
  if (data === "[DONE]") {
    return null;
  }

  try {
    return { eventName, parsed: JSON.parse(data) };
  } catch {
    return null;
  }
}

function extractResponsesDeltaText(input: unknown, eventName: string): string {
  const obj = asRecord(input);
  if (!obj) {
    return "";
  }

  if (typeof obj.delta === "string") {
    return obj.delta;
  }

  const isDeltaEvent = eventName.includes("delta");
  if (typeof obj.text === "string" && isDeltaEvent) {
    return obj.text;
  }

  return extractDeltaFromContent(obj.content, isDeltaEvent);
}

function extractDeltaFromContent(
  content: unknown,
  isDeltaEvent: boolean
): string {
  if (!Array.isArray(content)) {
    return "";
  }

  let combined = "";
  for (const item of content) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    if (typeof record.delta === "string") {
      combined += record.delta;
      continue;
    }
    if (typeof record.text === "string" && isDeltaEvent) {
      combined += record.text;
    }
  }
  return combined;
}

function extractResponsesDoneText(input: unknown, eventName: string): string {
  if (!input || typeof input !== "object") {
    return "";
  }

  const obj = input as Record<string, unknown>;
  if (
    eventName === "response.output_text.done" &&
    typeof obj.text === "string"
  ) {
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

  const obj = asRecord(input) as
    | (ResponsesApiResponse & Record<string, unknown>)
    | null;
  if (!obj) {
    return "";
  }

  if (typeof obj.output_text === "string") {
    return obj.output_text;
  }

  if (obj.response && typeof obj.response === "object") {
    const nested = extractResponsesOutputText(obj.response);
    if (nested) {
      return nested;
    }
  }

  return extractOutputTextParts(obj.output);
}

function extractOutputTextParts(output: unknown): string {
  if (!Array.isArray(output)) {
    return "";
  }

  const parts: string[] = [];
  for (const item of output) {
    const record = asRecord(item);
    if (!(record && Array.isArray(record.content))) {
      continue;
    }

    for (const piece of record.content) {
      const part = asRecord(piece);
      if (typeof part?.text === "string") {
        parts.push(part.text);
      }
    }
  }

  return parts.join("");
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  return input as Record<string, unknown>;
}

function isResponseFormatUnsupported(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const msg = error.message.toLowerCase();
  return (
    msg.includes("response_format") &&
    (msg.includes("unsupported") || msg.includes("unknown"))
  );
}

export async function generateSuggestion(
  request: string,
  context: RuntimeContext
): Promise<Suggestion> {
  const config = await resolveRuntimeConfig();
  const [systemPrompt, userPrompt] = await Promise.all([
    loadSystemPrompt(),
    Promise.resolve(buildUserPrompt(request, context)),
  ]);

  let raw: string;

  if (config.provider === "codex") {
    raw = await requestCodexResponses(
      config.accessToken,
      systemPrompt,
      userPrompt
    );
    if (
      process.env.TC_DEBUG_RAW === "1" ||
      process.env.TCOMP_DEBUG_RAW === "1"
    ) {
      console.error("DEBUG raw codex response:");
      console.error(raw);
    }
    return parseSuggestion(raw);
  }

  try {
    raw = await requestChatCompletion(
      config.apiKey,
      systemPrompt,
      userPrompt,
      true
    );
  } catch (error) {
    if (!isResponseFormatUnsupported(error)) {
      throw error;
    }
    raw = await requestChatCompletion(
      config.apiKey,
      systemPrompt,
      userPrompt,
      false
    );
  }

  return parseSuggestion(raw);
}

export async function generatePromptResponse(
  request: string,
  context: RuntimeContext
): Promise<string> {
  const config = await resolveRuntimeConfig();
  const userPrompt = `User prompt: ${request}

Runtime context:
- cwd: ${context.cwd}
- shell: ${context.shell}
- platform: ${context.platform}`;

  const raw =
    config.provider === "codex"
      ? await requestCodexResponses(
          config.accessToken,
          GENERAL_ASSISTANT_SYSTEM_PROMPT,
          userPrompt
        )
      : await requestChatCompletion(
          config.apiKey,
          GENERAL_ASSISTANT_SYSTEM_PROMPT,
          userPrompt,
          false
        );

  return raw.trim();
}
