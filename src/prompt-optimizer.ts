import { generatePromptResponse } from "./openai";
import type { RuntimeContext } from "./types";

export type PromptMode = "code" | "question" | "research" | "task";

const MODE_PREFIX_REGEX = /^\s*(code|question|research|task)\b[\s:,-]*/i;

export function detectPromptMode(input: string): PromptMode {
  const match = input.match(MODE_PREFIX_REGEX);
  if (!match) {
    return "task";
  }

  const mode = match[1]?.toLowerCase();
  if (
    mode === "code" ||
    mode === "question" ||
    mode === "research" ||
    mode === "task"
  ) {
    return mode;
  }

  return "task";
}

export function stripPromptModePrefix(input: string): string {
  return input.replace(MODE_PREFIX_REGEX, "").trim();
}

export function buildPromptOptimizationRequest(input: string): string {
  const mode = detectPromptMode(input);
  const normalizedInput = stripPromptModePrefix(input) || input.trim();
  const primaryLabel = mode === "question" ? "Question" : "Task";

  return [
    `Rewrite the rough developer input below into a polished ${mode} prompt for an AI agent.`,
    "Keep the output concise, concrete, and ready to paste into another AI tool.",
    "Do not mention transcription, speaking, or that this came from voice input.",
    "Use exactly this markdown structure:",
    `${primaryLabel}: <one sentence>`,
    "",
    "Requirements:",
    "- <bullet>",
    "- <bullet>",
    "",
    "Output:",
    "- <bullet>",
    "",
    buildModeGuidance(mode),
    `Raw input: ${JSON.stringify(normalizedInput)}`,
  ].join("\n");
}

export async function optimizePrompt(
  input: string,
  context: RuntimeContext
): Promise<string> {
  const request = buildPromptOptimizationRequest(input);
  return await generatePromptResponse(request, context);
}

function buildModeGuidance(mode: PromptMode): string {
  switch (mode) {
    case "code":
      return [
        "Focus on implementation details, technical constraints, tooling, and verification steps.",
        "Preserve mentioned runtimes, frameworks, languages, and compatibility constraints.",
      ].join(" ");
    case "research":
      return [
        "Frame the work as investigation and comparison, with clear questions to answer and sources to consult.",
        "Emphasize decision criteria, tradeoffs, and a concise summary deliverable.",
      ].join(" ");
    case "question":
      return [
        "Frame the request as something the agent should answer clearly, with supporting context and the expected depth.",
        "Requirements should capture what the answer must cover.",
      ].join(" ");
    case "task":
      return [
        "Frame the work as a general task with explicit requirements, constraints, and a concrete deliverable.",
      ].join(" ");
    default:
      return exhaustiveMode(mode);
  }
}

function exhaustiveMode(value: never): never {
  throw new Error(`Unsupported prompt mode: ${value}`);
}
