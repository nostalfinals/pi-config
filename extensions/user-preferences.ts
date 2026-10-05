/**
 * User Preferences Extension
 *
 * Loads USER_PREFERENCES.md from the Pi agent directory (PI_CODING_AGENT_DIR,
 * default ~/.pi/agent) into the <user_preferences> system prompt section.
 *
 * The file is loaded once when the extension loads (Pi startup or /reload).
 * If it already wraps its content in <user_preferences>...</user_preferences>,
 * that outer wrapper is stripped because the section API adds the tags itself.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";

const SECTION = "user_preferences";
const FILE = "USER_PREFERENCES.md";

function readPreferences(): string {
	let content: string;
	try {
		content = fs.readFileSync(path.join(getAgentDir(), FILE), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
		throw error;
	}

	const wrapped = content.match(
		/^\s*<user_preferences>\s*\n?([\s\S]*?)\n?\s*<\/user_preferences>\s*$/,
	);
	return (wrapped ? wrapped[1] : content).trim();
}

export default function userPreferences(pi: ExtensionAPI) {
	const content = readPreferences();

	pi.on("before_agent_start", (event) => {
		if (content) {
			event.systemPromptOptions.sections[SECTION] = content;
		} else {
			delete event.systemPromptOptions.sections[SECTION];
		}
	});
}
