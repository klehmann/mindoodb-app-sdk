import { describe, expect, it, vi } from "vitest";

import type { MockMailAccount } from "../testing";
import { MindooDBAppAccountsApiImpl } from "./accounts";
import type { PortRpcClient } from "./portRpcClient";

function fakeRpc(answer: (method: string, params: unknown) => unknown) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const rpc = {
    call: vi.fn(async (method: string, params: unknown) => {
      calls.push({ method, params });
      return answer(method, params);
    }),
  } as unknown as PortRpcClient;
  return { rpc, calls };
}

const unknownMethod = () => {
  throw Object.assign(new Error("unknown"), { code: "method-not-found" });
};

describe("session.accounts", () => {
  it("passes requests and JMAP calls to Haven", async () => {
    const { rpc, calls } = fakeRpc((method) =>
      method === "accounts.request" ? { ok: false, reason: "declined" } : { methodResponses: [] },
    );
    const api = new MindooDBAppAccountsApiImpl(rpc);
    expect(await api.request({ scopes: ["mail.read"], reason: "To sync" })).toEqual({ ok: false, reason: "declined" });
    await api.jmap("acc1", { using: ["urn:ietf:params:jmap:mail"], methodCalls: [["Mailbox/get", { accountId: "a" }, "0"]] });
    expect(calls).toEqual([
      { method: "accounts.request", params: { scopes: ["mail.read"], multiple: false, kinds: undefined, reason: "To sync" } },
      {
        method: "accounts.jmap",
        params: {
          accountId: "acc1",
          request: { using: ["urn:ietf:params:jmap:mail"], methodCalls: [["Mailbox/get", { accountId: "a" }, "0"]] },
        },
      },
    ]);
  });

  it("reports no accounts on hosts without them", async () => {
    const api = new MindooDBAppAccountsApiImpl(fakeRpc(unknownMethod).rpc);
    expect(await api.list()).toEqual([]);
    expect(await api.request({ scopes: ["mail.read"] })).toEqual({ ok: false, reason: "unsupported" });
  });

  it("refuses attachments over 25 MB before sending them", async () => {
    const { rpc, calls } = fakeRpc(() => ({}));
    const api = new MindooDBAppAccountsApiImpl(rpc);
    await expect(
      api.uploadBlob("acc1", { name: "big.bin", type: "application/octet-stream", data: new Uint8Array(25 * 1024 * 1024 + 1) }),
    ).rejects.toThrow(/25 MB/);
    expect(calls).toEqual([]);
  });
});

function mockAccount(id: string): MockMailAccount {
  return {
    id,
    kind: "jmap",
    label: id === "work" ? "Work" : "Private",
    address: `${id}@example.com`,
    services: ["mail"],
    session: () => ({
      username: `${id}@example.com`,
      capabilities: { "urn:ietf:params:jmap:core": {}, "urn:ietf:params:jmap:mail": {} },
      accounts: { a: { name: id, accountCapabilities: {} } },
      primaryAccounts: { "urn:ietf:params:jmap:mail": "a" },
    }),
    jmap: (request, scopes) => ({
      methodResponses: request.methodCalls.map(([name, , callId]) =>
        scopes.includes("mail.read") ? [name, { list: [] }, callId] : ["error", { type: "forbidden" }, callId],
      ),
    }),
  };
}

describe("mock session accounts", () => {
  it("grants on request and answers JMAP only for granted accounts", async () => {
    const { createMockMindooDBAppSession } = await import("../testing");
    const mock = createMockMindooDBAppSession({ accounts: [mockAccount("work"), mockAccount("home")] });
    expect(await mock.session.accounts.list()).toEqual([]);
    await expect(mock.session.accounts.jmapSession("work")).rejects.toMatchObject({ code: "forbidden" });

    const granted = await mock.session.accounts.request({ scopes: ["mail.read", "mail.send"] });
    expect(granted).toMatchObject({ ok: true, accounts: [{ id: "work", scopes: ["mail.read", "mail.send"] }] });
    expect(mock.getAccountGrants()).toEqual({ work: ["mail.read", "mail.send"] });

    const response = await mock.session.accounts.jmap("work", {
      using: [],
      methodCalls: [["Mailbox/get", { accountId: "a" }, "m"]],
    });
    expect(response.methodResponses[0]).toEqual(["Mailbox/get", { list: [] }, "m"]);

    await mock.session.accounts.release("work");
    expect(await mock.session.accounts.list()).toEqual([]);
  });

  it("can play a user who declines or picks a specific account", async () => {
    const { createMockMindooDBAppSession } = await import("../testing");
    const declining = createMockMindooDBAppSession({ accounts: [mockAccount("work")], accountRequest: () => null });
    expect(await declining.session.accounts.request({ scopes: ["mail.read"] })).toEqual({ ok: false, reason: "declined" });
    expect(declining.getAccountRequests()).toHaveLength(1);

    const picking = createMockMindooDBAppSession({
      accounts: [mockAccount("work"), mockAccount("home")],
      accountRequest: () => ["home"],
    });
    expect(await picking.session.accounts.request({ scopes: ["mail.read"] })).toMatchObject({
      ok: true,
      accounts: [{ id: "home", label: "Private" }],
    });
  });

  it("reports unsupported without any accounts", async () => {
    const { createMockMindooDBAppSession } = await import("../testing");
    const mock = createMockMindooDBAppSession();
    expect(await mock.session.accounts.request({ scopes: ["mail.read"] })).toEqual({ ok: false, reason: "unsupported" });
  });
});
