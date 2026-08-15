import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_GUIDELINE = "Inspect PI_* environment variables for current model and session details.";
const REPLACEMENT_GUIDELINE =
	"Inspect PI_* environment variables when you specifically need the current model, provider, reasoning level, or session details to fulfill the user's request.";

export default function promptPolicy(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		const systemPrompt = event.systemPrompt.replace(DEFAULT_GUIDELINE, REPLACEMENT_GUIDELINE);
		return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
	});
}
