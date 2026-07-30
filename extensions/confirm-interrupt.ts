import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const CONFIRMATION_WINDOW_MS = 5_000;
const PROMPT = " Press Esc again to interrupt ";

class ConfirmInterruptEditor extends CustomEditor {
	private confirmationDeadline = 0;
	private confirmationTimer?: ReturnType<typeof setTimeout>;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		private readonly appKeybindings: KeybindingsManager,
		private readonly ctx: ExtensionContext,
		private readonly isCompacting: () => boolean,
	) {
		super(tui, theme, appKeybindings);
	}

	override handleInput(data: string): void {
		const isInterrupt = this.appKeybindings.matches(data, "app.interrupt");
		if (
			!isInterrupt ||
			this.isShowingAutocomplete() ||
			(this.ctx.isIdle() && !this.isCompacting())
		) {
			super.handleInput(data);
			return;
		}

		const now = Date.now();
		if (this.confirmationDeadline <= now) {
			this.armConfirmation(now);
			return;
		}

		this.clearConfirmation();
		super.handleInput(data);
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (this.confirmationDeadline <= Date.now() || lines.length === 0 || width <= 0) {
			return lines;
		}

		const prompt = truncateToWidth(PROMPT, width, "");
		const fillWidth = Math.max(0, width - visibleWidth(prompt));
		lines[lines.length - 1] =
			this.ctx.ui.theme.fg("warning", prompt) + this.borderColor("─".repeat(fillWidth));
		return lines;
	}

	clearConfirmation(requestRender = true): void {
		this.confirmationDeadline = 0;
		if (this.confirmationTimer) {
			clearTimeout(this.confirmationTimer);
			this.confirmationTimer = undefined;
		}
		if (requestRender) this.tui.requestRender();
	}

	private armConfirmation(now: number): void {
		this.clearConfirmation(false);
		this.confirmationDeadline = now + CONFIRMATION_WINDOW_MS;
		this.confirmationTimer = setTimeout(() => this.clearConfirmation(), CONFIRMATION_WINDOW_MS);
		this.tui.requestRender();
	}
}

export default function (pi: ExtensionAPI) {
	let editor: ConfirmInterruptEditor | undefined;
	let compactionActive = false;

	function finishCompaction() {
		compactionActive = false;
		editor?.clearConfirmation();
	}

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			editor = new ConfirmInterruptEditor(
				tui,
				theme,
				keybindings,
				ctx,
				() => compactionActive,
			);
			return editor;
		});
	});

	pi.on("session_before_compact", (event) => {
		compactionActive = true;
		event.signal.addEventListener("abort", finishCompaction, { once: true });
	});

	pi.on("session_compact", finishCompaction);

	pi.on("agent_end", () => {
		if (!compactionActive) editor?.clearConfirmation();
	});

	pi.on("session_shutdown", () => {
		compactionActive = false;
		editor?.clearConfirmation(false);
		editor = undefined;
	});
}
