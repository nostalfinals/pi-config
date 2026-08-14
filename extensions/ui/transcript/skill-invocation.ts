import {
  SkillInvocationMessageComponent,
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
import { countTextLines, plural } from "./tool-layout";
import { renderToolParameter } from "./tool-parameter";

type SkillInvocationInternals = {
  expanded: boolean;
  skillBlock: {
    name: string;
    content: string;
  };
  markdownTheme: MarkdownTheme;
  paddingX: number;
  paddingY: number;
  clear(): void;
  addChild(component: Component): void;
  setBgFn(bgFn?: (text: string) => string): void;
};

type SkillInvocationPrototype = {
  updateDisplay(this: SkillInvocationMessageComponent): void;
};

class SkillContent implements Component {
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

export function installSkillInvocationStyle(pi: ExtensionAPI) {
  const prototype = SkillInvocationMessageComponent.prototype as unknown as SkillInvocationPrototype;
  const originalUpdateDisplay = prototype.updateDisplay;
  let activeTheme: Theme | undefined;
  let patchInstalled = false;

  function updateStyledSkillInvocation(this: SkillInvocationMessageComponent) {
    if (!activeTheme) {
      originalUpdateDisplay.call(this);
      return;
    }

    const self = this as unknown as SkillInvocationInternals;
    const theme = activeTheme;
    // Pi creates this component as a padded custom-message card. Remove that
    // shell so the skill invocation occupies the same transcript layout as a tool.
    self.paddingX = 0;
    self.paddingY = 0;
    self.setBgFn(undefined);

    const title = theme.fg("toolTitle", theme.bold("skill"));
    const skillName = renderToolParameter(theme, self.skillBlock.name);
    const summary = theme.fg("muted", plural(countTextLines(self.skillBlock.content), "line"));
    const header = ` ${title} ${skillName} ${summary}`;
    self.clear();
    self.addChild(new Text(header, 0, 0));

    if (self.expanded) {
      self.addChild(new SkillContent(self.skillBlock.content, self.markdownTheme, theme));
    }
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    activeTheme = ctx.ui.theme;
    prototype.updateDisplay = updateStyledSkillInvocation;
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
