import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { showCodexUsageDialog } from "./dialog";

export default function codexUsage(pi: ExtensionAPI): void {
  let dialogOpen = false;

  pi.registerCommand("codex-usage", {
    description: "Show OpenAI Codex usage",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("Codex usage is available in TUI mode only.", "warning");
        return;
      }
      if (dialogOpen) return;

      dialogOpen = true;
      try {
        await showCodexUsageDialog(ctx);
      } finally {
        dialogOpen = false;
      }
    },
  });
}
