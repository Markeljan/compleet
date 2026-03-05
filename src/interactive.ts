import { createInterface, emitKeypressEvents, type Key } from "node:readline";

export function canPromptInteractively(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

export async function askLine(prompt: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: canPromptInteractively(),
  });

  try {
    return await new Promise<string>((resolve) => {
      rl.question(prompt, resolve);
    });
  } finally {
    rl.close();
  }
}

export async function askChoice(
  prompt: string,
  options: string[],
  defaultValue?: string
): Promise<string> {
  const normalized = new Set(options);
  const suffix = defaultValue ? ` [${defaultValue}]` : "";

  while (true) {
    const raw = (await askLine(`${prompt}${suffix}: `)).trim();
    const value = raw || defaultValue || "";
    if (normalized.has(value)) {
      return value;
    }
    console.error(`Please choose one of: ${options.join(", ")}`);
  }
}

export async function confirm(
  prompt: string,
  defaultYes = true
): Promise<boolean> {
  const suffix = defaultYes ? " [Y/n]" : " [y/N]";
  const raw = (await askLine(`${prompt}${suffix}: `)).trim().toLowerCase();
  if (!raw) {
    return defaultYes;
  }
  return raw === "y" || raw === "yes";
}

export interface SelectOption<T = string> {
  label: string;
  value: T;
}

export async function selectWithArrows<T>(
  prompt: string,
  options: SelectOption<T>[],
  defaultIndex = 0
): Promise<T> {
  if (options.length === 0) {
    throw new Error("selectWithArrows requires at least one option");
  }

  if (
    !canPromptInteractively() ||
    typeof process.stdin.setRawMode !== "function"
  ) {
    const labels = options.map((option) => option.label);
    const defaultLabel =
      options[Math.max(0, Math.min(defaultIndex, options.length - 1))]?.label;
    const selected = await askChoice(prompt, labels, defaultLabel);
    const matched =
      options.find((option) => option.label === selected) ?? options[0];
    return matched.value;
  }

  const stdin = process.stdin;
  const stdout = process.stdout;
  const initialIndex = Math.max(0, Math.min(defaultIndex, options.length - 1));

  emitKeypressEvents(stdin);

  return await new Promise<T>((resolve, reject) => {
    let index = initialIndex;
    let linesRendered = 0;
    const wasRaw = stdin.isRaw;

    const cleanup = () => {
      stdin.off("keypress", onKeyPress);
      if (typeof stdin.setRawMode === "function") {
        stdin.setRawMode(Boolean(wasRaw));
      }
      if (!stdin.isPaused()) {
        stdin.pause();
      }
      stdout.write("\x1b[?25h");
    };

    const clearRender = () => {
      if (linesRendered === 0) {
        return;
      }
      stdout.write(`\x1b[${linesRendered}A`);
      for (let i = 0; i < linesRendered; i += 1) {
        stdout.write("\x1b[2K");
        stdout.write("\x1b[1B");
      }
      stdout.write(`\x1b[${linesRendered}A`);
      linesRendered = 0;
    };

    const render = () => {
      clearRender();
      stdout.write(`${prompt}\n`);
      for (let i = 0; i < options.length; i += 1) {
        const marker = i === index ? "❯" : " ";
        stdout.write(`${marker} ${options[i]?.label ?? ""}\n`);
      }
      linesRendered = options.length + 1;
    };

    const done = (value: T) => {
      clearRender();
      stdout.write(
        `${prompt} ${String(
          options.find((option) => option.value === value)?.label ?? ""
        )}\n`
      );
      cleanup();
      resolve(value);
    };

    const onKeyPress = (_: string, key: Key) => {
      if (key.name === "up") {
        index = (index - 1 + options.length) % options.length;
        render();
        return;
      }
      if (key.name === "down") {
        index = (index + 1) % options.length;
        render();
        return;
      }
      if (key.name === "return") {
        done(options[index]?.value as T);
        return;
      }
      if (key.ctrl && key.name === "c") {
        clearRender();
        cleanup();
        reject(new Error("Selection cancelled"));
      }
    };

    stdout.write("\x1b[?25l");
    stdin.on("keypress", onKeyPress);
    if (typeof stdin.setRawMode === "function") {
      stdin.setRawMode(true);
    }
    stdin.resume();
    render();
  });
}
