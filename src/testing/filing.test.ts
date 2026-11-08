import { describe, expect, it } from "vitest";
import { createMockMindooDBAppBridge, createMockMindooDBAppSession } from "./index";
import type { MindooDBAppExpression, MindooDBAppViewDefinition } from "../types";

// Built by hand: the published view-language package may predate the
// filing helpers (v.folders / v.inFolder produce exactly these nodes).
const literal = (value: unknown) => ({ kind: "literal", value }) as MindooDBAppExpression;
const folders = (store: string) =>
  ({ kind: "operation", op: "folders", args: [literal(store)] }) as unknown as MindooDBAppExpression;
const inFolder = (store: string, folderId?: string) =>
  ({
    kind: "operation",
    op: "inFolder",
    args: folderId === undefined ? [literal(store)] : [literal(store), literal(folderId)],
  }) as unknown as MindooDBAppExpression;
const field = (path: string) => ({ kind: "field", path }) as MindooDBAppExpression;

function mails(ids: Array<[string, number]>) {
  return ids.map(([id, receivedAt]) => ({ id, data: { type: "message", subject: id, receivedAt } }));
}

const folderView: MindooDBAppViewDefinition = {
  id: "mail-by-folder",
  title: "Mail by folder",
  filter: { mode: "expression", expression: inFolder("mail") as never },
  columns: [
    { name: "folder", role: "category", expression: folders("mail"), sorting: "ascending" },
    { name: "receivedAt", role: "sort", expression: field("receivedAt"), sorting: "descending" },
    { name: "subject", role: "display", expression: field("subject") },
    { name: "count", role: "total", expression: literal(1), totalMode: "sum" },
  ],
};

describe("database.filing (mock host)", () => {
  it("files, moves and lists without changing the documents", async () => {
    const session = createMockMindooDBAppSession({
      databases: [
        { info: { id: "mail", title: "Mail", capabilities: ["read", "update", "views"] }, documents: mails([["m1", 1], ["m2", 2]]) },
        { info: { id: "crm", title: "CRM", capabilities: ["read"] }, documents: mails([["c1", 3]]) },
      ],
    });
    const mail = await session.session.openDatabase("mail");
    const filing = mail.filing("mail");
    const inbox = await filing.createFolder({ name: "Inbox", folderId: "inbox", role: "inbox" });
    expect(inbox).toEqual({ folderId: "inbox", name: "Inbox", parentId: null, role: "inbox", design: null });
    const projects = await filing.createFolder({ name: "Projects" });
    expect(projects.folderId).toMatch(/^fld_/);

    await filing.add("m1", "inbox");
    await filing.add({ databaseId: "crm", docId: "c1" }, ["inbox", projects.folderId]);
    await filing.move("m1", { from: "inbox", to: projects.folderId });
    expect(await filing.foldersOf("m1")).toEqual([projects.folderId]);
    expect(await filing.count("inbox")).toBe(1);
    const page = await filing.contents(projects.folderId, { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe("1");
    const rest = await filing.contents(projects.folderId, { cursor: page.nextCursor });
    expect([...page.items, ...rest.items].map((e) => `${e.databaseId}/${e.docId}`).sort()).toEqual(["crm/c1", "mail/m1"]);

    await filing.renameFolder(projects.folderId, "Projekte");
    expect((await filing.getFolder(projects.folderId))?.name).toBe("Projekte");
    await filing.deleteFolder("inbox", { keepFiling: true });
    expect(await filing.foldersOf({ databaseId: "crm", docId: "c1" })).toEqual([projects.folderId]);
    expect((await filing.listFolders()).map((folder) => folder.folderId)).toEqual([projects.folderId]);
    expect((await mail.documents.get("m1"))?.data).toEqual({ type: "message", subject: "m1", receivedAt: 1 });
  });

  it("requires update on the filing database when capabilities are enforced", async () => {
    const session = createMockMindooDBAppSession({
      enforceCapabilities: true,
      databases: [{ info: { id: "mail", title: "Mail", capabilities: ["read"] }, documents: mails([["m1", 1]]) }],
    });
    const filing = (await session.session.openDatabase("mail")).filing("mail");
    await expect(filing.add("m1", "inbox")).rejects.toThrow(/update/);
    expect(await filing.foldersOf("m1")).toEqual([]);
  });
});

describe("filing.prune (mock host)", () => {
  it("takes deleted documents out of their folders after the grace period", async () => {
    const session = createMockMindooDBAppSession({
      databases: [
        { info: { id: "mail", title: "Mail", capabilities: ["read", "update", "delete"] }, documents: mails([["m1", 1], ["m2", 2]]) },
        { info: { id: "crm", title: "CRM", capabilities: ["read", "delete"] }, documents: mails([["c1", 3]]) },
      ],
    });
    const mail = await session.session.openDatabase("mail");
    const crm = await session.session.openDatabase("crm");
    const filing = mail.filing("mail");
    await filing.add("m1", "inbox");
    await filing.add("m2", "inbox");
    await filing.add({ databaseId: "crm", docId: "c1" }, "inbox");
    await mail.documents.delete("m1");
    await crm.documents.delete("c1");

    expect(await filing.prune()).toEqual({ removed: 0, pending: 1 }); // 30 days by default
    expect(await filing.prune({ gracePeriodMs: 0 })).toEqual({ removed: 1, pending: 0 });
    expect(await filing.foldersOf("m1")).toEqual([]);
    expect(await filing.foldersOf("m2")).toEqual(["inbox"]);
    // Other databases only when named.
    expect(await filing.foldersOf({ databaseId: "crm", docId: "c1" })).toEqual(["inbox"]);
    expect(await filing.prune({ databaseIds: ["crm"], gracePeriodMs: 0 })).toEqual({ removed: 1, pending: 0 });
    expect(await filing.count("inbox")).toBe(1);
  });
});

describe("views with filing stores (mock host, over the bridge)", () => {
  it("categorizes by folder, updates live and merges several categories", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [
        {
          info: { id: "mail", title: "Mail", capabilities: ["read", "update", "views"] },
          documents: mails([["a1", 10], ["a2", 7], ["b1", 9], ["b2", 4], ["x", 1]]),
        },
      ],
    });
    const session = await mock.bridge.connect();
    const mail = await session.openDatabase("mail");
    const filing = mail.filing("mail");
    await filing.add("a1", "acc1/inbox");
    await filing.add("a2", "acc1/inbox");
    await filing.add("b1", "acc2/INBOX");
    await filing.add("b2", ["acc2/INBOX", "acc1/inbox"]);

    const navigator = await session.createViewNavigator({
      databaseIds: ["mail"],
      definition: folderView,
      filingStores: [{ name: "mail", databaseId: "mail", store: "mail" }],
      options: { includeCategories: false },
    });
    await navigator.expandAll();
    const ids = async () =>
      (await navigator.entriesForward({ limit: 100 })).entries.map((e) => (e.categoryPath ?? []).join("\\") + ":" + e.docId);
    expect(await ids()).toEqual(["acc1/inbox:a1", "acc1/inbox:a2", "acc1/inbox:b2", "acc2/INBOX:b1", "acc2/INBOX:b2"]);

    const categories = await session.createViewNavigator({
      databaseIds: ["mail"],
      definition: { ...folderView, id: "mail-by-folder-categories" },
      filingStores: [{ name: "mail", databaseId: "mail", store: "mail" }],
      options: { includeDocuments: false },
    });
    const top = (await categories.entriesForward({ limit: 10 })).entries.map((e) => [e.categoryValue, e.columnValues.count]);
    expect(top).toEqual([["acc1/inbox", 3], ["acc2/INBOX", 2]]);

    let updates = 0;
    navigator.onDidUpdate(() => updates++);
    await filing.add("x", "acc2/INBOX");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(updates).toBeGreaterThan(0);

    const merged = await session.createViewNavigator({
      databaseIds: ["mail"],
      definition: { ...folderView, id: "mail-by-folder-merged" },
      filingStores: [{ name: "mail", databaseId: "mail", store: "mail" }],
      options: { rootCategoryPaths: [["acc1/inbox"], ["acc2/INBOX"]] },
    });
    const first = await merged.entriesForward({ limit: 3 });
    expect(first.entries.map((e) => e.docId)).toEqual(["a1", "b1", "a2"]);
    expect(first.hasMore).toBe(true);
    const second = await merged.entriesForward({ startPosition: first.nextPosition!, limit: 10 });
    // b2 is in both folders but listed once.
    expect(second.entries.map((e) => e.docId)).toEqual(["b2", "x"]);
    expect(second.hasMore).toBe(false);
    const backward = await merged.entriesBackward({ limit: 2 });
    expect(backward.entries.map((e) => e.docId)).toEqual(["x", "b2"]);
  });
});
