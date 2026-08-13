import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function getSessionCost(ctx: ExtensionContext) {
  let cost = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      cost += entry.message.usage.cost.total;
    }
  }
  return cost;
}

// Pi's default FooterComponent computes this inline rather than exporting a
// reusable helper. Mirror that logic against all session entries so this custom
// footer reports the same latest-request cache hit rate.
export function getLatestCacheHitRate(ctx: ExtensionContext) {
  let rate: number | undefined;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;

    const { input, cacheRead, cacheWrite } = entry.message.usage;
    const promptTokens = input + cacheRead + cacheWrite;
    rate = promptTokens > 0 ? (cacheRead / promptTokens) * 100 : undefined;
  }
  return rate;
}
