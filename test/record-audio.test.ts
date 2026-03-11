import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { attachManualStopListener } from "../voice/recordAudio";

class MockStdin extends EventEmitter {
  isRaw = false;
  isTTY = true;
  paused: boolean;
  rawModeCalls: boolean[] = [];

  constructor(paused = false) {
    super();
    this.paused = paused;
  }

  override off(eventName: "data", listener: (chunk: string) => void): this {
    return super.off(eventName, listener);
  }

  override on(eventName: "data", listener: (chunk: string) => void): this {
    return super.on(eventName, listener);
  }

  isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  setEncoding(_encoding: BufferEncoding): void {
    // No-op for tests.
  }

  setRawMode(mode: boolean): void {
    this.isRaw = mode;
    this.rawModeCalls.push(mode);
  }
}

describe("attachManualStopListener", () => {
  test("pauses stdin on cleanup even if it started resumed", () => {
    const stdin = new MockStdin(false);
    const cleanup = attachManualStopListener(
      () => {
        // No-op for tests.
      },
      () => {
        // No-op for tests.
      },
      stdin
    );

    expect(stdin.isPaused()).toBe(false);
    expect(stdin.rawModeCalls).toEqual([true]);

    cleanup?.();

    expect(stdin.isPaused()).toBe(true);
    expect(stdin.rawModeCalls).toEqual([true, false]);
  });
});
