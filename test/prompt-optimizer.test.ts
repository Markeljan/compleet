import { describe, expect, test } from "bun:test";
import {
  buildPromptOptimizationRequest,
  detectPromptMode,
  stripPromptModePrefix,
} from "../src/prompt-optimizer";

describe("detectPromptMode", () => {
  test("detects leading code keyword", () => {
    expect(detectPromptMode("code optimize docker image")).toBe("code");
  });

  test("defaults to task when no keyword is present", () => {
    expect(detectPromptMode("optimize docker image")).toBe("task");
  });
});

describe("stripPromptModePrefix", () => {
  test("removes leading prompt mode keyword", () => {
    expect(stripPromptModePrefix("research compare bun and node")).toBe(
      "compare bun and node"
    );
  });
});

describe("buildPromptOptimizationRequest", () => {
  test("uses code-focused guidance for code mode", () => {
    const request = buildPromptOptimizationRequest(
      "code optimize docker container and switch node to bun"
    );
    expect(request).toContain("polished code prompt");
    expect(request).toContain("Task: <one sentence>");
    expect(request).toContain(
      "Focus on implementation details, technical constraints, tooling, and verification steps."
    );
    expect(request).toContain(
      JSON.stringify("optimize docker container and switch node to bun")
    );
  });

  test("uses question label for question mode", () => {
    const request = buildPromptOptimizationRequest(
      "question when should i use bun in production"
    );
    expect(request).toContain("Question: <one sentence>");
    expect(request).toContain("Requirements:");
    expect(request).toContain("Output:");
  });
});
