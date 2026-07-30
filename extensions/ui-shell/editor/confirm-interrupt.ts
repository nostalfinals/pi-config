import {
  type ExtensionContext,
  type KeybindingsManager,
  CustomEditor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const CONFIRMATION_WINDOW_MS = 5_000;
const PROMPT = " Press Esc again to interrupt ";

export type ConfirmInterruptController<T extends CustomEditor> = {
  editor: T;
  clear(requestRender?: boolean): void;
};

/** Decorate an editor with a two-step interrupt confirmation. */
export function applyConfirmInterrupt<T extends CustomEditor>(
  editor: T,
  keybindings: KeybindingsManager,
  ctx: ExtensionContext,
  isCompacting: () => boolean,
  requestUiRender: () => void,
): ConfirmInterruptController<T> {
  let confirmationDeadline = 0;
  let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
  const handleInput = editor.handleInput.bind(editor);
  const render = editor.render.bind(editor);

  const clear = (requestRender = true): void => {
    confirmationDeadline = 0;
    if (confirmationTimer) {
      clearTimeout(confirmationTimer);
      confirmationTimer = undefined;
    }
    if (requestRender) requestUiRender();
  };

  editor.handleInput = (data: string): void => {
    const isInterrupt = keybindings.matches(data, "app.interrupt");
    if (
      !isInterrupt ||
      editor.isShowingAutocomplete() ||
      (ctx.isIdle() && !isCompacting())
    ) {
      handleInput(data);
      return;
    }

    const now = Date.now();
    if (confirmationDeadline <= now) {
      clear(false);
      confirmationDeadline = now + CONFIRMATION_WINDOW_MS;
      confirmationTimer = setTimeout(() => clear(), CONFIRMATION_WINDOW_MS);
      requestUiRender();
      return;
    }

    clear(false);
    handleInput(data);
  };

  editor.render = (width: number): string[] => {
    const lines = render(width);
    if (confirmationDeadline <= Date.now() || lines.length === 0 || width <= 0) {
      return lines;
    }

    const prompt = truncateToWidth(PROMPT, width, "");
    const fillWidth = Math.max(0, width - visibleWidth(prompt));
    lines[lines.length - 1] =
      ctx.ui.theme.fg("warning", prompt) + editor.borderColor("─".repeat(fillWidth));
    return lines;
  };

  return { editor, clear };
}
