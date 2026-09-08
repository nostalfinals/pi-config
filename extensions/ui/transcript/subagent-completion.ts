import {
  CustomMessageComponent,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { stripAnsi } from "./tool-layout";

type CustomMessageInternals = {
  message: { customType: string };
  customComponent?: Component;
  children: Component[];
  removeChild(component: Component): void;
};

type CompletionCard = Component & {
  children: Component[];
  paddingX: number;
  paddingY: number;
  setBgFn(bgFn?: (text: string) => string): void;
};

type CompletionText = Component & {
  text: string;
  setText(text: string): void;
};

type CustomMessagePrototype = {
  rebuild(this: CustomMessageComponent): void;
};

/** Render cooperate completion notices as ordinary transcript rows, not cards. */
export function installSubagentCompletionStyle(pi: ExtensionAPI) {
  const prototype = CustomMessageComponent.prototype as unknown as CustomMessagePrototype;
  const originalRebuild = prototype.rebuild;
  let patchInstalled = false;

  function rebuildSubagentCompletion(this: CustomMessageComponent) {
    originalRebuild.call(this);

    const self = this as unknown as CustomMessageInternals;
    if (self.message.customType !== "subagent" || !self.customComponent) return;

    for (const child of [...self.children]) {
      if (child !== self.customComponent) self.removeChild(child);
    }

    const card = self.customComponent as CompletionCard;
    const text = card.children[0] as CompletionText | undefined;
    const lines = text?.text.split("\n");
    if (text && lines && /^\([^)]*\)$/u.test(stripAnsi(lines[lines.length - 1] ?? "").trim())) {
      lines.pop();
      if (lines[lines.length - 1] === "") lines.pop();
      text.setText(lines.join("\n"));
    }

    card.paddingX = 1;
    card.paddingY = 0;
    card.setBgFn(undefined);
    card.invalidate?.();
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    prototype.rebuild = rebuildSubagentCompletion;
    patchInstalled = true;
  });

  pi.on("session_shutdown", () => {
    if (patchInstalled) {
      prototype.rebuild = originalRebuild;
      patchInstalled = false;
    }
  });
}
