import * as Automerge from "@automerge/automerge";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMockMindooDBAppSession,
  mockDatabasesFromDefinition,
  readTestHostUrlSettings,
  type MockMindooDBAppDatabaseDefinition,
} from "./index";
import type { MindooDBAppUpdateDocumentInput } from "../types";
import { MindooDBAppValue } from "../values";

const HEAD = /^[0-9a-f]{64}$/;

function seedDefinition(automerge = true): MockMindooDBAppDatabaseDefinition {
  return {
    info: { id: "main", title: "Main", capabilities: ["read", "create", "update", "delete"] },
    automerge,
    documents: [
      {
        id: "sheet-1",
        data: {
          title: "Sheet",
          rows: ["a", "b"],
          hits: MindooDBAppValue.counter(1),
        },
      },
    ],
  };
}

async function openMock(definition = seedDefinition()) {
  const mock = createMockMindooDBAppSession({ databases: [definition] });
  const session = await mock.bridge.connect();
  const database = await session.openDatabase("main");
  return { mock, database };
}

describe("automerge-backed mock databases", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("returns real heads that change on every write", async () => {
    const { database } = await openMock();
    const seeded = await database.documents.get("sheet-1");
    expect(seeded?.heads).toHaveLength(1);
    expect(seeded?.heads?.[0]).toMatch(HEAD);
    expect(seeded?.data).toEqual({ title: "Sheet", rows: ["a", "b"], hits: 1 });

    const updated = await database.documents.update("sheet-1", {
      json: { baseHeads: seeded?.heads, set: [{ path: ["title"], value: "Renamed" }] },
    });
    expect(updated.heads?.[0]).toMatch(HEAD);
    expect(updated.heads).not.toEqual(seeded?.heads);
    expect((await database.documents.get("sheet-1"))?.heads).toEqual(updated.heads);

    const created = await database.documents.create({ set: { title: "New" } });
    expect(created.heads?.[0]).toMatch(HEAD);
    const emptyCreated = await database.documents.create({ set: {} });
    expect(emptyCreated.heads?.[0]).toMatch(HEAD);

    const listed = await database.documents.list();
    expect(listed.items.find((item) => item.id === "sheet-1")?.data).toEqual({
      title: "Renamed",
      rows: ["a", "b"],
      hits: 1,
    });
    const snapshot = await database.documents.getAutomergeSnapshot("sheet-1");
    expect(snapshot.heads).toEqual(updated.heads);
    expect(Automerge.getHeads(Automerge.load(snapshot.binary))).toEqual(updated.heads);
  });

  it("gives two mocks built from the same seed the same heads", async () => {
    const first = await openMock();
    const second = await openMock();
    expect((await first.database.documents.get("sheet-1"))?.heads).toEqual(
      (await second.database.documents.get("sheet-1"))?.heads,
    );
  });

  it("reads typed values back the way Haven returns them", async () => {
    const { database } = await openMock();
    const created = await database.documents.create({
      set: {
        code: MindooDBAppValue.atomic("ABC-1"),
        nested: { label: MindooDBAppValue.atomic("x") },
        visits: MindooDBAppValue.counter(2),
        due: MindooDBAppValue.timestamp(Date.UTC(2026, 0, 2)),
      },
    });
    expect(created.data).toEqual({
      code: "ABC-1",
      nested: { label: "x" },
      visits: 2,
      due: "2026-01-02T00:00:00.000Z",
    });
    const updated = await database.documents.update(created.id, {
      json: {
        set: [{ path: ["tags"], value: [MindooDBAppValue.atomic("red")] }],
        counterIncrement: [{ path: ["visits"], delta: 3 }],
      },
    });
    expect(updated.data.tags).toEqual(["red"]);
    expect(typeof (updated.data.tags as unknown[])[0]).toBe("string");
    expect(updated.data.visits).toBe(5);

    // The stored Automerge document really holds an ImmutableString and a Counter.
    const snapshot = await database.documents.getAutomergeSnapshot(created.id);
    const doc = Automerge.load<Record<string, any>>(snapshot.binary);
    expect(Automerge.isImmutableString(doc.code)).toBe(true);
    expect(Automerge.isCounter(doc.visits)).toBe(true);
    expect(doc.due).toBeInstanceOf(Date);
  });

  it("mirrors the host's JSON patch rules", async () => {
    const { database } = await openMock();
    // missing parents are created; unset of a missing parent is a no-op
    const updated = await database.documents.update("sheet-1", {
      json: {
        set: [{ path: ["meta", "owner"], value: "kl" }],
        unset: [{ path: ["nope", "deeper"] }],
        listInsert: [{ path: ["charts"], index: 0, values: [{ id: "c1" }] }],
      },
    });
    expect(updated.data.meta).toEqual({ owner: "kl" });
    expect(updated.data.charts).toEqual([{ id: "c1" }]);
    await expect(
      database.documents.update("sheet-1", { json: { baseHeads: updated.heads } }),
    ).rejects.toThrow("at least one operation");
    await expect(
      database.documents.update("sheet-1", {
        json: { counterIncrement: [{ path: ["title"], delta: 1 }] },
      }),
    ).rejects.toThrow("non-counter");
  });

  it("keeps both entries of concurrent inserts at the same index and baseHeads", async () => {
    const { mock, database } = await openMock();
    const loaded = await database.documents.get("sheet-1");
    const baseHeads = loaded?.heads ?? [];

    // device B writes first, at the heads the app loaded
    const remote = await mock.applyRemoteUpdate("main", "sheet-1", {
      json: { baseHeads, listInsert: [{ path: ["rows"], index: 1, values: ["remote"] }] },
    });
    expect(remote.data.rows).toEqual(["a", "remote", "b"]);

    // then the app saves its own patch authored against the same heads
    const merged = await database.documents.update("sheet-1", {
      json: { baseHeads, listInsert: [{ path: ["rows"], index: 1, values: ["local"] }] },
    });
    const rows = merged.data.rows as string[];
    expect(rows).toHaveLength(4);
    expect(rows[0]).toBe("a");
    expect(rows[3]).toBe("b");
    expect([...rows.slice(1, 3)].sort()).toEqual(["local", "remote"]);
    // two concurrent changes: the merged document has two heads
    expect(merged.heads).toHaveLength(2);

    // the other order keeps both entries too (their relative order follows
    // Automerge's op ids, as in Haven, and may differ between the two orders)
    const other = await openMock();
    await other.database.documents.update("sheet-1", {
      json: { baseHeads, listInsert: [{ path: ["rows"], index: 1, values: ["local"] }] },
    });
    const otherMerged = await other.mock.applyRemoteUpdate("main", "sheet-1", {
      json: { baseHeads, listInsert: [{ path: ["rows"], index: 1, values: ["remote"] }] },
    });
    expect([...(otherMerged.data.rows as string[])].sort()).toEqual(["a", "b", "local", "remote"]);
  });

  it("merges to the same data whichever write is applied first", async () => {
    const appPatch = (baseHeads: string[]): MindooDBAppUpdateDocumentInput => ({
      json: {
        baseHeads,
        set: [{ path: ["title"], value: "App title" }],
        listInsert: [{ path: ["rows"], index: 0, values: ["app-first"] }],
        counterIncrement: [{ path: ["hits"], delta: 2 }],
      },
    });
    const remotePatch = (baseHeads: string[]): MindooDBAppUpdateDocumentInput => ({
      json: {
        baseHeads,
        set: [{ path: ["note"], value: MindooDBAppValue.atomic("from B") }],
        // the host applies listDelete before listInsert
        listDelete: [{ path: ["rows"], index: 1, deleteCount: 1 }],
        listInsert: [{ path: ["rows"], index: 1, values: ["remote-last"] }],
        counterIncrement: [{ path: ["hits"], delta: 5 }],
      },
    });

    const appFirst = await openMock();
    const headsA = (await appFirst.database.documents.get("sheet-1"))?.heads ?? [];
    await appFirst.database.documents.update("sheet-1", appPatch(headsA));
    await appFirst.mock.applyRemoteUpdate("main", "sheet-1", remotePatch(headsA));

    const remoteFirst = await openMock();
    const headsB = (await remoteFirst.database.documents.get("sheet-1"))?.heads ?? [];
    expect(headsB).toEqual(headsA);
    await remoteFirst.mock.applyRemoteUpdate("main", "sheet-1", remotePatch(headsB));
    await remoteFirst.database.documents.update("sheet-1", appPatch(headsB));

    const left = (await appFirst.database.documents.get("sheet-1"))?.data;
    const right = (await remoteFirst.database.documents.get("sheet-1"))?.data;
    expect(left).toEqual(right);
    expect(left).toEqual({
      title: "App title",
      note: "from B",
      rows: ["app-first", "a", "remote-last"],
      hits: 8,
    });
  });

  it("lets the same remote device write twice at old heads", async () => {
    const { mock, database } = await openMock();
    const baseHeads = (await database.documents.get("sheet-1"))?.heads ?? [];
    await mock.applyRemoteUpdate("main", "sheet-1", {
      json: { baseHeads, listInsert: [{ path: ["rows"], index: 0, values: ["b1"] }] },
    });
    await mock.applyRemoteUpdate("main", "sheet-1", {
      json: { baseHeads, listInsert: [{ path: ["rows"], index: 2, values: ["b2"] }] },
    });
    // a second device, too
    await mock.applyRemoteUpdate(
      "main",
      "sheet-1",
      { json: { baseHeads, set: [{ path: ["title"], value: "C" }] } },
      { actor: "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0" },
    );
    const doc = await database.documents.get("sheet-1");
    expect(doc?.data.rows).toEqual(["b1", "a", "b2", "b"]);
    expect(doc?.data.title).toBe("C");
  });

  it("reports changed documents through the changefeed", async () => {
    const { mock, database } = await openMock();
    await database.documents.create({ id: "other", set: { title: "Other" } });
    const { cursor } = await database.documents.getHeadCursor();
    expect(await database.documents.list({ cursor, metadataOnly: true })).toEqual({ items: [], nextCursor: null });
    await mock.applyRemoteUpdate("main", "sheet-1", { json: { set: [{ path: ["title"], value: "Remote" }] } });
    await database.documents.update("other", { json: { set: [{ path: ["title"], value: "Local" }] } });
    const page = await database.documents.list({ cursor, metadataOnly: true });
    expect(page.items.map((item) => item.id)).toEqual(["sheet-1", "other"]);
    expect(await database.documents.list({ cursor: page.nextCursor, metadataOnly: true })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("merges concurrent text patches at their baseHeads", async () => {
    const { mock, database } = await openMock();
    const baseHeads = (await database.documents.get("sheet-1"))?.heads ?? [];
    await mock.applyRemoteUpdate("main", "sheet-1", {
      json: { baseHeads, textSplice: [{ path: ["title"], index: 5, deleteCount: 0, insert: " B" }] },
    });
    const merged = await database.documents.update("sheet-1", {
      text: [{ path: ["title"], baseHeads, edits: [{ index: 0, deleteCount: 0, insert: "A " }] }],
    });
    expect(merged.data.title).toBe("A Sheet B");
  });

  it("pushes remote updates to live queries", async () => {
    const { mock, database } = await openMock();
    const titles: unknown[] = [];
    const subscription = await database.documents.liveQuery({}, (result) => {
      titles.push(result.rows.find((row) => row.docId === "sheet-1")?.fields.title);
    });
    await mock.applyRemoteUpdate("main", "sheet-1", {
      set: { title: "Changed elsewhere" },
    });
    expect(titles).toEqual(["Sheet", "Changed elsewhere"]);
    await subscription.dispose();
  });

  it("keeps the plain JSON mock when the flag is off", async () => {
    const { mock, database } = await openMock(seedDefinition(false));
    const updated = await database.documents.update("sheet-1", {
      json: { baseHeads: ["ignored"], listInsert: [{ path: ["rows"], index: 0, values: ["x"] }] },
    });
    expect(updated.heads?.[0]).toMatch(/^mock-head-/);
    const remote = await mock.applyRemoteUpdate("main", "sheet-1", { set: { title: "B" } });
    expect(remote.data).toMatchObject({ title: "B", rows: ["x", "a", "b"] });
    expect(remote.heads?.[0]).toMatch(/^mock-head-/);
  });

  it("is switched on through mockDatabasesFromDefinition and the test host URL", () => {
    const definition = { databases: [{ logicalDatabaseId: "main", permissions: ["write" as const] }] };
    expect(mockDatabasesFromDefinition(definition)[0]?.automerge).toBeUndefined();
    expect(mockDatabasesFromDefinition(definition, {}, { automerge: true })[0]?.automerge).toBe(true);
    expect(readTestHostUrlSettings("?automerge=1").automerge).toBe(true);
    expect(readTestHostUrlSettings("?automerge=0").automerge).toBe(false);
    expect(readTestHostUrlSettings("").automerge).toBeUndefined();
  });
});
