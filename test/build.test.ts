import { describe, expect, test } from "bun:test";
import {
  parseBuildOptions,
  renderUnixInstallScript,
  renderWindowsInstallScript,
} from "../build";

describe("parseBuildOptions", () => {
  test("supports export bundles and explicit targets", () => {
    const parsed = parseBuildOptions([
      "--debug",
      "--export",
      "--target",
      "bun-darwin-arm64",
    ]);

    expect(parsed).toEqual({
      debug: true,
      exportBundle: true,
      target: "bun-darwin-arm64",
    });
  });

  test("rejects unknown flags", () => {
    expect(() => parseBuildOptions(["--nope"])).toThrow(
      "Unknown build option: --nope"
    );
  });
});

describe("renderUnixInstallScript", () => {
  test("keeps the default target dir shell expansion intact", () => {
    const script = renderUnixInstallScript();

    expect(script).toContain(`TARGET_DIR="\${1:-$HOME/.local/bin}"`);
    expect(script).toContain('mkdir -p "$TARGET_DIR"');
    expect(script).toContain(
      'install -m 755 "$BUNDLE_DIR/tc" "$TARGET_DIR/tc"'
    );
    expect(script).toContain(
      'install -m 755 "$BUNDLE_DIR/compleet" "$TARGET_DIR/compleet"'
    );
  });
});

describe("renderWindowsInstallScript", () => {
  test("defaults to a user bin directory", () => {
    const script = renderWindowsInstallScript();

    expect(script).toContain(
      'if "%TARGET_DIR%"=="" set "TARGET_DIR=%USERPROFILE%\\bin"'
    );
    expect(script).toContain(
      'copy /Y "%~dp0tc.exe" "%TARGET_DIR%\\tc.exe" >nul'
    );
    expect(script).toContain(
      'copy /Y "%~dp0compleet.exe" "%TARGET_DIR%\\compleet.exe" >nul'
    );
  });
});
