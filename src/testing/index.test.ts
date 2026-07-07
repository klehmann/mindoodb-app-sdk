import { afterEach, describe, expect, it } from "vitest";

import { createMindooDBAppBridge } from "../client/createMindooDBAppBridge";
import { createMindooDBRichTextHandle } from "../richTextHandle";
import { createMindooDBTextBuffer } from "../textBuffer";
import {
  createFakeBridgeHost,
  createMockMindooDBAppBridge,
} from "./index";

describe("mindoodb-app-sdk/testing", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("creates a mock bridge and session for simple app tests", async () => {
    const mock = createMockMindooDBAppBridge({
      launchContext: {
        appId: "timerecords",
        launchParameters: {
          decryptionKeyId: "payroll",
        },
      },
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read", "create"],
        },
      }],
    });

    const session = await mock.bridge.connect();
    await expect(session.getLaunchContext()).resolves.toMatchObject({
      appId: "timerecords",
      licensedProducts: [],
      launchParameters: {
        decryptionKeyId: "payroll",
      },
    });
    await expect(session.listDatabases()).resolves.toEqual([{
      id: "main",
      title: "Main",
      capabilities: ["read", "create"],
    }]);
  });

  it("delivers the host locale and pushes locale changes to subscribers", async () => {
    const mock = createMockMindooDBAppBridge({
      launchContext: {
        appId: "lehrerpult",
        locale: "de",
      },
    });

    const session = await mock.bridge.connect();
    await expect(session.getLaunchContext()).resolves.toMatchObject({
      locale: "de",
    });

    const localeChanges: string[] = [];
    const unsubscribe = session.onLocaleChange((locale) => {
      localeChanges.push(locale);
    });

    mock.emitLocaleChange("en");
    mock.emitLocaleChange("fr");
    expect(localeChanges).toEqual(["en", "fr"]);
    await expect(session.getLaunchContext()).resolves.toMatchObject({
      locale: "fr",
    });

    unsubscribe();
    mock.emitLocaleChange("de");
    expect(localeChanges).toEqual(["en", "fr"]);
  });

  it("exposes licensed products from mock sessions and fake hosts", async () => {
    const mock = createFakeBridgeHost({
      launchContext: {
        licensedProducts: ["Haven Enterprise", "Custom Product"],
      },
    });

    mock.install();
    const session = await createMindooDBAppBridge().connect();

    await expect(session.getLicensedProducts()).resolves.toEqual(["Haven Enterprise", "Custom Product"]);
    expect(mock.requests.some((request) => request.method === "session.getLicensedProducts")).toBe(true);
    mock.dispose();
  });

  it("stores and returns full-text setup on mock database handles", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [
        {
          info: {
            id: "plain",
            title: "Plain",
            capabilities: ["read", "update"],
          },
        },
        {
          info: {
            id: "preconfigured",
            title: "Preconfigured",
            capabilities: ["read"],
          },
          fulltextSetup: { enabled: true, attachments: true, language: "de" },
        },
      ],
    });

    const session = await mock.bridge.connect();

    const plain = await session.openDatabase("plain");
    await expect(plain.getFulltextSetup()).resolves.toBeNull();
    await plain.setFulltextSetup({ enabled: true, include: ["subject", "body"] });
    await expect(plain.getFulltextSetup()).resolves.toEqual({
      enabled: true,
      include: ["subject", "body"],
    });
    await plain.setFulltextSetup(null);
    await expect(plain.getFulltextSetup()).resolves.toBeNull();

    const preconfigured = await session.openDatabase("preconfigured");
    await expect(preconfigured.getFulltextSetup()).resolves.toEqual({
      enabled: true,
      attachments: true,
      language: "de",
    });
  });

  it("stores and returns extraction setup on mock database handles", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [
        {
          info: {
            id: "plain",
            title: "Plain",
            capabilities: ["read", "update"],
          },
        },
        {
          info: {
            id: "preconfigured",
            title: "Preconfigured",
            capabilities: ["read"],
          },
          extractionSetup: { enabled: true, languages: ["deu", "eng"] },
        },
      ],
    });

    const session = await mock.bridge.connect();

    const plain = await session.openDatabase("plain");
    await expect(plain.getExtractionSetup()).resolves.toBeNull();
    await plain.setExtractionSetup({ enabled: true, mimeTypes: ["image/"] });
    await expect(plain.getExtractionSetup()).resolves.toEqual({
      enabled: true,
      mimeTypes: ["image/"],
    });
    await plain.setExtractionSetup(null);
    await expect(plain.getExtractionSetup()).resolves.toBeNull();

    const preconfigured = await session.openDatabase("preconfigured");
    await expect(preconfigured.getExtractionSetup()).resolves.toEqual({
      enabled: true,
      languages: ["deu", "eng"],
    });
  });

  it("honors caller-provided document ids and is idempotent in the mock bridge", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read", "create", "update"],
        },
      }],
    });

    const session = await mock.bridge.connect();
    const database = await session.openDatabase("main");
    const created = await database.documents.create({
      id: "AppSettings",
      set: {
        title: "Initial",
      },
    });
    expect(created.id).toBe("AppSettings");

    const reCreated = await database.documents.create({
      id: "AppSettings",
      set: {
        title: "Should not overwrite",
      },
    });
    expect(reCreated.id).toBe("AppSettings");
    expect(reCreated.data).toEqual({ title: "Initial" });

    const fetched = await database.documents.get("AppSettings");
    expect(fetched).toMatchObject({
      id: "AppSettings",
      data: { title: "Initial" },
      attachments: [],
    });
  });

  it("applies top-level set and unset operations in the mock bridge", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read", "create", "update"],
        },
      }],
    });

    const session = await mock.bridge.connect();
    const database = await session.openDatabase("main");
    const created = await database.documents.create({
      set: {
        title: "Original",
        keep: true,
        removeMe: "legacy",
      },
    });
    await expect(database.documents.update(created.id, {
      set: {
        title: "Updated",
      },
      unset: ["removeMe"],
    })).resolves.toEqual({
      id: created.id,
      data: {
        title: "Updated",
        keep: true,
      },
      heads: expect.any(Array),
      attachments: [],
      updatedAt: expect.any(String),
    });
  });

  it("applies granular JSON operations in the mock bridge", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read", "create", "update"],
        },
      }],
    });

    const session = await mock.bridge.connect();
    const database = await session.openDatabase("main");
    const created = await database.documents.create({
      set: {
        teamgrid: {
          workbook: {
            worksheetOrder: ["sheet_1"],
            worksheetsById: {
              sheet_1: {
                rowOrder: ["row_1"],
                cellsById: {},
              },
            },
          },
        },
      },
    });

    const updated = await database.documents.update(created.id, {
      json: {
        baseHeads: created.heads,
        set: [{
          path: ["teamgrid", "workbook", "worksheetsById", "sheet_1", "cellsById", "row_1:col_1"],
          value: { id: "row_1:col_1", value: { kind: "number", value: 7 } },
        }],
        listInsert: [{
          path: ["teamgrid", "workbook", "worksheetsById", "sheet_1", "rowOrder"],
          index: 1,
          values: ["row_2"],
        }],
      },
    });

    expect(updated.data.teamgrid).toMatchObject({
      workbook: {
        worksheetsById: {
          sheet_1: {
            rowOrder: ["row_1", "row_2"],
            cellsById: {
              "row_1:col_1": { value: { kind: "number", value: 7 } },
            },
          },
        },
      },
    });
  });

  it("applies granular JSON text splices in the mock bridge", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read", "create", "update"],
        },
      }],
    });

    const session = await mock.bridge.connect();
    const database = await session.openDatabase("main");
    const created = await database.documents.create({
      set: {
        bodyDoc: {
          version: 2,
          blocksById: {
            p1: { id: "p1", type: "paragraph", text: "Hello" },
          },
          blockOrder: ["p1"],
          blocks: [{ id: "p1", type: "paragraph", text: "Hello" }],
        },
      },
    });

    const updated = await database.documents.update(created.id, {
      json: {
        baseHeads: created.heads,
        textSplice: [{
          path: ["bodyDoc", "blocksById", "p1", "text"],
          index: 5,
          deleteCount: 0,
          insert: " world",
        }],
      },
    });

    expect((updated.data.bodyDoc as any).blocksById.p1.text).toBe("Hello world");
  });

  it("flushes buffered text edits through the mock bridge", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read", "create", "update"],
        },
      }],
    });

    const session = await mock.bridge.connect();
    const database = await session.openDatabase("main");
    const created = await database.documents.create({
      set: {
        body: "Hello world",
      },
    });
    const buffer = createMindooDBTextBuffer({
      database,
      document: created,
      path: ["body"],
    });

    buffer.replaceText("Hello collaborative world");
    expect(buffer.value).toBe("Hello collaborative world");
    expect(buffer.dirty).toBe(true);

    const result = await buffer.flush();
    expect(result.value).toBe("Hello collaborative world");
    expect(result.reconciled).toBe(false);
    expect(buffer.dirty).toBe(false);
    await expect(database.documents.get(created.id)).resolves.toMatchObject({
      data: {
        body: "Hello collaborative world",
      },
      heads: expect.any(Array),
    });
  });

  it("flushes rich-text spans through the mock bridge", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read", "create", "update"],
        },
      }],
    });

    const session = await mock.bridge.connect();
    const database = await session.openDatabase("main");
    const created = await database.documents.create({
      set: {
        type: "word",
        body: [],
      },
    });
    const handle = createMindooDBRichTextHandle({
      database,
      document: created,
      path: ["body"],
    });

    handle.replaceSpans([
      {
        type: "block",
        value: {
          type: { type: "immutableString", value: "paragraph" },
          parents: [],
          attrs: {},
          isEmbed: false,
        },
      },
      {
        type: "text",
        value: "Hello rich text",
        marks: {
          strong: true,
        },
      },
    ]);

    const result = await handle.flush();
    expect(result.reconciled).toBe(true);
    expect(result.snapshot.spans).toEqual([{ type: "text", value: "Hello rich text" }]);
    await expect(database.documents.getRichText(created.id, ["body"])).resolves.toMatchObject({
      spans: result.snapshot.spans,
      heads: expect.any(Array),
    });
  });

  it("flushes text edits as rich-text steps for merge-friendly saves", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read", "create", "update"],
        },
      }],
    });

    const session = await mock.bridge.connect();
    const database = await session.openDatabase("main");
    const created = await database.documents.create({
      set: {
        type: "word",
        body: [{ type: "text", value: "Hello" }],
      },
    });
    const handle = createMindooDBRichTextHandle({
      database,
      document: created,
      path: ["body"],
      spans: [{ type: "text", value: "Hello" }],
    });

    handle.replaceSpans([{ type: "text", value: "Hello world" }]);
    const result = await handle.flush();

    expect(result.snapshot.spans).toEqual([{ type: "text", value: "Hello world" }]);
    await expect(database.documents.get(created.id)).resolves.toMatchObject({
      data: {
        body: "Hello world",
      },
    });
  });

  it("connects through the real bridge using the fake host harness", async () => {
    const host = createFakeBridgeHost({
      launchContext: {
        appId: "timerecords",
        launchId: "launch-sdk-testing",
      },
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read"],
        },
        methods: {
          documents: {
            async list() {
              return {
                items: [{ id: "doc-1" }],
                nextCursor: null,
              };
            },
            async get(docId) {
              return {
                id: docId,
                data: {
                  title: "Hello",
                },
              };
            },
          },
        },
      }],
    });

    host.install();
    const session = await createMindooDBAppBridge().connect();
    const database = await session.openDatabase("main");

    await expect(session.getLaunchContext()).resolves.toMatchObject({
      appId: "timerecords",
      launchId: "launch-sdk-testing",
    });
    await expect(database.documents.list()).resolves.toEqual({
      items: [{ id: "doc-1" }],
      nextCursor: null,
    });
    await expect(database.documents.get("doc-1")).resolves.toEqual({
      id: "doc-1",
      data: {
        title: "Hello",
      },
    });

    host.dispose();
  });

  it("supports structured host-rendered menus in the mock and fake bridge helpers", async () => {
    const mock = createMockMindooDBAppBridge();
    const mockSession = await mock.bridge.connect();
    const pendingSelection = mockSession.menus.show({
      anchor: {
        type: "point",
        x: 16,
        y: 24,
      },
      items: [{
        id: "rename",
        label: "Rename",
      }],
    });
    await mockSession.menus.hide();
    await expect(pendingSelection).resolves.toEqual({
      action: "dismissed",
      reason: "hide",
    });

    const host = createFakeBridgeHost({
      requestHandlers: {
        "menus.show": () => ({
          action: "selected",
          itemId: "properties",
        }),
      },
    });

    host.install();
    const session = await createMindooDBAppBridge().connect();
    await expect(session.menus.show({
      anchor: {
        type: "rect",
        rect: {
          left: 20,
          top: 30,
          width: 80,
          height: 24,
        },
      },
      kind: "dropdown",
      items: [{
        id: "properties",
        label: "Properties",
      }],
    })).resolves.toEqual({
      action: "selected",
      itemId: "properties",
    });
    host.dispose();
  });

  it("answers summary queries with filters, sorting, and paging in the mock bridge", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read", "create"],
        },
      }],
    });

    const session = await mock.bridge.connect();
    const database = await session.openDatabase("main");
    await database.documents.create({ set: { type: "invoice", total: 250, customer: "acme" } });
    await database.documents.create({ set: { type: "invoice", total: 80, customer: "globex" } });
    await database.documents.create({ set: { type: "offer", total: 500, customer: "acme" } });

    // Formula-string filter, parsed locally by the SDK/mock.
    const filtered = await database.documents.query({
      filter: 'v.eq(v.field("type"), "invoice")',
      sortBy: [{ field: "total", direction: "descending" }],
    });
    expect(filtered.total).toBe(2);
    expect(filtered.coverage).toBe("full");
    expect(filtered.rows.map((row) => row.fields.total)).toEqual([250, 80]);

    // Paging + field projection.
    const paged = await database.documents.query({
      sortBy: [{ field: "total", direction: "ascending" }],
      offset: 1,
      limit: 1,
      fields: ["customer"],
    });
    expect(paged.total).toBe(3);
    expect(paged.rows).toHaveLength(1);
    expect(paged.rows[0].fields).toEqual({ customer: "acme" });
  });

  it("narrows documents.list by idPrefix (boundary-aware) in the mock bridge", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read", "create"],
        },
      }],
    });

    const session = await mock.bridge.connect();
    const database = await session.openDatabase("main");
    const cls1 = await database.documents.create({ idPrefix: "cls", set: { name: "5a" } });
    const cls2 = await database.documents.create({ idPrefix: "cls", set: { name: "5b" } });
    await database.documents.create({ idPrefix: "stu", set: { name: "Ada" } });
    const classroom = await database.documents.create({ idPrefix: "classroom", set: { name: "R1" } });

    const clsPage = await database.documents.list({ idPrefix: "cls", metadataOnly: true });
    expect(clsPage.items.map((item) => item.id).sort()).toEqual([cls1.id, cls2.id].sort());
    // Boundary: the `classroom_…` doc shares the "cls" substring but must not match.
    expect(clsPage.items.map((item) => item.id)).not.toContain(classroom.id);

    const stuPage = await database.documents.list({ idPrefix: "stu", metadataOnly: true });
    expect(stuPage.items).toHaveLength(1);
    expect(stuPage.items[0].id.startsWith("stu_")).toBe(true);

    // No prefix → all four documents.
    const allPage = await database.documents.list({ metadataOnly: true });
    expect(allPage.items).toHaveLength(4);
  });

  it("evaluates full-text `text` clauses in the mock bridge with relevance ordering", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read", "create"],
        },
      }],
    });

    const session = await mock.bridge.connect();
    const database = await session.openDatabase("main");
    const many = await database.documents.create({
      set: { type: "article", body: "solar power, solar panels, solar everywhere" },
    });
    const single = await database.documents.create({
      set: { type: "article", title: "solar", body: "one mention only" },
    });
    await database.documents.create({ set: { type: "article", body: "wind energy" } });
    const note = await database.documents.create({
      set: { type: "note", body: "solar notes" },
    });

    // Text clause alone: matches ordered best score first, scores exposed.
    const result = await database.documents.query({ text: { query: "solar" } });
    expect(result.total).toBe(3);
    expect(result.rows[0].docId).toBe(many.id);
    expect(result.rows.every((row) => typeof row.textScore === "number")).toBe(true);

    // Combined with a filter (logical AND).
    const filtered = await database.documents.query({
      text: { query: "solar" },
      filter: 'v.eq(v.field("type"), "note")',
    });
    expect(filtered.rows.map((row) => row.docId)).toEqual([note.id]);

    // Field restriction: only the title mentions "solar" here.
    const titleOnly = await database.documents.query({
      text: { query: "solar", fields: ["title"] },
    });
    expect(titleOnly.rows.map((row) => row.docId)).toEqual([single.id]);

    // Prefix matching is on by default; exact matching can be forced off.
    const prefixed = await database.documents.query({ text: { query: "sol" } });
    expect(prefixed.total).toBe(3);
    const exact = await database.documents.query({
      text: { query: "sol", prefix: false },
    });
    expect(exact.total).toBe(0);
  });

  it("runs the live query lifecycle in the mock bridge: initial result, coalesced updates, dispose", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read", "create", "update", "delete"],
        },
      }],
    });

    const session = await mock.bridge.connect();
    const database = await session.openDatabase("main");
    await database.documents.create({ set: { type: "task", title: "First" } });

    const results: number[] = [];
    const subscription = await database.documents.liveQuery(
      { filter: 'v.eq(v.field("type"), "task")' },
      (result) => {
        results.push(result.total);
      },
    );
    expect(results).toEqual([1]);

    // A matching mutation pushes a new result...
    await database.documents.create({ set: { type: "task", title: "Second" } });
    expect(results).toEqual([1, 2]);

    // ...a non-matching mutation is coalesced away (fingerprint unchanged).
    await database.documents.create({ set: { type: "note", title: "Ignored" } });
    expect(results).toEqual([1, 2]);

    // refresh() re-delivers even without changes.
    await subscription.refresh();
    expect(results).toEqual([1, 2, 2]);

    await subscription.dispose();
    await database.documents.create({ set: { type: "task", title: "Third" } });
    expect(results).toEqual([1, 2, 2]);
  });

  it("routes queries and live-query pushes through the fake host and real bridge", async () => {
    const host = createFakeBridgeHost({
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read", "create"],
        },
      }],
    });

    host.install();
    const session = await createMindooDBAppBridge().connect();
    const database = await session.openDatabase("main");

    await database.documents.create({ set: { type: "invoice", total: 100 } });
    await expect(
      database.documents.query({ filter: 'v.eq(v.field("type"), "invoice")' }),
    ).resolves.toMatchObject({
      total: 1,
      coverage: "full",
    });
    expect(host.requests.some((request) => request.method === "documents.query")).toBe(true);

    const totals: number[] = [];
    const subscription = await database.documents.liveQuery(
      { filter: 'v.eq(v.field("type"), "invoice")' },
      (result) => {
        totals.push(result.total);
      },
    );
    expect(totals).toEqual([1]);

    // Mutations on the host push query-result messages back over the port.
    await database.documents.create({ set: { type: "invoice", total: 300 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(totals).toEqual([1, 2]);

    await subscription.dispose();
    await database.documents.create({ set: { type: "invoice", total: 400 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(totals).toEqual([1, 2]);
    expect(
      host.requests.some((request) => request.method === "documents.liveQuery.unsubscribe"),
    ).toBe(true);

    host.dispose();
  });

  it("delivers navigator onDidUpdate pushes emitted by the fake host", async () => {
    const host = createFakeBridgeHost({
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read", "views"],
        },
      }],
    });

    host.install();
    const session = await createMindooDBAppBridge().connect();
    const navigator = await session.createViewNavigator({
      databaseIds: ["main"],
      definition: {
        id: "tasks-by-status",
        title: "Tasks",
        columns: [{
          name: "status",
          role: "category",
          expression: { kind: "field", path: "status" },
        }],
      },
    });

    const updates: Array<{ addedCount: number; removedCount: number }> = [];
    const unsubscribe = navigator.onDidUpdate((stats) => {
      updates.push(stats);
    });

    host.emitViewChanged("navigator-1", { addedCount: 3, removedCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updates).toEqual([{ addedCount: 3, removedCount: 1 }]);

    // Pushes for other navigators are ignored.
    host.emitViewChanged("navigator-999", { addedCount: 9, removedCount: 9 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updates).toHaveLength(1);

    unsubscribe();
    host.emitViewChanged("navigator-1", { addedCount: 1, removedCount: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updates).toHaveLength(1);

    host.dispose();
  });
});
