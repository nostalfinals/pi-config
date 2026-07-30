import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const PATCH_MARK = Symbol.for("ui-customization.mcp-status");

type McpStatusController = {
  connectedCount: number;
  onChange?: (connectedCount: number) => void;
};

function parseConnectedCount(value: string | undefined) {
  if (value === undefined) return 0;

  // pi-mcp-adapter 2.15 reports "N servers enabled (M connected)";
  // preserve support for its previous "M/N servers" format.
  const match = value.match(/MCP:\s*(\d+)\s*\/\s*\d+\s+servers?\b/i)
    ?? value.match(/MCP:\s*\d+\s+servers?\s+enabled\s*\((\d+)\s+connected\)/i);
  return match ? Number.parseInt(match[1]!, 10) : undefined;
}

export function installMcpStatus(
  pi: ExtensionAPI,
  onChange: (connectedCount: number) => void,
) {
  pi.on("session_start", (_event, ctx) => {
    const ui = ctx.ui;
    const patchableUi = ui as typeof ui & Record<symbol, unknown>;
    let controller = patchableUi[PATCH_MARK] as McpStatusController | undefined;

    if (!controller) {
      const originalSetStatus = ui.setStatus.bind(ui);
      controller = { connectedCount: 0 };
      patchableUi[PATCH_MARK] = controller;

      ui.setStatus = (key, value) => {
        if (key !== "mcp") {
          originalSetStatus(key, value);
          return;
        }

        const connectedCount = parseConnectedCount(value);
        if (
          connectedCount !== undefined
          && connectedCount !== controller!.connectedCount
        ) {
          controller!.connectedCount = connectedCount;
          controller!.onChange?.(connectedCount);
        }
        originalSetStatus(key, undefined);
      };
    }

    controller.connectedCount = 0;
    controller.onChange = onChange;
    onChange(0);

    // Clear a status that pi-mcp-adapter may have added before this handler ran.
    ui.setStatus("mcp", undefined);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    const patchableUi = ctx.ui as ExtensionContext["ui"] & Record<symbol, unknown>;
    const controller = patchableUi[PATCH_MARK] as McpStatusController | undefined;
    if (controller?.onChange === onChange) controller.onChange = undefined;
  });
}
