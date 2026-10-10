/**
 * A reference tool for an app's edit language ("ops_guide"), so the edit tools
 * themselves can keep short descriptions.
 *
 * Without arguments the tool answers with the group list and one signature line
 * per op, a few KB that tell an agent what exists. With `groups` it returns the
 * full reference of those groups: field tables, units, runnable JSON examples
 * and common mistakes. Agents load the groups they need before a batch they have
 * not sent before, instead of every request carrying all of it.
 *
 * @module agentGuide
 */
import type { MindooDBAppAgentTool } from "../types";
import { MindooDBAppAgentToolError } from "./agentTools";

/** One field of an op, as a row of the group's field table. */
export interface MindooDBAppAgentGuideField {
  name: string;
  /** Short type: `string`, `number (pt)`, `"left" | "center"`, `{start, end?}`. */
  type: string;
  required?: boolean;
  description: string;
}

/** One op (or one kind of entry) of an edit tool. */
export interface MindooDBAppAgentGuideOp {
  /** The op's name as the agent writes it (`insertContent`, `style`). */
  name: string;
  /** Compact usage: the fields, `?` marking optional ones (`{target, markdown}`). */
  signature: string;
  /** One or two sentences: what it does, when to use it. */
  summary?: string;
  fields?: MindooDBAppAgentGuideField[];
  /** JSON values an agent can send as they are; shown as ```json blocks. Test them. */
  examples?: unknown[];
  notes?: string[];
}

/** A group of ops, loaded together. */
export interface MindooDBAppAgentGuideGroup {
  /** Id the agent passes in `groups`: lower case, digits, `_` or `-`. */
  name: string;
  /** One line for the group list. */
  summary: string;
  /** Heading of the group's reference; default `name`. */
  title?: string;
  /**
   * The group's whole reference as Markdown, for apps that keep it elsewhere.
   * Replaces what `intro`, `ops` and `mistakes` would render; `ops` still feed
   * the signature index.
   */
  content?: string;
  /** Prose before the ops: units, addressing, what applies to all of them. */
  intro?: string;
  ops?: MindooDBAppAgentGuideOp[];
  mistakes?: string[];
}

export interface MindooDBAppAgentGuideOptions {
  /** Tool name within the app; default `ops_guide`. */
  name?: string;
  /**
   * Full tool description. Default: names `documents`, explains the two modes and
   * lists the groups.
   */
  description?: string;
  /** The tool(s) the guide documents, as agents see them (`teamedit_markdown_apply_ops`). */
  documents?: string;
  groups: MindooDBAppAgentGuideGroup[];
  /**
   * Signature index returned without `groups`. Default: one `## group` heading per
   * group with an `opName signature` line per op.
   */
  signatures?: string | (() => string);
}

const GROUP_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,47}$/;

/** The group's reference as Markdown, as the guide tool returns it. */
export function renderAgentGuideGroup(group: MindooDBAppAgentGuideGroup): string {
  if (group.content !== undefined) return group.content;
  const parts = [`# ${group.title ?? group.name}`, `> ${group.summary}`];
  if (group.intro) parts.push(group.intro.trim());
  for (const op of group.ops ?? []) {
    const lines = [`### ${op.name}`, `\`${op.signature}\``];
    if (op.summary) lines.push("", op.summary);
    if (op.fields?.length) {
      lines.push("", "| field | type | required | meaning |", "|---|---|---|---|");
      for (const field of op.fields) {
        lines.push(`| ${cell(field.name)} | ${cell(field.type)} | ${field.required ? "yes" : ""} | ${cell(field.description)} |`);
      }
    }
    for (const example of op.examples ?? []) {
      lines.push("", "```json", JSON.stringify(example), "```");
    }
    if (op.notes?.length) lines.push("", ...op.notes.map((note) => `- ${note}`));
    parts.push(lines.join("\n"));
  }
  if (group.mistakes?.length) {
    parts.push(["## Common mistakes", ...group.mistakes.map((mistake) => `- ${mistake}`)].join("\n"));
  }
  return parts.join("\n\n");
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** `opName signature` lines per group: what exists and how each op is shaped. */
export function agentGuideSignatureIndex(groups: MindooDBAppAgentGuideGroup[]): string {
  return groups
    .filter((group) => group.ops?.length)
    .map((group) => `## ${group.name}\n${group.ops!.map((op) => `${op.name} ${op.signature}`).join("\n")}`)
    .join("\n");
}

/** Every example of the guide, for a test that runs each one through the real tool. */
export function agentGuideExamples(
  groups: MindooDBAppAgentGuideGroup[],
): Array<{ group: string; op: string; example: unknown }> {
  return groups.flatMap((group) =>
    (group.ops ?? []).flatMap((op) => (op.examples ?? []).map((example) => ({ group: group.name, op: op.name, example }))),
  );
}

/**
 * Builds the guide tool. Register it next to the edit tools and point their
 * descriptions at it ("signatures and examples: <prefix>_ops_guide").
 */
export function createAgentGuideTool(options: MindooDBAppAgentGuideOptions): MindooDBAppAgentTool {
  const groups = new Map<string, MindooDBAppAgentGuideGroup>();
  for (const group of options.groups) {
    if (!GROUP_NAME_PATTERN.test(group.name)) {
      throw new Error(`Invalid guide group name "${group.name}": use lower case, digits, "_" and "-".`);
    }
    if (groups.has(group.name)) throw new Error(`Guide group "${group.name}" is defined twice.`);
    groups.set(group.name, group);
  }
  if (groups.size === 0) throw new Error("A guide needs at least one group.");
  const names = [...groups.keys()];
  const subject = options.documents ? `the op reference for ${options.documents}` : "the op reference";
  const description =
    options.description ??
    `${subject[0]!.toUpperCase()}${subject.slice(1)}. Without groups: the group list and every op's one-line ` +
      "signature. With groups: field tables, units, runnable JSON examples and common mistakes. Load the groups " +
      `you need before a batch you have not sent before. Groups: ${names.join(", ")}.`;

  return {
    name: options.name ?? "ops_guide",
    description,
    inputSchema: {
      type: "object",
      properties: {
        groups: { type: "array", items: { type: "string", enum: names } },
      },
    },
    annotations: { readOnlyHint: true },
    async execute(input) {
      const raw = Array.isArray(input.groups)
        ? input.groups.map(String)
        : typeof input.groups === "string" && input.groups
          ? [input.groups]
          : [];
      if (raw.length === 0) {
        const signatures =
          typeof options.signatures === "function"
            ? options.signatures()
            : (options.signatures ?? agentGuideSignatureIndex(options.groups));
        return {
          groups: options.groups.map((group) => `${group.name} — ${group.summary}`).join("\n"),
          signatures,
        };
      }
      const unknown = raw.filter((name) => !groups.has(name));
      if (unknown.length) {
        throw new MindooDBAppAgentToolError(
          "INVALID_INPUT",
          `Unknown group(s): ${unknown.join(", ")}. Available: ${names.join(", ")}.`,
        );
      }
      return { guide: [...new Set(raw)].map((name) => renderAgentGuideGroup(groups.get(name)!)).join("\n\n---\n\n") };
    },
  };
}
