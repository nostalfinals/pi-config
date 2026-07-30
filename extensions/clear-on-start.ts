import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let cleared = false;

  pi.on("session_start", (event, ctx) => {
    if (
      cleared ||
      event.reason !== "startup" ||
      ctx.mode !== "tui" ||
      !process.stdout.isTTY
    ) {
      return;
    }

    cleared = true;

    // Clear the viewport, move the cursor home, and clear scrollback.
    process.stdout.write("\x1b[2J\x1b[H\x1b[3J");
  });
}
