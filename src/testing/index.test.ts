import { afterEach, describe, expect, it } from "vitest";

import { createMindooDBAppBridge } from "../client/createMindooDBAppBridge";
import { createMindooDBRichTextHandle } from "../richTextHandle";
import { createMindooDBTextBuffer } from "../textBuffer";
import {
  createFakeBridgeHost,
  createMockMindooDBAppBridge,
} from "./index";
import type { MindooDBAppQueryResult, MindooDBAppQueryRow } from "../types";

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

  it("declines proposeApp by default and records what was asked", async () => {
    const mock = createFakeBridgeHost();
    mock.install();
    const session = await createMindooDBAppBridge().connect();

    // The real host needs a human to approve, so an unconfigured test sees the
    // answer it would get if nobody did.
    await expect(session.proposeApp({ url: "https://new-app.example.com" })).resolves.toEqual({
      ok: false,
      reason: "declined",
    });
    expect(mock.proposedApps).toEqual([{ url: "https://new-app.example.com" }]);
    mock.dispose();
  });

  it("returns the configured proposeApp outcome", async () => {
    const mock = createFakeBridgeHost({
      proposeApp: (input) => ({
        ok: true,
        appId: "new-app",
        appInstanceId: "instance-1",
        label: input.label ?? "New App",
        warnings: [],
      }),
    });
    mock.install();
    const session = await createMindooDBAppBridge().connect();

    await expect(
      session.proposeApp({ url: "https://new-app.example.com", label: "My App" }),
    ).resolves.toEqual({
      ok: true,
      appId: "new-app",
      appInstanceId: "instance-1",
      label: "My App",
      warnings: [],
    });
    expect(mock.requests.some((request) => request.method === "apps.propose")).toBe(true);
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
      id: "appsettings",
      set: {
        title: "Initial",
      },
    });
    expect(created.id).toBe("appsettings");

    const reCreated = await database.documents.create({
      id: "appsettings",
      set: {
        title: "Should not overwrite",
      },
    });
    expect(reCreated.id).toBe("appsettings");
    expect(reCreated.data).toEqual({ title: "Initial" });

    const fetched = await database.documents.get("appsettings");
    expect(fetched).toMatchObject({
      id: "appsettings",
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
      decryptionKeyId: "default",
    });
  });

  it("adds and removes sealed recipients in the mock bridge", async () => {
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
      set: { title: "Secret" },
      recipients: ["cn=Ada/o=Acme"],
    });
    expect(created.data._encryptFor).toEqual({
      "cn=Ada/o=Acme": { kind: "user" },
    });

    const added = await database.documents.addRecipients(created.id, ["cn=Bob/o=Acme"]);
    expect(added.data._encryptFor).toEqual({
      "cn=Ada/o=Acme": { kind: "user" },
      "cn=Bob/o=Acme": { kind: "user" },
    });

    const removed = await database.documents.removeRecipients(created.id, ["cn=Ada/o=Acme"]);
    expect(removed.data._encryptFor).toEqual({
      "cn=Bob/o=Acme": { kind: "user" },
    });
  });

  it("reports the shared key a document is encrypted with", async () => {
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
      set: { title: "Shared" },
      decryptionKeyId: "team-key",
    });
    expect(created.decryptionKeyId).toBe("team-key");

    const loaded = await database.documents.get(created.id);
    expect(loaded?.decryptionKeyId).toBe("team-key");

    const updated = await database.documents.update(created.id, { set: { title: "Still shared" } });
    expect(updated.decryptionKeyId).toBe("team-key");
  });

  it("reports no shared key for a person-encrypted document", async () => {
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
    const created = await database.documents.create({
      set: { title: "Secret" },
      recipients: ["cn=Ada/o=Acme"],
    });
    expect(created.decryptionKeyId).toBeUndefined();

    const loaded = await database.documents.get(created.id);
    expect(loaded?.decryptionKeyId).toBeUndefined();
  });

  it("rejects an empty recipient list with includeSelf: false", async () => {
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
    await expect(
      database.documents.create({
        set: { title: "Nobody" },
        recipients: [],
        recipientOptions: { includeSelf: false },
      }),
    ).rejects.toThrow(/nobody can read/);
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

  it("lets tests resolve a hanging mock drag.start", async () => {
    const mockSession = createMockMindooDBAppBridge();
    await mockSession.session.drag.setProfile({
      accepts: ["text/plain"],
    });
    expect(mockSession.getDragProfile()?.accepts).toEqual(["text/plain"]);
    const pending = mockSession.session.drag.start({
      offers: [{ type: "text/plain", data: "hi" }],
      preview: {
        png: new ArrayBuffer(8),
        width: 10,
        height: 10,
        hotspotX: 1,
        hotspotY: 1,
      },
      pointer: { x: 0, y: 0 },
    });
    mockSession.resolveDrag({ action: "copied" });
    await expect(pending).resolves.toEqual({ action: "copied" });
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

  it("joins related documents through include slots in the mock bridge", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [
        {
          info: { id: "billing", title: "Billing", capabilities: ["read", "create"] },
          documents: [
            { id: "inv_1", data: { type: "invoice", total: 250, customerId: "cust_1" } },
            { id: "inv_2", data: { type: "invoice", total: 80, customerId: "cust_2" } },
            { id: "line_1", data: { type: "line", invoiceId: "inv_1", amount: 100 } },
            { id: "line_2", data: { type: "line", invoiceId: "inv_1", amount: 150 } },
            { id: "line_3", data: { type: "line", invoiceId: "inv_2", amount: 80 } },
          ],
        },
        {
          info: { id: "customers", title: "Customers", capabilities: ["read"] },
          documents: [
            { id: "cust_1", data: { name: "Acme", countryId: "de" } },
            { id: "cust_2", data: { name: "Globex", countryId: "us" } },
          ],
        },
        {
          info: { id: "geo", title: "Geo", capabilities: ["read"] },
          documents: [{ id: "de", data: { label: "Germany" } }],
        },
      ],
    });

    const session = await mock.bridge.connect();
    const billing = await session.openDatabase("billing");

    const result = await billing.documents.query<{
      customer: MindooDBAppQueryRow | null;
      lines: MindooDBAppQueryRow[];
    }>({
      filter: 'v.eq(v.field("type"), "invoice")',
      fields: ["total"],
      sortBy: [{ field: "total", direction: "descending" }],
      include: {
        // Cross-database lookup by the parent's foreign key, plus a nested
        // slot on the related document itself.
        customer: {
          databaseId: "customers",
          cardinality: "one",
          localKey: "customerId",
          fields: ["name"],
          include: {
            country: {
              databaseId: "geo",
              cardinality: "one",
              localKey: "countryId",
              fields: ["label"],
            },
          },
        },
        // Same-database back-reference, ordered and projected.
        lines: {
          cardinality: "many",
          filter: 'v.eq(v.field("invoiceId"), v.parentDocId())',
          fields: ["amount"],
          sortBy: [{ field: "amount", direction: "descending" }],
        },
      },
    });

    expect(result.rows.map((row) => row.docId)).toEqual(["inv_1", "inv_2"]);

    const [first, second] = result.rows;
    expect(first.includes?.customer?.fields).toEqual({ name: "Acme" });
    expect(first.includes?.customer?.includes?.country).toMatchObject({
      docId: "de",
      fields: { label: "Germany" },
    });
    expect(first.includes?.lines.map((line) => line.fields.amount)).toEqual([150, 100]);

    expect(second.includes?.customer?.fields).toEqual({ name: "Globex" });
    // The nested slot of one parent must not leak onto another.
    expect(second.includes?.customer?.includes?.country).toBeNull();
    expect(second.includes?.lines.map((line) => line.docId)).toEqual(["line_3"]);
  });

  it("mirrors the host's include errors in the mock bridge", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [
        {
          info: { id: "billing", title: "Billing", capabilities: ["read"] },
          documents: [
            { id: "inv_1", data: { type: "invoice" } },
            { id: "line_1", data: { type: "line", invoiceId: "inv_1" } },
            { id: "line_2", data: { type: "line", invoiceId: "inv_1" } },
          ],
        },
      ],
    });

    const session = await mock.bridge.connect();
    const billing = await session.openDatabase("billing");
    const invoices = { filter: 'v.eq(v.field("type"), "invoice")' };

    // Several matches where a single related document was declared.
    await expect(
      billing.documents.query({
        ...invoices,
        include: {
          line: { cardinality: "one", filter: 'v.eq(v.field("invoiceId"), v.parentDocId())' },
        },
      }),
    ).rejects.toThrow(/cardinality "one", but document "inv_1" matched 2 related documents/);

    // A filter that never relates the two documents would be a full scan per row.
    await expect(
      billing.documents.query({
        ...invoices,
        include: {
          lines: { cardinality: "many", filter: 'v.eq(v.field("type"), "line")' },
        },
      }),
    ).rejects.toThrow(/cannot be joined because it does not reference the parent document/);

    // A database the app was not given.
    await expect(
      billing.documents.query({
        ...invoices,
        include: {
          customer: { databaseId: "customers", cardinality: "one", localKey: "customerId" },
        },
      }),
    ).rejects.toThrow(/which this app is not mapped to/);
  });

  it("re-fires a live query with includes when the joined database changes", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [
        {
          info: { id: "billing", title: "Billing", capabilities: ["read"] },
          documents: [{ id: "inv_1", data: { type: "invoice", customerId: "cust_1" } }],
        },
        {
          info: { id: "customers", title: "Customers", capabilities: ["read", "update"] },
          documents: [{ id: "cust_1", data: { name: "Acme" } }],
        },
      ],
    });

    const session = await mock.bridge.connect();
    const billing = await session.openDatabase("billing");
    const customers = await session.openDatabase("customers");

    const results: MindooDBAppQueryResult<{ customer: MindooDBAppQueryRow | null }>[] = [];
    const subscription = await billing.documents.liveQuery<{
      customer: MindooDBAppQueryRow | null;
    }>(
      {
        filter: 'v.eq(v.field("type"), "invoice")',
        include: {
          customer: { databaseId: "customers", cardinality: "one", localKey: "customerId" },
        },
      },
      (result) => {
        results.push(result);
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0].rows[0].includes?.customer?.fields.name).toBe("Acme");

    await customers.documents.update("cust_1", { set: { name: "Acme Inc." } });

    expect(results).toHaveLength(2);
    expect(results[1].rows[0].includes?.customer?.fields.name).toBe("Acme Inc.");

    await subscription.dispose();
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

  it("lists inaccessible seed documents without exposing them to list/get", async () => {
    const mock = createMockMindooDBAppBridge({
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read"],
        },
        documents: [
          {
            id: "dbsettings_alice",
            data: { type: "dbsettings" },
            inaccessible: true,
            decryptionKeyId: "sealed_alice",
            authorLabel: "cn=Alice/o=Acme",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "memo_own",
            data: { type: "memo" },
          },
        ],
      }],
    });

    const session = await mock.bridge.connect();
    const database = await session.openDatabase("main");
    await expect(database.documents.get("dbsettings_alice")).resolves.toBeNull();
    const visible = await database.documents.list({ metadataOnly: true });
    expect(visible.items.map((item) => item.id)).toEqual(["memo_own"]);

    const hidden = await database.documents.listInaccessible({ idPrefix: "dbsettings" });
    expect(hidden.items).toEqual([
      {
        id: "dbsettings_alice",
        createdAt: "2026-01-01T00:00:00.000Z",
        decryptionKeyId: "sealed_alice",
        authorLabel: "cn=Alice/o=Acme",
      },
    ]);
    await expect(database.documents.listInaccessible({ idPrefix: "memo" })).resolves.toEqual({
      items: [],
    });
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

  it("carries DAG parents, the revision phase, and head sets to the host", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const host = createFakeBridgeHost({
      databases: [{
        info: {
          id: "main",
          title: "Main",
          capabilities: ["read"],
        },
        methods: {
          documents: {
            async listHistory() {
              return [{
                revisionId: "rev-merge",
                timestamp: 3,
                publicKey: "pk-1",
                isDeleted: false,
                isCurrent: true,
                dependencyIds: ["rev-a", "rev-b"],
              }];
            },
            async getAtRevision(docId, revisionId, options) {
              calls.push({ call: "getAtRevision", docId, revisionId, phase: options?.phase });
              return { id: docId, revisionId, timestamp: 3, state: "missing", data: null, attachments: [] };
            },
            async getAtHeads(docId, headIds) {
              calls.push({ call: "getAtHeads", docId, headIds });
              return { id: docId, timestamp: 3, state: "missing", data: null, attachments: [] };
            },
          },
        },
      }],
    });

    host.install();
    const session = await createMindooDBAppBridge().connect();
    const database = await session.openDatabase("main");

    // A merge's parents are what a change-graph view draws its edges from.
    await expect(database.documents.listHistory("doc-1")).resolves.toMatchObject([
      { revisionId: "rev-merge", dependencyIds: ["rev-a", "rev-b"] },
    ]);

    await database.documents.getAtRevision("doc-1", "rev-merge", { phase: "before" });
    await database.documents.getAtRevision("doc-1", "rev-merge");
    await database.documents.getAtHeads("doc-1", ["rev-a", "rev-b"]);

    expect(calls).toEqual([
      { call: "getAtRevision", docId: "doc-1", revisionId: "rev-merge", phase: "before" },
      { call: "getAtRevision", docId: "doc-1", revisionId: "rev-merge", phase: undefined },
      { call: "getAtHeads", docId: "doc-1", headIds: ["rev-a", "rev-b"] },
    ]);

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
          sorting: "ascending",
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

describe("evaluating VirtualView navigators", () => {
  it("filters seeded documents with the view definition expression", async () => {
    const { createViewLanguage } = await import("mindoodb-view-language");
    const v = createViewLanguage();
    const mock = createMockMindooDBAppBridge({
      databases: [{
        info: {
          id: "teacher_core",
          title: "Core",
          capabilities: ["read", "views"],
        },
        documents: [
          {
            id: "obs_a",
            data: { type: "observation", classGroupId: "cls_a", title: "A" },
          },
          {
            id: "obs_b",
            data: { type: "observation", classGroupId: "cls_b", title: "B" },
          },
          {
            id: "task_a",
            data: {
              type: "task",
              context: { classGroupId: "cls_a" },
              title: "Task A",
            },
          },
        ],
      }],
    });

    const session = await mock.bridge.connect();
    const navigator = await session.createViewNavigator({
      databaseIds: ["teacher_core"],
      categorizationStyle: "category_then_document",
      definition: {
        id: "class-scoped-test-v1",
        title: "Class scoped",
        filter: {
          mode: "expression",
          expression: v.and(
            v.or(
              v.eq(v.field("type"), "observation"),
              v.eq(v.field("type"), "task"),
            ),
            v.eq(
              v.coalesce(v.field("classGroupId"), v.field("context.classGroupId")),
              "cls_a",
            ),
          ),
        },
        columns: [
          {
            name: "type",
            role: "category",
            expression: v.field("type"),
            sorting: "ascending",
          },
          {
            name: "title",
            role: "display",
            expression: v.field("title"),
            sorting: "ascending",
          },
          {
            name: "sourceType",
            role: "display",
            expression: v.field("type"),
          },
        ],
      },
      options: {
        includeCategories: false,
        includeDocuments: true,
        hideEmptyCategories: true,
      },
    });

    await navigator.expandAll();
    const page = await navigator.entriesForward({ limit: 100 });
    const docIds = page.entries
      .filter((entry) => entry.kind === "document")
      .map((entry) => entry.docId)
      .sort();

    expect(docIds).toEqual(["obs_a", "task_a"]);
    await navigator.dispose();
  });

  it("supports calendar-style childDocumentsBetween on sorted display columns", async () => {
    const { createViewLanguage } = await import("mindoodb-view-language");
    const v = createViewLanguage();
    const mock = createMockMindooDBAppBridge({
      databases: [{
        info: {
          id: "events",
          title: "Events",
          capabilities: ["read", "views"],
        },
        documents: [
          { id: "evt_before", data: { startsAt: "2026-09-01T00:00:00.000", title: "Before" } },
          { id: "evt_in", data: { startsAt: "2026-10-15T08:00:00.000", title: "In range" } },
          { id: "evt_after", data: { startsAt: "2026-11-20T00:00:00.000", title: "After" } },
        ],
      }],
    });

    const session = await mock.bridge.connect();
    const navigator = await session.createViewNavigator({
      databaseIds: ["events"],
      categorizationStyle: "category_then_document",
      definition: {
        id: "calendar-range-test-v1",
        title: "Calendar",
        columns: [
          {
            name: "calendarBucket",
            role: "category",
            expression: v.literal("calendar"),
            sorting: "ascending",
          },
          {
            name: "calendarStart",
            role: "display",
            expression: v.field("startsAt"),
            sorting: "ascending",
          },
          {
            name: "title",
            role: "display",
            expression: v.field("title"),
          },
        ],
      },
      options: {
        includeCategories: true,
        includeDocuments: true,
        hideEmptyCategories: true,
      },
    });

    const category = await navigator.findCategoryEntryByParts(["calendar"]);
    expect(category).not.toBeNull();
    const entries = await navigator.childDocumentsBetween(category!.key, {
      startKey: "2026-10-01T00:00:00.000",
      endKey: "2026-10-31T23:59:59.999",
    });
    expect(entries.map((entry) => entry.docId)).toEqual(["evt_in"]);
    await navigator.dispose();
  });
});
