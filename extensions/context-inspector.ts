import {
	DynamicBorder,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	matchesKey,
	Text,
	truncateToWidth,
} from "@earendil-works/pi-tui";

type ColorName = "accent" | "error" | "thinkingXhigh" | "mdLink" | "success";
type CategoryKey = "system" | "tools" | "history" | "files" | "summaries";

interface Category {
	key: CategoryKey;
	label: string;
	color: ColorName;
	rawTokens: number;
	tokens: number;
}

interface ContextSnapshot {
	categories: Category[];
	usedTokens: number;
	contextWindow: number;
	isEstimated: boolean;
}

const CATEGORY_META: Array<Pick<Category, "key" | "label" | "color">> = [
	{ key: "system", label: "System", color: "accent" },
	{ key: "tools", label: "Tools", color: "error" },
	{ key: "history", label: "History", color: "thinkingXhigh" },
	{ key: "files", label: "Files", color: "mdLink" },
	{ key: "summaries", label: "Summaries", color: "success" },
];

function estimateTokens(value: unknown): number {
	if (value === undefined || value === null) return 0;
	const text = typeof value === "string" ? value : safeStringify(value);
	// A provider-independent estimate. The total is calibrated to Pi's context usage below.
	return Math.max(0, Math.ceil([...text].length / 4));
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return String(value);
	}
}

function contentTokens(content: unknown): number {
	if (typeof content === "string") return estimateTokens(content);
	if (!Array.isArray(content)) return estimateTokens(content);
	return content.reduce((sum, block) => sum + estimateTokens(block), 0);
}

function collectSnapshot(pi: ExtensionAPI, ctx: ExtensionContext): ContextSnapshot {
	const raw: Record<CategoryKey, number> = {
		system: 0,
		tools: 0,
		history: 0,
		files: 0,
		summaries: 0,
	};

	const systemPrompt = ctx.getSystemPrompt();
	// Pi embeds AGENTS.md/CLAUDE.md files in these XML blocks. Parsing the final
	// prompt keeps the inspector usable from shortcuts, whose context is read-only.
	const contextFileBlocks = systemPrompt.match(
		/<project_instructions path="[^"]*">\n[\s\S]*?\n<\/project_instructions>/g,
	) ?? [];
	for (const block of contextFileBlocks) raw.files += estimateTokens(block);

	const fullSystemTokens = estimateTokens(systemPrompt);
	raw.system = Math.max(0, fullSystemTokens - raw.files);

	const activeTools = new Set(pi.getActiveTools());
	for (const tool of pi.getAllTools()) {
		if (!activeTools.has(tool.name)) continue;
		raw.tools += estimateTokens({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			promptGuidelines: tool.promptGuidelines,
		});
	}

	for (const entry of ctx.sessionManager.buildContextEntries()) {
		if (entry.type === "compaction" || entry.type === "branch_summary") {
			raw.summaries += estimateTokens(entry.summary);
			continue;
		}
		if (entry.type === "custom_message") {
			raw.history += contentTokens(entry.content);
			continue;
		}
		if (entry.type !== "message") continue;

		const message = entry.message as any;
		switch (message.role) {
			case "assistant":
				for (const block of message.content ?? []) {
					if (block?.type === "toolCall") raw.tools += estimateTokens(block);
					else raw.history += estimateTokens(block);
				}
				break;
			case "toolResult":
				raw.tools += contentTokens(message.content);
				break;
			case "bashExecution":
				raw.tools += estimateTokens({ command: message.command, output: message.output });
				break;
			case "branchSummary":
			case "compactionSummary":
				raw.summaries += estimateTokens(message.summary);
				break;
			default:
				raw.history += contentTokens(message.content ?? message);
		}
	}

	const usage = ctx.getContextUsage();
	const rawTotal = Object.values(raw).reduce((sum, value) => sum + value, 0);
	const reportedTokens = usage?.tokens;
	const usedTokens = Math.max(0, reportedTokens ?? rawTotal);
	const contextWindow = Math.max(
		1,
		usage?.contextWindow ?? ctx.model?.contextWindow ?? usedTokens,
	);
	const scale = rawTotal > 0 && reportedTokens !== null && reportedTokens !== undefined
		? usedTokens / rawTotal
		: 1;

	const categories = CATEGORY_META.map((meta) => ({
		...meta,
		rawTokens: raw[meta.key],
		tokens: Math.max(0, Math.round(raw[meta.key] * scale)),
	}));

	// Keep the displayed category total exactly aligned with Pi's reported total.
	const categoryTotal = categories.reduce((sum, category) => sum + category.tokens, 0);
	const correctionTarget = categories.find((category) => category.key === "history") ?? categories[0];
	if (correctionTarget && categoryTotal !== usedTokens) {
		correctionTarget.tokens = Math.max(0, correctionTarget.tokens + usedTokens - categoryTotal);
	}

	return {
		categories,
		usedTokens,
		contextWindow,
		isEstimated: true,
	};
}

function formatTokens(tokens: number): string {
	return Math.round(tokens).toLocaleString("en-US");
}

class ContextInspectorPanel {
	constructor(
		private readonly theme: Theme,
		private readonly snapshot: ContextSnapshot,
		private readonly done: () => void,
	) {}

	handleInput(data: string): void {
		if (
			matchesKey(data, "escape") ||
			matchesKey(data, "ctrl+c") ||
			matchesKey(data, "return")
		) {
			this.done();
		}
	}

	render(width: number): string[] {
		const contentWidth = Math.max(1, width - 4);
		const lines: string[] = [""];
		lines.push(`  ${this.renderBar(contentWidth)}`);
		lines.push("");
		lines.push(...this.renderLegend(contentWidth).map((line) => `  ${line}`));
		lines.push("");

		const usedPercent = Math.min(999, (this.snapshot.usedTokens / this.snapshot.contextWindow) * 100);
		lines.push(
			"  " +
				this.theme.fg(
					"text",
					`${formatTokens(this.snapshot.usedTokens)} / ${formatTokens(this.snapshot.contextWindow)} tokens`,
				) +
				this.theme.fg("dim", `  (${usedPercent.toFixed(1)}% used)`),
		);
		lines.push(this.theme.fg("dim", "  Estimated breakdown · esc/enter close"));
		lines.push("");

		return lines.map((line) => truncateToWidth(line, width, "", true));
	}

	invalidate(): void {}

	private renderBar(width: number): string {
		const barWidth = Math.max(8, width);
		const total = this.snapshot.contextWindow;
		let previousBoundary = 0;
		let consumed = 0;
		let result = "";

		for (const category of this.snapshot.categories) {
			consumed += category.tokens;
			const boundary = Math.min(barWidth, Math.round((consumed / total) * barWidth));
			const segmentWidth = Math.max(0, boundary - previousBoundary);
			result += this.theme.fg(category.color, "█".repeat(segmentWidth));
			previousBoundary = boundary;
		}
		result += this.theme.fg("dim", "░".repeat(Math.max(0, barWidth - previousBoundary)));
		return result;
	}

	private renderLegend(width: number): string[] {
		const items = this.snapshot.categories.map((category) => {
			const percent = (category.tokens / this.snapshot.contextWindow) * 100;
			const bullet = this.theme.fg(category.color, "●");
			return `${bullet} ${category.label.padEnd(9)} ${formatTokens(category.tokens).padStart(8)}  ${percent.toFixed(1).padStart(5)}%`;
		});
		const available = Math.max(0, this.snapshot.contextWindow - this.snapshot.usedTokens);
		items.push(
			`${this.theme.fg("dim", "○")} ${"Available".padEnd(9)} ${formatTokens(available).padStart(8)}  ${((available / this.snapshot.contextWindow) * 100).toFixed(1).padStart(5)}%`,
		);

		if (width < 66) return items;
		const columnWidth = Math.floor(width / 2);
		const result: string[] = [];
		for (let index = 0; index < items.length; index += 2) {
			const left = truncateToWidth(items[index] ?? "", columnWidth, "", true);
			result.push(left + (items[index + 1] ?? ""));
		}
		return result;
	}
}

export default function (pi: ExtensionAPI) {
	let panelOpen = false;

	const showContextInspector = async (ctx: ExtensionContext): Promise<void> => {
		if (panelOpen) return;
		if (ctx.mode !== "tui") {
			ctx.ui.notify("Context inspector is available in TUI mode only", "warning");
			return;
		}

		panelOpen = true;
		const snapshot = collectSnapshot(pi, ctx);
		try {
			await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
				const container = new Container();
				const panel = new ContextInspectorPanel(theme, snapshot, done);
				container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
				container.addChild(
					new Text(theme.fg("accent", theme.bold("Context Summary")), 1, 0),
				);
				container.addChild(panel);
				container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));

				return {
					render: (width: number) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => panel.handleInput(data),
				};
			});
		} finally {
			panelOpen = false;
		}
	};

	pi.registerCommand("context", {
		description: "Inspect estimated context composition and token usage",
		handler: async (_args, ctx) => showContextInspector(ctx),
	});
}
