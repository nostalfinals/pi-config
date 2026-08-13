import installContextCommand from "./context-command";
import installDumpRequestCommand from "./dump-request-command";
import installSystemPromptCommand from "./system-prompt-command";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function diagnostics(pi: ExtensionAPI) {
  installContextCommand(pi);
  installDumpRequestCommand(pi);
  installSystemPromptCommand(pi);
}
