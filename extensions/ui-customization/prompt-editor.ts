import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";

const ANSI_ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const BORDER_LINE = /^─+(?: [↑↓] \d+ more )?─*$/;

export function applyPromptEditorStyle<T extends CustomEditor>(
  editor: T,
  keybindings: KeybindingsManager,
  onToggleToolsExpanded: () => void,
): T {
  const renderEditor = editor.render.bind(editor);
  const handleInput = editor.handleInput.bind(editor);

  // Observe Pi's built-in app.tools.expand action without replacing it. The
  // original handler still toggles its internal tool-output state; this only
  // mirrors that state for the custom footer.
  editor.handleInput = (data: string): void => {
    const togglesTools = keybindings.matches(data, "app.tools.expand");
    handleInput(data);
    if (togglesTools) onToggleToolsExpanded();
  };

  editor.render = (width: number): string[] => {
    if (width < 3) return renderEditor(width);

    const lines = renderEditor(width - 2);
    const borderIndexes = lines
      .map((line, index) =>
        BORDER_LINE.test(line.replace(ANSI_ESCAPE, "")) ? index : -1,
      )
      .filter((index) => index >= 0);
    const topBorderIndex = borderIndexes[0] ?? 0;
    // confirm-interrupt replaces the bottom border with its warning prompt.
    const bottomBorderIndex = borderIndexes[1] ?? lines.length - 1;
    let contentLine = 0;

    return lines.map((line, index) => {
      if (index === topBorderIndex || index === bottomBorderIndex) {
        return `${line}${editor.borderColor("──")}`;
      }

      if (index > topBorderIndex && index < bottomBorderIndex) {
        const prefix = contentLine++ === 0 ? editor.borderColor("> ") : "  ";
        return `${prefix}${line}`;
      }

      // Keep autocomplete results aligned with the editor content.
      return `  ${line}`;
    });
  };

  return editor;
}
