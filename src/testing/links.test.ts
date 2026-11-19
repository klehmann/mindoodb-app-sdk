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
      expect(calls).toEqual(["links.create", "links.copy"]);
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

  it("writes the clipboard from the frame within the click and lets Haven confirm it", async () => {
    const url = "https://haven.mindoodb.com/open/t/a/invoices/inv_1";
    const calls: Array<[string, unknown]> = [];
    const links = new MindooDBAppLinksApiImpl({
      addMessageListener: () => () => undefined,
      call: async (method: string, params: unknown) => {
        calls.push([method, params]);
        return method === "links.copy" ? { url, markdown: url, status: "copied" } : { url, markdown: url };
      },
    } as unknown as PortRpcClient);
    const written: Record<string, string>[] = [];
    class FakeItem {
      constructor(readonly items: Record<string, Promise<Blob>>) {}
    }
    const stubs = { ClipboardItem: FakeItem };
    Object.assign(globalThis, stubs);
    let startedSync = false;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (list: FakeItem[]) => {
          startedSync = calls.length === 1; // only links.create was sent yet
          const out: Record<string, string> = {};
          for (const [type, blob] of Object.entries(list[0]!.items)) out[type] = await (await blob).text();
          written.push(out);
        },
      },
    });
    try {
      expect(await links.copy({ databaseId: "invoices", docId: "inv_1", title: "RE <1>" })).toEqual({ url, markdown: url, status: "copied" });
      expect(startedSync).toBe(true);
      expect(written).toEqual([{ "text/plain": url, "text/html": `<a href="${url}">RE &#60;1&#62;</a>` }]);
      expect(calls.map(([method]) => method)).toEqual(["links.create", "links.copy"]);
      expect(calls[1]![1]).toMatchObject({ copied: true, title: "RE <1>" });
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
      Reflect.deleteProperty(globalThis, "ClipboardItem");
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

  it("opens any URL through Haven: web, mail, app documents (both levels)", async () => {
    const mock = createMockMindooDBAppSession({ databases, launchContext: { appId: "mindoodb-app-invoice", tenantId: "t_8f3k2m" } });
    const session = await mock.bridge.connect();
    const opened: MindooDBAppLinkOpened[] = [];
    session.links.onOpened((link) => {
      opened.push(link);
    });
    expect(await session.links.openUrl("https://example.com/page?q=1#top")).toEqual({ status: "external" });
    expect(await session.links.openUrl("mailto:anna@example.com")).toEqual({ status: "external" });
    mock.links.answerOpenUrl("navigated");
    expect(await session.links.openUrl("https://haven.mindoodb.com/inspect/t_8f3k2m/db/doc")).toEqual({ status: "navigated" });
    const own = await session.links.create({ databaseId: "invoices", docId: "inv_9" });
    expect(await session.links.openUrl(own.url)).toEqual({ status: "opened" });
    await expect.poll(() => opened).toEqual([{ databaseId: "invoices", docId: "inv_9" }]);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "/relative", "", "https://"]) {
      expect(await session.links.openUrl(bad)).toEqual({ status: "invalid" });
    }
    expect(mock.links.openedUrls()).toEqual([
      "https://example.com/page?q=1#top",
      "mailto:anna@example.com",
      "https://haven.mindoodb.com/inspect/t_8f3k2m/db/doc",
      own.url,
    ]);

    const host = createFakeBridgeHost({ databases, launchContext: { appId: "mindoodb-app-invoice" } });
    host.install();
    try {
      const bridged = await createMindooDBAppBridge().connect();
      expect(await bridged.links.openUrl("tel:+4930123")).toEqual({ status: "external" });
      host.links.answerOpenUrl("shown");
      expect(await bridged.links.openUrl("https://example.com/")).toEqual({ status: "shown" });
      expect(host.links.openedUrls()).toEqual(["tel:+4930123", "https://example.com/"]);
    } finally {
      host.dispose();
    }
  });

  it("opens URLs from the app's frame when Haven does not know links.openUrl", async () => {
    const calls: Array<[string, unknown]> = [];
    const links = new MindooDBAppLinksApiImpl({
      addMessageListener: () => () => undefined,
      call: async (method: string, params: unknown) => {
        calls.push([method, params]);
        if (method === "links.openUrl") throw Object.assign(new Error("Unknown method."), { name: "method-not-found" });
        return { status: "opened" };
      },
    } as unknown as PortRpcClient);
    const opens: Array<[string, string | undefined, string | undefined]> = [];
    let answer: { opener: unknown } | null = { opener: window };
    const originalOpen = window.open;
    window.open = ((url: string, target?: string, features?: string) => {
      opens.push([url, target, features]);
      return answer;
    }) as typeof window.open;
    try {
      expect(await links.openUrl("https://example.com/a")).toEqual({ status: "external" });
      // Without "noopener", so the answer says whether it opened; the page gets no opener.
      expect(opens).toEqual([["https://example.com/a", "_blank", undefined]]);
      expect(answer?.opener).toBeNull();
      answer = null;
      expect(await links.openUrl("https://example.com/b")).toEqual({ status: "failed" });
      // App document links still go to Haven's links.open.
      expect(await links.openUrl("https://haven.mindoodb.com/open/t/a/invoices/inv_1")).toEqual({ status: "opened" });
      expect(calls.map(([method]) => method)).toEqual(["links.openUrl", "links.openUrl", "links.openUrl", "links.open"]);
      expect(opens).toHaveLength(2);

      const refusing = new MindooDBAppLinksApiImpl({
        addMessageListener: () => () => undefined,
        call: async () => {
          throw Object.assign(new Error("Not a URL Haven opens."), { name: "invalid-params" });
        },
      } as unknown as PortRpcClient);
      expect(await refusing.openUrl("https://example.com/c")).toEqual({ status: "invalid" });
      expect(opens).toHaveLength(2);
    } finally {
      window.open = originalOpen;
    }
  });
});
