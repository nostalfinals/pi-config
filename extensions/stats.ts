import {
  DynamicBorder,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, Spacer, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { readdirSync, readFileSync, statSync, writeFileSync, type Stats } from "node:fs";
import { join } from "node:path";

interface ModelUsage {
  messages: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

// Aggregated usage for one session file. `models` maps "provider/model".
interface FileStats {
  mtime: number;
  size: number;
  day: string;
  messages: number;
  models: Record<string, ModelUsage>;
}

interface Aggregate {
  sessions: number;
  messages: number;
  days: Set<string>;
  models: Map<string, ModelUsage>;
  files: FileStats[];
}

type Period = "all" | "today" | "7d" | "30d";

const PERIODS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: "all", label: "All" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Recent 7 days" },
  { value: "30d", label: "Recent 30 days" },
];

interface CacheFile {
  version: 1;
  files: Record<string, FileStats>;
}

const CACHE_PATH = join(getAgentDir(), "stats-cache.json");
const SESSIONS_DIR = join(getAgentDir(), "sessions");

function emptyUsage(): ModelUsage {
  return { messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

function addUsage(target: ModelUsage, usage: unknown): void {
  const u = usage as
    | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } }
    | undefined;
  if (!u || typeof u !== "object") return;
  target.input += typeof u.input === "number" ? u.input : 0;
  target.output += typeof u.output === "number" ? u.output : 0;
  target.cacheRead += typeof u.cacheRead === "number" ? u.cacheRead : 0;
  target.cacheWrite += typeof u.cacheWrite === "number" ? u.cacheWrite : 0;
  target.cost += typeof u.cost?.total === "number" ? u.cost.total : 0;
}

function modelKey(provider: unknown, model: unknown): string {
  return `${typeof provider === "string" && provider ? provider : "?"}/${typeof model === "string" && model ? model : "?"}`;
}

// Parse one session JSONL file. Only lines that can carry usage are decoded:
// assistant/toolResult messages, compaction/branch summaries, plus cheap
// model_change lines so late usage entries attribute to the right model.
function scanFile(path: string, stats: Stats): FileStats {
  const result: FileStats = { mtime: stats.mtimeMs, size: stats.size, day: "", messages: 0, models: {} };
  let lastModel = "?/?";

  const usage = (key: string, value: unknown): void => {
    const bucket = (result.models[key] ??= emptyUsage());
    addUsage(bucket, value);
  };

  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return result;
  }

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.startsWith('{"type":"session"')) {
      try {
        const header = JSON.parse(line) as { timestamp?: string };
        result.day = typeof header.timestamp === "string" ? header.timestamp.slice(0, 10) : "";
      } catch {
        /* keep empty day */
      }
      continue;
    }
    if (!line.includes('"usage"') && !line.startsWith('{"type":"model_change"')) continue;

    let entry: {
      type?: string;
      provider?: string;
      modelId?: string;
      usage?: unknown;
      message?: { role?: string; provider?: string; model?: string; usage?: unknown };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "model_change" && entry.provider && entry.modelId) {
      lastModel = modelKey(entry.provider, entry.modelId);
      continue;
    }

    const message = entry.message;
    if (message?.role === "assistant") {
      lastModel = modelKey(message.provider, message.model);
      result.messages++;
      usage(lastModel, message.usage);
      result.models[lastModel].messages++;
    } else if (message?.role === "toolResult" && message.usage) {
      usage(lastModel, message.usage);
    } else if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) {
      usage(lastModel, entry.usage);
    }
  }

  return result;
}

function listSessionFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
  };
  walk(SESSIONS_DIR);
  return files.sort();
}

function loadCache(): CacheFile {
  try {
    const parsed = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as CacheFile;
    if (parsed?.version === 1 && typeof parsed.files === "object") return parsed;
  } catch {
    /* missing or corrupt cache: start fresh */
  }
  return { version: 1, files: {} };
}

const yieldToUi = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function emptyAggregate(): Aggregate {
  return { sessions: 0, messages: 0, days: new Set(), models: new Map(), files: [] };
}

function addFileStats(aggregate: Aggregate, fileStats: FileStats): void {
  aggregate.files.push(fileStats);
  aggregate.sessions++;
  aggregate.messages += fileStats.messages;
  if (fileStats.day) aggregate.days.add(fileStats.day);
  for (const [key, bucket] of Object.entries(fileStats.models)) {
    const existing = aggregate.models.get(key);
    const total = existing ?? emptyUsage();
    if (!existing) aggregate.models.set(key, total);
    total.messages += bucket.messages;
    total.input += bucket.input;
    total.output += bucket.output;
    total.cacheRead += bucket.cacheRead;
    total.cacheWrite += bucket.cacheWrite;
    total.cost += bucket.cost;
  }
}

function aggregateForPeriod(aggregate: Aggregate, period: Period): Aggregate {
  if (period === "all") return aggregate;

  const days = period === "today" ? 1 : period === "7d" ? 7 : 30;
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startDay = start.toISOString().slice(0, 10);
  const filtered = emptyAggregate();
  for (const fileStats of aggregate.files) {
    if (fileStats.day >= startDay) addFileStats(filtered, fileStats);
  }
  return filtered;
}

// Aggregate every session file under the agent dir, using mtime/size cache.
export async function collectStats(
  onProgress: ((done: number, total: number) => void) | undefined,
  forceRescan = false,
): Promise<Aggregate> {
  const files = listSessionFiles();
  const cache = forceRescan ? { version: 1 as const, files: {} } : loadCache();
  const aggregate = emptyAggregate();

  for (let i = 0; i < files.length; i++) {
    const path = files[i];
    let fileStats: FileStats | undefined;
    const cached = cache.files[path];
    let info: Stats | undefined;
    try {
      info = statSync(path);
    } catch {
      continue; // deleted between listing and stat
    }
    if (cached && cached.mtime === info.mtimeMs && cached.size === info.size) {
      fileStats = cached;
    } else {
      fileStats = scanFile(path, info);
      cache.files[path] = fileStats;
    }

    addFileStats(aggregate, fileStats);

    if (onProgress && (i % 8 === 7 || i === files.length - 1)) {
      onProgress(i + 1, files.length);
      await yieldToUi();
    }
  }

  // Drop cache entries for sessions that no longer exist.
  const live = new Set(files);
  for (const path of Object.keys(cache.files)) {
    if (!live.has(path)) delete cache.files[path];
  }
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(cache));
  } catch {
    /* stats still shown without cache */
  }

  return aggregate;
}

function trimOneDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

export function formatTokens(count: number): string {
  if (count >= 1e9) return `${trimOneDecimal(count / 1e9)}B`;
  if (count >= 1e6) return `${trimOneDecimal(count / 1e6)}M`;
  if (count >= 1e3) return `${trimOneDecimal(count / 1e3)}K`;
  return String(Math.round(count));
}

export function formatCost(cost: number): string {
  if (cost >= 10) return `$${cost.toFixed(2)}`;
  if (cost >= 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(4)}`;
}

function sortedModels(aggregate: Aggregate, sortBy: "cost" | "tokens"): Array<[string, ModelUsage]> {
  const totalTokens = (usage: ModelUsage): number => usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  return [...aggregate.models.entries()].sort((a, b) => {
    if (sortBy === "cost") {
      if (b[1].cost !== a[1].cost) return b[1].cost - a[1].cost;
    }
    return totalTokens(b[1]) - totalTokens(a[1]);
  });
}

type ScanState =
  | { kind: "scanning"; done: number; total: number }
  | { kind: "done"; aggregate: Aggregate }
  | { kind: "error"; message: string };

// Fixed dialog chrome (borders, title, blank, overview, table header, blank,
// position and hint lines) plus the editor/status area pi keeps below the dialog.
const CHROME_LINES = 20;

class StatsViewer {
  state: ScanState = { kind: "scanning", done: 0, total: 0 };
  private period: Period = "all";
  private sortBy: "cost" | "tokens" = "tokens";
  private scrollOffset = 0;

  constructor(
    private readonly theme: Theme,
    private readonly tui: { requestRender(): void },
    private readonly scan: (forceRescan: boolean) => void,
    private readonly done: () => void,
  ) {}

  private pageSize(): number {
    return Math.max(4, (process.stdout.rows ?? 40) - CHROME_LINES);
  }

  private displayedAggregate(): Aggregate | undefined {
    return this.state.kind === "done" ? aggregateForPeriod(this.state.aggregate, this.period) : undefined;
  }

  private maxOffset(): number {
    const models = this.displayedAggregate()?.models.size ?? 0;
    return Math.max(0, models - this.pageSize());
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "enter") || matchesKey(data, "ctrl+c") || data === "q") {
      this.done();
      return;
    }

    const max = this.maxOffset();
    const page = this.pageSize();
    if (matchesKey(data, "tab")) {
      const index = PERIODS.findIndex(({ value }) => value === this.period);
      this.period = PERIODS[(index + 1) % PERIODS.length].value;
      this.scrollOffset = 0;
    } else if (this.state.kind !== "scanning" && (data === "r" || data === "R")) {
      this.scrollOffset = 0;
      this.scan(true);
      return;
    }
    if (data === "s" || data === "S") {
      this.sortBy = this.sortBy === "cost" ? "tokens" : "cost";
      this.scrollOffset = 0;
    } else if (matchesKey(data, "up") || data === "k") {
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
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const th = this.theme;
    const container = new Container();
    const border = (text: string) => th.fg("accent", text);
    container.addChild(new DynamicBorder(border));
    container.addChild(new Text(border(th.bold("Stats")), 1, 0));
    if (this.state.kind === "scanning") {
      const pct = this.state.total > 0 ? Math.round((this.state.done / this.state.total) * 100) : 0;
      container.addChild(new Spacer(1));
      container.addChild(new Text(th.fg("muted", `Scanning sessions… ${this.state.done}/${this.state.total} (${pct}%)`), 1, 0));
      container.addChild(new Spacer(1));
      container.addChild(new DynamicBorder(border));
      return container.render(width);
    }

    container.addChild(new Spacer(1));
    const tabs = PERIODS.map(({ value, label }) => {
      const tab = ` ${label} `;
      return value === this.period ? th.bg("selectedBg", th.fg("accent", tab)) : th.fg("dim", tab);
    }).join(" ");
    container.addChild(new Text(tabs, 1, 0));
    container.addChild(new Spacer(1));

    if (this.state.kind === "error") {
      container.addChild(new Text(th.fg("error", `Failed to collect stats: ${this.state.message}`), 1, 0));
    } else {
      const aggregate = this.displayedAggregate()!;
      const totalTokens =
        [...aggregate.models.values()].reduce((sum, u) => sum + u.input + u.output + u.cacheRead + u.cacheWrite, 0);
      const totalCost = [...aggregate.models.values()].reduce((sum, u) => sum + u.cost, 0);

      const overview: Array<[string, string]> = [
        ["Sessions", String(aggregate.sessions)],
        ["Messages", String(aggregate.messages)],
        ["Days", String(aggregate.days.size)],
        ["Total Cost", formatCost(totalCost)],
        ["Tokens", formatTokens(totalTokens)],
        ["Cache Read", formatTokens([...aggregate.models.values()].reduce((sum, u) => sum + u.cacheRead, 0))],
      ];
      for (const [label, value] of overview) {
        container.addChild(new Text(`${th.fg("muted", label.padEnd(12))}${value}`, 1, 0));
      }

      container.addChild(new Spacer(1));
      const models = sortedModels(aggregate, this.sortBy);

      // Widths come from all models so columns stay stable while scrolling.
      const cells = models.map(([key, usage]) => ({
        key,
        messages: String(usage.messages),
        input: formatTokens(usage.input),
        output: formatTokens(usage.output),
        cacheRead: formatTokens(usage.cacheRead),
        cost: formatCost(usage.cost),
      }));
      const headers = { key: "Model", messages: "Msgs", input: "Input", output: "Output", cacheRead: "Cache Read", cost: "Cost" };
      const maxWidth = (field: keyof typeof headers): number =>
        Math.max(headers[field].length, ...cells.map((cell) => cell[field].length));
      const msgWidth = maxWidth("messages");
      const inWidth = maxWidth("input");
      const outWidth = maxWidth("output");
      const cacheWidth = maxWidth("cacheRead");
      const costWidth = maxWidth("cost");
      // Stretch the model column so Cost sits at the terminal's right edge;
      // model names only trim when even that leaves too little room.
      const fixedWidth = (msgWidth + 2) + (inWidth + 2) + (outWidth + 2) + (cacheWidth + 2) + (costWidth + 2);
      const keyWidth = Math.max(20, Math.max(width - 2, 0) - fixedWidth);

      const rowLine = (cell: (typeof cells)[number]): string =>
        truncateToWidth(cell.key, keyWidth).padEnd(keyWidth) +
        cell.messages.padStart(msgWidth + 2) +
        cell.input.padStart(inWidth + 2) +
        cell.output.padStart(outWidth + 2) +
        cell.cacheRead.padStart(cacheWidth + 2) +
        th.fg("accent", cell.cost.padStart(costWidth + 2));

      const headerRow =
        headers.key.padEnd(keyWidth) +
        headers.messages.padStart(msgWidth + 2) +
        headers.input.padStart(inWidth + 2) +
        headers.output.padStart(outWidth + 2) +
        headers.cacheRead.padStart(cacheWidth + 2) +
        headers.cost.padStart(costWidth + 2);
      container.addChild(new Text(th.fg("dim", headerRow), 1, 0));

      this.scrollOffset = Math.min(this.scrollOffset, Math.max(0, models.length - this.pageSize()));
      const visible = cells.slice(this.scrollOffset, this.scrollOffset + this.pageSize())
        .map((cell) => truncateToWidth(rowLine(cell), Math.max(width - 2, 20)));
      container.addChild(new Text(visible.join("\n"), 1, 0));

      const from = models.length === 0 ? 0 : this.scrollOffset + 1;
      const to = Math.min(this.scrollOffset + this.pageSize(), models.length);
      const arrows = `${this.scrollOffset > 0 ? "↑ " : ""}${to < models.length ? "↓" : ""}`.trim();
      container.addChild(new Spacer(1));
      container.addChild(
        new Text(border(models.length === 0 ? "lines 0 of 0" : `lines ${from}–${to} of ${models.length}`) + (arrows ? th.fg("dim", `  ${arrows}`) : ""), 1, 0),
      );
    }

    container.addChild(
      new Text(th.fg("dim", `tab range · ↑↓ navigate · pgup/pgdn page · s sort by ${this.sortBy === "cost" ? "tokens" : "cost"} · r rescan · esc close`), 1, 0),
    );
    container.addChild(new DynamicBorder(border));
    return container.render(width);
  }
}

async function showStatsDialog(ctx: ExtensionContext): Promise<void> {
  await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    let closed = false;
    let scanFn: (force: boolean) => void;
    const viewer = new StatsViewer(theme, tui, (force) => scanFn(force), () => {
      closed = true;
      done();
    });

    const scan = (forceRescan: boolean): void => {
      viewer.state = { kind: "scanning", done: 0, total: 0 };
      tui.requestRender();
      void collectStats((done, total) => {
        viewer.state = { kind: "scanning", done, total };
        tui.requestRender();
      }, forceRescan).then(
        (aggregate) => {
          if (closed) return;
          viewer.state = { kind: "done", aggregate };
          tui.requestRender();
        },
        (error: unknown) => {
          if (closed) return;
          viewer.state = { kind: "error", message: error instanceof Error ? error.message : String(error) };
          tui.requestRender();
        },
      );
    };
    scanFn = scan;

    queueMicrotask(() => scan(false));

    return {
      render: (width: number) => viewer.render(width),
      invalidate: () => {},
      handleInput: (data: string) => viewer.handleInput(data),
    };
  });
}

export default function stats(pi: ExtensionAPI): void {
  let dialogOpen = false;

  pi.registerCommand("stats", {
    description: "Show aggregated model usage across all sessions in this agent dir",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("Stats are available in TUI mode only.", "warning");
        return;
      }
      if (dialogOpen) return;

      dialogOpen = true;
      try {
        await showStatsDialog(ctx);
      } finally {
        dialogOpen = false;
      }
    },
  });
}
