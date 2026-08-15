import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

/**
 * Per-tool display policy for transcript tool rows.
 *
 * The chrome in tool-indicator.ts renders every tool row generically:
 * renderer invocation, line cleaning, status indicator, header composition,
 * rail, inter-row spacing. Everything that used to be a hardcoded tool-name
 * branch now lives in a ToolDisplayDescriptor looked up from this registry.
 *
 * The seven built-in tools register their descriptors in
 * builtin-tool-displays.ts so the current rendering is preserved verbatim.
 *
 * Custom tool extensions contribute their display policy by attaching a
 * `display` field to the ToolDefinition object they register, e.g.:
 *
 *   import type { ToolDisplayDescriptor } from "../ui/transcript/tool-display";
 *   pi.registerTool({
 *     name: "my_search",
 *     ...,
 *     display: {
 *       summary: (self) => `${countRows(self.result)} matches`,
 *       cacheable: true,
 *       suppressResultWhenCollapsed: true,
 *       suppressCallBody: true,
 *     },
 *   });
 *
 * IMPORTANT: pi loads every extension through a fresh jiti instance with
 * moduleCache disabled, so module-level state is NOT shared between
 * extensions. registerToolDisplay() below only affects the module instance
 * that calls it (the chrome reads it through the same import graph). Use the
 * toolDefinition.display field for anything contributed by a tool extension.
 */

export type ToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  details?: any;
  isError: boolean;
};

/** Observable internals of a ToolExecutionComponent row, cast from the instance. */
export type ToolInternals = {
  toolName: string;
  args: any;
  expanded: boolean;
  isPartial: boolean;
  result?: ToolResult;
  rendererState: any;
  executionStarted: boolean;
  callRendererComponent?: Component;
  resultRendererComponent?: Component;
  imageComponents: Component[];
  imageSpacers: Component[];
  hideComponent: boolean;
  /** The tool definition the row was constructed with (may carry `display`). */
  toolDefinition?: { display?: ToolDisplayDescriptor };
  ui: { requestRender(force?: boolean): void };
  getRenderShell(): "default" | "self";
};

/** Context passed to composeBody. */
export type BodyComposeContext = {
  self: ToolInternals;
  callLines: string[];
  resultLines: string[];
  theme: Theme;
  /** Inner row width (transcript width minus the indicator column). */
  width: number;
  display: ToolDisplayDescriptor;
};

export interface ToolDisplayDescriptor {
  /** Extra text rendered after the tool title on the header line. */
  summary?(self: ToolInternals, theme: Theme): string | undefined;
  /**
   * Return the filesystem-path argument rendered in the header, if any. Only
   * this declared value receives middle path elision; all other headers are
   * truncated at the end.
   */
  pathArgument?(args: unknown): string | undefined;
  /** Force the "detailed" row kind (affects inter-row gap rules). Default: derived from body length. */
  detailed?: boolean;
  /** Allow settled rows to be cached across redraws. Default: false. */
  cacheable?: boolean;
  /** Render an empty result component while the row is collapsed. */
  suppressResultWhenCollapsed?: boolean;
  /** Omit the wrapped call body; only the header line is shown. */
  suppressCallBody?: boolean;
  /** Use the call component's unwrapped Text content as the header line. */
  unwrappedCallHeader?: boolean;
  /** Replace the header title entirely (e.g. "bash"). */
  forceHeaderTitle?: string;
  /** Render the call with expanded=false regardless of UI expansion state. */
  forceCallCollapsed?: boolean;
  /** Classify this call as a skill invocation (e.g. read of SKILL.md). */
  isSkillRead?(args: unknown): boolean;
  /**
   * This self-shell tool is handled by the display pipeline.
   * Self-shell tools without this flag bypass the chrome entirely.
   */
  handleSelfShell?: boolean;
  /** Replace the call-line extraction step. Default: cleanToolLines(component.render(width)). */
  renderCallLines?(component: Component | undefined, theme: Theme, width: number): string[];
  /** Transform result lines before body assembly (applied by the default composeBody). */
  transformResultLines?(lines: string[]): string[];
  /** Fully custom body composition. Default: call body after the header + result lines. */
  composeBody?(ctx: BodyComposeContext): string[];
}

const registry = new Map<string, ToolDisplayDescriptor>();

const EMPTY_DISPLAY: ToolDisplayDescriptor = {};

/** Register or replace the display descriptor for a tool name. */
export function registerToolDisplay(toolName: string, descriptor: ToolDisplayDescriptor) {
  registry.set(toolName, descriptor);
}

/** Look up the display descriptor for a tool name. Unregistered tools get the generic default. */
export function getToolDisplay(toolName: string): ToolDisplayDescriptor {
  return registry.get(toolName) ?? EMPTY_DISPLAY;
}
