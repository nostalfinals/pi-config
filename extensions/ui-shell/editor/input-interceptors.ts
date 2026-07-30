import { CustomEditor } from "@earendil-works/pi-coding-agent";

export type EditorInputInterceptor = (data: string) => boolean;

const interceptors = new Map<string, EditorInputInterceptor>();

/** Register an optional editor-level input handler without taking editor ownership. */
export function registerEditorInputInterceptor(
  id: string,
  interceptor: EditorInputInterceptor,
): () => void {
  interceptors.set(id, interceptor);
  return () => {
    if (interceptors.get(id) === interceptor) interceptors.delete(id);
  };
}

export function applyEditorInputInterceptors<T extends CustomEditor>(editor: T): T {
  const handleInput = editor.handleInput.bind(editor);

  editor.handleInput = (data: string): void => {
    for (const interceptor of interceptors.values()) {
      try {
        if (interceptor(data)) return;
      } catch (error) {
        console.error("UI editor input interceptor failed:", error);
      }
    }
    handleInput(data);
  };

  return editor;
}
