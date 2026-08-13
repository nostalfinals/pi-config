import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import {
  getCapabilities,
  hyperlink,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { formatTokens, formatWorkspace } from "./format";
import { getLatestCacheHitRate, getSessionCost } from "./session";
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
        const separator = theme.fg("dim", " | ");
        const join = (segments: string[]) => segments.filter(Boolean).join(separator);
        const fits = (left: string, right: string) =>
          visibleWidth(left) + 1 + visibleWidth(right) <= width;
        const alignRight = (left: string, right: string) => {
          const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
          return `${left}${" ".repeat(gap)}${right}`;
        };
        const model = ctx.model;
        const usage = ctx.getContextUsage();
        const contextPercentText = usage?.percent == null
          ? "?"
          : `${Math.round(usage.percent)}%`;
        const contextPercent = usage?.percent == null
          ? theme.fg("muted", contextPercentText)
          : usage.percent >= 90
            ? theme.fg("error", contextPercentText)
            : usage.percent >= 70
              ? theme.fg("warning", contextPercentText)
              : theme.fg("muted", contextPercentText);
        const contextTokens = theme.fg(
          "muted",
          usage?.tokens == null ? "?" : formatTokens(usage.tokens),
        );

        const cost = model && !ctx.modelRegistry.isUsingOAuth(model)
          ? theme.fg("muted", `$${getSessionCost(ctx).toFixed(2)}`)
          : "";
        const contextFull = [
          theme.fg("dim", "ctx"),
          contextPercent,
          theme.fg("dim", "·"),
          contextTokens,
          cost,
        ].filter(Boolean).join(" ");
        const contextCompact = `${theme.fg("dim", "ctx")} ${contextPercent}`;
        const cacheHitRate = getLatestCacheHitRate(ctx);
        const cacheHit = `${theme.fg("dim", "hit")} ${theme.fg(
          "muted",
          cacheHitRate === undefined ? "?" : `${cacheHitRate.toFixed(1)}%`,
        )}`;

        const gitInfo = getGitInfo();
        const workspaceParts = [theme.fg("accent", formatWorkspace(ctx.cwd))];
        if (gitInfo.branch) workspaceParts.push(theme.fg("muted", gitInfo.branch));
        if (gitInfo.changedFiles > 0) {
          workspaceParts.push(theme.fg("warning", `+${gitInfo.changedFiles}`));
        }
        if (gitInfo.pullRequest) {
          const label = `PR#${gitInfo.pullRequest.number}`;
          const linkedLabel = getCapabilities().hyperlinks
            ? hyperlink(label, gitInfo.pullRequest.url)
            : label;
          workspaceParts.push(theme.fg("success", linkedLabel));
        }
        const workspace = workspaceParts.join(" ");
        const workspaceWithoutPr = workspaceParts.slice(
          0,
          gitInfo.pullRequest ? -1 : undefined,
        ).join(" ");

        const statuses = Array.from(footerData.getExtensionStatuses().entries())
          .filter(([key]) => key !== "sandbox")
          .sort(([a], [b]) => a.localeCompare(b))
          .flatMap(([, text]) => text.split("\n"))
          .filter(Boolean);
        const expanded = getToolsExpanded() ? theme.fg("muted", "expanded") : "";
        const modelFull = model
          ? `${theme.fg("muted", `${model.provider}/${model.id}`)} ${theme.fg(
              "dim",
              model.reasoning ? pi.getThinkingLevel() : "off",
            )}`
          : theme.fg("muted", "no-model");
        const modelCompact = theme.fg("muted", model?.id ?? "no-model");

        const candidates = [
          { left: join([workspace, contextFull, cacheHit, ...statuses, expanded]), right: modelFull },
          { left: join([workspaceWithoutPr, contextFull, cacheHit, expanded]), right: modelFull },
          { left: join([workspaceWithoutPr, contextCompact, cacheHit, expanded]), right: modelFull },
          {
            left: join([
              gitInfo.branch ? theme.fg("muted", gitInfo.branch) : workspaceParts[0]!,
              contextPercent,
              cacheHit,
              expanded,
            ]),
            right: modelCompact,
          },
        ];
        const candidate = candidates.find(({ left, right }) => fits(left, right));
        if (candidate) return [alignRight(candidate.left, candidate.right)];

        const fallback = candidates.at(-1)!;
        const rightWidth = Math.min(width, visibleWidth(fallback.right));
        const fittedRight = truncateToWidth(fallback.right, rightWidth, "");
        const leftWidth = Math.max(0, width - visibleWidth(fittedRight) - 1);
        if (leftWidth === 0) return [fittedRight];
        const fittedLeft = truncateToWidth(fallback.left, leftWidth, "");
        return [alignRight(fittedLeft, fittedRight)];
      },
    };
  });
}
