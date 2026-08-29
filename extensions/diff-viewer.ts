import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Focusable, type TUI } from "@earendil-works/pi-tui";

const STATUS_LABELS: Record<string, string> = {
  " ": "unchanged",
  M: "modified",
  T: "type changed",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "unmerged",
  "?": "untracked",
  "!": "ignored",
};

type Pane = "files" | "diff";
type CommentScope = "file" | "hunk";
type RowKind = "context" | "change" | "meta" | "hunk";

export interface ChangedFile {
  status: string;
  path: string;
  originalPath?: string;
  rows: DiffRow[];
}

export interface DiffRow {
  kind: RowKind;
  leftNumber?: number;
  rightNumber?: number;
  left: string;
  right: string;
  hunkIndex?: number;
}

export interface ReviewComment {
  scope: CommentScope;
  path: string;
  body: string;
  hunkHeader?: string;
  excerpt?: string;
}

interface ParsedHunk {
  header: string;
  rows: DiffRow[];
}

interface CommentDisplayRow {
  commentIndex: number;
  text: string;
}

export function parsePorcelain(output: string): Array<Omit<ChangedFile, "rows">> {
  const records = output.split("\0");
  const files: Array<Omit<ChangedFile, "rows">> = [];

  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record || record.length < 3) continue;

    const status = record.slice(0, 2);
    const path = record.slice(3);
    if (!path) continue;

    const renamedOrCopied = status.includes("R") || status.includes("C");
    const originalPath = renamedOrCopied ? records[++index] || undefined : undefined;
    files.push({ status, path, originalPath });
  }
  return files;
}

function parseRange(header: string): { oldLine: number; newLine: number } {
  const match = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  return {
    oldLine: match ? Number(match[1]) : 0,
    newLine: match ? Number(match[2]) : 0,
  };
}

function rowsFromHunk(header: string, body: string[], hunkIndex: number): DiffRow[] {
  const rows: DiffRow[] = [{ kind: "hunk", left: header, right: "", hunkIndex }];
  let { oldLine, newLine } = parseRange(header);
  let index = 0;

  while (index < body.length) {
    const line = body[index] ?? "";
    if (line.startsWith("-")) {
      const removed: string[] = [];
      const added: string[] = [];
      while (index < body.length && body[index]!.startsWith("-")) removed.push(body[index++]!.slice(1));
      while (index < body.length && body[index]!.startsWith("+")) added.push(body[index++]!.slice(1));
      const count = Math.max(removed.length, added.length);
      for (let pair = 0; pair < count; pair++) {
        const left = removed[pair];
        const right = added[pair];
        rows.push({
          kind: "change",
          leftNumber: left === undefined ? undefined : oldLine++,
          rightNumber: right === undefined ? undefined : newLine++,
          left: left ?? "",
          right: right ?? "",
          hunkIndex,
        });
      }
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ kind: "change", rightNumber: newLine++, left: "", right: line.slice(1), hunkIndex });
    } else if (line.startsWith(" ")) {
      rows.push({
        kind: "context",
        leftNumber: oldLine++,
        rightNumber: newLine++,
        left: line.slice(1),
        right: line.slice(1),
        hunkIndex,
      });
    } else if (line.startsWith("\\")) {
      rows.push({ kind: "meta", left: line, right: line, hunkIndex });
    }
    index++;
  }
  return rows;
}

export function parseUnifiedDiff(patch: string): { rows: DiffRow[]; hunks: ParsedHunk[] } {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const hunks: ParsedHunk[] = [];
  const meta: string[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    if (line.startsWith("@@ ")) {
      const body: string[] = [];
      const header = line;
      index++;
      while (index < lines.length && !lines[index]!.startsWith("@@ ") && !lines[index]!.startsWith("diff --git ")) {
        body.push(lines[index++]!);
      }
      const hunkIndex = hunks.length;
      hunks.push({ header, rows: rowsFromHunk(header, body, hunkIndex) });
      continue;
    }
    if (
      line &&
      !line.startsWith("diff --git ") &&
      !line.startsWith("index ") &&
      !line.startsWith("--- ") &&
      !line.startsWith("+++ ")
    ) {
      meta.push(line);
    }
    index++;
  }

  if (hunks.length > 0) return { rows: hunks.flatMap((hunk) => hunk.rows), hunks };
  const rows = meta.map((line): DiffRow => ({ kind: "meta", left: line, right: "" }));
  return { rows, hunks };
}

function makeUntrackedPatch(path: string, content: string): string {
  if (content.includes("\0")) return `Binary file ${path} is untracked`;
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  return `new file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${body}`;
}

function statusText(status: string): string {
  const parts = [...status]
    .map((code, index) => code === " " ? undefined : `${index === 0 ? "index" : "worktree"}: ${STATUS_LABELS[code] ?? code}`)
    .filter(Boolean);
  return parts.join(", ") || "unchanged";
}

function safeDisplay(text: string): string {
  return text.replace(/\t/g, "  ").replace(/[\x00-\x1f\x7f]/g, "�");
}

function fit(text: string, width: number): string {
  if (width <= 0) return "";
  const clipped = truncateToWidth(text, width, "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function statusColor(theme: Theme, status: string, text: string): string {
  if (status.includes("U")) return theme.fg("error", text);
  if (status.includes("A") || status === "??") return theme.fg("success", text);
  if (status.includes("D")) return theme.fg("error", text);
  if (status.includes("R") || status.includes("C")) return theme.fg("warning", text);
  return theme.fg("accent", text);
}

class DiffViewer implements Focusable {
  private files: ChangedFile[];
  private readonly comments: ReviewComment[] = [];
  private fileIndex = 0;
  private fileOffset = 0;
  private diffIndex = 0;
  private diffOffset = 0;
  private horizontalOffset = 0;
  private pane: Pane = "files";
  private commentScope?: CommentScope;
  private editingCommentIndex?: number;
  private commentPanel = false;
  private commentIndex = 0;
  private commentOffset = 0;
  private readonly input = new Input();
  private _focused = false;

  constructor(
    files: ChangedFile[],
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly onClose: (comments: ReviewComment[]) => void,
  ) {
    this.files = files;
    this.input.onSubmit = (value) => this.submitComment(value);
    this.input.onEscape = () => {
      this.commentScope = undefined;
      this.editingCommentIndex = undefined;
      this.input.setValue("");
      this.tui.requestRender();
    };
  }

  get focused(): boolean { return this._focused; }
  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value && this.commentScope !== undefined;
  }

  invalidate(): void {
    this.input.invalidate();
  }

  private currentFile(): ChangedFile | undefined { return this.files[this.fileIndex]; }
  private currentRow(): DiffRow | undefined { return this.currentFile()?.rows[this.diffIndex]; }

  private currentHunkIndex(): number | undefined {
    const rows = this.currentFile()?.rows ?? [];
    if (rows.length === 0) return undefined;
    for (let index = Math.min(this.diffIndex, rows.length - 1); index >= 0; index--) {
      if (rows[index]?.hunkIndex !== undefined) return rows[index]!.hunkIndex;
    }
    return undefined;
  }

  private beginComment(scope: CommentScope): void {
    if (!this.currentFile()) return;
    if (scope === "hunk" && this.currentHunkIndex() === undefined) return;
    this.editingCommentIndex = undefined;
    this.commentScope = scope;
    this.input.setValue("");
    this.input.focused = this.focused;
  }

  private beginEditComment(): void {
    const comment = this.comments[this.commentIndex];
    if (!comment) return;
    this.editingCommentIndex = this.commentIndex;
    this.commentScope = comment.scope;
    this.input.setValue(comment.body);
    this.input.focused = this.focused;
  }

  private submitComment(value: string): void {
    const body = value.trim();
    const file = this.currentFile();
    if (body && this.editingCommentIndex !== undefined) {
      const existing = this.comments[this.editingCommentIndex];
      if (existing) this.comments[this.editingCommentIndex] = { ...existing, body };
    } else if (body && file && this.commentScope) {
      const hunkIndex = this.currentHunkIndex();
      const hunk = hunkIndex === undefined ? undefined : file.rows.find((row) => row.kind === "hunk" && row.hunkIndex === hunkIndex);
      const excerptRows = hunkIndex === undefined ? [] : file.rows.filter((row) => row.hunkIndex === hunkIndex && row.kind !== "hunk").slice(0, 8);
      this.comments.push({
        scope: this.commentScope,
        path: file.path,
        body,
        hunkHeader: this.commentScope === "hunk" ? hunk?.left : undefined,
        excerpt: this.commentScope === "hunk"
          ? excerptRows.map((row) => `${row.leftNumber ?? ""}|${row.rightNumber ?? ""} ${row.left || row.right}`).join("\n")
          : undefined,
      });
      this.commentIndex = this.comments.length - 1;
    }
    this.commentScope = undefined;
    this.editingCommentIndex = undefined;
    this.input.setValue("");
    this.input.focused = false;
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (this.commentScope) {
      this.input.handleInput(data);
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, "escape") && this.commentPanel) {
      this.commentPanel = false;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "escape") || data === "q" || data === "Q") {
      this.onClose([...this.comments]);
      return;
    }
    if (data === "v" || data === "V") {
      this.commentPanel = !this.commentPanel;
      this.commentIndex = Math.max(0, Math.min(this.comments.length - 1, this.commentIndex));
      this.commentOffset = 0;
      this.tui.requestRender();
      return;
    }
    if (this.commentPanel) {
      if (matchesKey(data, "up") || data === "k") {
        this.moveComment(-1);
      } else if (matchesKey(data, "down") || data === "j") {
        this.moveComment(1);
      } else if (matchesKey(data, "home")) {
        this.commentIndex = 0;
      } else if (matchesKey(data, "end")) {
        this.commentIndex = Math.max(0, this.comments.length - 1);
      } else if (data === "e" || data === "E" || matchesKey(data, "enter")) {
        this.beginEditComment();
      } else if (data === "d" || data === "D" || matchesKey(data, "delete")) {
        this.deleteComment();
      }
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "tab")) {
      this.pane = this.pane === "files" ? "diff" : "files";
    } else if (data === "f" || data === "F") {
      this.beginComment("file");
    } else if (data === "c" || data === "C") {
      this.beginComment("hunk");
    } else if (data === "[" || data === "]") {
      this.jumpHunk(data === "]" ? 1 : -1);
    } else if (matchesKey(data, "left") && this.pane === "diff") {
      this.horizontalOffset = Math.max(0, this.horizontalOffset - 4);
    } else if (matchesKey(data, "right") && this.pane === "diff") {
      this.horizontalOffset += 4;
    } else if (matchesKey(data, "home")) {
      if (this.pane === "diff") this.diffIndex = 0;
      else this.selectFile(0);
    } else if (matchesKey(data, "end")) {
      if (this.pane === "diff") this.diffIndex = Math.max(0, (this.currentFile()?.rows.length ?? 1) - 1);
      else this.selectFile(Math.max(0, this.files.length - 1));
    } else if (matchesKey(data, "pageUp") && this.pane === "diff") {
      this.movePage(-1);
    } else if (matchesKey(data, "pageDown") && this.pane === "diff") {
      this.movePage(1);
    } else if (matchesKey(data, "up") || data === "k") {
      this.move(-1);
    } else if (matchesKey(data, "down") || data === "j") {
      this.move(1);
    } else if (matchesKey(data, "enter") && this.pane === "files") {
      this.pane = "diff";
    }
    this.tui.requestRender();
  }

  private moveComment(delta: number): void {
    if (this.comments.length === 0) return;
    const lastIndex = this.comments.length - 1;
    if (delta < 0 && this.commentIndex === 0) this.commentIndex = lastIndex;
    else if (delta > 0 && this.commentIndex === lastIndex) this.commentIndex = 0;
    else this.commentIndex = Math.max(0, Math.min(lastIndex, this.commentIndex + delta));
  }

  private deleteComment(): void {
    if (!this.comments[this.commentIndex]) return;
    this.comments.splice(this.commentIndex, 1);
    this.commentIndex = Math.max(0, Math.min(this.comments.length - 1, this.commentIndex));
  }

  private selectFile(index: number): void {
    const next = Math.max(0, Math.min(this.files.length - 1, index));
    if (next === this.fileIndex) return;
    this.fileIndex = next;
    this.diffIndex = 0;
    this.diffOffset = 0;
    this.horizontalOffset = 0;
  }

  private move(delta: number): void {
    if (this.pane === "files") {
      const lastIndex = this.files.length - 1;
      if (lastIndex < 0) return;
      if (delta < 0 && this.fileIndex === 0) this.selectFile(lastIndex);
      else if (delta > 0 && this.fileIndex === lastIndex) this.selectFile(0);
      else this.selectFile(this.fileIndex + delta);
      return;
    }
    const rows = this.currentFile()?.rows ?? [];
    if (rows.length === 0) return;
    const lastIndex = rows.length - 1;
    if (delta < 0 && this.diffIndex === 0) {
      this.diffIndex = lastIndex;
    } else if (delta > 0 && this.diffIndex === lastIndex) {
      this.diffIndex = 0;
    } else {
      this.diffIndex = Math.max(0, Math.min(lastIndex, this.diffIndex + delta));
    }
  }

  private movePage(direction: -1 | 1): void {
    const rows = this.currentFile()?.rows ?? [];
    if (rows.length === 0) return;

    const lastIndex = rows.length - 1;
    if (direction < 0 && this.diffIndex === 0) {
      this.diffIndex = lastIndex;
      return;
    }
    if (direction > 0 && this.diffIndex === lastIndex) {
      this.diffIndex = 0;
      return;
    }

    const bodyHeight = Math.max(10, (this.tui.terminal.rows || 24) - 1) - 4;
    const pageSize = Math.max(1, bodyHeight - 1);
    this.diffIndex = Math.max(0, Math.min(lastIndex, this.diffIndex + direction * pageSize));
  }

  private jumpHunk(direction: number): void {
    const rows = this.currentFile()?.rows ?? [];
    const hunkRows = rows.map((row, index) => row.kind === "hunk" ? index : -1).filter((index) => index >= 0);
    if (hunkRows.length === 0) return;
    if (direction > 0) this.diffIndex = hunkRows.find((index) => index > this.diffIndex) ?? hunkRows[0]!;
    else this.diffIndex = [...hunkRows].reverse().find((index) => index < this.diffIndex) ?? hunkRows.at(-1)!;
    this.pane = "diff";
  }

  private keepVisible(bodyHeight: number): void {
    if (this.fileIndex < this.fileOffset) this.fileOffset = this.fileIndex;
    if (this.fileIndex >= this.fileOffset + bodyHeight) this.fileOffset = this.fileIndex - bodyHeight + 1;
    if (this.diffIndex < this.diffOffset) this.diffOffset = this.diffIndex;
    if (this.diffIndex >= this.diffOffset + bodyHeight) this.diffOffset = this.diffIndex - bodyHeight + 1;
  }

  private buildCommentRows(width: number): CommentDisplayRow[] {
    if (this.comments.length === 0) return [{ commentIndex: -1, text: " No comments yet" }];

    const contentWidth = Math.max(1, width - 2);
    const rows: CommentDisplayRow[] = [];
    this.comments.forEach((comment, index) => {
      const location = comment.scope === "file"
        ? `[FILE] ${safeDisplay(comment.path)}`
        : `[HUNK] ${safeDisplay(comment.path)} ${safeDisplay(comment.hunkHeader ?? "")}`;
      for (const line of wrapTextWithAnsi(`${index + 1}. ${location}`, contentWidth)) {
        rows.push({ commentIndex: index, text: ` ${line}` });
      }
      for (const sourceLine of comment.body.split(/\r?\n/)) {
        const wrapped = wrapTextWithAnsi(safeDisplay(sourceLine), contentWidth);
        for (const line of wrapped.length > 0 ? wrapped : [""]) {
          rows.push({ commentIndex: index, text: ` ${line}` });
        }
      }
      rows.push({ commentIndex: index, text: "" });
    });
    return rows;
  }

  private keepCommentVisible(rows: CommentDisplayRow[], bodyHeight: number): void {
    const selectedRows = rows
      .map((row, index) => row.commentIndex === this.commentIndex ? index : -1)
      .filter((index) => index >= 0);
    if (selectedRows.length === 0) {
      this.commentOffset = 0;
      return;
    }
    const first = selectedRows[0]!;
    const last = selectedRows.at(-1)!;
    if (first < this.commentOffset) this.commentOffset = first;
    if (last >= this.commentOffset + bodyHeight) this.commentOffset = Math.max(0, last - bodyHeight + 1);
  }

  private renderDiffCell(text: string, number: number | undefined, width: number, color: "add" | "remove" | "context"): string {
    const numberWidth = Math.min(6, Math.max(3, String(number ?? "").length + 1));
    const codeWidth = Math.max(0, width - numberWidth - 1);
    const code = sliceByColumn(safeDisplay(text), this.horizontalOffset, codeWidth);
    const raw = `${String(number ?? "").padStart(numberWidth)} ${fit(code, codeWidth)}`;
    if (color === "add") return this.theme.fg("toolDiffAdded", raw);
    if (color === "remove") return this.theme.fg("toolDiffRemoved", raw);
    return this.theme.fg("toolDiffContext", raw);
  }

  render(width: number): string[] {
    const height = Math.max(10, (this.tui.terminal.rows || 24) - 1);
    const bodyHeight = height - 4;
    const fileWidth = Math.min(40, Math.max(20, Math.floor(width * 0.28)));
    const diffWidth = Math.max(1, width - fileWidth - 1);
    const leftWidth = Math.floor((diffWidth - 1) / 2);
    const rightWidth = Math.max(0, diffWidth - leftWidth - 1);
    this.keepVisible(bodyHeight);

    const file = this.currentFile();
    const commentRows = this.commentPanel ? this.buildCommentRows(diffWidth) : [];
    if (this.commentPanel) this.keepCommentVisible(commentRows, bodyHeight);
    const title = this.theme.bg("selectedBg", fit(
      ` DIFF REVIEW  ${this.files.length} file${this.files.length === 1 ? "" : "s"}  ${this.comments.length} comment${this.comments.length === 1 ? "" : "s"}`,
      width,
    ));
    const fileHeading = this.theme.fg(this.pane === "files" ? "accent" : "muted", this.theme.bold(" FILES (XY)"));
    const diffHeadingText = this.commentPanel
      ? `COMMENTS (${this.comments.length})`
      : file
        ? `${file.originalPath ? `${safeDisplay(file.originalPath)} → ` : ""}${safeDisplay(file.path)}  [${statusText(file.status)}]`
        : "No uncommitted changes";
    const diffHeading = this.theme.fg(this.commentPanel || this.pane === "diff" ? "accent" : "muted", this.theme.bold(` ${diffHeadingText}`));
    const lines = [title, fit(fileHeading, fileWidth) + this.theme.fg("border", "│") + fit(diffHeading, diffWidth)];

    for (let rowIndex = 0; rowIndex < bodyHeight; rowIndex++) {
      const fileListIndex = this.fileOffset + rowIndex;
      const listed = this.files[fileListIndex];
      let fileCell = "";
      if (listed) {
        const selected = fileListIndex === this.fileIndex;
        const commentCount = this.comments.filter((comment) => comment.path === listed.path).length;
        const name = `${listed.originalPath ? `${safeDisplay(listed.originalPath)} → ` : ""}${safeDisplay(listed.path)}`;
        const content = `${selected ? "›" : " "} ${listed.status} ${name}${commentCount ? ` 󰆉${commentCount}` : ""}`;
        fileCell = statusColor(this.theme, listed.status, fit(content, fileWidth));
        if (selected) fileCell = this.theme.bg("selectedBg", fileCell);
      } else {
        fileCell = " ".repeat(fileWidth);
      }

      const diffRowIndex = this.diffOffset + rowIndex;
      const row = file?.rows[diffRowIndex];
      let diffCell: string;
      if (this.commentPanel) {
        const commentRow = commentRows[this.commentOffset + rowIndex];
        diffCell = fit(commentRow?.text ?? "", diffWidth);
        if (commentRow?.commentIndex === this.commentIndex) {
          diffCell = this.theme.bg("selectedBg", diffCell);
        }
      } else if (!row) {
        const emptyMessage = rowIndex === 0 && file && file.rows.length === 0 ? "No textual diff" : "";
        diffCell = fit(emptyMessage, diffWidth);
      } else if (row.kind === "hunk") {
        const count = this.comments.filter((comment) => comment.path === file!.path && comment.hunkHeader === row.left).length;
        diffCell = this.theme.fg("accent", fit(` ${row.left}${count ? `  󰆉${count}` : ""}`, diffWidth));
      } else if (row.kind === "meta") {
        diffCell = this.theme.fg("muted", fit(` ${row.left}`, diffWidth));
      } else {
        const leftColor = row.kind === "change" ? "remove" : "context";
        const rightColor = row.kind === "change" ? "add" : "context";
        diffCell = this.renderDiffCell(row.left, row.leftNumber, leftWidth, leftColor)
          + this.theme.fg("borderMuted", "│")
          + this.renderDiffCell(row.right, row.rightNumber, rightWidth, rightColor);
      }
      if (!this.commentPanel && this.pane === "diff" && diffRowIndex === this.diffIndex) diffCell = this.theme.bg("selectedBg", diffCell);
      lines.push(fileCell + this.theme.fg("border", "│") + fit(diffCell, diffWidth));
    }

    const footer = this.commentScope
      ? `${this.editingCommentIndex === undefined ? (this.commentScope === "file" ? "File" : "Hunk") : "Edit"} comment: ${this.input.render(Math.max(1, width - 16))[0] ?? ""}`
      : this.commentPanel
        ? " ↑↓/jk select  Enter/e edit  d/Delete remove  v/Esc back  q send & close"
        : " Tab pane  ↑↓/jk move  PgUp/PgDn page  Home/End edges  ←→ scroll  [/] hunk  c/f comment  v comments  Esc/q close";
    lines.push(this.theme.fg("border", "─".repeat(Math.max(0, width))));
    lines.push(fit(this.theme.fg("dim", ` ${footer}`), width));
    return lines.map((line) => fit(line, width));
  }
}

function formatReviewComments(comments: ReviewComment[]): string {
  const blocks = comments.map((comment, index) => {
    const location = comment.scope === "file"
      ? `File: ${comment.path}`
      : `File: ${comment.path}\nHunk: ${comment.hunkHeader ?? "(unknown)"}`;
    const excerpt = comment.excerpt ? `\nReference excerpt:\n\`\`\`\n${comment.excerpt}\n\`\`\`` : "";
    return `${index + 1}. ${location}${excerpt}\nComment: ${comment.body}`;
  });
  return `I reviewed the uncommitted workspace changes. Apply the review comments below: understand each referenced location first, then make the requested changes.\n\n${blocks.join("\n\n")}`;
}

export default function diffViewerExtension(pi: ExtensionAPI): void {
  let open = false;

  pi.registerCommand("diff", {
    description: "Review uncommitted workspace changes in a side-by-side diff viewer",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/diff is available in TUI mode only", "warning");
        return;
      }
      if (open) return;
      open = true;

      try {
        const root = await pi.exec("git", ["rev-parse", "--show-toplevel"], { timeout: 5000 });
        if (root.code !== 0) {
          ctx.ui.notify("The current workspace is not a Git repository", "error");
          return;
        }

        const repoRoot = root.stdout.replace(/\r?\n$/, "");
        const statusResult = await pi.exec(
          "git",
          ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
          { timeout: 10000, cwd: repoRoot },
        );
        if (statusResult.code !== 0) throw new Error(statusResult.stderr || "git status failed");
        const statusFiles = parsePorcelain(statusResult.stdout);
        if (statusFiles.length === 0) {
          ctx.ui.notify("No uncommitted workspace changes", "info");
          return;
        }

        const head = await pi.exec("git", ["rev-parse", "--verify", "HEAD"], { timeout: 5000, cwd: repoRoot });
        const hasHead = head.code === 0;
        const files: ChangedFile[] = await Promise.all(statusFiles.map(async (file) => {
          let patch = "";
          if (file.status === "??" || !hasHead) {
            try {
              const absolutePath = join(repoRoot, file.path);
              const content = await readFile(absolutePath, "utf8");
              patch = makeUntrackedPatch(file.path, content);
            } catch {
              patch = `Binary, deleted, or unreadable file: ${file.path}`;
            }
          } else {
            const paths = file.originalPath ? [file.originalPath, file.path] : [file.path];
            const result = await pi.exec(
              "git",
              ["diff", "--no-ext-diff", "--no-color", "--find-renames", "--unified=3", "HEAD", "--", ...paths],
              { timeout: 15000, cwd: repoRoot },
            );
            if (result.code !== 0) patch = result.stderr || `Unable to diff ${file.path}`;
            else patch = result.stdout;
          }
          return { ...file, rows: parseUnifiedDiff(patch).rows };
        }));

        const comments = await ctx.ui.custom<ReviewComment[]>((tui, theme, _keybindings, done) =>
          new DiffViewer(files, tui, theme, done));

        if (comments.length > 0) {
          const message = formatReviewComments(comments);
          if (ctx.isIdle()) pi.sendUserMessage(message);
          else pi.sendUserMessage(message, { deliverAs: "followUp" });
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      } finally {
        open = false;
      }
    },
  });
}
