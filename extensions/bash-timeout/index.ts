import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isBashToolResult, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { CONFIG_PATH, loadConfig, type BashTimeoutConfig } from "./config";

const TIMEOUT_MESSAGE_PATTERN = /Command timed out after/i;
const ORIGINAL_TIMEOUT_DESCRIPTION = "Timeout in seconds (optional, no default timeout)";

export default function bashTimeout(pi: ExtensionAPI): void {
  const config: BashTimeoutConfig = loadConfig();

  const defaultedCalls = new Set<string>();

  pi.on("session_start", async (_event, ctx) => {
    const bash = pi.getAllTools().find((t) => t.name === "bash");
    const timeoutParam = (bash?.parameters as { properties?: Record<string, { description?: string }> } | undefined)
      ?.properties?.timeout;
    if (timeoutParam) {
      timeoutParam.description =
        config.defaultTimeoutSeconds === undefined
          ? ORIGINAL_TIMEOUT_DESCRIPTION
          : `Timeout in seconds (optional, default ${config.defaultTimeoutSeconds}s${config.maxTimeoutSeconds !== undefined ? `, max ${config.maxTimeoutSeconds}s` : ""})`;
    }

    if (config.errors.length > 0) {
      ctx.ui.notify(
        `Invalid bash-timeout config (${CONFIG_PATH}):\n${config.errors.join("\n")}`,
        "error",
      );
    }
  });

  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return;

    const { timeout } = event.input;

    if (timeout !== undefined && config.maxTimeoutSeconds !== undefined && timeout > config.maxTimeoutSeconds) {
      return {
        block: true,
        reason: `Timeout of ${timeout}s exceeds the maximum of ${config.maxTimeoutSeconds}s.`,
      };
    }

    if (timeout === undefined && config.defaultTimeoutSeconds !== undefined) {
      const effective =
        config.maxTimeoutSeconds !== undefined && config.defaultTimeoutSeconds > config.maxTimeoutSeconds
          ? config.maxTimeoutSeconds
          : config.defaultTimeoutSeconds;
      event.input.timeout = effective;
      defaultedCalls.add(event.toolCallId);
    }
  });

  pi.on("tool_result", (event) => {
    if (!isBashToolResult(event)) return;
    if (!defaultedCalls.delete(event.toolCallId)) return;

    const text = event.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    if (!TIMEOUT_MESSAGE_PATTERN.test(text)) return;

    const seconds = typeof event.input.timeout === "number" ? event.input.timeout : config.defaultTimeoutSeconds;
    return {
      content: [
        ...event.content,
        { type: "text", text: `\nBash tool will use a ${seconds}s default timeout when no timeout is explicitly specified` },
      ],
    };
  });

  pi.on("tool_execution_end", (event) => {
    defaultedCalls.delete(event.toolCallId);
  });
}
