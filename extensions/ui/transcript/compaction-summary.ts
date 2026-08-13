import {
  CompactionSummaryMessageComponent,
  keyText,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Spacer, Text, type MarkdownTheme } from "@earendil-works/pi-tui";

type CompactionSummaryInternals = {
  expanded: boolean;
  message: {
    tokensBefore: number;
    summary: string;
  };
  markdownTheme: MarkdownTheme;
  clear(): void;
  addChild(component: Text | Spacer | Markdown): void;
};

type CompactionSummaryPrototype = {
  updateDisplay(this: CompactionSummaryMessageComponent): void;
};

export function installCompactionSummary(pi: ExtensionAPI) {
  const prototype = CompactionSummaryMessageComponent.prototype as unknown as CompactionSummaryPrototype;
  const originalUpdateDisplay = prototype.updateDisplay;
  let activeTheme: Theme | undefined;
  let patchInstalled = false;

  function updateCompactionSummary(this: CompactionSummaryMessageComponent) {
    if (!activeTheme) {
      originalUpdateDisplay.call(this);
      return;
    }

    const self = this as unknown as CompactionSummaryInternals;
    const theme = activeTheme;
    self.clear();

    const tokenStr = self.message.tokensBefore.toLocaleString();
    self.addChild(
      new Text(
        theme.bold(theme.fg("customMessageLabel", "Compaction")),
        0,
        0,
      ),
    );
    self.addChild(new Spacer(1));

    if (self.expanded) {
      const header = `**Compacted from ${tokenStr} tokens**\n\n`;
      self.addChild(
        new Markdown(header + self.message.summary, 0, 0, self.markdownTheme, {
          color: (text) => theme.fg("customMessageText", text),
        }),
      );
      return;
    }

    self.addChild(
      new Text(
        theme.fg("customMessageText", `Compacted from ${tokenStr} tokens `) +
          theme.fg(
            "muted",
            `(${keyText("app.tools.expand")} to expand)`,
          ),
        0,
        0,
      ),
    );
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    activeTheme = ctx.ui.theme;
    prototype.updateDisplay = updateCompactionSummary;
    patchInstalled = true;
  });

  pi.on("session_shutdown", () => {
    activeTheme = undefined;
    if (patchInstalled) {
      prototype.updateDisplay = originalUpdateDisplay;
      patchInstalled = false;
    }
  });
}
