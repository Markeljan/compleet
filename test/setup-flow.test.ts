import { describe, expect, test } from "bun:test";
import { buildProviderSelectionOptions } from "../src/setup-flow";

describe("buildProviderSelectionOptions", () => {
  test("puts skip first when an existing provider is already configured", () => {
    const result = buildProviderSelectionOptions("codex", "codex");

    expect(result.defaultIndex).toBe(0);
    expect(result.options[0]?.label).toBe(
      "Skip provider setup and keep codex (Recommended)"
    );
    expect(result.options[1]?.value).toBe("codex");
    expect(result.options[2]?.value).toBe("openai");
  });

  test("keeps the normal provider order when nothing is configured", () => {
    const result = buildProviderSelectionOptions("openai", null);

    expect(result.defaultIndex).toBe(1);
    expect(result.options.map((option) => option.value)).toEqual([
      "codex",
      "openai",
    ]);
  });
});
