/**
 * /system-prompt — audit the system prompt pi currently sends to the model.
 *
 * Opens a scrollable viewer with stats and prompt sources.
 * In the viewer: ↑/↓/j/k scroll, PgUp/PgDn page, Home/End jump, Esc/q close.
 */
import {
	DynamicBorder,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";

function estimateTokens(text: string): number {
	return Math.max(0, Math.ceil([...text].length / 4));
}

function buildSourceLines(ctx: ExtensionCommandContext): string[] {
	const options = ctx.getSystemPromptOptions();
	const lines: string[] = [];

	lines.push(
		`custom prompt: ${options.customPrompt ? "yes (replaces default)" : "no"}`,
	);
	if (options.appendSystemPrompt) {
		lines.push(
			`appended prompt: ${options.appendSystemPrompt.length} chars (--append-system-prompt)`,
		);
	}

	const contextFiles = options.contextFiles ?? [];
	lines.push(
		contextFiles.length > 0
			? `context files (${contextFiles.length}): ${contextFiles.map((f) => f.path).join(", ")}`
			: "context files: none",
	);

	const guidelines = options.promptGuidelines ?? [];
	lines.push(`custom guidelines: ${guidelines.length}`);

	return lines;
}

/** Word-wrap text to `width`, breaking long words if needed. */
function wrapLine(line: string, width: number): string[] {
	if (line.length <= width) return [line];
	const out: string[] = [];
	let rest = line;
	while (rest.length > width) {
		let cut = rest.lastIndexOf(" ", width);
		if (cut <= 0) cut = width; // no good break point: hard split
		out.push(rest.slice(0, cut));
		rest = rest.slice(cut).replace(/^ /, "");
	}
	if (rest.length > 0) out.push(rest);
	return out;
}

interface VisualLine {
	/** Original prompt line number (1-based), undefined for continuation rows. */
	lineNo?: number;
	text: string;
}

class PromptViewer {
	private scrollOffset = 0;
	private readonly rawLines: string[];
	private wrapCache: { width: number; lines: VisualLine[] } | undefined;

	constructor(
		private readonly theme: Theme,
		prompt: string,
		private readonly headerLines: string[],
		private readonly done: () => void,
	) {
		this.rawLines = prompt.split("\n");
	}

	private getVisualLines(width: number): VisualLine[] {
		if (this.wrapCache?.width === width) return this.wrapCache.lines;
		const lines: VisualLine[] = [];
		this.rawLines.forEach((raw, index) => {
			const wrapped = wrapLine(raw, width);
			wrapped.forEach((text, part) => {
				lines.push({ lineNo: part === 0 ? index + 1 : undefined, text });
			});
		});
		this.wrapCache = { width, lines };
		return lines;
	}

	private pageSize(): number {
		// Reserve rows for borders, title, header, footer, editor and status bar.
		const rows = process.stdout.rows ?? 40;
		return Math.max(10, rows - this.headerLines.length - 14);
	}

	private maxOffset(): number {
		const width = this.wrapCache?.width ?? 80;
		return Math.max(0, this.getVisualLines(width).length - this.pageSize());
	}

	handleInput(data: string): void {
		if (
			matchesKey(data, "escape") ||
			matchesKey(data, "ctrl+c") ||
			data === "q"
		) {
			this.done();
			return;
		}
		const max = this.maxOffset();
		const page = this.pageSize();
		if (matchesKey(data, "up") || data === "k") {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
		} else if (matchesKey(data, "down") || data === "j") {
			this.scrollOffset = Math.min(max, this.scrollOffset + 1);
		} else if (matchesKey(data, "pageUp")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - page);
		} else if (matchesKey(data, "pageDown")) {
			this.scrollOffset = Math.min(max, this.scrollOffset + page);
		} else if (matchesKey(data, "home")) {
			this.scrollOffset = 0;
		} else if (matchesKey(data, "end")) {
			this.scrollOffset = max;
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		const out: string[] = [""];

		for (const line of this.headerLines) {
			out.push(`  ${th.fg("dim", line)}`);
		}
		out.push("");

		// "  " indent + "12345" line number + " │ " separator
		const prefixWidth = 2 + 5 + 3;
		const wrapWidth = Math.max(20, width - prefixWidth - 1);
		const lines = this.getVisualLines(wrapWidth);
		const page = this.pageSize();
		const visible = lines.slice(this.scrollOffset, this.scrollOffset + page);

		for (const item of visible) {
			const lineNo =
				item.lineNo !== undefined ? String(item.lineNo).padStart(5, " ") : " ".repeat(5);
			const text = th.fg("text", item.text);
			out.push(`  ${th.fg("dim", `${lineNo} │ `)}${text}`);
		}
		out.push("");

		const canUp = this.scrollOffset > 0;
		const canDown = this.scrollOffset + page < lines.length;
		const pos = `lines ${this.scrollOffset + 1}-${Math.min(this.scrollOffset + page, lines.length)} of ${lines.length}`;
		const scrollHints = `${canUp ? "↑ " : ""}${canDown ? "↓ " : ""}`.trim();
		out.push(
			"  " +
				th.fg("accent", pos) +
				(scrollHints ? th.fg("dim", `  ${scrollHints}`) : ""),
		);
		out.push(
			th.fg("dim", "  ↑↓/j/k scroll · PgUp/PgDn page · Home/End jump · Esc/q close"),
		);
		out.push("");

		return out.map((line) => truncateToWidth(line, width, "", true));
	}

	invalidate(): void {}
}

export default function (pi: ExtensionAPI) {
	let viewerOpen = false;

	pi.registerCommand("system-prompt", {
		description: "Audit the current system prompt in a scrollable viewer",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				console.log(ctx.getSystemPrompt());
				return;
			}
			if (viewerOpen) return;
			viewerOpen = true;

			const prompt = ctx.getSystemPrompt();
			const headerLines = [
				`${prompt.length.toLocaleString("en-US")} chars · ~${estimateTokens(prompt).toLocaleString("en-US")} tokens · ${prompt.split("\n").length.toLocaleString("en-US")} lines`,
				...buildSourceLines(ctx),
			];

			try {
				await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
					const container = new Container();
					const viewer = new PromptViewer(theme, prompt, headerLines, done);
					container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
					container.addChild(
						new Text(theme.fg("accent", theme.bold("System Prompt")), 1, 0),
					);
					container.addChild(viewer);
					container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));

					return {
						render: (width: number) => container.render(width),
						invalidate: () => container.invalidate(),
						handleInput: (data: string) => viewer.handleInput(data),
					};
				});
			} finally {
				viewerOpen = false;
			}
		},
	});
}
