import {
  DynamicBorder,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type SessionEntry,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  type Component,
  type ScrollView,
  type TUI,
  matchesKey,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

interface ConversationTurn {
  entryId: string;
  prompt: string;
  response: string;
}

interface LayoutBox {
  children: LayoutBox[];
  scrollView?: ScrollView;
  scrollContentLines?: readonly string[];
}

interface LayoutFrame {
  root: LayoutBox;
  primaryScrollView?: ScrollView;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((block): block is { type: "text"; text: string } => (
      typeof block === "object"
      && block !== null
      && "type" in block
      && block.type === "text"
      && "text" in block
      && typeof block.text === "string"
    ))
    .map((block) => block.text)
    .join("");
}

function collectTurns(entries: readonly SessionEntry[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let current: ConversationTurn | undefined;

  const finish = () => {
    if (current?.response.trim()) turns.push(current);
    current = undefined;
  };

  for (const entry of entries) {
    if (entry.type !== "message") continue;

    if (entry.message.role === "user") {
      finish();
      current = {
        entryId: entry.id,
        prompt: textContent(entry.message.content).trim(),
        response: "",
      };
      continue;
    }

    if (
      current
      && entry.message.role === "assistant"
      && !entry.message.content.some((block) => block.type === "toolCall")
    ) {
      const response = textContent(entry.message.content).trim();
      if (response) current.response = response;
    }
  }

  finish();
  return turns;
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

class TurnList implements Component {
  private selectedIndex: number;
  private startIndex: number;

  constructor(
    private readonly turns: ConversationTurn[],
    private readonly maxVisible: number,
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsManager,
    private readonly onSelect: (entryId: string) => void,
    private readonly onCancel: () => void,
    initialSelectedIndex: number,
  ) {
    this.selectedIndex = Math.max(0, Math.min(initialSelectedIndex, turns.length - 1));
    this.startIndex = Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.turns.length - this.maxVisible),
    );
  }

  private keepSelectionVisible(): void {
    if (this.selectedIndex < this.startIndex) {
      this.startIndex = this.selectedIndex;
    } else if (this.selectedIndex >= this.startIndex + this.maxVisible) {
      this.startIndex = this.selectedIndex - this.maxVisible + 1;
    }
    this.startIndex = Math.max(0, Math.min(this.startIndex, this.turns.length - this.maxVisible));
  }

  render(width: number): string[] {
    const start = this.startIndex;
    const end = Math.min(start + this.maxVisible, this.turns.length);
    const lines: string[] = [];

    for (let index = start; index < end; index++) {
      const turn = this.turns[index];
      if (!turn) continue;

      const selected = index === this.selectedIndex;
      const style = (line: string) => selected ? this.theme.bg("selectedBg", this.theme.bold(line)) : line;
      const messageLine = (text: string, color: "text" | "muted") => {
        const innerWidth = Math.max(1, width - 2);
        const content = truncateToWidth(this.theme.fg(color, text), innerWidth, "");
        const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
        return style(` ${content}${padding} `);
      };

      lines.push(messageLine(oneLine(turn.prompt) || "(image)", "text"));
      lines.push(messageLine(oneLine(turn.response), "muted"));
      lines.push("");
    }

    const position = `messages ${start + 1}-${end} of ${this.turns.length}`;
    const scrollHints = `${start > 0 ? "↑ " : ""}${end < this.turns.length ? "↓ " : ""}`.trim();
    lines.push(
      ` ${this.theme.fg("accent", position)}${scrollHints ? this.theme.fg("dim", `  ${scrollHints}`) : ""}`,
    );

    return lines;
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "tui.select.up")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    } else if (this.keybindings.matches(data, "tui.select.down")) {
      this.selectedIndex = Math.min(this.turns.length - 1, this.selectedIndex + 1);
    } else if (this.keybindings.matches(data, "tui.select.pageUp")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - this.maxVisible);
    } else if (this.keybindings.matches(data, "tui.select.pageDown")) {
      this.selectedIndex = Math.min(this.turns.length - 1, this.selectedIndex + this.maxVisible);
    } else if (matchesKey(data, "home")) {
      this.selectedIndex = 0;
    } else if (matchesKey(data, "end")) {
      this.selectedIndex = this.turns.length - 1;
    } else if (this.keybindings.matches(data, "tui.select.confirm")) {
      const selected = this.turns[this.selectedIndex];
      if (selected) this.onSelect(selected.entryId);
    } else if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.onCancel();
      return;
    }

    this.keepSelectionVisible();
  }

  invalidate(): void {}
}

function assistantHasMarker(entry: SessionEntry): boolean {
  if (entry.type !== "message" || entry.message.role !== "assistant") return false;
  if (entry.message.content.some((block) => block.type === "toolCall")) return false;
  return entry.message.content.some((block) => (
    block.type === "text" ? block.text.trim().length > 0 : block.type === "thinking" && block.thinking.trim().length > 0
  ));
}

function markerIndexForEntry(entries: readonly SessionEntry[], targetId: string): number | undefined {
  let markerIndex = 0;
  for (const entry of entries) {
    if (entry.type === "message" && entry.message.role === "user") {
      if (entry.id === targetId) return markerIndex;
      markerIndex++;
    } else if (assistantHasMarker(entry)) {
      markerIndex++;
    }
  }
  return undefined;
}

function findScrollBox(box: LayoutBox, scrollView: ScrollView): LayoutBox | undefined {
  if (box.scrollView === scrollView) return box;
  for (const child of box.children) {
    const match = findScrollBox(child, scrollView);
    if (match) return match;
  }
  return undefined;
}

function getTranscriptViewport(tui: TUI): { scrollView: ScrollView; lines: readonly string[] } | undefined {
  if (tui.mode !== "fullscreen") return undefined;

  // Pi does not expose transcript positioning through ExtensionUIContext. The fullscreen
  // renderer does expose its current layout at runtime, which lets us read and position its
  // public ScrollView without changing the session branch.
  const layout = (tui as TUI & { currentLayout?: LayoutFrame }).currentLayout;
  const scrollView = layout?.primaryScrollView;
  if (!layout || !scrollView) return undefined;

  const lines = findScrollBox(layout.root, scrollView)?.scrollContentLines;
  return lines ? { scrollView, lines } : undefined;
}

function markerRows(lines: readonly string[]): number[] {
  const rows: number[] = [];
  for (let row = 0; row < lines.length; row++) {
    if (lines[row]?.includes("\x1b]133;A")) rows.push(row);
  }
  return rows;
}

function initialTurnIndex(
  tui: TUI,
  renderedEntries: readonly SessionEntry[],
  turns: readonly ConversationTurn[],
): number {
  const viewport = getTranscriptViewport(tui);
  if (!viewport) return turns.length - 1;

  const rows = markerRows(viewport.lines);
  const visibleBottom = viewport.scrollView.scrollTop + Math.max(0, viewport.scrollView.viewportHeight - 1);
  let selected = turns.length - 1;
  let found = false;

  for (let index = 0; index < turns.length; index++) {
    const markerIndex = markerIndexForEntry(renderedEntries, turns[index]!.entryId);
    if (markerIndex === undefined) continue;
    const row = rows[markerIndex];
    if (row === undefined) continue;
    if (!found) {
      selected = index;
      found = true;
    }
    if (row > visibleBottom) break;
    selected = index;
  }

  return selected;
}

function scrollToMarker(tui: TUI, targetMarkerIndex: number): boolean {
  const viewport = getTranscriptViewport(tui);
  if (!viewport) return false;

  const row = markerRows(viewport.lines)[targetMarkerIndex];
  if (row === undefined) return false;

  viewport.scrollView.scrollTo(row, { disableFollow: true });
  tui.requestRender();
  return true;
}

async function showNavigate(ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Navigate is available in TUI mode only.", "warning");
    return;
  }

  const turns = collectTurns(ctx.sessionManager.getBranch());
  if (turns.length === 0) {
    ctx.ui.notify("No completed conversation turns yet.", "info");
    return;
  }

  const renderedEntries = ctx.sessionManager.buildContextEntries();
  let jump: (() => boolean) | undefined;
  await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
    const container = new Container();
    const visibleTurns = Math.max(3, Math.floor(((tui.terminal.rows ?? 24) - 9) / 3));
    const list = new TurnList(
      turns,
      visibleTurns,
      theme,
      keybindings,
      (entryId) => {
        const markerIndex = markerIndexForEntry(renderedEntries, entryId);
        jump = markerIndex === undefined ? () => false : () => scrollToMarker(tui, markerIndex);
        done();
      },
      done,
      initialTurnIndex(tui, renderedEntries, turns),
    );

    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    container.addChild(new Text(theme.fg("accent", theme.bold("Navigate")), 1, 0));
    container.addChild(new Spacer(1));
    container.addChild(list);
    container.addChild(new Text(theme.fg("dim", "↑↓ navigate · esc cancel"), 1, 0));
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  });

  if (!jump) return;
  queueMicrotask(() => {
    if (!jump?.()) {
      ctx.ui.notify("This message is not present in the current transcript view.", "warning");
    }
  });
}

export default function navigate(pi: ExtensionAPI): void {
  let open = false;

  const show = async (ctx: ExtensionContext) => {
    if (open) return;
    open = true;
    try {
      await showNavigate(ctx);
    } finally {
      open = false;
    }
  };

  pi.registerCommand("navigate", {
    description: "Jump to a completed turn in the current conversation branch",
    handler: async (_args, ctx) => show(ctx),
  });

  pi.registerShortcut("alt+n", {
    description: "Open conversation navigator",
    handler: show,
  });
}
