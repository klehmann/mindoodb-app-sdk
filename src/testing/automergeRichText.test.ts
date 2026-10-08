/**
 * Rich text in Automerge-backed mock databases, as MindooDB applies it: `richText`
 * patches run `updateSpans` at their `baseHeads`, `richTextSteps` splice and mark, and
 * `getRichText` returns `Automerge.spans`. So concurrent edits merge as in Haven, and a
 * value Automerge rejects fails here too instead of only in production.
 */
import { describe, expect, it } from "vitest";

import { createMockMindooDBAppSession } from "./index";
import type { MindooDBAppRichTextSpan } from "../types";

async function openMock() {
  const mock = createMockMindooDBAppSession({
    databases: [
      {
        info: { id: "main", title: "Main", capabilities: ["read", "create", "update", "delete"] },
        automerge: true,
        documents: [{ id: "note", data: { title: "Note" } }],
      },
    ],
  });
  const database = await (await mock.bridge.connect()).openDatabase("main");
  return { mock, database };
}

const paragraph = (...text: MindooDBAppRichTextSpan[]): MindooDBAppRichTextSpan[] => [
  { type: "block", value: { type: "p", attrs: { type: "immutableString", value: "{}" } } },
  ...text,
];

describe("rich text in automerge-backed mock databases", () => {
  it("applies a snapshot at base heads when nothing changed since", async () => {
    const { database } = await openMock();
    const base = await database.documents.update("note", {
      richText: [{ path: ["body"], spans: paragraph({ type: "text", value: "Hello world" }) }],
    });
    const saved = await database.documents.update("note", {
      richText: [{ path: ["body"], baseHeads: base.heads, spans: paragraph({ type: "text", value: "Hello world", marks: { b: true } }) }],
    });
    const snapshot = await database.documents.getRichText("note", ["body"]);
    expect(snapshot.spans[1]).toEqual({ type: "text", value: "Hello world", marks: { b: true } });
    expect(snapshot.heads).toEqual(saved.heads);
  });

  /*
   * Automerge 3.5's updateSpans inside changeAt reads the text at the base heads but
   * applies its indexes to the current text: with concurrent changes it throws "out of
   * bounds", and MindooDB's recovery (empty the field, apply the snapshot again) drops
   * the concurrent edit. The mock does exactly what MindooDB does, so apps see it in
   * tests. Splices (`text`, `richTextSteps`) at old base heads merge.
   */
  it("drops a concurrent edit when a snapshot is written at older base heads, like MindooDB", async () => {
    const { mock, database } = await openMock();
    const base = await database.documents.update("note", {
      richText: [{ path: ["body"], spans: paragraph({ type: "text", value: "Hello world" }) }],
    });
    await mock.applyRemoteUpdate("main", "note", {
      richTextSteps: [{ path: ["body"], baseHeads: base.heads, steps: [{ type: "splice", index: 7, deleteCount: 0, insert: "brave " }] }],
    });
    await database.documents.update("note", {
      richText: [{ path: ["body"], baseHeads: base.heads, spans: paragraph({ type: "text", value: "Hello world!" }) }],
    });
    const { spans } = await database.documents.getRichText("note", ["body"]);
    expect(spans.filter((s) => s.type === "text").map((s) => s.value).join("")).toBe("Hello world!");
  });

  it("merges splices and marks written at older base heads", async () => {
    const { mock, database } = await openMock();
    const base = await database.documents.update("note", {
      richText: [{ path: ["body"], spans: paragraph({ type: "text", value: "Hello world" }) }],
    });
    // the text after the block marker starts at index 1
    await mock.applyRemoteUpdate("main", "note", {
      richTextSteps: [
        {
          path: ["body"],
          baseHeads: base.heads,
          steps: [{ type: "splice", index: 7, deleteCount: 0, insert: "brave ", marks: [{ index: 1, length: 5, marks: { i: true } }] }],
        },
      ],
    });
    await database.documents.update("note", {
      richTextSteps: [
        {
          path: ["body"],
          baseHeads: base.heads,
          steps: [{ type: "splice", index: 12, deleteCount: 0, insert: "!", marks: [{ index: 1, length: 5, marks: { b: true } }] }],
        },
      ],
    });
    const { spans } = await database.documents.getRichText("note", ["body"]);
    expect(spans.filter((s) => s.type === "text").map((s) => s.value).join("")).toBe("Hello brave world!");
    expect(spans.find((s) => s.type === "text" && s.value.startsWith("Hello"))).toMatchObject({ marks: { b: true, i: true } });
  });

  it("rejects an immutable string as a mark value, as Automerge does in Haven", async () => {
    const { database } = await openMock();
    await expect(
      database.documents.update("note", {
        richText: [
          {
            path: ["body"],
            spans: paragraph({ type: "text", value: "red", marks: { color: { type: "immutableString", value: "FF0000" } } }),
          },
        ],
      }),
    ).rejects.toThrow(/updateSpans/);
    // a plain string mark is fine
    await database.documents.update("note", {
      richText: [{ path: ["body"], spans: paragraph({ type: "text", value: "red", marks: { color: "FF0000" } }) }],
    });
    const { spans } = await database.documents.getRichText("note", ["body"]);
    expect(spans[1]).toEqual({ type: "text", value: "red", marks: { color: "FF0000" } });
  });

  it("validates patches like MindooDB", async () => {
    const { database } = await openMock();
    await expect(
      database.documents.update("note", { richText: [{ path: ["body"] } as never] }),
    ).rejects.toThrow("exactly one of spans or spansSequence");
    await expect(
      database.documents.update("note", { richText: [{ path: ["title"], spans: [{ type: "text", value: "x" }] }] }),
    ).resolves.toBeTruthy(); // the title is text already
    await database.documents.update("note", { set: { count: 3 } });
    await expect(
      database.documents.update("note", { richText: [{ path: ["count"], spans: [{ type: "text", value: "x" }] }] }),
    ).rejects.toThrow("non-string value");
  });

  it("splices and marks with rich-text steps", async () => {
    const { database } = await openMock();
    await database.documents.update("note", {
      richTextSteps: [
        {
          path: ["body"],
          steps: [{ type: "splice", index: 0, deleteCount: 0, insert: "bold text", marks: [{ index: 0, length: 4, marks: { b: true } }] }],
        },
      ],
    });
    const { spans } = await database.documents.getRichText("note", ["body"]);
    expect(spans).toEqual([
      { type: "text", value: "bold", marks: { b: true } },
      { type: "text", value: " text" },
    ]);
  });
});
