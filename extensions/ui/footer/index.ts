import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { getCapabilities, hyperlink } from "@earendil-works/pi-tui";
import { columns, formatDirectory, formatTokens } from "./format";
import { getSessionCost } from "./session";
import type { GitInfo } from "./types";

export function installFooter(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  getGitInfo: () => GitInfo,
  getToolsExpanded: () => boolean,
  setRequestRender: (requestRender: () => void) => void,
) {
  if (ctx.mode !== "tui") return;

  ctx.ui.setFooter((tui, theme, footerData: ReadonlyFooterDataProvider) => {
    setRequestRender(() => tui.requestRender());
    return {
      invalidate() {},
      render(width: number) {
        const model = ctx.model;
        const usage = ctx.getContextUsage();
        const contextPercent = usage?.percent == null
          ? "?"
          : `${Math.round(usage.percent)}%`;
        const contextTokens = usage?.tokens == null
          ? "?"
          : formatTokens(usage.tokens);
        const providerAndModel = model
          ? `(${model.provider}) ${model.id} • ${model.reasoning ? pi.getThinkingLevel() : "off"}`
          : "no-model";
        const statsParts = [`${contextTokens} (${contextPercent})`];
        // OAuth-backed providers are treated as subscription plans; metered
        // API-key providers retain the estimated session cost.
        if (model && !ctx.modelRegistry.isUsingOAuth(model)) {
          statsParts.push(`$${getSessionCost(ctx).toFixed(2)}`);
        }
        // Keep this as the final item in the left-side stats block, after cost
        // and immediately before the gap that separates the model details.
        if (getToolsExpanded()) statsParts.push("expanded");
        const stats = statsParts.join(" • ");
        const statuses = Array.from(footerData.getExtensionStatuses().entries())
          .filter(([key]) => key !== "sandbox")
          .sort(([a], [b]) => a.localeCompare(b))
          .flatMap(([, text]) => text.split("\n"))
          .filter(Boolean);
        const statsWithStatuses = statuses.length > 0
          ? `${statuses.join(theme.fg("dim", " • "))}${theme.fg("dim", " • ")}${theme.fg("muted", stats)}`
          : theme.fg("muted", stats);

        const gitInfo = getGitInfo();
        const projectAndBranch = theme.fg(
          "muted",
          `${formatDirectory(ctx.cwd)}${gitInfo.branch ? `:${gitInfo.branch}` : ""}`,
        );
        const gitStatusParts: string[] = [];
        if (gitInfo.changedFiles > 0) {
          const fileLabel = gitInfo.changedFiles === 1 ? "file" : "files";
          gitStatusParts.push(`${gitInfo.changedFiles} ${fileLabel} changed`);
        }
        if (gitInfo.pullRequest) {
          const label = `PR #${gitInfo.pullRequest.number}`;
          gitStatusParts.push(
            getCapabilities().hyperlinks
              ? hyperlink(label, gitInfo.pullRequest.url)
              : label,
          );
        }
        const gitStatus = gitStatusParts.join(" • ");

        return [
          columns(
            projectAndBranch,
            theme.fg("muted", gitStatus),
            width,
          ),
          columns(
            statsWithStatuses,
            theme.fg("muted", providerAndModel),
            width,
          ),
        ];
      },
    };
  });
}
