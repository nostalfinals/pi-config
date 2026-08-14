import {
  CompactionSummaryMessageComponent,
  keyText,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Markdown,
  Text,
  truncateToWidth,
  type Component,
  type MarkdownTheme,
} from "@earendil-works/pi-tui";

type CompactionSummaryInternals = {
  expanded: boolean;
  message: {
    tokensBefore: number;
    summary: string;
  };
  markdownTheme: MarkdownTheme;
  paddingX: number;
  paddingY: number;
  clear(): void;
  addChild(component: Component): void;
  setBgFn(bgFn?: (text: string) => string): void;
};

type CompactionSummaryPrototype = {
  updateDisplay(this: CompactionSummaryMessageComponent): void;
};

class CompactionContent implements Component {
  private readonly markdown: Markdown;

  constructor(content: string, markdownTheme: MarkdownTheme, private readonly theme: Theme) {
    this.markdown = new Markdown(content, 0, 0, markdownTheme, {
      color: (text) => theme.fg("toolOutput", text),
    });
  }

  render(width: number) {
    const rail = this.theme.fg("muted", "│");
    return this.markdown.render(Math.max(1, width - 3)).map((line) =>
      truncateToWidth(` ${rail} ${line}`, width, ""),
    );
  }

  invalidate() {
    this.markdown.invalidate();
  }
}

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
    // Match tool and skill transcript rows instead of rendering a custom-message card.
    self.paddingX = 0;
    self.paddingY = 0;
    self.setBgFn(undefined);

    const tokenStr = self.message.tokensBefore.toLocaleString();
    const title = theme.fg("toolTitle", theme.bold("compaction"));
    const details = theme.fg("muted", `${tokenStr} tokens`);
    const hint = theme.fg(
      "muted",
      ` (${keyText("app.tools.expand")} to expand)`,
    );
    self.clear();

    if (self.expanded) {
      self.addChild(new Text(` ${title} ${details}`, 0, 0));
      self.addChild(new CompactionContent(self.message.summary, self.markdownTheme, theme));
      return;
    }

    self.addChild(new Text(` ${title} ${details}${hint}`, 0, 0));
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
