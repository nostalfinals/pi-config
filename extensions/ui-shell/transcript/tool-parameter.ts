import { readFileSync, statSync } from "node:fs";
import type { Theme } from "@earendil-works/pi-coding-agent";

type ColorValue = string | number;
type ToolParameterCache = {
  sourcePath: string;
  mtimeMs: number;
  value?: ColorValue;
};

let toolParameterCache: ToolParameterCache | undefined;

function resolveToolParameter(theme: Theme): ColorValue | undefined {
  const sourcePath = theme.sourcePath;
  if (!sourcePath) return undefined;

  try {
    const mtimeMs = statSync(sourcePath).mtimeMs;
    if (
      toolParameterCache?.sourcePath === sourcePath &&
      toolParameterCache.mtimeMs === mtimeMs
    ) {
      return toolParameterCache.value;
    }

    const config = JSON.parse(readFileSync(sourcePath, "utf8")) as {
      vars?: Record<string, ColorValue>;
    };
    const vars = config.vars ?? {};
    let value = vars.toolParameter;
    const visited = new Set<string>();

    while (
      typeof value === "string" &&
      value !== "" &&
      !value.startsWith("#")
    ) {
      if (visited.has(value) || !(value in vars)) {
        value = undefined;
        break;
      }
      visited.add(value);
      value = vars[value];
    }

    if (
      typeof value === "number" &&
      (!Number.isInteger(value) || value < 0 || value > 255)
    ) {
      value = undefined;
    }
    if (
      typeof value === "string" &&
      value !== "" &&
      !/^#[0-9a-f]{6}$/iu.test(value)
    ) {
      value = undefined;
    }

    toolParameterCache = { sourcePath, mtimeMs, value };
    return value;
  } catch {
    return undefined;
  }
}

function hexTo256(red: number, green: number, blue: number) {
  const cubeIndex = (value: number) =>
    value < 48 ? 0 : value < 115 ? 1 : Math.min(5, Math.round((value - 35) / 40));
  return 16 + 36 * cubeIndex(red) + 6 * cubeIndex(green) + cubeIndex(blue);
}

export function renderToolParameter(theme: Theme, text: string) {
  const value = resolveToolParameter(theme);
  if (value === undefined) return theme.fg("muted", text);
  if (value === "") return `\x1b[39m${text}\x1b[39m`;
  if (typeof value === "number") {
    return `\x1b[38;5;${value}m${text}\x1b[39m`;
  }

  const red = Number.parseInt(value.slice(1, 3), 16);
  const green = Number.parseInt(value.slice(3, 5), 16);
  const blue = Number.parseInt(value.slice(5, 7), 16);
  const color = theme.getColorMode() === "truecolor"
    ? `\x1b[38;2;${red};${green};${blue}m`
    : `\x1b[38;5;${hexTo256(red, green, blue)}m`;
  return `${color}${text}\x1b[39m`;
}
