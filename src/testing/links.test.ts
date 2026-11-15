/** @vitest-environment jsdom */
/** `session.links` in both mocks: creating links and receiving opened ones. */
import { describe, expect, it } from "vitest";

import { createMindooDBAppBridge } from "../client/createMindooDBAppBridge";
import { MindooDBAppLinksApiImpl } from "../client/links";
import type { PortRpcClient } from "../client/portRpcClient";
import type { MindooDBAppLinkOpened } from "../types";
import { createFakeBridgeHost, createMockMindooDBAppSession } from "./index";

const databases = [{ info: { id: "invoices", title: "Invoices", capabilities: ["read" as const] }, documents: [] }];

describe("session.links", () => {
  it("creates links to the app's documents and refuses unmapped databases (Level 1)", async () => {
    const mock = createMockMindooDBAppSession({ databases, launchContext: { appId: "mindoodb-app-invoice", tenantId: "t_8f3k2m" } });
    const session = await mock.bridge.connect();
    expect(await session.links.create({ databaseId: "invoices", docId: "inv_2026_0012", target: "line=l_4", title: "Invoice [RE-12]" })).toEqual({
      url: "https://haven.mindoodb.com/open/t_8f3k2m/mindoodb-app-invoice/invoices/inv_2026_0012#line=l_4",
      markdown: "[Invoice \\[RE-12\\]](https://haven.mindoodb.com/open/t_8f3k2m/mindoodb-app-invoice/invoices/inv_2026_0012#line=l_4)",
    });
    expect((await session.links.create({ databaseId: "invoices", docId: "a b/c" })).url).toMatch(/\/invoices\/a%20b%2Fc$/);
    await expect(session.links.create({ databaseId: "other", docId: "x" })).rejects.toThrow(/maps no database/);
    expect(mock.links.created().map((link) => link.input.docId)).toEqual(["inv_2026_0012", "a b/c"]);

    const opened: MindooDBAppLinkOpened[] = [];
    mock.links.open({ databaseId: "invoices", docId: "early" });
    session.links.onOpened((link) => {
      opened.push(link);
    });
    mock.links.open({ databaseId: "invoices", docId: "inv_2026_0012", target: "line=l_4" });
    await expect.poll(() => opened).toEqual([
      { databaseId: "invoices", docId: "early" },
      { databaseId: "invoices", docId: "inv_2026_0012", target: "line=l_4" },
    ]);
  });

  it("works over the bridge port, holding links until the app listens (Level 2)", async () => {
    const host = createFakeBridgeHost({ databases, launchContext: { appId: "mindoodb-app-invoice" } });
    host.install();
    try {
      const session = await createMindooDBAppBridge().connect();
      const link = await session.links.create({ databaseId: "invoices", docId: "inv_1" });
      expect(link.url).toBe("https://haven.mindoodb.com/open/t_mocktenant/mindoodb-app-invoice/invoices/inv_1");
      host.links.open({ databaseId: "invoices", docId: "inv_1", target: "line=l_2" });
      const opened: MindooDBAppLinkOpened[] = [];
      session.links.onOpened((entry) => {
        opened.push(entry);
      });
      await expect.poll(() => opened).toEqual([{ databaseId: "invoices", docId: "inv_1", target: "line=l_2" }]);
      host.links.open({ databaseId: "invoices", docId: "inv_2" });
      await expect.poll(() => opened.length).toBe(2);
      await expect(session.links.create({ databaseId: "invoices", docId: "x", target: "y".repeat(501) })).rejects.toThrow(/500/);
    } finally {
      host.dispose();
    }
  });

  it("copies links through Haven in both mocks", async () => {
    const mock = createMockMindooDBAppSession({ databases, launchContext: { appId: "mindoodb-app-invoice", tenantId: "t_8f3k2m" } });
    const session = await mock.bridge.connect();
    expect(await session.links.copy({ databaseId: "invoices", docId: "inv_1", title: "RE-1" })).toEqual({
      url: "https://haven.mindoodb.com/open/t_8f3k2m/mindoodb-app-invoice/invoices/inv_1",
      markdown: "[RE-1](https://haven.mindoodb.com/open/t_8f3k2m/mindoodb-app-invoice/invoices/inv_1)",
      status: "copied",
    });
    mock.links.answerCopy("shown");
    expect((await session.links.copy({ databaseId: "invoices", docId: "inv_2" })).status).toBe("shown");
    expect(mock.links.copied().map((link) => link.input.docId)).toEqual(["inv_1", "inv_2"]);
    await expect(session.links.copy({ databaseId: "other", docId: "x" })).rejects.toThrow(/maps no database/);

    const host = createFakeBridgeHost({ databases, launchContext: { appId: "mindoodb-app-invoice" } });
    host.install();
    try {
      const bridged = await createMindooDBAppBridge().connect();
      const copied = await bridged.links.copy({ databaseId: "invoices", docId: "inv_3", target: "line=l_1" });
      expect(copied).toEqual({
        url: "https://haven.mindoodb.com/open/t_mocktenant/mindoodb-app-invoice/invoices/inv_3#line=l_1",
        markdown: "https://haven.mindoodb.com/open/t_mocktenant/mindoodb-app-invoice/invoices/inv_3#line=l_1",
        status: "copied",
      });
      expect(host.links.copied().map((link) => link.input.target)).toEqual(["line=l_1"]);
    } finally {
      host.dispose();
    }
  });

  it("copies from the app's frame when Haven does not know links.copy", async () => {
    const url = "https://haven.mindoodb.com/open/t/a/invoices/inv_1";
    const calls: string[] = [];
    const rpc = {
      addMessageListener: () => () => undefined,
      call: async (method: string) => {
        calls.push(method);
        if (method === "links.copy") throw Object.assign(new Error("Unknown method."), { name: "method-not-found" });
        return { url, markdown: url };
      },
    } as unknown as PortRpcClient;
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
    try {
      const links = new MindooDBAppLinksApiImpl(rpc);
      expect(await links.copy({ databaseId: "invoices", docId: "inv_1" })).toEqual({ url, markdown: url, status: "copiedByApp" });
      expect(calls).toEqual(["links.copy", "links.create"]);
      expect(written).toEqual([url]);

      const failing = new MindooDBAppLinksApiImpl({
        addMessageListener: () => () => undefined,
        call: async () => {
          throw Object.assign(new Error('The app maps no database "x".'), { name: "database-not-found" });
        },
      } as unknown as PortRpcClient);
      await expect(failing.copy({ databaseId: "x", docId: "y" })).rejects.toThrow(/maps no database/);
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("parses links to app documents and nothing else", async () => {
    const mock = createMockMindooDBAppSession({ databases, launchContext: { appId: "mindoodb-app-invoice", tenantId: "t_8f3k2m" } });
    const session = await mock.bridge.connect();
    expect(session.links.parse("https://haven.mindoodb.com/open/t_8f3k2m/mindoodb-app-crm/deals/d%201#tab=notes")).toEqual({
      tenantId: "t_8f3k2m",
      appId: "mindoodb-app-crm",
      databaseId: "deals",
      docId: "d 1",
      target: "tab=notes",
    });
    expect(session.links.parse("https://haven.example.org/intranet/open/t/a/db/doc")).toEqual({ tenantId: "t", appId: "a", databaseId: "db", docId: "doc" });
    for (const other of [
      "https://mindoodb.com/",
      "https://haven.mindoodb.com/open/t/a/db",
      "https://haven.mindoodb.com/open/t/a/db/doc/more",
      "javascript:alert(1)",
      "mailto:a@b.c",
      "not a url",
    ]) {
      expect(session.links.parse(other)).toBeNull();
    }
  });

  it("opens links in Haven: own links reach onOpened, foreign ones are Haven's business (both levels)", async () => {
    const mock = createMockMindooDBAppSession({ databases, launchContext: { appId: "mindoodb-app-invoice", tenantId: "t_8f3k2m" } });
    const session = await mock.bridge.connect();
    const opened: MindooDBAppLinkOpened[] = [];
    session.links.onOpened((link) => {
      opened.push(link);
    });
    const own = await session.links.create({ databaseId: "invoices", docId: "inv_7", target: "line=2" });
    expect(await session.links.open(own.url)).toEqual({ status: "opened" });
    await expect.poll(() => opened).toEqual([{ databaseId: "invoices", docId: "inv_7", target: "line=2" }]);

    const foreign = "https://haven.mindoodb.com/open/t_8f3k2m/mindoodb-app-crm/deals/d_1";
    expect(await session.links.open(foreign)).toEqual({ status: "opened" });
    mock.links.answerOpen("noApp");
    expect(await session.links.open(foreign)).toEqual({ status: "noApp" });
    expect(await session.links.open("https://mindoodb.com/")).toEqual({ status: "invalid" });
    expect(mock.links.openRequests().map((parts) => parts.appId)).toEqual([
      "mindoodb-app-invoice",
      "mindoodb-app-crm",
      "mindoodb-app-crm",
    ]);

    const host = createFakeBridgeHost({ databases, launchContext: { appId: "mindoodb-app-invoice" } });
    host.install();
    try {
      const bridged = await createMindooDBAppBridge().connect();
      expect(await bridged.links.open(foreign)).toEqual({ status: "opened" });
      expect(host.links.openRequests()).toHaveLength(1);
    } finally {
      host.dispose();
    }
  });
});
