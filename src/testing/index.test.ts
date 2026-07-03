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
});
