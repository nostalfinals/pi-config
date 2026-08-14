import installPiEnvGuideline from "./pi-env-guideline";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function promptPolicy(pi: ExtensionAPI) {
  installPiEnvGuideline(pi);
}
