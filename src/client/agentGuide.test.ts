import { describe, expect, it } from "vitest";

import { MindooDBAppAgentToolError } from "./agentTools";
import {
  agentGuideExamples,
  createAgentGuideTool,
  renderAgentGuideGroup,
  type MindooDBAppAgentGuideGroup,
} from "./agentGuide";

const groups: MindooDBAppAgentGuideGroup[] = [
  {
    name: "blocks",
    summary: "insert, replace and delete blocks",
    title: "Block ops",
    intro: "Block indexes are 0-based.",
    ops: [
      {
        name: "insertContent",
        signature: "{after, markdown}",
        summary: "Inserts Markdown blocks.",
        fields: [
          { name: "after", type: "integer | {heading}", required: true, description: "-1 = start | anchor" },
          { name: "markdown", type: "string", required: true, description: "New blocks." },
        ],
        examples: [{ op: "insertContent", after: -1, markdown: "# Title" }],
        notes: ["Several blocks may follow one anchor."],
      },
      { name: "deleteBlocks", signature: "{target}" },
    ],
    mistakes: ["Indexes refer to the document before the call."],
  },
  { name: "text", summary: "find and replace", content: "# Text\nWhole reference." },
];

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as MindooDBAppAgentToolError;
  }
  throw new Error("expected a rejection");
}

describe("createAgentGuideTool", () => {
  it("describes itself and offers the groups as an enum", () => {
    const tool = createAgentGuideTool({ documents: "teamedit_markdown_apply_ops", groups });
    expect(tool.name).toBe("ops_guide");
    expect(tool.annotations).toEqual({ readOnlyHint: true });
    expect(tool.description).toMatch(/^The op reference for teamedit_markdown_apply_ops\./);
    expect(tool.description).toContain("Groups: blocks, text.");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: { groups: { type: "array", items: { type: "string", enum: ["blocks", "text"] } } },
    });
  });

  it("answers without groups with the group list and the signature index", async () => {
    const tool = createAgentGuideTool({ groups });
    expect(await tool.execute({})).toEqual({
      groups: "blocks — insert, replace and delete blocks\ntext — find and replace",
      signatures: "## blocks\ninsertContent {after, markdown}\ndeleteBlocks {target}",
    });
    const custom = createAgentGuideTool({ groups, signatures: () => "custom" });
    expect(await custom.execute({ groups: [] })).toMatchObject({ signatures: "custom" });
  });

  it("returns the requested groups once each", async () => {
    const tool = createAgentGuideTool({ groups });
    const result = (await tool.execute({ groups: ["text", "blocks", "text"] })) as { guide: string };
    expect(result.guide).toBe(`# Text\nWhole reference.\n\n---\n\n${renderAgentGuideGroup(groups[0]!)}`);
    expect(await tool.execute({ groups: "text" })).toEqual({ guide: "# Text\nWhole reference." });
  });

  it("rejects unknown groups with the available ones", async () => {
    const error = await rejection(createAgentGuideTool({ groups }).execute({ groups: ["nope"] }));
    expect(error).toBeInstanceOf(MindooDBAppAgentToolError);
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.message).toBe("Unknown group(s): nope. Available: blocks, text.");
  });

  it("checks group names", () => {
    expect(() => createAgentGuideTool({ groups: [] })).toThrow(/at least one group/);
    expect(() => createAgentGuideTool({ groups: [{ name: "Bad Name", summary: "" }] })).toThrow(/Invalid guide group/);
    expect(() => createAgentGuideTool({ groups: [groups[1]!, groups[1]!] })).toThrow(/twice/);
  });
});

describe("renderAgentGuideGroup", () => {
  it("renders intro, field tables, examples, notes and mistakes", () => {
    expect(renderAgentGuideGroup(groups[0]!)).toBe(
      [
        "# Block ops",
        "> insert, replace and delete blocks",
        "Block indexes are 0-based.",
        [
          "### insertContent",
          "`{after, markdown}`",
          "",
          "Inserts Markdown blocks.",
          "",
          "| field | type | required | meaning |",
          "|---|---|---|---|",
          "| after | integer \\| {heading} | yes | -1 = start \\| anchor |",
          "| markdown | string | yes | New blocks. |",
          "",
          "```json",
          '{"op":"insertContent","after":-1,"markdown":"# Title"}',
          "```",
          "",
          "- Several blocks may follow one anchor.",
        ].join("\n"),
        "### deleteBlocks\n`{target}`",
        "## Common mistakes\n- Indexes refer to the document before the call.",
      ].join("\n\n"),
    );
  });

  it("lists every example for tests", () => {
    expect(agentGuideExamples(groups)).toEqual([
      { group: "blocks", op: "insertContent", example: { op: "insertContent", after: -1, markdown: "# Title" } },
    ]);
  });
});
