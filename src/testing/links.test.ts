/** @vitest-environment jsdom */
/** `session.links` in both mocks: creating links and receiving opened ones. */
import { describe, expect, it } from "vitest";

import { createMindooDBAppBridge } from "../client/createMindooDBAppBridge";
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
});
