/**
 * Rich text in Automerge-backed mock databases, as MindooDB applies it: `richText`
 * patches run `updateSpans` at their `baseHeads`, `richTextSteps` splice and mark, and
 * `getRichText` returns `Automerge.spans`. So concurrent edits merge as in Haven, and a
 * value Automerge rejects fails here too instead of only in production.
 */
import * as Automerge from "@automerge/automerge";
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
   * applies its indexes to the current text. MindooDB (and so the mock) applies a
   * snapshot at older heads on a fork at those heads and merges it back, so a
   * concurrent edit survives.
   */
  it("keeps a concurrent edit when a snapshot is written at older base heads", async () => {
    const { mock, database } = await openMock();
    const base = await database.documents.update("note", {
      richText: [{ path: ["body"], spans: paragraph({ type: "text", value: "Hello world" }) }],
    });
    await mock.applyRemoteUpdate("main", "note", {
      richText: [{ path: ["body"], baseHeads: base.heads, spans: paragraph({ type: "text", value: "Hello brave world" }) }],
    });
    await database.documents.update("note", {
      richText: [{ path: ["body"], baseHeads: base.heads, spans: paragraph({ type: "text", value: "Hello world!", marks: { b: true } }) }],
    });
    const { spans } = await database.documents.getRichText("note", ["body"]);
    expect(spans.filter((s) => s.type === "text").map((s) => s.value).join("")).toBe("Hello brave world!");
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

  it("applies all parts of one update as one change, like MindooDB's applyDocumentUpdate", async () => {
    const { database } = await openMock();
    const base = await database.documents.update("note", {
      json: { set: [{ path: ["shape"], value: { x: 1, y: 1 } }] },
      richText: [
        { path: ["a"], spans: paragraph({ type: "text", value: "Alpha" }) },
        { path: ["b"], spans: paragraph({ type: "text", value: "Beta" }) },
      ],
    });
    const changes = async () =>
      Automerge.getAllChanges(Automerge.load((await database.documents.getAutomergeSnapshot("note")).binary)).length;
    const before = await changes();
    const saved = await database.documents.update("note", {
      json: { baseHeads: base.heads, set: [{ path: ["shape", "x"], value: 42 }] },
      richTextSteps: [
        { path: ["a"], baseHeads: base.heads, steps: [{ type: "splice", index: 6, deleteCount: 0, insert: "!" }] },
        { path: ["b"], baseHeads: base.heads, steps: [{ type: "splice", index: 1, deleteCount: 0, insert: "The " }] },
      ],
    });
    expect((await changes()) - before).toBe(1);
    expect(saved.data.shape).toEqual({ x: 42, y: 1 });
    expect(saved.data.a).toBe("\uFFFCAlpha!");
  });

  it("applies nothing of an update when one part fails", async () => {
    const { database } = await openMock();
    await database.documents.update("note", { set: { count: 3 } });
    await expect(
      database.documents.update("note", {
        json: { set: [{ path: ["moved"], value: true }] },
        richText: [{ path: ["count"], spans: [{ type: "text", value: "x" }] }],
      }),
    ).rejects.toThrow("non-string value");
    expect((await database.documents.get("note"))?.data.moved).toBeUndefined();
  });
});
