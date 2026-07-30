import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { installCompactionStatus } from "./compaction-status";
import { installCompactionSummary } from "./compaction-summary";
import { installFooter } from "./footer";
import { refreshGit } from "./git";
import { installMcpStatus } from "./mcp-status";
import { applyPromptEditorStyle } from "./prompt-editor";
import { installResponseStats } from "./response-stats";
import { installSkillInvocationStyle } from "./skill-invocation";
import { installToolIndicators } from "./tool-indicator";
import type { GitInfo } from "./types";
import { emptyGitInfo } from "./types";
import { installWorkingStatus } from "./working-status";

const POLL_INTERVAL_MS = 3_000;

export default function uiCustomization(pi: ExtensionAPI) {
  let currentContext: ExtensionContext | undefined;
  let requestRender: (() => void) | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let generation = 0;
  let refreshRunning = false;
  let gitInfo = emptyGitInfo();
  let mcpConnectedCount = 0;
  let toolsExpanded = false;

  function scheduleRender() {
    requestRender?.();
  }

  installCompactionStatus(pi);
  installCompactionSummary(pi);
  installResponseStats(pi);
  installSkillInvocationStyle(pi);
  installToolIndicators(pi);
  installWorkingStatus(pi);
  installMcpStatus(pi, (connectedCount) => {
    mcpConnectedCount = connectedCount;
    scheduleRender();
  });

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
      () => mcpConnectedCount,
      () => toolsExpanded,
      (nextRequestRender) => {
        requestRender = nextRequestRender;
      },
    );
    if (ctx.mode === "tui") {
      const previousEditorFactory = ctx.ui.getEditorComponent();
      ctx.ui.setEditorComponent((tui, theme, keybindings) => {
        const editor = previousEditorFactory
          ? previousEditorFactory(tui, theme, keybindings)
          : new CustomEditor(tui, theme, keybindings);
        return applyPromptEditorStyle(editor, keybindings, () => {
          toolsExpanded = !toolsExpanded;
          scheduleRender();
        });
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

  pi.on("session_shutdown", (_event, ctx) => {
    generation += 1;
    currentContext = undefined;
    requestRender = undefined;
    refreshRunning = false;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
    if (ctx.mode === "tui") {
      ctx.ui.setEditorComponent(undefined);
      ctx.ui.setFooter(undefined);
    }
  });
}
