import {
  keyText,
  SkillInvocationMessageComponent,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Spacer, Text, type MarkdownTheme } from "@earendil-works/pi-tui";
import { renderToolParameter } from "./tool-parameter";

type SkillInvocationInternals = {
  expanded: boolean;
  skillBlock: {
    name: string;
    content: string;
  };
  markdownTheme: MarkdownTheme;
  clear(): void;
  addChild(component: Text | Spacer | Markdown): void;
};

type SkillInvocationPrototype = {
  updateDisplay(this: SkillInvocationMessageComponent): void;
};

export function installSkillInvocationStyle(pi: ExtensionAPI) {
  const prototype = SkillInvocationMessageComponent.prototype as unknown as SkillInvocationPrototype;
  const originalUpdateDisplay = prototype.updateDisplay;
  let activeTheme: Theme | undefined;
  let patchInstalled = true;

  prototype.updateDisplay = function updateStyledSkillInvocation() {
    if (!activeTheme) {
      originalUpdateDisplay.call(this);
      return;
    }

    const self = this as unknown as SkillInvocationInternals;
    const theme = activeTheme;
    const title = theme.fg("toolTitle", theme.bold("skill"));
    const skillName = renderToolParameter(theme, self.skillBlock.name);
    self.clear();

    if (self.expanded) {
      self.addChild(new Text(`${title} ${skillName}`, 0, 0));
      self.addChild(new Spacer(1));
      self.addChild(
        new Markdown(self.skillBlock.content, 0, 0, self.markdownTheme, {
          color: (text) => theme.fg("customMessageText", text),
        }),
      );
      return;
    }

    self.addChild(
      new Text(
        `${title} ${skillName}${theme.fg(
          "muted",
          ` (${keyText("app.tools.expand")} to expand)`,
        )}`,
        0,
        0,
      ),
    );
  };

  pi.on("session_start", (_event, ctx) => {
    activeTheme = ctx.ui.theme;
  });

  pi.on("session_shutdown", () => {
    activeTheme = undefined;
    if (patchInstalled) {
      prototype.updateDisplay = originalUpdateDisplay;
      patchInstalled = false;
    }
  });
}
