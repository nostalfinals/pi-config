import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { applyConfirmInterrupt, type ConfirmInterruptController } from "./editor/confirm-interrupt";
import { applyEditorInputInterceptors } from "./editor/input-interceptors";
import { applyPromptEditorStyle } from "./editor/prompt-style";
import { installFooter } from "./footer";
import { refreshGit } from "./footer/git";
import type { GitInfo } from "./footer/types";
import { emptyGitInfo } from "./footer/types";
import { installCompactionStatus } from "./status/compaction";
import { installWorkingStatus } from "./status/working";
import { installCompactionSummary } from "./transcript/compaction-summary";
import { installContext7OutputCollapse } from "./transcript/context7-output";
import { installResponseStats } from "./transcript/response-stats";
import { installSkillInvocationStyle } from "./transcript/skill-invocation";
import { installToolIndicators } from "./transcript/tool-indicator";

const POLL_INTERVAL_MS = 3_000;

export default function uiShell(pi: ExtensionAPI) {
  let currentContext: ExtensionContext | undefined;
  let requestRender: (() => void) | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let generation = 0;
  let refreshRunning = false;
  let gitInfo = emptyGitInfo();
  let toolsExpanded = false;
  let compactionActive = false;
  let interruptController: ConfirmInterruptController<CustomEditor> | undefined;

  function scheduleRender() {
    requestRender?.();
  }

  function finishCompaction() {
    compactionActive = false;
    interruptController?.clear();
  }

  installCompactionStatus(pi);
  installCompactionSummary(pi);
  installContext7OutputCollapse(pi);
  installResponseStats(pi);
  installSkillInvocationStyle(pi);
  installToolIndicators(pi);
  installWorkingStatus(pi);

  async function refreshGitState(ctx: ExtensionContext, force = false) {
    if (refreshRunning && !force) return;
    refreshRunning = true;
    const refreshGeneration = generation;
    try {
      await refreshGit({
        ctx,
        force,
        generation: refreshGeneration,
        getGeneration: () => generation,
        getGitInfo: () => gitInfo,
        setGitInfo: (nextGitInfo: GitInfo) => {
          gitInfo = nextGitInfo;
        },
        requestRender: scheduleRender,
      });
    } finally {
      refreshRunning = false;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    generation += 1;
    currentContext = ctx;
    gitInfo = emptyGitInfo();
    installFooter(
      pi,
      ctx,
      () => gitInfo,
      () => toolsExpanded,
      (nextRequestRender) => {
        requestRender = nextRequestRender;
      },
    );

    if (ctx.mode === "tui") {
      const previousEditorFactory = ctx.ui.getEditorComponent();
      ctx.ui.setEditorComponent((tui, theme, keybindings) => {
        const baseEditor = previousEditorFactory
          ? previousEditorFactory(tui, theme, keybindings)
          : new CustomEditor(tui, theme, keybindings);
        const styledEditor = applyPromptEditorStyle(baseEditor, keybindings, () => {
          toolsExpanded = !toolsExpanded;
          scheduleRender();
        });
        interruptController = applyConfirmInterrupt(
          styledEditor,
          keybindings,
          ctx,
          () => compactionActive,
          () => tui.requestRender(),
        );
        return applyEditorInputInterceptors(interruptController.editor);
      });
    }

    void refreshGitState(ctx, true);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (currentContext) void refreshGitState(currentContext);
    }, POLL_INTERVAL_MS);
  });

  pi.on("model_select", () => scheduleRender());
  pi.on("thinking_level_select", () => scheduleRender());
  pi.on("turn_end", () => scheduleRender());
  pi.on("input", (_event, ctx) => {
    void refreshGitState(ctx);
    return { action: "continue" };
  });
  pi.on("tool_execution_end", (_event, ctx) => void refreshGitState(ctx));
  pi.on("session_before_compact", (event) => {
    compactionActive = true;
    event.signal.addEventListener("abort", finishCompaction, { once: true });
  });
  pi.on("session_compact", finishCompaction);
  pi.on("agent_settled", () => {
    if (!compactionActive) interruptController?.clear();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    generation += 1;
    currentContext = undefined;
    requestRender = undefined;
    refreshRunning = false;
    compactionActive = false;
    interruptController?.clear(false);
    interruptController = undefined;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
    if (ctx.mode === "tui") {
      ctx.ui.setEditorComponent(undefined);
      ctx.ui.setFooter(undefined);
    }
  });
}
