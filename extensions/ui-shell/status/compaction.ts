import {
  keyText,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Loader } from "@earendil-works/pi-tui";
import { formatStatusDuration } from "../shared/duration";

type CompactionLoader = Loader & {
  kind?: string;
  setMessage(message: string): void;
};

type CompactionState = {
  startedAt: number;
  lastElapsed?: string;
};

export function installCompactionStatus(pi: ExtensionAPI) {
  const prototype = Loader.prototype;
  const originalRender = prototype.render;
  const states = new WeakMap<Loader, CompactionState>();
  let activeTheme: Theme | undefined;
  let patchInstalled = false;

  function renderCompactionStatus(this: Loader, width: number) {
    const self = this as CompactionLoader;

    if (self.kind === "compaction" && activeTheme) {
      let state = states.get(this);
      if (!state) {
        state = { startedAt: Date.now() };
        states.set(this, state);
      }

      const elapsed = formatStatusDuration(Date.now() - state.startedAt);
      if (elapsed !== state.lastElapsed) {
        state.lastElapsed = elapsed;
        self.setMessage(
          `${activeTheme.fg("accent", "Compacting...")} ${activeTheme.fg(
            "muted",
            `(${elapsed} • ${keyText("app.interrupt")} to cancel)`,
          )}`,
        );
      }
    }

    return originalRender.call(this, width);
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    activeTheme = ctx.ui.theme;
    prototype.render = renderCompactionStatus;
    patchInstalled = true;
  });

  pi.on("session_shutdown", () => {
    activeTheme = undefined;
    if (patchInstalled) {
      prototype.render = originalRender;
      patchInstalled = false;
    }
  });
}
