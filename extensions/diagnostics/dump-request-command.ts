import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}` +
    `-${String(d.getMilliseconds()).padStart(3, "0")}`
  );
}

export default function (pi: ExtensionAPI) {
  let armed = false;

  pi.registerCommand("dump-request", {
    description: "Dump the next provider request payload to dump_request_<time>.json",
    handler: async (_args, ctx) => {
      armed = true;
      ctx.ui.notify(
        "Armed: the next provider request payload will be saved to dump_request_<time>.json",
        "info",
      );
    },
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!armed) return;
    armed = false;

    const file = join(ctx.cwd, `dump_request_${timestamp()}.json`);
    writeFileSync(file, `${JSON.stringify(event.payload, null, 2)}\n`, "utf8");
    ctx.ui.notify(`Provider payload dumped to ${file}`, "info");
  });
}
