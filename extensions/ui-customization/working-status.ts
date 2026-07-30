import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { formatStatusDuration } from "./duration";

export function installWorkingStatus(pi: ExtensionAPI) {
  let startedAt: number | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let activeContext: ExtensionContext | undefined;

  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
    startedAt = undefined;
    activeContext?.ui.setWorkingMessage();
    activeContext = undefined;
  }

  function update() {
    if (!activeContext || startedAt === undefined) return;
    const theme = activeContext.ui.theme;
    const elapsed = formatStatusDuration(Date.now() - startedAt);
    activeContext.ui.setWorkingMessage(
      `${theme.fg("accent", "Working...")} ${theme.fg("muted", `(${elapsed})`)}`,
    );
  }

  pi.on("agent_start", (_event, ctx) => {
    stop();
    if (ctx.mode !== "tui") return;
    activeContext = ctx;
    startedAt = Date.now();
    update();
    timer = setInterval(update, 1_000);
  });

  pi.on("agent_end", stop);
  pi.on("session_shutdown", stop);
}
