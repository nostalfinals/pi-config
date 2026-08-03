/**
 * Dedicated grep.app code-search tool for pi.
 *
 * Registers a first-class `gh_grep` tool that searches real-world code
 * across public GitHub repositories via grep.app's official programmatic
 * endpoint — no MCP adapter, no mcp.json, no external dependencies.
 *
 * Reload with /reload after adding/editing this file.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { searchGrepApp } from "./lib";
import { renderGrepCall, renderGrepResult } from "./render";

const ghGrepToolSchema = Type.Object({
  query: Type.String({
    description:
      "The literal code pattern to search for (e.g. 'useState(', 'export function', 'async function'). " +
      "Search for actual code that would appear in files, not keywords or questions.",
  }),
  useRegexp: Type.Optional(
    Type.Boolean({
      description:
        "Interpret the query as a regular expression. Prefix with '(?s)' to match across multiple lines.",
      default: false,
    }),
  ),
  matchCase: Type.Optional(
    Type.Boolean({ description: "Whether the search should be case sensitive.", default: false }),
  ),
  matchWholeWords: Type.Optional(
    Type.Boolean({ description: "Whether to match whole words only.", default: false }),
  ),
  language: Type.Optional(
    Type.Array(
      Type.String({
        description:
          "Filter by programming language, e.g. 'TypeScript', 'TSX', 'Python', 'Java', 'C#', 'Markdown', 'YAML'.",
      }),
      { description: "Filter by programming language." },
    ),
  ),
  repo: Type.Optional(
    Type.String({
      description:
        "Filter by repository. Examples: 'facebook/react', 'microsoft/vscode'. " +
        "Partial names work, e.g. 'vercel/' finds repositories in the vercel org.",
    }),
  ),
  path: Type.Optional(
    Type.String({
      description:
        "Filter by file path. Examples: 'src/components/Button.tsx', 'README.md'. " +
        "Partial paths work, e.g. '/route.ts' finds route.ts files at any level.",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({ description: "Maximum number of results to return.", default: 10, minimum: 1, maximum: 20 }),
  ),
});

export type GhGrepToolInput = Static<typeof ghGrepToolSchema>;

export default function ghGrepExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "gh_grep",
    label: "grep.app",
    description:
      "Search literal code patterns across public GitHub repositories. Supports regex via useRegexp=true, " +
      "and filtering by language, repo, or file path.",
    promptSnippet: "Search literal code patterns and real-world API usage across public GitHub repositories",
    promptGuidelines: [
      "For gh_grep, search for literal code snippets (like `useState(` or `client.get(`) rather than natural language; use useRegexp with a (?s) prefix for flexible multi-line patterns.",
      "Narrow gh_grep results with language, repo (e.g. `facebook/react`), or path filters when the user has a specific stack in mind.",
    ],
    parameters: ghGrepToolSchema,
    renderCall: (args, theme) => renderGrepCall(args, theme),
    renderResult: (result, options, theme, context) =>
      renderGrepResult(result, options, theme, context),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const result = await searchGrepApp(params, signal ?? undefined);
      return {
        content: [{ type: "text", text: result.text }],
        details: {
          total: result.total,
          hits: result.hits,
          query: params.query,
          filters: {
            language: params.language,
            repo: params.repo,
            path: params.path,
            useRegexp: params.useRegexp,
            matchCase: params.matchCase,
            matchWholeWords: params.matchWholeWords,
          },
        },
      };
    },
  });
}
