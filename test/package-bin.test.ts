import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

describe("package bin metadata", () => {
  test("points both CLI names at a checked-in wrapper", async () => {
    const packageJson = (await Bun.file("./package.json").json()) as {
      bin: Record<string, string>;
    };

    expect(packageJson.bin.tc).toBe("bin/tc.cjs");
    expect(packageJson.bin.compleet).toBe("bin/tc.cjs");
    expect(existsSync(join(process.cwd(), packageJson.bin.tc))).toBe(true);

    const wrapper = await Bun.file(packageJson.bin.tc).text();
    expect(wrapper).toContain('spawnSync("bun"');
    expect(wrapper).toContain('join(__dirname, "..", "src", "cli.ts")');
  });
});
